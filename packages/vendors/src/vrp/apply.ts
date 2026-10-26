/**
 * Ejecución de intenciones de VRP: cambios de configuración (con la
 * reconciliación de cada área y la convergencia de la red), `display`, cambios
 * de vista, `save` con su pregunta, `ping` y `tracert` con el formato del equipo.
 */
import {
  type ApplyPolicy,
  applyOps,
  converge,
  ping as corePing,
  type Device,
  type DriverContext,
  type DriverError,
  type DriverOutcome,
  err,
  formatIpv4,
  type Ipv4,
  type Network,
  type Op,
  ok,
  parseIpv4,
  type Result,
  resolveName,
  saveScript,
  trace,
} from '@nos/core';
import { AREAS, DISPLAYS } from './commands';
import { currentConfiguration, displayThis } from './config-text';
import { ctxOf } from './grammar';
import type { DisplayView, VrpAction, VrpIntent, VrpSessionChange } from './intent';
import { parentView, type VrpSession } from './session';

type Ctx = DriverContext<VrpSession>;
type Outcome = Result<DriverOutcome<VrpSession>, DriverError>;

/** VRP no deja borrar lo que otra parte de la configuración está usando. */
const VRP_POLICY: ApplyPolicy = { danglingRefs: 'reject' };

/** Archivo donde `save` deja la configuración. */
export const SAVED_CONFIG = 'vrpcfg.zip';

const done = (net: Network, session: VrpSession, output = ''): Outcome =>
  ok({ net, session, output });

const vendor = (code: string): DriverError => ({ kind: 'vendor', code });

function replaceDevice(net: Network, device: Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === device.id ? device : d)) };
}

const deviceIn = (net: Network, device: Device): Device =>
  net.devices.find((d) => d.id === device.id) ?? device;

// ── Configuración ───────────────────────────────────────────────────────────

function applyConfig(
  ops: readonly Op[],
  net: Network,
  device: Device,
  session: VrpSession,
): Outcome {
  if (ops.length === 0) return done(net, session);
  const applied = applyOps(device, ops, VRP_POLICY);
  if (!applied.ok) return err({ kind: 'core', error: applied.error.error });
  // Cada área deja el modelo coherente (pools enlazados, NAT al día...).
  let current = applied.value.device;
  for (const area of AREAS) {
    const extra = area.reconcile?.(current) ?? [];
    if (extra.length === 0) continue;
    const fixed = applyOps(current, extra, VRP_POLICY);
    if (!fixed.ok) return err({ kind: 'core', error: fixed.error.error });
    current = fixed.value.device;
  }
  return done(converge(replaceDevice(net, current)), session);
}

// ── Display ─────────────────────────────────────────────────────────────────

export function renderDisplay(view: DisplayView, ctx: Ctx): string {
  switch (view.what) {
    case 'current-configuration':
      return currentConfiguration(ctx.device);
    case 'this':
      return displayThis(ctx.device, ctx.session.view);
    case 'saved-configuration': {
      const file = ctx.device.storage.files.find((f) => f.name === SAVED_CONFIG);
      return file?.payload.kind === 'script' ? file.payload.text : '';
    }
    case 'version':
      return [
        'Huawei Versatile Routing Platform Software',
        'VRP (R) software, Version 5.160 (Network Labs simulator)',
        `${ctx.device.config.system.identity} uptime is 0 week, 0 day, 0 hour, 1 minute`,
      ].join('\n');
    default: {
      const display = DISPLAYS[view.what];
      return display ? display(ctxOf(ctx), view.arg) : '';
    }
  }
}

// ── Sesión ──────────────────────────────────────────────────────────────────

function applySession(change: VrpSessionChange, ctx: Ctx): Outcome {
  const { net, session } = ctx;
  switch (change.kind) {
    case 'enter':
      return done(net, { ...session, view: change.view });
    case 'quit': {
      const parent = parentView(session.view);
      if (!parent) return ok({ net, session, output: '', closed: true });
      return done(net, { ...session, view: parent });
    }
    case 'return':
      return done(net, { ...session, view: { kind: 'user' } });
    case 'interrupt':
      return done(net, { ...session, pending: null });
    case 'confirm': {
      const pending = session.pending;
      const cleared = { ...session, pending: null };
      if (!pending || !change.yes) return done(net, cleared);
      const saved = saveScript(ctx.device, SAVED_CONFIG, currentConfiguration(ctx.device), net.now);
      return done(
        replaceDevice(net, saved),
        cleared,
        'Now saving the current configuration to the slot 0.\nSave the configuration successfully.',
      );
    }
  }
}

// ── Ping y tracert ──────────────────────────────────────────────────────────

/** IP de destino: una dirección o un nombre que resuelva el DNS del equipo. */
function targetIp(net: Network, device: Device, target: string): Ipv4 | null {
  const ip = parseIpv4(target);
  if (ip !== null) return ip;
  const resolved = resolveName(net, device.id, target);
  return resolved.outcome === 'answered' ? (resolved.address ?? null) : null;
}

function applyPing(action: Extract<VrpAction, { kind: 'ping' }>, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  const dst = targetIp(net, device, action.target);
  if (dst === null) return err(vendor('unknown-host'));
  const src = action.src === undefined ? undefined : (parseIpv4(action.src) ?? undefined);
  const result = corePing(net, device.id, dst, {
    count: action.count,
    ...(src === undefined ? {} : { src }),
  });
  const shown = formatIpv4(dst);
  const hops = result.trace.forward.hops.length;
  const lines = [`  PING ${action.target}: ${action.size}  data bytes, press CTRL_C to break`];
  for (const reply of result.replies) {
    lines.push(
      reply.ok
        ? `    Reply from ${shown}: bytes=${action.size} Sequence=${reply.seq + 1} ttl=${Math.max(1, 256 - hops)} time=${Math.max(1, Math.round(reply.rttMs ?? 1))} ms`
        : '    Request time out',
    );
  }
  const received = result.replies.filter((r) => r.ok);
  const loss = ((result.replies.length - received.length) / result.replies.length) * 100;
  lines.push('', `  --- ${action.target} ping statistics ---`);
  lines.push(`    ${result.replies.length} packet(s) transmitted`);
  lines.push(`    ${received.length} packet(s) received`);
  lines.push(`    ${loss.toFixed(2)}% packet loss`);
  if (received.length > 0) {
    const times = received.map((r) => Math.max(1, Math.round(r.rttMs ?? 1)));
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    lines.push(
      `    round-trip min/avg/max = ${Math.min(...times)}/${avg}/${Math.max(...times)} ms`,
    );
  }
  return done(result.net, session, lines.join('\n'));
}

function applyTracert(target: string, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  const dst = targetIp(net, device, target);
  if (dst === null) return err(vendor('unknown-host'));
  const result = trace(net, { from: device.id, dst, protocol: 'icmp' });
  const lines = [
    ` traceroute to  ${target}(${formatIpv4(dst)}), max hops: 30 ,packet length: 40,press CTRL_C to break `,
  ];
  // Cada salto responde con la dirección de la interfaz por la que entró el paquete.
  result.forward.hops.slice(1).forEach((hop, index) => {
    const at = net.devices.find((d) => d.id === hop.device);
    const addr = at?.config.addressing.addresses.find((a) => a.iface === hop.inIface);
    const ip = addr ? formatIpv4(addr.address.ip) : formatIpv4(dst);
    lines.push(` ${index + 1} ${ip} ${index + 1} ms  ${index + 1} ms  ${index + 1} ms `);
  });
  const end = result.forward.end;
  if (end.kind === 'delivered' && end.emulated) {
    const n = result.forward.hops.length;
    lines.push(` ${n} ${formatIpv4(dst)} ${n + 9} ms  ${n + 9} ms  ${n + 9} ms `);
  } else if (end.kind !== 'delivered') {
    lines.push(` ${result.forward.hops.length} * * * `);
  }
  return done(net, session, lines.join('\n'));
}

// ── Punto de entrada ────────────────────────────────────────────────────────

function applyVendor(action: VrpAction, ctx: Ctx): Outcome {
  switch (action.kind) {
    case 'ping':
      return applyPing(action, ctx);
    case 'tracert':
      return applyTracert(action.target, ctx);
    case 'save':
      return done(
        ctx.net,
        { ...ctx.session, pending: { kind: 'save' } },
        'The current configuration will be written to the device.\nAre you sure to continue?[Y/N]:',
      );
    case 'message':
      return done(ctx.net, ctx.session, action.text);
  }
}

export function applyIntent(intent: VrpIntent, ctx: Ctx): Outcome {
  switch (intent.kind) {
    case 'noop':
      return done(ctx.net, ctx.session);
    case 'config':
      return applyConfig(intent.ops, ctx.net, ctx.device, ctx.session);
    case 'show':
      return done(ctx.net, ctx.session, renderDisplay(intent.view, ctx));
    case 'session':
      return applySession(intent.change, ctx);
    case 'vendor':
      return applyVendor(intent.action, ctx);
    case 'action':
      // VRP no usa las acciones neutrales del núcleo: ping y tracert son propias.
      return done(ctx.net, ctx.session);
    case 'sequence': {
      let net = ctx.net;
      let session = ctx.session;
      const out: string[] = [];
      for (const step of intent.steps) {
        const r = applyIntent(step, { net, device: deviceIn(net, ctx.device), session });
        if (!r.ok) return r;
        net = r.value.net;
        session = r.value.session;
        if (r.value.output) out.push(r.value.output);
      }
      return done(net, session, out.join('\n'));
    }
  }
}
