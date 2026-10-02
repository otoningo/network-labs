import type { ItemId } from '../model/brand';
import type { DeviceConfig } from '../model/config';

/**
 * Miembros de una lista de interfaces, resolviendo inclusiones.
 * Las listas incorporadas `all` y `static` abarcan todo; `none` y `dynamic`, nada.
 */
export function interfaceListMembers(
  config: DeviceConfig,
  name: string,
  seen: ReadonlySet<string> = new Set(),
): ReadonlySet<ItemId> | 'all' {
  if (name === 'all' || name === 'static') return 'all';
  if (name === 'none' || name === 'dynamic' || seen.has(name)) return new Set();
  const list = config.interfaceLists.find((l) => l.name === name);
  if (!list || list.disabled) return new Set();
  const members = new Set(
    config.interfaceListMembers
      .filter((m) => !m.disabled && m.list === list.id)
      .map((m) => m.iface),
  );
  const nextSeen = new Set([...seen, name]);
  for (const included of list.include) {
    const sub = interfaceListMembers(config, included, nextSeen);
    if (sub === 'all') return 'all';
    for (const id of sub) members.add(id);
  }
  return members;
}

export function inInterfaceList(config: DeviceConfig, name: string, iface: ItemId): boolean {
  const members = interfaceListMembers(config, name);
  return members === 'all' || members.has(iface);
}
