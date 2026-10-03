/**
 * Ejecución de intenciones: aplica operaciones al modelo (con undo, log y
 * política de referencias huérfanas de RouterOS), imprime menús, gestiona la
 * sesión (menús, safe mode, confirmaciones) y corre las acciones del fabricante.
 */
import {
  type ApplyPolicy,
  applyOp,
  applyOps,
  converge,
  ping as corePing,
  type Device,
  type DriverContext,
  type DriverError,
  type DriverOutcome,
  err,
  formatIpv4,
  LOG_LIMIT,
  type LogEntry,
  type Network,
  type Op,
  ok,
  parseIpv4,
  type Result,
  readScript,
  resolveName,
  saveScript,
  type UserGroup,
} from '@nos/core';
import { describeScriptError } from './errors';
import { renderExport } from './exporter';
import { evalExpr } from './expr';
import type { PrintView, RosAction, RosIntent, RosSessionChange } from './intent';
import { parseLine } from './parser';
import { PING_HEADER, pingLine, pingSummary } from './ping';
import { ROUTEROS_PLATFORM } from './platform';
import { renderPrint } from './render';
import type { ActionOutcome, MenuCtx, Row } from './schema';
import { newSession, pushUndo, type RouterosSession } from './session';
import { MENUS, menuAt } from './tree';

type Ctx = DriverContext<RouterosSession>;
type Outcome = Result<DriverOutcome<RouterosSession>, DriverError>;

/** RouterOS deja borrar algo en uso y marca lo que dependía como inválido (D-009). */
const ROUTEROS_POLICY: ApplyPolicy = { danglingRefs: 'orphan' };

export function menuCtxOf(net: Network, device: Device, session: RouterosSession): MenuCtx {
  return {
    net,
    device,
    platform: ROUTEROS_PLATFORM,
    user: session.user,
    clockBase: session.clockBase,
  };
}

const vendor = (code: string, detail?: string): DriverError => ({
  kind: 'vendor',
  code,
  ...(detail === undefined ? {} : { detail }),
});

const done = (net: Network, session: RouterosSession, output = ''): Outcome =>
  ok({ net, session, output });

function replaceDevice(net: Network, device: Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === device.id ? device : d)) };
}

function deviceIn(net: Network, id: Device['id'], fallback: Device): Device {
  return net.devices.find((d) => d.id === id) ?? fallback;
}

// ── Permisos ────────────────────────────────────────────────────────────────

/**
 * Grupos de `/user`: `read` solo consulta, `write` cambia la configuración
 * salvo los usuarios y `full` lo puede todo.
 */
const RANK: Readonly<Record<UserGroup, number>> = { read: 0, write: 1, full: 2 };

/** Acciones de menú que solo miran (diagnóstico): las demás cambian algo. */
const READ_ACTIONS: ReadonlySet<string> = new Set(['torch', 'traceroute', 'monitor-traffic']);

/** Acciones que reemplazan la configuración entera: solo el grupo `full`. */
const FULL_ACTIONS: ReadonlySet<string> = new Set([
  'system/reset-configuration',
  'system/backup/load',
]);

/** Un usuario que no está en `/user` (pruebas, arranque de labs) tiene acceso total. */
function groupOf(device: Device, user: string): UserGroup {
  return device.config.system.users.find((u) => u.name === user)?.group ?? 'full';
}

const permitted = (device: Device, session: RouterosSession, need: UserGroup): boolean =>
  RANK[groupOf(device, session.user)] >= RANK[need];

const denied = (): Outcome => err(vendor('not-enough-permissions'));

/** Los cambios en `/user` piden `full`; el resto de la configuración, `write`. */
function opNeeds(op: Op): UserGroup {
  if (op.op === 'restore') return 'write';
  const scope = op.op === 'setSingleton' ? op.key : op.coll;
  return scope === 'users' ? 'full' : 'write';
}

function actionNeeds(action: RosAction): UserGroup {
  switch (action.kind) {
    case 'menu-action': {
      const id = `${action.path}/${action.name}`;
      if (FULL_ACTIONS.has(id) || action.path === 'user' || action.path.startsWith('user/'))
        return 'full';
      return READ_ACTIONS.has(action.name) ? 'read' : 'write';
    }
    case 'export':
      return action.file === undefined ? 'read' : 'write';
    case 'ping':
    case 'resolve':
    case 'put':
    // Cada línea del script pasa por su propia comprobación.
    case 'script':
      return 'read';
    case 'remove-other':
    case 'import':
    case 'undo':
    case 'redo':
      return 'write';
  }
}

// ── Configuración ───────────────────────────────────────────────────────────

function changeLog(op: Op, by: string, at: Network['now']): LogEntry | undefined {
  switch (op.op) {
    case 'add':
      return { at, event: { kind: 'config-change', scope: op.coll, action: 'added', by } };
    case 'set':
    case 'move':
      return { at, event: { kind: 'config-change', scope: op.coll, action: 'changed', by } };
    case 'remove':
      return { at, event: { kind: 'config-change', scope: op.coll, action: 'removed', by } };
    case 'setSingleton':
      return { at, event: { kind: 'config-change', scope: op.key, action: 'changed', by } };
    case 'restore':
      return undefined;
  }
}

function applyConfig(
  ops: readonly Op[],
  net: Network,
  device: Device,
  session: RouterosSession,
): Outcome {
  if (ops.length === 0) return done(net, session);
  if (!ops.every((op) => permitted(device, session, opNeeds(op)))) return denied();
  const result = applyOps(device, ops, ROUTEROS_POLICY);
  if (!result.ok) return err({ kind: 'core', error: result.error.error });
  const entries = ops.flatMap((op) => changeLog(op, session.user, net.now) ?? []);
  const changed = result.value.device;
  const logged: Device = {
    ...changed,
    oper: { ...changed.oper, log: [...changed.oper.log, ...entries].slice(-LOG_LIMIT) },
  };
  return done(converge(replaceDevice(net, logged)), pushUndo(session, device.config));
}

function restoreConfig(net: Network, device: Device, config: Device['config']): Network {
  const restored = applyOp(device, { op: 'restore', config }, ROUTEROS_POLICY);
  return restored.ok ? converge(replaceDevice(net, restored.value.device)) : net;
}

// ── Print ───────────────────────────────────────────────────────────────────

function printRows(view: PrintView, ctx: Ctx): { rows: Row[]; ok: boolean } {
  const menu = menuAt(view.path);
  if (!menu) return { rows: [], ok: false };
  const all = menu.rows(menuCtxOf(ctx.net, ctx.device, ctx.session));
  const where = view.where;
  return { rows: where ? all.filter((r) => evalExpr(where, r, menu)) : [...all], ok: true };
}

export function renderView(
  view: PrintView,
  ctx: Ctx,
): { text: string; numbered: readonly string[] } {
  const menu = menuAt(view.path);
  if (!menu) return { text: '', numbered: [] };
  return renderPrint(menu, printRows(view, ctx).rows, view.mode);
}

function applyPrint(view: PrintView, ctx: Ctx): Outcome {
  const menu = menuAt(view.path);
  if (!menu) return err(vendor('bad-command', 'print'));
  const printed = renderView(view, ctx);
  const session =
    view.mode === 'count'
      ? ctx.session
      : { ...ctx.session, numbering: { ...ctx.session.numbering, [view.path]: printed.numbered } };
  return done(ctx.net, session, printed.text);
}

// ── Sesión ──────────────────────────────────────────────────────────────────

function applySession(change: RosSessionChange, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  switch (change.kind) {
    case 'cd':
      return done(net, { ...session, path: change.path });
    case 'safe-toggle':
      return session.safe
        ? done(net, { ...session, safe: null }, '[Safe Mode released]')
        : done(net, { ...session, safe: { snapshot: device.config } }, '[Safe Mode taken]');
    case 'quit': {
      // Salir en safe mode deshace todo lo hecho desde que se tomó.
      const reverted = session.safe ? restoreConfig(net, device, session.safe.snapshot) : net;
      return ok({
        net: reverted,
        session: { ...session, safe: null, pending: null },
        output: '',
        closed: true,
      });
    }
    case 'interrupt':
      return done(net, { ...session, pending: null });
    case 'confirm': {
      const pending = session.pending;
      const cleared = { ...session, pending: null };
      if (!pending || !change.yes) return done(net, cleared);
      return runVendor(
        {
          kind: 'menu-action',
          path: pending.path,
          name: pending.name,
          args: [...pending.args, ['confirmed', 'yes']],
          rowKeys: pending.rowKeys,
        },
        { ...ctx, session: cleared },
      );
    }
  }
}

// ── Acciones ────────────────────────────────────────────────────────────────

function finishAction(
  outcome: ActionOutcome,
  ctx: Ctx,
  pendingOf: () => RouterosSession['pending'],
): Outcome {
  if (outcome.confirm !== undefined) {
    return done(ctx.net, { ...ctx.session, pending: pendingOf() }, outcome.confirm);
  }
  let net = outcome.net ?? ctx.net;
  let session = outcome.session ?? ctx.session;
  if (outcome.ops && outcome.ops.length > 0) {
    const applied = applyConfig(
      outcome.ops,
      net,
      deviceIn(net, ctx.device.id, ctx.device),
      session,
    );
    if (!applied.ok) return applied;
    net = applied.value.net;
    session = applied.value.session;
  }
  return ok({
    net,
    session,
    output: outcome.output ?? '',
    ...(outcome.live ? { live: outcome.live } : {}),
    ...(outcome.closed ? { closed: true } : {}),
  });
}

function runPing(action: Extract<RosAction, { kind: 'ping' }>, ctx: Ctx): Outcome {
  const { device, session } = ctx;
  let net = ctx.net;
  let dst = parseIpv4(action.target);
  if (dst === null) {
    const resolved = resolveName(net, device.id, action.target);
    net = resolved.net;
    if (resolved.outcome !== 'answered' || resolved.address === undefined)
      return err(vendor('invalid-value', 'address'));
    dst = resolved.address;
  }
  const target = dst;
  const host = formatIpv4(target);
  const src = action.src === undefined ? null : parseIpv4(action.src);
  const options = (count: number) => ({ count, ...(src === null ? {} : { src }) });

  if (action.count !== undefined) {
    const result = corePing(net, device.id, target, options(action.count));
    const lines = result.replies.map((r) =>
      pingLine(r.seq, host, action.size, result.trace, r.rttMs, device.id),
    );
    const summary = pingSummary(result.replies.map((r) => r.rttMs));
    return done(result.net, session, [PING_HEADER, ...lines, summary].join('\n'));
  }
  return ok({
    net,
    session,
    output: PING_HEADER,
    live: {
      mode: 'append',
      frame: (current, elapsed) => {
        const result = corePing(current, device.id, target, options(elapsed + 1));
        const last = result.replies.at(-1);
        return pingLine(elapsed, host, action.size, result.trace, last?.rttMs, device.id);
      },
      stop: (current, elapsed) =>
        pingSummary(
          corePing(current, device.id, target, options(Math.max(1, elapsed))).replies.map(
            (r) => r.rttMs,
          ),
        ),
    },
  });
}

/** Une las líneas partidas con `\` al final, como las que genera export. */
export function scriptLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = current === '' ? raw : `${current} ${raw.trimStart()}`;
    if (line.trimEnd().endsWith('\\')) {
      current = line.trimEnd().slice(0, -1).trimEnd();
      continue;
    }
    current = '';
    lines.push(line);
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Error de una línea de script, ya redactado con su número de línea. */
const scriptError = (error: DriverError, line: number): DriverError =>
  vendor('script-error', describeScriptError(error, line));

/** Ejecuta líneas en orden; cada una ve el estado que dejó la anterior. */
function runLines(lines: readonly string[], ctx: Ctx, numberErrors: boolean): Outcome {
  let net = ctx.net;
  let session = ctx.session;
  const outputs: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const device = deviceIn(net, ctx.device.id, ctx.device);
    const step: Ctx = { net, device, session };
    const parsed = parseLine(line, { menuCtx: menuCtxOf(net, device, session), session });
    if (!parsed.ok) {
      const error: DriverError = { kind: 'syntax', fault: parsed.error };
      return err(numberErrors ? scriptError(error, index + 1) : error);
    }
    const applied = applyIntent(parsed.value, step);
    if (!applied.ok)
      return err(numberErrors ? scriptError(applied.error, index + 1) : applied.error);
    net = applied.value.net;
    session = applied.value.session;
    if (applied.value.output !== '') outputs.push(applied.value.output);
  }
  return done(net, session, outputs.join('\n'));
}

function runVendor(action: RosAction, ctx: Ctx): Outcome {
  const { net, device, session } = ctx;
  if (!permitted(device, session, actionNeeds(action))) return denied();
  switch (action.kind) {
    case 'menu-action': {
      const menu = menuAt(action.path);
      const def = menu?.actions?.[action.name];
      if (!menu || !def) return err(vendor('bad-command', action.name));
      const mctx = menuCtxOf(net, device, session);
      const all = menu.rows(mctx);
      const rows = action.rowKeys.flatMap((key) => all.filter((r) => r.key === key));
      const result = def.run(new Map(action.args), { ...mctx, session, rows, menu });
      if (!result.ok) return err({ kind: 'syntax', fault: result.error });
      return finishAction(result.value, ctx, () => ({
        path: action.path,
        name: action.name,
        args: action.args,
        rowKeys: action.rowKeys,
      }));
    }
    case 'remove-other': {
      const menu = menuAt(action.path);
      if (!menu?.removeOther) return err(vendor('bad-command', 'remove'));
      const mctx = menuCtxOf(net, device, session);
      const all = menu.rows(mctx);
      const rows = action.rowKeys.flatMap((key) => all.filter((r) => r.key === key));
      const result = menu.removeOther(rows, mctx);
      if (!result.ok) return err({ kind: 'syntax', fault: result.error });
      return finishAction(result.value, ctx, () => null);
    }
    case 'ping':
      return runPing(action, ctx);
    case 'export': {
      const text = renderExport(MENUS, menuCtxOf(net, device, session), {
        scope: action.path,
        verbose: action.verbose,
        showSensitive: action.showSensitive,
        header: true,
      });
      if (action.file === undefined) return done(net, session, text);
      const name = action.file.endsWith('.rsc') ? action.file : `${action.file}.rsc`;
      return done(replaceDevice(net, saveScript(device, name, text, net.now)), session);
    }
    case 'import': {
      const exists = (name: string) => device.storage.files.some((f) => f.name === name);
      const name =
        exists(action.file) || action.file.endsWith('.rsc') ? action.file : `${action.file}.rsc`;
      const script = readScript(device, name);
      if (!script.ok) return err(vendor('no-such-file'));
      const fresh = newSession(device, { user: session.user, clockBase: session.clockBase });
      const ran = runLines(scriptLines(script.value), { net, device, session: fresh }, true);
      if (!ran.ok) return ran;
      return done(ran.value.net, session, 'Script file loaded and executed successfully');
    }
    case 'undo':
    case 'redo': {
      const stack = action.kind === 'undo' ? session.undo : session.redo;
      const target = stack.at(-1);
      if (!target)
        return err(vendor(action.kind === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo'));
      const rest = stack.slice(0, -1);
      const next =
        action.kind === 'undo'
          ? { ...session, undo: rest, redo: [...session.redo, device.config] }
          : { ...session, redo: rest, undo: [...session.undo, device.config] };
      return done(restoreConfig(net, device, target), next);
    }
    case 'resolve': {
      const result = resolveName(net, device.id, action.name);
      if (result.outcome === 'answered' && result.address !== undefined) {
        return done(result.net, session, formatIpv4(result.address));
      }
      return err(vendor(result.outcome === 'nxdomain' ? 'dns-nxdomain' : 'dns-timeout'));
    }
    case 'put':
      return done(net, session, action.text);
    case 'script':
      return runLines(action.lines, ctx, false);
  }
}

export function applyIntent(intent: RosIntent, ctx: Ctx): Outcome {
  switch (intent.kind) {
    case 'noop':
      return done(ctx.net, ctx.session);
    case 'config':
      return applyConfig(intent.ops, ctx.net, ctx.device, ctx.session);
    case 'show':
      return applyPrint(intent.view, ctx);
    case 'session':
      return applySession(intent.change, ctx);
    case 'vendor':
      return runVendor(intent.action, ctx);
    case 'action':
      return err(vendor('not-allowed'));
    case 'sequence': {
      let current = ctx;
      const outputs: string[] = [];
      for (const step of intent.steps) {
        const applied = applyIntent(step, current);
        if (!applied.ok) return applied;
        current = {
          net: applied.value.net,
          session: applied.value.session,
          device: deviceIn(applied.value.net, ctx.device.id, ctx.device),
        };
        if (applied.value.output !== '') outputs.push(applied.value.output);
      }
      return done(current.net, current.session, outputs.join('\n'));
    }
  }
}
