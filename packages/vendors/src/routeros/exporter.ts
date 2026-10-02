/**
 * `/export`: script que reproduce la configuración actual, con los menús en
 * orden de dependencias y sin los valores de fábrica (salvo `verbose`). Las
 * líneas largas se parten con ` \` como en el equipo real.
 */
import type { ExportDef, MenuCtx, MenuDef, PropDef, Row } from './schema';
import { formatDateTime, quote } from './values';

export interface ExportOptions {
  /** Ruta del menú desde el que se exporta (`''` = todo). */
  readonly scope: string;
  readonly verbose: boolean;
  readonly showSensitive: boolean;
  readonly header: boolean;
}

const MAX_WIDTH = 79;
const INDENT = '    ';

/**
 * RouterOS siempre exporta la acción de las reglas de firewall, aunque sea la
 * de por defecto (`add action=accept chain=input`).
 */
const ALWAYS_IN_ADD: ReadonlySet<string> = new Set(['action', 'dst-address']);

export function renderExport(
  menus: readonly MenuDef[],
  ctx: MenuCtx,
  options: ExportOptions,
): string {
  const selected = menus
    .flatMap((menu) =>
      menu.export && inScope(menu.path, options.scope) ? [{ menu, def: menu.export }] : [],
    )
    .sort((a, b) => a.def.order - b.def.order);
  const lines = options.header ? headerLines(ctx) : [];
  for (const { menu, def } of selected) {
    const commands = commandsOf(menu, def, ctx, options);
    if (commands.length === 0) continue;
    lines.push(`/${menu.path.replaceAll('/', ' ')}`, ...commands.flatMap(wrap));
  }
  return lines.join('\n');
}

const inScope = (path: string, scope: string): boolean =>
  scope === '' || path === scope || path.startsWith(`${scope}/`);

function headerLines(ctx: MenuCtx): string[] {
  return [
    `# ${formatDateTime(ctx.clockBase, ctx.net.now)} by RouterOS 7 (simulated)`,
    `# model = ${ctx.device.hardware.board}`,
  ];
}

// ── Comandos ────────────────────────────────────────────────────────────────

/** Cada comando es una lista de piezas: la cabeza (`add`, `set ether1`...) y sus argumentos. */
type Command = readonly string[];

function commandsOf(
  menu: MenuDef,
  def: ExportDef,
  ctx: MenuCtx,
  options: ExportOptions,
): Command[] {
  const rows = menu.rows(ctx);
  const argsFor = (row: Row, skip: string, always: ReadonlySet<string>): string[] =>
    argsOf(menu, def, row, ctx, options, skip, always);
  switch (def.style) {
    case 'add': {
      const always = alwaysInAdd(menu);
      return rows
        .filter((row) => row.id !== undefined && !/[D*]/.test(row.flags))
        .map((row) => ['add', ...argsFor(row, '', always)]);
    }
    case 'set': {
      const row = rows[0];
      const args = row ? argsFor(row, '', new Set()) : [];
      return args.length === 0 ? [] : [['set', ...args]];
    }
    case 'set-default-name':
      return rows.flatMap((row) => {
        const name = row.props.get('default-name');
        const args = argsFor(row, 'default-name', new Set());
        if (name === undefined || args.length === 0) return [];
        return [[`set [ find default-name=${quote(name)} ]`, ...args]];
      });
    case 'set-name':
      return rows.flatMap((row) => {
        const args = argsFor(row, 'name', new Set());
        return args.length === 0 ? [] : [[`set ${quote(row.props.get('name') ?? '')}`, ...args]];
      });
  }
}

/** En `add` van siempre las obligatorias y el nombre (aunque coincida con el de fábrica). */
function alwaysInAdd(menu: MenuDef): ReadonlySet<string> {
  const names = new Set(ALWAYS_IN_ADD);
  for (const p of menu.props) if (p.required) names.add(p.name);
  if (menu.autoName) names.add('name');
  if (menu.nameProp) names.add(menu.nameProp);
  return names;
}

const exportable = (p: PropDef, options: ExportOptions): boolean =>
  p.writable && !p.addOnly && !p.noExport && !(p.sensitive && !options.showSensitive);

/** Argumentos `nombre=valor` ordenados alfabéticamente, sin los valores por defecto. */
function argsOf(
  menu: MenuDef,
  def: ExportDef,
  row: Row,
  ctx: MenuCtx,
  options: ExportOptions,
  skip: string,
  always: ReadonlySet<string>,
): string[] {
  const defaults = def.rowDefaults?.(row, ctx);
  const args: (readonly [string, string])[] = [];
  for (const p of menu.props) {
    if (p.name === skip || !exportable(p, options)) continue;
    const value =
      p.name === 'comment' ? (row.comment ?? row.props.get(p.name)) : row.props.get(p.name);
    if (value === undefined) continue;
    const fallback = defaults?.get(p.name) ?? p.default ?? '';
    if (!options.verbose && value === fallback && !always.has(p.name)) continue;
    args.push([p.name, `${p.name}=${quote(value)}`]);
  }
  return args.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, text]) => text);
}

// ── Líneas largas ───────────────────────────────────────────────────────────

/**
 * Parte un comando en líneas de hasta MAX_WIDTH columnas (contando el ` \`
 * final), siempre entre argumentos: nunca dentro de un valor entre comillas.
 */
function wrap(command: Command): string[] {
  const [head = '', ...args] = command;
  const lines: string[] = [];
  let current = head;
  for (const [i, arg] of args.entries()) {
    const rest = args.slice(i).join(' ');
    if (current.length + 1 + rest.length <= MAX_WIDTH) {
      current = `${current} ${rest}`;
      break;
    }
    if (current.length + 1 + arg.length + 2 <= MAX_WIDTH) {
      current = `${current} ${arg}`;
    } else {
      lines.push(`${current} \\`);
      current = `${INDENT}${arg}`;
    }
  }
  lines.push(current);
  return lines;
}
