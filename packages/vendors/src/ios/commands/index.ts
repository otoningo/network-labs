/**
 * Todas las áreas de comandos de IOS. El orden de las líneas dentro de una
 * interfaz lo fija cada línea (`InterfaceLine.order`), no el de esta lista.
 */
import type { Area, Show } from '../area';
import type { CommandSpec } from '../grammar';
import type { ViewKind } from '../session';
import { AAA_AREA } from './aaa';
import { DHCP_AREA } from './dhcp';
import { DIAG_AREA } from './diag';
import { DNS_AREA } from './dns';
import { INTERFACE_AREA } from './interface';
import { NAT_AREA } from './nat';
import { ROUTING_AREA } from './routing';
import { SYSTEM_AREA } from './system';

export const AREAS: readonly Area[] = [
  SYSTEM_AREA,
  INTERFACE_AREA,
  ROUTING_AREA,
  NAT_AREA,
  DHCP_AREA,
  AAA_AREA,
  DNS_AREA,
  DIAG_AREA,
];

const byView = new Map<ViewKind, readonly CommandSpec[]>();

/** Los comandos disponibles en un modo. */
export function commandsFor(view: ViewKind): readonly CommandSpec[] {
  const cached = byView.get(view);
  if (cached) return cached;
  const list = AREAS.flatMap((a) => a.commands.filter((c) => c.views.includes(view)));
  byView.set(view, list);
  return list;
}

export const SHOWS: Readonly<Record<string, Show>> = Object.assign(
  {},
  ...AREAS.map((a) => a.shows ?? {}),
);
