/** Driver de RouterOS v7 ensamblado: cumple el contrato VendorDriver del núcleo. */
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
  type VendorDriver,
} from '@nos/core';
import { applyIntent, menuCtxOf, renderView, scriptLines } from './apply';
import { complete, help } from './complete';
import { describeError } from './errors';
import type { RosAction, RosSessionChange, RosView } from './intent';
import { parseLine } from './parser';
import { ROUTEROS_PLATFORM } from './platform';
import { newSession, type RouterosSession } from './session';

type Ctx = DriverContext<RouterosSession>;

const parseCtx = (ctx: Ctx) => ({
  menuCtx: menuCtxOf(ctx.net, ctx.device, ctx.session),
  session: ctx.session,
});

export function routerosPrompt(ctx: Ctx): string {
  const { session, device } = ctx;
  if (session.pending) return '';
  const path = session.path.length === 0 ? '' : `/${session.path.join('/')}`;
  return `[${session.user}@${device.config.system.identity}] ${path}${session.safe ? '<SAFE>' : '>'} `;
}

export const routeros: VendorDriver<RouterosSession, RosView, RosSessionChange, RosAction> = {
  os: 'routeros',
  platform: ROUTEROS_PLATFORM,
  session: (device, options) => newSession(device, options),
  // Solo la línea del sistema: la ayuda de uso la pone la interfaz, en el idioma del usuario.
  banner: () => '\n  RouterOS 7\n',
  parse: (input, ctx) => parseLine(input, parseCtx(ctx)),
  apply: (intent, ctx) => applyIntent(intent, ctx),
  render: (view, ctx) => renderView(view, ctx).text,
  prompt: routerosPrompt,
  complete: (input, cursor, ctx) => complete(input, cursor, parseCtx(ctx)),
  help: (input, ctx) => help(input, parseCtx(ctx)),
  key: (chord) => {
    switch (chord) {
      case 'ctrl-x':
        return { kind: 'session', change: { kind: 'safe-toggle' } };
      case 'ctrl-d':
        return { kind: 'session', change: { kind: 'quit' } };
      case 'ctrl-c':
        return { kind: 'session', change: { kind: 'interrupt' } };
      case 'ctrl-z':
        return null;
    }
  },
  describeError: (error) => describeError(error),
};

/**
 * Ejecuta el script de arranque de un lab (D-016) sobre un equipo aislado.
 * Si una línea falla, el lab no carga y el mensaje dice cuál.
 */
export const routerosStartup: StartupRunner = (
  device: Device,
  script: string,
): Result<Device, string> => {
  const net: Network = { devices: [device], links: [], scenario: { flows: [] }, now: simTime(0) };
  const ran = runScript(routeros, net, device.id, scriptLines(script));
  if (!ran.ok) return err(`line ${ran.error.line}: ${ran.error.message}`);
  const result = ran.value.devices.find((d) => d.id === device.id);
  return result ? ok(result) : err('device lost');
};
