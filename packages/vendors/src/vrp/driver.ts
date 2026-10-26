/** Driver de Huawei VRP ensamblado: cumple el contrato VendorDriver del núcleo. */
import {
  type Device,
  type DriverContext,
  err,
  type Network,
  ok,
  type Result,
  runScript,
  type StartupRunner,
  simTime,
  type UserGroup,
  type VendorDriver,
} from '@nos/core';
import { applyIntent, renderDisplay } from './apply';
import { commandsFor } from './commands';
import { describeError } from './errors';
import {
  type CommandSpec,
  completions,
  ctxOf,
  formatHelp,
  helpEntries,
  matchLine,
} from './grammar';
import type { VrpAction, VrpIntent, VrpSessionChange, VrpView } from './intent';
import { VRP_PLATFORM } from './platform';
import { newSession, type VrpSession } from './session';

type Ctx = DriverContext<VrpSession>;

export function vrpPrompt(ctx: Ctx): string {
  const { session, device } = ctx;
  if (session.pending) return '';
  const name = device.config.system.identity;
  const view = session.view;
  switch (view.kind) {
    case 'user':
      return `<${name}>`;
    case 'system':
      return `[${name}]`;
    case 'interface': {
      const iface = device.config.interfaces.find((i) => i.id === view.iface);
      return `[${name}-${iface?.name ?? 'interface'}]`;
    }
    case 'pool':
      return `[${name}-ip-pool-${view.name}]`;
    case 'acl':
      return `[${name}-acl-basic-${view.number}]`;
    case 'aaa':
      return `[${name}-aaa]`;
  }
}

/** Un usuario que no está en `local-user` (pruebas, arranque de labs) tiene acceso total. */
function groupOf(device: Device, user: string): UserGroup {
  return device.config.system.users.find((u) => u.name === user)?.group ?? 'full';
}

/**
 * Los comandos de la vista actual. Un usuario de solo lectura no ve
 * `system-view` ni `save`: en VRP, lo que está por encima de tu nivel no existe.
 */
function available(ctx: Ctx): readonly CommandSpec[] {
  const cmds = commandsFor(ctx.session.view.kind);
  if (groupOf(ctx.device, ctx.session.user) !== 'read') return cmds;
  return cmds.filter(
    (c) =>
      !c.forms.some(
        (f) => f[0]?.t === 'kw' && (f[0].word === 'system-view' || f[0].word === 'save'),
      ),
  );
}

function parseLine(input: string, ctx: Ctx) {
  // Respuesta a una pregunta [Y/N]: cualquier cosa que no sea Y cuenta como no.
  if (ctx.session.pending) {
    const yes = /^\s*y(es)?\s*$/i.test(input);
    return ok<VrpIntent>({ kind: 'session', change: { kind: 'confirm', yes } });
  }
  if (input.trim() === '') return ok<VrpIntent>({ kind: 'noop' });
  const cmds = available(ctx);
  const matched = matchLine(cmds, input);
  if (!matched.ok) return err({ code: matched.code, at: matched.at });
  const cmd = cmds[matched.cmd];
  if (!cmd) return err({ code: 'unrecognized', at: 0 });
  const built = cmd.build(matched.matched, ctxOf(ctx));
  if (!built.ok) {
    const { code, at, detail } = built.error;
    return err({
      code,
      ...(at === undefined ? {} : { at }),
      ...(detail === undefined ? {} : { detail }),
    });
  }
  return ok(built.value);
}

export const vrp: VendorDriver<VrpSession, VrpView, VrpSessionChange, VrpAction> = {
  os: 'vrp',
  platform: VRP_PLATFORM,
  session: (device, options) => newSession(device, options),
  banner: () =>
    '\nInfo: The max number of VTY users is 5, and the number\n      of current VTY users on line is 1.\n',
  parse: (input, ctx) => parseLine(input, ctx),
  apply: (intent, ctx) => applyIntent(intent, ctx),
  render: (view, ctx) => renderDisplay(view, ctx),
  prompt: vrpPrompt,
  complete: (input, cursor, ctx) => {
    const { replaceFrom, words } = completions(available(ctx), input.slice(0, cursor));
    return { replaceFrom, candidates: words.map((text) => ({ text })) };
  },
  help: (input, ctx) => {
    const entries = helpEntries(available(ctx), input);
    if (entries === null || entries.length === 0) {
      const matched = matchLine(available(ctx), input.trimEnd() || ' ');
      const at = matched.ok ? input.length : matched.at;
      return describeError({ kind: 'syntax', fault: { code: 'unrecognized', at } }, vrpPrompt(ctx));
    }
    return formatHelp(entries);
  },
  key: (chord) => {
    switch (chord) {
      case 'ctrl-z':
        return { kind: 'session', change: { kind: 'return' } };
      case 'ctrl-c':
        return { kind: 'session', change: { kind: 'interrupt' } };
      case 'ctrl-d':
      case 'ctrl-x':
        return null;
    }
  },
  describeError: (error, ctx) => describeError(error, vrpPrompt(ctx)),
};

/** Líneas de un script de arranque: sin comentarios `#`, sin `return` y sin líneas vacías. */
export function startupLines(script: string): string[] {
  return script
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && l !== '#' && l !== 'return');
}

/**
 * Ejecuta el script de arranque de un lab (D-016) sobre un equipo aislado. El
 * script se escribe como la configuración de VRP: arranca en la vista de
 * sistema, así que el `system-view` lo pone el ejecutor.
 */
export const vrpStartup: StartupRunner = (
  device: Device,
  script: string,
): Result<Device, string> => {
  const net: Network = { devices: [device], links: [], scenario: { flows: [] }, now: simTime(0) };
  const ran = runScript(vrp, net, device.id, ['system-view', ...startupLines(script)]);
  if (!ran.ok) return err(`line ${ran.error.line - 1}: ${ran.error.message}`);
  const result = ran.value.devices.find((d) => d.id === device.id);
  return result ? ok(result) : err('device lost');
};
