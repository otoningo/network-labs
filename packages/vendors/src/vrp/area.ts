/**
 * Contrato de un área de comandos de VRP (sistema, interfaces, rutas, DHCP,
 * NAT, AAA, DNS). Cada área vive en su archivo bajo `commands/` y aporta sus
 * comandos, sus `display`, su trozo de `display current-configuration` y,
 * si la necesita, una reconciliación que se corre tras cada cambio.
 */
import {
  type Device,
  err,
  formatIpv4,
  type Interface,
  type Ipv4,
  type ItemId,
  lenOfMask,
  maskOf,
  type Op,
  ok,
  parseIpv4,
  type Result,
} from '@nos/core';
import type { CmdCtx, CommandSpec, VrpFault } from './grammar';
import type { VrpIntent } from './intent';
import type { View } from './session';

export interface ConfigBlock {
  readonly order: number;
  readonly lines: readonly string[];
}

export type Display = (ctx: CmdCtx, arg: string | undefined) => string;

export interface Area {
  readonly commands: readonly CommandSpec[];
  /** `display <what>` que resuelve esta área. */
  readonly displays?: Readonly<Record<string, Display>>;
  /**
   * Bloques de configuración global de esta área. El ensamblador los ordena por
   * `order` y los separa con `#`, como VRP: sysname 10, DNS 20, dhcp enable 30,
   * ACL 40, pools 50, AAA 60, (interfaces 100), rutas 200, servicios 210.
   */
  readonly blocks?: (device: Device) => readonly ConfigBlock[];
  /** Líneas de esta área dentro del bloque de una interfaz (con su sangría de un espacio). */
  readonly interfaceLines?: (device: Device, iface: Interface) => readonly string[];
  /** Mensajes de error propios de esta área, por código, con la voz de VRP (`Error: ...`). */
  readonly messages?: Readonly<Record<string, string>>;
  /** Bloque de `display this` para una vista propia de esta área (pool, ACL, AAA); null si no es suya. */
  readonly viewBlock?: (device: Device, view: View) => readonly string[] | null;
  /** Operaciones que mantienen coherente el modelo después de un cambio (por ejemplo, enlazar pools). */
  readonly reconcile?: (device: Device) => readonly Op[];
}

// ── Atajos para construir intenciones ───────────────────────────────────────

export const intent = (value: VrpIntent): Result<VrpIntent, VrpFault> => ok(value);

export const fault = (
  code: string,
  at?: number,
  detail?: Readonly<Record<string, string | number>>,
): Result<VrpIntent, VrpFault> =>
  err({ code, ...(at === undefined ? {} : { at }), ...(detail === undefined ? {} : { detail }) });

/** Cambio de configuración, con un mensaje `Info:` opcional detrás. */
export function config(ops: readonly Op[], message?: string): Result<VrpIntent, VrpFault> {
  const change: VrpIntent = { kind: 'config', ops };
  if (message === undefined) return ok(change);
  return ok({
    kind: 'sequence',
    steps: [change, { kind: 'vendor', action: { kind: 'message', text: message } }],
  });
}

export const noop = (): Result<VrpIntent, VrpFault> => ok({ kind: 'noop' });

// ── Consultas al modelo ─────────────────────────────────────────────────────

export const ifaceByName = (device: Device, name: string): Interface | undefined =>
  device.config.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase());

export const ifaceById = (device: Device, id: ItemId): Interface | undefined =>
  device.config.interfaces.find((i) => i.id === id);

/** La interfaz de la vista de interfaz actual. */
export function currentIface(ctx: CmdCtx): Interface | undefined {
  const view = ctx.session.view;
  return view.kind === 'interface' ? ifaceById(ctx.device, view.iface) : undefined;
}

/** Máscara en el formato X.X.X.X que imprime VRP. */
export const dottedMask = (len: number): string => formatIpv4(maskOf(len) as Ipv4);

/** Longitud de un argumento ya validado que puede ser máscara (X.X.X.X) o longitud (0-32). */
export function lenOf(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const ip = parseIpv4(text);
  return (ip && lenOfMask(ip)) ?? 0;
}
