/**
 * Terminal de pruebas de VRP: escribe líneas y pulsa teclas sobre una red,
 * como lo hará la UI. Igual que la de RouterOS, pero con el driver de VRP.
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
import { vrp } from './driver';
import type { VrpSession } from './session';

export class VrpTerminal {
  net: Network;
  session: VrpSession;
  readonly id: DeviceId;
  last: CommandResult<VrpSession> | undefined;

  constructor(net: Network, id: string, options: { user?: string } = {}) {
    this.net = net;
    this.id = deviceId(id);
    this.session = vrp.session(
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
    return vrp.prompt({ net: this.net, device: this.device, session: this.session });
  }

  private take(result: CommandResult<VrpSession>): CommandResult<VrpSession> {
    this.last = result;
    this.net = result.net;
    this.session = result.session;
    return result;
  }

  /** Ejecuta una línea y devuelve la salida (o el error con la voz de VRP). */
  run(line: string): string {
    return this.take(runCommand(vrp, this.net, this.id, this.session, line)).output;
  }

  /** Igual que run, pero falla la prueba si el comando no tuvo éxito. */
  ok(line: string): string {
    const result = this.take(runCommand(vrp, this.net, this.id, this.session, line));
    if (!result.ok) throw new Error(`"${line}" falló: ${result.output}`);
    return result.output;
  }

  /** Ejecuta varias líneas exigiendo éxito. */
  script(lines: readonly string[]): this {
    for (const line of lines) this.ok(line);
    return this;
  }

  key(chord: KeyChord): string {
    return this.take(pressKey(vrp, this.net, this.id, this.session, chord)).output;
  }

  help(input: string): string {
    return vrp.help(input, { net: this.net, device: this.device, session: this.session });
  }

  complete(input: string): readonly string[] {
    return vrp
      .complete(input, input.length, { net: this.net, device: this.device, session: this.session })
      .candidates.map((c) => c.text);
  }
}
