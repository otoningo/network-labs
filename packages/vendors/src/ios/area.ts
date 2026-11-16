/**
 * Contrato de un área de comandos de IOS (sistema, interfaces, rutas, DHCP,
 * NAT, DNS, AAA, diagnóstico). Cada área vive en su archivo bajo `commands/` y
 * aporta sus comandos, sus `show`, su trozo de `show running-config` y, si la
 * necesita, una reconciliación que se corre tras cada cambio.
 */
import {
  type Device,
  err,
  formatIpv4,
  type Interface,
  type Ipv4,
  type ItemId,
  maskOf,
  type Op,
  ok,
  type Result,
} from '@nos/core';
import type { CmdCtx, CommandSpec, IosFault } from './grammar';
import type { IosIntent, OutputFilter } from './intent';

export interface ConfigBlock {
  readonly order: number;
  readonly lines: readonly string[];
}

/** Una línea dentro del bloque de una interfaz, con su posición relativa. */
export interface InterfaceLine {
  readonly order: number;
  readonly line: string;
}

export type Show = (ctx: CmdCtx, arg: string | undefined) => string;

export interface Area {
  readonly commands: readonly CommandSpec[];
  /** `show <what>` que resuelve esta área. */
  readonly shows?: Readonly<Record<string, Show>>;
  /**
   * Bloques de configuración global de esta área. El ensamblador los ordena por
   * `order` y los separa con `!`, como IOS: hostname 20, enable 30, DHCP 40-45,
   * dominio y DNS 50, usuarios 60, (interfaces 100), NAT 130, rutas 140, ACL 150, líneas 170.
   */
  readonly blocks?: (device: Device) => readonly ConfigBlock[];
  /**
   * Líneas de esta área dentro del bloque de una interfaz. El orden es el de
   * IOS: description 10, ip address 20, ip nat 30, shutdown 40, duplex/speed 50.
   */
  readonly interfaceLines?: (device: Device, iface: Interface) => readonly InterfaceLine[];
  /** Mensajes de error propios de esta área, por código; `{clave}` se sustituye con el detalle. */
  readonly messages?: Readonly<Record<string, string>>;
  /** Operaciones que mantienen coherente el modelo después de un cambio. */
  readonly reconcile?: (device: Device) => readonly Op[];
}

// ── Atajos para construir intenciones ───────────────────────────────────────

export type Built = Result<IosIntent, IosFault>;

export const intent = (value: IosIntent): Built => ok(value);

export const fault = (
  code: string,
  at?: number,
  detail?: Readonly<Record<string, string | number>>,
): Built =>
  err({ code, ...(at === undefined ? {} : { at }), ...(detail === undefined ? {} : { detail }) });

/** Cambio de configuración, con un mensaje opcional detrás. */
export function config(ops: readonly Op[], message?: string): Built {
  const change: IosIntent = { kind: 'config', ops };
  if (message === undefined) return ok(change);
  return ok({
    kind: 'sequence',
    steps: [change, { kind: 'vendor', action: { kind: 'message', text: message } }],
  });
}

export const noop = (): Built => ok({ kind: 'noop' });

/** Un `show`, con su filtro `|` si lo hubo (el driver lo añade después). */
export const show = (what: string, arg?: string, filter?: OutputFilter): Built =>
  intent({
    kind: 'show',
    view: {
      kind: 'show',
      what,
      ...(arg === undefined ? {} : { arg }),
      ...(filter === undefined ? {} : { filter }),
    },
  });

// ── Consultas al modelo ─────────────────────────────────────────────────────

export const ifaceByName = (device: Device, name: string): Interface | undefined =>
  device.config.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase());

export const ifaceById = (device: Device, id: ItemId): Interface | undefined =>
  device.config.interfaces.find((i) => i.id === id);

/** La interfaz del modo de interfaz actual. */
export function currentIface(ctx: CmdCtx): Interface | undefined {
  const view = ctx.session.view;
  return view.kind === 'interface' ? ifaceById(ctx.device, view.iface) : undefined;
}

/** Interfaces que IOS lista: las físicas, las VLAN y las loopback, en orden. */
export const listedInterfaces = (device: Device): Interface[] =>
  device.config.interfaces.filter(
    (i) => i.kind === 'ethernet' || i.kind === 'vlan' || i.kind === 'loopback',
  );

/** Máscara en el formato A.B.C.D que imprime IOS. */
export const dottedMask = (len: number): string => formatIpv4(maskOf(len) as Ipv4);

/** Comodín (máscara invertida) de una longitud: /24 → 0.0.0.255. */
export const wildcardOf = (len: number): string => formatIpv4((~maskOf(len) >>> 0) as Ipv4);

/** Longitud de la red con clase de una dirección (A /8, B /16, C /24). */
export function classfulLen(ip: Ipv4): number {
  const first = ip >>> 24;
  if (first < 128) return 8;
  if (first < 192) return 16;
  return 24;
}
