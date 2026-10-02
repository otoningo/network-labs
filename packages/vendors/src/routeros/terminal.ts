/**
 * Terminal de pruebas: escribe líneas y pulsa teclas sobre una red, como lo
 * hará la UI. Útil para las baterías de pruebas por lab.
 */
import {
  type CommandResult,
  type Device,
  type DeviceId,
  deviceId,
  type KeyChord,
  type Network,
  pressKey,
  runCommand,
} from '@nos/core';
import { routeros } from './driver';
import type { RouterosSession } from './session';

export class Terminal {
  net: Network;
  session: RouterosSession;
  readonly id: DeviceId;
  last: CommandResult<RouterosSession> | undefined;

  constructor(net: Network, id: string, options: { user?: string } = {}) {
    this.net = net;
    this.id = deviceId(id);
    this.session = routeros.session(
      this.device,
      options.user === undefined ? {} : { user: options.user },
    );
  }

  get device(): Device {
    const found = this.net.devices.find((d) => d.id === this.id);
    if (!found) throw new Error(`no existe ${this.id}`);
    return found;
  }

  get prompt(): string {
    return routeros.prompt({ net: this.net, device: this.device, session: this.session });
  }

  private take(result: CommandResult<RouterosSession>): CommandResult<RouterosSession> {
    this.last = result;
    this.net = result.net;
    this.session = result.session;
    return result;
  }

  /** Ejecuta una línea y devuelve la salida (o el error con la voz de RouterOS). */
  run(line: string): string {
    return this.take(runCommand(routeros, this.net, this.id, this.session, line)).output;
  }

  /** Igual que run, pero falla la prueba si el comando no tuvo éxito. */
  ok(line: string): string {
    const result = this.take(runCommand(routeros, this.net, this.id, this.session, line));
    if (!result.ok) throw new Error(`"${line}" falló: ${result.output}`);
    return result.output;
  }

  /** Ejecuta varias líneas exigiendo éxito. */
  script(lines: readonly string[]): this {
    for (const line of lines) this.ok(line);
    return this;
  }

  key(chord: KeyChord): string {
    return this.take(pressKey(routeros, this.net, this.id, this.session, chord)).output;
  }
}
