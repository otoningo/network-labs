/**
 * Ejecución de intenciones de IOS: cambios de configuración (con la
 * reconciliación de cada área, la convergencia de la red y los avisos
 * `%LINK`/`%LINEPROTO` al encender o apagar un puerto), `show` con su filtro
 * `|`, cambios de modo, las preguntas pendientes (`copy`, `erase`, `crypto
 * key`), `write memory`, `ping` y `traceroute` con el formato del equipo.
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
  saveBackup,
  trace,
} from '@nos/core';
import { ifaceByName, listedInterfaces } from './area';
import { AREAS, SHOWS } from './commands';
import { runningConfig, startupConfig } from './config-text';
import { canonicalIface, ctxOf } from './grammar';
import type { IosAction, IosIntent, IosSessionChange, OutputFilter, ShowView } from './intent';
import { metaOf, metaOps } from './meta';
import { type IosSession, isConfigView, parentView } from './session';

type Ctx = DriverContext<IosSession>;
type Outcome = Result<DriverOutcome<IosSession>, DriverError>;

/** IOS no deja borrar lo que otra parte de la configuración está usando. */
const IOS_POLICY: ApplyPolicy = { danglingRefs: 'reject' };

/** Archivo donde `write memory` deja la configuración (una instantánea neutral). */
export const SAVED_CONFIG = 'startup-config';

const CONFIG_I = '%SYS-5-CONFIG_I: Configured from console by console';

const done = (net: Network, session: IosSession, output = ''): Outcome =>
  ok({ net, session, output });

const vendor = (code: string): DriverError => ({ kind: 'vendor', code });

function replaceDevice(net: Network, device: Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === device.id ? device : d)) };
}

const deviceIn = (net: Network, device: Device): Device =>
  net.devices.find((d) => d.id === device.id) ?? device;

// ── Configuración ───────────────────────────────────────────────────────────

/** Avisos de IOS cuando un puerto se apaga o se enciende con `shutdown` / `no shutdown`. */
function linkMessages(before: Device, after: Device): string[] {
  const out: string[] = [];
  for (const iface of listedInterfaces(after)) {
    const old = before.config.interfaces.find((i) => i.id === iface.id);
    if (!old || old.disabled === iface.disabled) continue;
    const wasUp = before.oper.interfaces.find((o) => o.iface === iface.id)?.running === true;
    const isUp = after.oper.interfaces.find((o) => o.iface === iface.id)?.running === true;
    if (iface.disabled) {
      out.push(`%LINK-5-CHANGED: Interface ${iface.name}, changed state to administratively down`);
      if (wasUp) {
        out.push(
          `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to down`,
        );
      }
    } else if (isUp) {
      out.push(
        `%LINK-5-CHANGED: Interface ${iface.name}, changed state to up`,
        `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to up`,
      );
    }
  }
  return out;
}

function applyConfig(
  ops: readonly Op[],
  net: Network,
  device: Device,
  session: IosSession,
): Outcome {
  if (ops.length === 0) return done(net, session);
  const applied = applyOps(device, ops, IOS_POLICY);
  if (!applied.ok) return err({ kind: 'core', error: applied.error.error });
  // Cada área deja el modelo coherente (pools y servidores DHCP, Telnet y SSH...).
  let current = applied.value.device;
  for (const area of AREAS) {
    const extra = area.reconcile?.(current) ?? [];
    if (extra.length === 0) continue;
    const fixed = applyOps(current, extra, IOS_POLICY);
    if (!fixed.ok) return err({ kind: 'core', error: fixed.error.error });
    current = fixed.value.device;
  }
  const next = converge(replaceDevice(net, current));
  const messages = linkMessages(device, deviceIn(next, device));
  return done(next, session, messages.join('\n\n'));
}

// ── Show ────────────────────────────────────────────────────────────────────

function savedConfig(device: Device): Device['config'] | undefined {
  const file = device.storage.files.find((f) => f.name === SAVED_CONFIG);
  return file?.payload.kind === 'backup' ? file.payload.config : undefined;
}

function showVersion(device: Device): string {
  const ports = listedInterfaces(device).filter((i) => i.kind === 'ethernet').length;
  return [
    'Cisco IOS Software, Network Labs simulator (sim-ios), Version 15.1',
    'Behaviour modelled for practice; not a real Cisco image.',
    '',
    `${device.config.system.identity} uptime is 1 minute`,
    'System image file is "flash:sim-ios"',
    '',
    `${ports} Gigabit Ethernet interfaces`,
    '255K bytes of non-volatile configuration memory.',
    '',
    'Configuration register is 0x2102',
  ].join('\n');
}

/** Filtro `| include`, `| exclude`, `| begin` o `| section` sobre la salida. */
function applyFilter(text: string, filter: OutputFilter | undefined): string {
  if (!filter) return text;
  let re: RegExp;
  try {
    re = new RegExp(filter.pattern);
  } catch {
    re = new RegExp(filter.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  const lines = text.split('\n');
  switch (filter.mode) {
    case 'include':
      return lines.filter((l) => re.test(l)).join('\n');
    case 'exclude':
      return lines.filter((l) => !re.test(l)).join('\n');
    case 'begin': {
      const at = lines.findIndex((l) => re.test(l));
      return at < 0 ? '' : lines.slice(at).join('\n');
    }
    case 'section': {
      // Una sección es una línea sin sangría que coincide y las sangradas que la siguen.
      const out: string[] = [];
      let inside = false;
      for (const l of lines) {
        if (!l.startsWith(' ')) inside = re.test(l);
        else if (re.test(l) && !inside) out.push(l);
        if (inside) out.push(l);
      }
      return out.join('\n');
    }
  }
}

export function renderShow(view: ShowView, ctx: Ctx): string {
  const device = ctx.device;
  let text: string;
  switch (view.what) {
    case 'running-config':
      text = runningConfig(device);
      break;
    case 'startup-config':
      text = startupConfig(device, savedConfig(device));
      break;
    case 'version':
      text = showVersion(device);
      break;
    default: {
      const show = SHOWS[view.what];
      text = show ? show(ctxOf(ctx), view.arg) : '';
    }
  }
  return applyFilter(text, view.filter);
}

// ── Guardar y claves ────────────────────────────────────────────────────────

function save(net: Network, device: Device, session: IosSession): Outcome {
  const saved = saveBackup(device, SAVED_CONFIG, net.now);
  return done(replaceDevice(net, saved), session, 'Building configuration...\n[OK]');
}

function generateRsa(bits: number, ctx: Ctx, withName: boolean): Outcome {
  const { net, device, session } = ctx;
  const name = `${device.config.system.identity}.${metaOf(device).domain ?? ''}`;
  const applied = applyConfig(
    metaOps(device, (meta) => ({ ...meta, rsaBits: bits })),
    net,
    device,
    session,
  );
  if (!applied.ok) return applied;
  const lines = [
    ...(withName ? [`The name for the keys will be: ${name}`, ''] : []),
    `% The key modulus size is ${bits} bits`,
    `% Generating ${bits} bit RSA keys, keys will be non-exportable...`,
    '[OK] (elapsed time was 1 seconds)',
    '',
    '%SSH-5-ENABLED: SSH 1.99 has been enabled',
  ];
  return done(applied.value.net, session, lines.join('\n'));
}

// ── Sesión ──────────────────────────────────────────────────────────────────

function answer(text: string, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  const pending = session.pending;
  const cleared: IosSession = { ...session, pending: null };
  const reply = text.trim();
  const cctx: Ctx = { ...ctx, session: cleared };
  switch (pending?.kind) {
    case undefined:
      return done(net, cleared);
    case 'copy':
      if (reply === '' || reply.toLowerCase() === 'startup-config')
        return save(net, device, cleared);
      return done(net, cleared, `%Error opening nvram:${reply} (Permission denied)`);
    case 'erase': {
      if (reply !== '' && !/^(y|yes|confirm)$/i.test(reply)) return done(net, cleared);
      const files = device.storage.files.filter((f) => f.name !== SAVED_CONFIG);
      const erased = { ...device, storage: { files } };
      return done(replaceDevice(net, erased), cleared, '[OK]\nErase of nvram: complete');
    }
    case 'rsa': {
      const bits = reply === '' ? 512 : Number(reply);
      if (!/^\d*$/.test(reply) || bits < 360 || bits > 4096) {
        return done(net, cleared, '% A decimal number between 360 and 4096.');
      }
      return generateRsa(bits, cctx, false);
    }
    case 'configure': {
      if (reply === '' || 'terminal'.startsWith(reply.toLowerCase())) {
        return done(
          net,
          { ...cleared, view: { kind: 'config' } },
          'Enter configuration commands, one per line.  End with CNTL/Z.',
        );
      }
      return done(net, cleared, '?Must be "terminal", "memory" or "network"');
    }
  }
}

function applySession(change: IosSessionChange, ctx: Ctx): Outcome {
  const { net, session } = ctx;
  switch (change.kind) {
    case 'enter':
      return done(net, { ...session, view: change.view });
    case 'exit': {
      const parent = parentView(session.view);
      if (!parent) return ok({ net, session, output: '', closed: true });
      const out = session.view.kind === 'config' ? CONFIG_I : '';
      return done(net, { ...session, view: parent }, out);
    }
    case 'end':
      if (!isConfigView(session.view)) return done(net, session);
      return done(net, { ...session, view: { kind: 'priv' } }, CONFIG_I);
    case 'logout':
      return ok({ net, session, output: '', closed: true });
    case 'ask':
      return done(net, { ...session, pending: change.pending });
    case 'answer':
      return answer(change.text, ctx);
    case 'interrupt':
      if (session.pending) return done(net, { ...session, pending: null });
      if (isConfigView(session.view)) return done(net, { ...session, view: { kind: 'priv' } });
      return done(net, session);
  }
}

// ── Ping y traceroute ───────────────────────────────────────────────────────

/** IP de destino: una dirección, un `ip host` o un nombre que resuelva el DNS del equipo. */
function targetIp(net: Network, device: Device, target: string): Ipv4 | null {
  const ip = parseIpv4(target);
  if (ip !== null) return ip;
  const local = device.config.dns.static.find((s) => s.name === target && !s.disabled);
  if (local?.address !== undefined) return local.address;
  if (!metaOf(device).domainLookup) return null;
  const resolved = resolveName(net, device.id, target);
  return resolved.outcome === 'answered' ? (resolved.address ?? null) : null;
}

/**
 * Línea `Translating` que IOS imprime antes de usar un nombre que pregunta al
 * DNS. Un nombre de `ip host` se resuelve en la tabla del propio equipo, sin
 * esa línea.
 */
function translating(device: Device, target: string): string[] {
  if (parseIpv4(target) !== null) return [];
  if (device.config.dns.static.some((s) => s.name === target && !s.disabled)) return [];
  const servers = device.config.dns.servers;
  return [
    `Translating "${target}"...domain server (${servers.length > 0 ? servers.map(formatIpv4).join(' ') : '255.255.255.255'}) [OK]`,
    '',
  ];
}

/** Origen de `ping ... source`: una IP del equipo o una interfaz con dirección. */
function sourceIp(device: Device, text: string): Ipv4 | null {
  const ip = parseIpv4(text);
  const addresses = device.config.addressing.addresses;
  if (ip !== null) return addresses.some((a) => a.address.ip === ip) ? ip : null;
  const iface = ifaceByName(device, canonicalIface(text) ?? '');
  const addr = iface ? addresses.find((a) => a.iface === iface.id && !a.disabled) : undefined;
  return addr ? addr.address.ip : null;
}

function applyPing(action: Extract<IosAction, { kind: 'ping' }>, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  const dst = targetIp(net, device, action.target);
  if (dst === null) return err(vendor('unknown-host'));
  let src: Ipv4 | undefined;
  if (action.src !== undefined) {
    src = sourceIp(device, action.src) ?? undefined;
    if (src === undefined) return err(vendor('bad-source'));
  }
  const result = corePing(net, device.id, dst, {
    count: action.count,
    ...(src === undefined ? {} : { src }),
  });
  const received = result.replies.filter((r) => r.ok);
  const total = result.replies.length;
  const percent = Math.round((received.length / total) * 100);
  const lines = [
    ...translating(device, action.target),
    'Type escape sequence to abort.',
    `Sending ${total}, ${action.size}-byte ICMP Echos to ${formatIpv4(dst)}, timeout is 2 seconds:`,
    ...(src === undefined ? [] : [`Packet sent with a source address of ${formatIpv4(src)} `]),
    result.replies.map((r) => (r.ok ? '!' : '.')).join(''),
  ];
  if (received.length === 0) {
    lines.push(`Success rate is 0 percent (0/${total})`);
  } else {
    const times = received.map((r) => Math.max(1, Math.round(r.rttMs ?? 1)));
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    lines.push(
      `Success rate is ${percent} percent (${received.length}/${total}), round-trip min/avg/max = ${Math.min(...times)}/${avg}/${Math.max(...times)} ms`,
    );
  }
  return done(result.net, session, lines.join('\n'));
}

function applyTraceroute(target: string, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  const dst = targetIp(net, device, target);
  if (dst === null) return err(vendor('unknown-host'));
  const result = trace(net, { from: device.id, dst, protocol: 'icmp' });
  const lines = [
    ...translating(device, target),
    'Type escape sequence to abort.',
    `Tracing the route to ${formatIpv4(dst)}`,
    'VRF info: (vrf in name/id, vrf out name/id)',
  ];
  // Cada salto responde con la dirección de la interfaz por la que entró el paquete.
  result.forward.hops.slice(1).forEach((hop, index) => {
    const at = net.devices.find((d) => d.id === hop.device);
    const addr = at?.config.addressing.addresses.find((a) => a.iface === hop.inIface);
    const ip = addr ? formatIpv4(addr.address.ip) : formatIpv4(dst);
    const ms = index * 4;
    lines.push(`  ${index + 1} ${ip} ${ms} msec ${ms + 4} msec ${ms} msec`);
  });
  const end = result.forward.end;
  const n = result.forward.hops.length;
  if (end.kind === 'delivered' && end.emulated) {
    lines.push(`  ${n} ${formatIpv4(dst)} ${n * 4} msec ${n * 4} msec ${n * 4} msec`);
  } else if (end.kind !== 'delivered') {
    lines.push(`  ${Math.max(1, n)}  *  *  * `);
  }
  return done(net, session, lines.join('\n'));
}

// ── Punto de entrada ────────────────────────────────────────────────────────

function applyVendor(action: IosAction, ctx: Ctx): Outcome {
  switch (action.kind) {
    case 'ping':
      return applyPing(action, ctx);
    case 'traceroute':
      return applyTraceroute(action.target, ctx);
    case 'save':
      return save(ctx.net, ctx.device, ctx.session);
    case 'message':
      return done(ctx.net, ctx.session, action.text);
    case 'rsa':
      return generateRsa(action.bits, ctx, true);
  }
}

export function applyIntent(intent: IosIntent, ctx: Ctx): Outcome {
  switch (intent.kind) {
    case 'noop':
      return done(ctx.net, ctx.session);
    case 'config':
      return applyConfig(intent.ops, ctx.net, ctx.device, ctx.session);
    case 'show':
      return done(ctx.net, ctx.session, renderShow(intent.view, ctx));
    case 'session':
      return applySession(intent.change, ctx);
    case 'vendor':
      return applyVendor(intent.action, ctx);
    case 'action':
      // IOS no usa las acciones neutrales del núcleo: ping y traceroute son propias.
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
