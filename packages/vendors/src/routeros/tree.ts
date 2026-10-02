/**
 * Árbol de menús de RouterOS. Los directorios intermedios (`ip`, `ip/firewall`)
 * existen aunque no tengan definición propia: se deducen de las rutas.
 */
import { INTERFACE_MENUS } from './menus/interface';
import { IP_MENUS } from './menus/ip';
import { SYSTEM_MENUS } from './menus/system';
import type { MenuDef } from './schema';

export const MENUS: readonly MenuDef[] = [...INTERFACE_MENUS, ...IP_MENUS, ...SYSTEM_MENUS];

const BY_PATH = new Map(MENUS.map((m) => [m.path, m]));

/** Directorios implícitos: todos los prefijos de las rutas definidas. */
const NODES = new Set<string>(['']);
for (const menu of MENUS) {
  const parts = menu.path.split('/');
  for (let i = 1; i <= parts.length; i++) NODES.add(parts.slice(0, i).join('/'));
}

export const pathKey = (segments: readonly string[]): string => segments.join('/');

export function menuAt(path: string): MenuDef | undefined {
  return BY_PATH.get(path);
}

export function isNode(path: string): boolean {
  return NODES.has(path);
}

/** Nombres de los submenús directos, en orden alfabético. */
export function childrenOf(path: string): string[] {
  const prefix = path === '' ? '' : `${path}/`;
  const names = new Set<string>();
  for (const node of NODES) {
    if (node === path || !node.startsWith(prefix)) continue;
    const rest = node.slice(prefix.length);
    if (rest !== '' && !rest.includes('/')) names.add(rest);
  }
  return [...names].sort();
}

export interface CommandInfo {
  readonly name: string;
  readonly help: string;
}

/** Comandos globales: se pueden usar desde cualquier menú. */
export const GLOBAL_COMMANDS: readonly CommandInfo[] = [
  { name: 'export', help: 'Print or save an export script' },
  { name: 'import', help: 'Run configuration script' },
  { name: 'ping', help: 'Send ICMP Echo packets' },
  { name: 'quit', help: 'Quit console' },
  { name: 'redo', help: 'Redo previously undone action' },
  { name: 'undo', help: 'Undo previous action' },
];

/** Comandos de un menú concreto (sin los globales), según lo que la definición admite. */
export function menuCommands(menu: MenuDef | undefined): CommandInfo[] {
  if (!menu) return [];
  const list: CommandInfo[] = [];
  const has = (name: string) => menu.props.some((p) => p.name === name && p.writable);
  const listable = menu.style !== 'none' && menu.style !== 'singleton';
  if (menu.add) list.push({ name: 'add', help: 'Create a new item' });
  if (menu.update && listable && has('comment'))
    list.push({ name: 'comment', help: 'Set comment for items' });
  if (menu.update && listable && has('disabled')) {
    list.push({ name: 'disable', help: 'Disable items' }, { name: 'enable', help: 'Enable items' });
  }
  if (listable) list.push({ name: 'find', help: 'Find items by value' });
  if (menu.movable) list.push({ name: 'move', help: 'Move items' });
  if (menu.style !== 'none') list.push({ name: 'print', help: 'Print values of item properties' });
  if (menu.remove || menu.removeOther) list.push({ name: 'remove', help: 'Remove item' });
  if (menu.update) list.push({ name: 'set', help: 'Change item properties' });
  if (menu.update && listable) list.push({ name: 'unset', help: 'Unset item properties' });
  for (const [name, action] of Object.entries(menu.actions ?? {}))
    list.push({ name, help: action.help });
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Todo lo que se puede escribir en una posición de comando: submenús, comandos del menú y globales. */
export function namesAt(path: string): { children: string[]; commands: CommandInfo[] } {
  const own = menuCommands(menuAt(path));
  const ownNames = new Set(own.map((c) => c.name));
  return {
    children: childrenOf(path),
    commands: [...own, ...GLOBAL_COMMANDS.filter((g) => !ownNames.has(g.name))],
  };
}
