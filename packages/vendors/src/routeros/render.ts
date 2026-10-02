/**
 * Salida de `print` al estilo de la consola de RouterOS v7: tabla con leyenda
 * de flags y línea `Columns:`, detalle `clave=valor`, terse, count, stats,
 * menús únicos (`clave: valor`) y las líneas del log.
 */
import type { PrintMode } from './intent';
import type { FlagSlot, MenuDef, Row } from './schema';
import { quote } from './values';

export interface PrintResult {
  readonly text: string;
  /** Claves de las filas numeradas: el índice es el número de print. */
  readonly numbered: readonly string[];
}

/** Ancho máximo de línea en detail (la consola tiene 80 columnas). */
const MAX_WIDTH = 79;

/** Columnas que se alinean a la derecha aunque su propiedad sea texto (contadores). */
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  'bytes',
  'packets',
  'rx-byte',
  'tx-byte',
  'rx-packet',
  'tx-packet',
  'actual-mtu',
  'mtu',
  'distance',
  'port',
  'pvid',
  'size',
  'vlan-id',
]);

/** Fila lista para imprimir: su número (si lo lleva) y sus flags ordenadas. */
interface Printed {
  readonly row: Row;
  readonly number: number | undefined;
  readonly flags: string;
}

export function renderPrint(menu: MenuDef, rows: readonly Row[], mode: PrintMode): PrintResult {
  const numbered = rows.filter((row) => row.numbered).map((row) => row.key);
  if (mode === 'count') return { text: String(rows.length), numbered };
  const lines = layout(menu, prepare(menu, rows), mode).map((line) => line.trimEnd());
  return { text: lines.join('\n'), numbered };
}

function prepare(menu: MenuDef, rows: readonly Row[]): Printed[] {
  const printed: Printed[] = [];
  let next = 0;
  for (const row of rows) {
    const number = row.numbered ? next : undefined;
    if (row.numbered) next += 1;
    printed.push({ row, number, flags: orderFlags(menu.flags, row.flags) });
  }
  return printed;
}

function layout(menu: MenuDef, printed: readonly Printed[], mode: PrintMode): string[] {
  const first = printed[0];
  if (!first || menu.style === 'none') return [];
  if (menu.style === 'singleton') return singleton(menu, first.row);
  if (mode === 'terse') return terse(menu, printed);
  if (mode === 'detail') return detail(menu, printed);
  if (mode === 'stats') {
    const columns = menu.statsColumns ?? menu.columns;
    if (columns.length > 0) return table(menu, printed, columns);
  }
  if (menu.style === 'lines') return printed.map((p) => logLine(p.row));
  if (menu.style === 'detail') return detail(menu, printed);
  return table(menu, printed, menu.columns);
}

// ── Flags ───────────────────────────────────────────────────────────────────

/** Letras en el orden de las columnas de flags del menú; las desconocidas, al final. */
function orderFlags(slots: readonly FlagSlot[], letters: string): string {
  const known = [...new Set(slots.flat().map((f) => f.letter))];
  const ordered = known.filter((letter) => letters.includes(letter));
  const unknown = [...letters].filter((letter) => !known.includes(letter));
  return [...ordered, ...unknown].join('');
}

/** `Flags: X - DISABLED, I - INVALID; D - DYNAMIC`, solo con las flags que aparecen. */
function legend(slots: readonly FlagSlot[], printed: readonly Printed[]): string[] {
  const used = new Set(printed.flatMap((p) => [...p.flags]));
  const groups = slots
    .map((slot) =>
      slot
        .filter((f) => used.has(f.letter))
        .map((f) => `${f.letter} - ${f.name.toUpperCase()}`)
        .join(', '),
    )
    .filter((group) => group !== '');
  return groups.length === 0 ? [] : [`Flags: ${groups.join('; ')}`];
}

const flagWidthOf = (printed: readonly Printed[]): number =>
  Math.max(0, ...printed.map((p) => p.flags.length));

// ── Tabla ───────────────────────────────────────────────────────────────────

function isNumeric(menu: MenuDef, column: string): boolean {
  const kind = menu.props.find((p) => p.name === column)?.type.kind;
  return kind === 'int' || kind === 'kib' || NUMERIC_COLUMNS.has(column);
}

function table(menu: MenuDef, printed: readonly Printed[], columns: readonly string[]): string[] {
  const headers = columns.map((c) => c.toUpperCase());
  const cells = printed.map((p) => columns.map((c) => p.row.props.get(c) ?? ''));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((values) => (values[i] ?? '').length)),
  );
  const numeric = columns.map((c) => isNumeric(menu, c));
  const format = (values: readonly string[]): string =>
    values
      .map((v, i) => (numeric[i] ? v.padStart(widths[i] ?? 0) : v.padEnd(widths[i] ?? 0)))
      .join('  ');

  const numWidth = Math.max(1, String(Math.max(0, ...printed.map((p) => p.number ?? 0))).length);
  const flagWidth = flagWidthOf(printed);
  const flagColumn = (flags: string): string =>
    flagWidth > 0 ? ` ${flags.padStart(flagWidth)}` : '';

  const lines = [
    ...legend(menu.flags, printed),
    `Columns: ${headers.join(', ')}`,
    `${'#'.padEnd(numWidth)}${flagColumn('')} ${format(headers)}`,
  ];
  printed.forEach((p, i) => {
    if (p.row.comment) lines.push(`;;; ${p.row.comment}`);
    const number = String(p.number ?? '').padEnd(numWidth);
    lines.push(`${number}${flagColumn(p.flags)} ${format(cells[i] ?? [])}`);
  });
  return lines;
}

// ── Detalle y terse ─────────────────────────────────────────────────────────

/** `clave=valor` de las propiedades visibles, en el orden del menú (el comentario va aparte). */
function pairs(menu: MenuDef, row: Row): string[] {
  return menu.props
    .filter((p) => !p.hidden && p.name !== 'comment' && row.props.has(p.name))
    .map((p) => `${p.name}=${quote(row.props.get(p.name) ?? '')}`);
}

/** Reparte los pares en líneas de hasta MAX_WIDTH, cortando solo entre pares. */
function wrapPairs(start: string, items: readonly string[], indent: string): string[] {
  const lines: string[] = [];
  let current = start;
  let empty = true;
  for (const item of items) {
    if (!empty && current.length + 1 + item.length > MAX_WIDTH) {
      lines.push(current);
      current = indent;
      empty = true;
    }
    current = empty ? `${current}${item}` : `${current} ${item}`;
    empty = false;
  }
  lines.push(current);
  return lines;
}

function detail(menu: MenuDef, printed: readonly Printed[]): string[] {
  const flagWidth = flagWidthOf(printed);
  const blocks = printed.map((p) => {
    const prefix = `${String(p.number ?? '').padStart(2)} ${p.flags.padEnd(flagWidth)} `;
    const indent = ' '.repeat(prefix.length);
    const items = pairs(menu, p.row);
    if (!p.row.comment) return wrapPairs(prefix, items, indent);
    const head = `${prefix};;; ${p.row.comment}`;
    return items.length === 0 ? [head] : [head, ...wrapPairs(indent, items, indent)];
  });
  return [
    ...legend(menu.flags, printed),
    ...blocks.flatMap((block, i) => (i === 0 ? block : ['', ...block])),
  ];
}

function terse(menu: MenuDef, printed: readonly Printed[]): string[] {
  return printed.map((p) => {
    const comment = p.row.comment ? [`comment=${quote(p.row.comment)}`] : [];
    const items = [...comment, ...pairs(menu, p.row)].join(' ');
    return `${String(p.number ?? '').padStart(2)} ${p.flags} ${items}`;
  });
}

// ── Menús únicos y log ──────────────────────────────────────────────────────

function singleton(menu: MenuDef, row: Row): string[] {
  const entries = menu.props
    .filter((p) => !p.hidden && row.props.has(p.name))
    .map((p) => [p.name, row.props.get(p.name) ?? ''] as const);
  const width = Math.max(0, ...entries.map(([key]) => key.length)) + 2;
  return entries.map(([key, value]) => `${key.padStart(width)}: ${value}`);
}

function logLine(row: Row): string {
  const field = (name: string): string => row.props.get(name) ?? '';
  return ` ${field('time')} ${field('topics')} ${field('message')}`;
}
