/**
 * Consola de un equipo: une un driver de fabricante con su sesión y oculta
 * los tipos propios del driver al resto de la interfaz. La red no vive aquí:
 * cada llamada recibe la red actual y devuelve la nueva.
 */
import {
  type CommandResult,
  type Completion,
  type Device,
  type DeviceId,
  type KeyChord,
  type LabEnvironment,
  type Network,
  type OsId,
  pressKey,
  runCommand,
  type VendorDriver,
} from '@nos/core';
import { ROUTEROS_PLATFORM, routeros, routerosStartup } from '@nos/vendors/routeros';
import { VRP_PLATFORM, vrp, vrpStartup } from '@nos/vendors/vrp';

export type ConsoleResult = Omit<CommandResult<unknown>, 'session'>;

export interface DeviceConsole {
  readonly deviceId: DeviceId;
  readonly os: OsId;
  banner(net: Network): string;
  prompt(net: Network): string;
  run(net: Network, line: string): ConsoleResult;
  key(net: Network, chord: KeyChord): ConsoleResult;
  complete(net: Network, input: string, cursor: number): Completion;
  help(net: Network, input: string): string;
  /** Sesión nueva (tras `quit` o un reinicio del equipo). */
  reopen(net: Network): void;
}

function deviceIn(net: Network, id: DeviceId): Device {
  const device = net.devices.find((d) => d.id === id);
  if (!device) throw new Error(`equipo inexistente: ${id}`);
  return device;
}

function strip<S>(result: CommandResult<S>): ConsoleResult {
  const { session: _session, ...rest } = result;
  return rest;
}

export function openConsole<S, V, C, A>(
  driver: VendorDriver<S, V, C, A>,
  net: Network,
  id: DeviceId,
): DeviceConsole {
  let session = driver.session(deviceIn(net, id));
  const ctx = (current: Network) => ({ net: current, device: deviceIn(current, id), session });
  const take = (result: CommandResult<S>): ConsoleResult => {
    session = result.session;
    return strip(result);
  };
  return {
    deviceId: id,
    os: driver.os,
    banner: (current) => driver.banner(ctx(current)),
    prompt: (current) => driver.prompt(ctx(current)),
    run: (current, line) => take(runCommand(driver, current, id, session, line)),
    key: (current, chord) => take(pressKey(driver, current, id, session, chord)),
    complete: (current, input, cursor) => driver.complete(input, cursor, ctx(current)),
    help: (current, input) => driver.help(input, ctx(current)),
    reopen: (current) => {
      session = driver.session(deviceIn(current, id));
    },
  };
}

/** Plataformas y arranque de cada fabricante con driver: RouterOS y VRP. */
export const LAB_ENVIRONMENT: LabEnvironment = {
  platforms: { routeros: ROUTEROS_PLATFORM, vrp: VRP_PLATFORM },
  // Cada equipo arranca con el driver de su sistema.
  runStartup: (device, script) =>
    device.os === 'vrp' ? vrpStartup(device, script) : routerosStartup(device, script),
};

/** Abre la consola de un equipo si su sistema tiene driver; hosts e Internet no tienen CLI. */
export function consoleFor(net: Network, id: DeviceId): DeviceConsole | null {
  const device = deviceIn(net, id);
  switch (device.os) {
    case 'routeros':
      return openConsole(routeros, net, id);
    case 'vrp':
      return openConsole(vrp, net, id);
    default:
      return null;
  }
}
