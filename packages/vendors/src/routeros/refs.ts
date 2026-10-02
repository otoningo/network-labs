/** Referencias por nombre: interfaces, pools, servidores DHCP, listas, usuarios, archivos. */
import type { DeviceConfig, ItemId } from '@nos/core';
import type { MenuCtx, RefTarget } from './schema';

export const BUILTIN_LISTS = ['all', 'none', 'dynamic', 'static'] as const;

interface Named {
  readonly id: ItemId;
  readonly name: string;
}

function entries(config: DeviceConfig, target: RefTarget, ctx: MenuCtx): readonly Named[] {
  switch (target) {
    case 'interface':
      return config.interfaces;
    case 'bridge':
      return config.interfaces.filter((i) => i.kind === 'bridge');
    case 'pool':
      return config.dhcpServer.pools;
    case 'dhcp-server':
      return config.dhcpServer.servers;
    case 'interface-list':
      return config.interfaceLists;
    case 'user':
      return config.system.users;
    case 'file':
      return ctx.device.storage.files.map((f, i) => ({ id: (i + 1) as ItemId, name: f.name }));
  }
}

/** Identificador interno `*1A`, que RouterOS acepta en lugar de un nombre. */
export const internalId = (id: ItemId): string => `*${id.toString(16).toUpperCase()}`;

export function parseInternalId(text: string): ItemId | undefined {
  const match = /^\*([0-9A-Fa-f]+)$/.exec(text);
  return match?.[1] ? (Number.parseInt(match[1], 16) as ItemId) : undefined;
}

export function refNames(ctx: MenuCtx, target: RefTarget): string[] {
  const names = entries(ctx.device.config, target, ctx).map((e) => e.name);
  return target === 'interface-list' ? [...BUILTIN_LISTS, ...names] : names;
}

/** Id por nombre exacto o `*hex`. Las listas incorporadas no tienen id. */
export function resolveRef(ctx: MenuCtx, target: RefTarget, text: string): ItemId | undefined {
  const internal = parseInternalId(text);
  const list = entries(ctx.device.config, target, ctx);
  if (internal !== undefined) return list.some((e) => e.id === internal) ? internal : undefined;
  return list.find((e) => e.name === text)?.id;
}

/** Igual que resolveRef pero acepta un `*hex` que ya no existe (referencias huérfanas). */
export function refIdLoose(ctx: MenuCtx, target: RefTarget, text: string): ItemId | undefined {
  return parseInternalId(text) ?? resolveRef(ctx, target, text);
}

/** Nombre para mostrar; si el ítem ya no existe, su id interno como hace RouterOS. */
export function refName(ctx: MenuCtx, target: RefTarget, id: ItemId): string {
  return entries(ctx.device.config, target, ctx).find((e) => e.id === id)?.name ?? internalId(id);
}

export const ifaceName = (ctx: MenuCtx, id: ItemId): string => refName(ctx, 'interface', id);
