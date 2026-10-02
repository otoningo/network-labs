/**
 * Autocompletado (Tab) y ayuda contextual (`?`) de la consola de RouterOS.
 * Recorre la línea como una versión ligera del parser (rutas absolutas o
 * relativas, `..`, la forma v7 `/ip/address/print` y el comando) y, según
 * dónde quede el cursor, propone submenús, comandos, argumentos o valores.
 * Nunca lanza: ante una entrada rara devuelve cero candidatos o ayuda genérica.
 */
import type { Completion, CompletionCandidate } from '@nos/core';
import { matchPrefix } from './codec';
import { lexLine, splitArg, type Token } from './lexer';
import { refNames } from './refs';
import { type MenuCtx, type PropDef, type RefTarget, T, type ValueType } from './schema';
import type { RouterosSession } from './session';
import { menuAt, namesAt, pathKey } from './tree';

export interface CompleteCtx {
  readonly menuCtx: MenuCtx;
  readonly session: RouterosSession;
}

// ── Descripción de tipos ────────────────────────────────────────────────────

const REF_LABELS: Readonly<Record<RefTarget, string>> = {
  interface: 'Interface name',
  bridge: 'Bridge name',
  pool: 'Pool name',
  'dhcp-server': 'DHCP server name',
  'interface-list': 'Interface list name',
  user: 'User name',
  file: 'File name',
};

/** Lo que muestra `?` junto a cada argumento: el tipo de valor que espera. */
export function describeType(type: ValueType): string {
  switch (type.kind) {
    case 'string':
    case 'name':
      return 'Text';
    case 'bool':
    case 'flag':
      return 'yes | no';
    case 'int':
      return `Integer: ${type.min}..${type.max}`;
    case 'time':
      return 'Time interval';
    case 'kib':
      return 'Size in KiB';
    case 'ip':
      return 'IP address';
    case 'prefix':
      return 'IP address with prefix';
    case 'ip-list':
      return 'List of IP addresses';
    case 'prefix-list':
      return 'List of IP addresses with prefix';
    case 'range-list':
      return 'List of address ranges';
    case 'address':
      return 'IP address, prefix or range';
    case 'mac':
      return 'MAC address';
    case 'enum':
      return type.values.join(' | ');
    case 'enum-list':
      return `List of: ${type.values.join(' | ')}`;
    case 'ref':
      return REF_LABELS[type.target];
    case 'ref-list':
      return `List of: ${REF_LABELS[type.target]}`;
    case 'vlan-ids':
      return 'List of VLAN IDs';
    case 'ports':
      return 'Port or port range';
    case 'gateway':
      return 'IP address or interface';
    case 'protocol':
      return 'Protocol name or number';
    case 'neg':
      return `${describeType(type.inner)} (! to negate)`;
  }
}

// ── Argumentos de cada comando ──────────────────────────────────────────────

interface ArgSpec {
  readonly name: string;
  readonly type: ValueType;
  /** Se escribe sin `=`: opciones de print o export, flags como `blackhole`. */
  readonly word: boolean;
  /** Descripción del candidato (`PropDef.help`). */
  readonly help?: string;
  /** Texto fijo de la ayuda cuando el tipo no lo explica (opciones de print). */
  readonly about?: string;
}

const arg = (name: string, type: ValueType): ArgSpec => ({
  name,
  type,
  word: type.kind === 'flag',
});

const fromProp = (p: PropDef): ArgSpec => ({
  ...arg(p.name, p.type),
  ...(p.help === undefined ? {} : { help: p.help }),
});

const printOption = (name: string, about: string): ArgSpec => ({
  name,
  type: T.flag,
  word: true,
  about,
});

const PRINT_ARGS: readonly ArgSpec[] = [
  printOption('brief', 'Print a table with the main properties'),
  printOption('count-only', 'Print only the number of items'),
  printOption('detail', 'Print all properties of each item'),
  printOption('stats', 'Print statistics'),
  printOption('terse', 'Print each item on one line'),
  printOption('where', 'Print only the items that match an expression'),
  printOption('without-paging', 'Print everything without stopping'),
];
const PRINT_NAMES = PRINT_ARGS.map((a) => a.name);

const GLOBAL_ARGS: Readonly<Record<string, readonly ArgSpec[]>> = {
  ping: [
    { ...arg('address', T.string), about: 'IP address or DNS name' },
    arg('count', T.int(1, 4294967295)),
    arg('interface', T.ref('interface')),
    arg('interval', T.time),
    arg('src-address', T.ip),
    arg('size', T.int(14, 65535)),
  ],
  export: [
    arg('compact', T.flag),
    arg('terse', T.flag),
    arg('verbose', T.flag),
    arg('file', T.string),
    arg('show-sensitive', T.flag),
    arg('hide-sensitive', T.flag),
  ],
  import: [arg('file-name', T.ref('file'))],
};

/** Argumentos que admite `command` en el menú `path` (como los resuelve el parser). */
function argSpecs(path: string, command: string): readonly ArgSpec[] {
  const menu = menuAt(path);
  if (menu) {
    const actions = menu.actions;
    const action = actions && Object.hasOwn(actions, command) ? actions[command] : undefined;
    // `confirmed` lo añade el driver al responder [y/N]; no es algo que se escriba.
    if (action) return action.args.filter((a) => a.name !== 'confirmed').map(fromProp);
    if (command === 'add' && menu.add) return menu.props.filter((p) => p.writable).map(fromProp);
    if (command === 'set' && menu.update) {
      return menu.props.filter((p) => p.writable && !p.addOnly).map(fromProp);
    }
    if (command === 'print' && menu.style !== 'none') return PRINT_ARGS;
  }
  return Object.hasOwn(GLOBAL_ARGS, command) ? (GLOBAL_ARGS[command] ?? []) : [];
}

// ── Recorrido de la línea ───────────────────────────────────────────────────

interface Place {
  path: string[];
  command: string | undefined;
}

/**
 * Avanza por los segmentos de una palabra de ruta (`/ip`, `..`, `ip/address/print`).
 * Igual que el parser: coincidencia exacta o prefijo único entre submenús y
 * comandos juntos. Devuelve false si un segmento no existe o es ambiguo.
 */
function enter(place: Place, word: string): boolean {
  let rest = word;
  if (rest.startsWith('/')) {
    place.path = [];
    rest = rest.slice(1);
  }
  for (const segment of rest.split('/')) {
    if (segment === '') continue;
    if (place.command !== undefined) return false;
    if (segment === '..') {
      place.path = place.path.slice(0, -1);
      continue;
    }
    const { children, commands } = namesAt(pathKey(place.path));
    const { match } = matchPrefix(segment, [...children, ...commands.map((c) => c.name)]);
    if (match === undefined) return false;
    if (children.includes(match)) place.path = [...place.path, match];
    else place.command = match;
  }
  return true;
}

interface Walk {
  readonly place: Place;
  /** Palabras después del comando. */
  readonly args: readonly Token[];
  /** Alguna palabra no se reconoció; `place` queda donde se llegó. */
  readonly failed: boolean;
}

function walk(tokens: readonly Token[], start: readonly string[]): Walk {
  const place: Place = { path: [...start], command: undefined };
  const args: Token[] = [];
  for (const token of tokens) {
    if (place.command !== undefined) {
      args.push(token);
      continue;
    }
    const plain = token.eq < 0 && token.sub === undefined && !token.quoted;
    if (!plain || !enter(place, token.text)) return { place, args, failed: true };
  }
  return { place, args, failed: false };
}

/** Palabras del último comando de la línea (tras el último `;`), o null si no se puede analizar. */
function lastCommandTokens(text: string): readonly Token[] | null {
  const lexed = lexLine(text);
  if (!lexed.ok) return null;
  const last = lexed.value.at(-1);
  if (last === undefined) return [];
  // Si el último comando terminó en `;`, lo que sigue es un comando nuevo.
  return last.offset + last.source.length < text.length ? [] : last.tokens;
}

/** Inicio de la palabra bajo el cursor: tras el último espacio, tabulador o `;`. */
const wordStart = (text: string): number =>
  Math.max(text.lastIndexOf(' '), text.lastIndexOf('\t'), text.lastIndexOf(';')) + 1;

const join = (path: string, name: string): string => (path === '' ? name : `${path}/${name}`);

const byText = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

const candidate = (text: string, description: string | undefined): CompletionCandidate =>
  description === undefined ? { text } : { text, description };

/** Filtra por prefijo, quita repetidos y ordena alfabéticamente. */
function finish(list: readonly CompletionCandidate[], prefix: string): CompletionCandidate[] {
  const seen = new Set<string>();
  const out: CompletionCandidate[] = [];
  for (const c of list) {
    if (!c.text.startsWith(prefix) || seen.has(c.text)) continue;
    seen.add(c.text);
    out.push(c);
  }
  return out.sort((a, b) => byText(a.text, b.text));
}

// ── Autocompletado ──────────────────────────────────────────────────────────

/** Posición de ruta o comando: submenús y comandos del último segmento. */
function completePath(start: readonly string[], word: string, end: number): Completion | null {
  const place: Place = { path: [...start], command: undefined };
  const slash = word.lastIndexOf('/');
  const last = word.slice(slash + 1);
  if (slash >= 0 && !enter(place, word.slice(0, slash + 1))) return null;
  if (place.command !== undefined) return null;
  const key = pathKey(place.path);
  const { children, commands } = namesAt(key);
  const list = [
    ...children.map((name) => candidate(name, menuAt(join(key, name))?.help)),
    ...commands.map((c) => candidate(c.name, c.help)),
  ];
  return { replaceFrom: end - last.length, candidates: finish(list, last) };
}

interface ValueOptions {
  readonly options: readonly string[];
  /** Lista separada por comas: se completa el último elemento. */
  readonly list: boolean;
}

function valueOptions(type: ValueType, ctx: MenuCtx): ValueOptions {
  switch (type.kind) {
    case 'enum':
      return { options: type.values, list: false };
    case 'enum-list':
      return { options: type.values, list: true };
    case 'bool':
    case 'flag':
      return { options: ['yes', 'no'], list: false };
    case 'ref':
      return { options: [...(type.extra ?? []), ...refNames(ctx, type.target)], list: false };
    case 'ref-list':
      return { options: refNames(ctx, type.target), list: true };
    case 'protocol':
      return { options: ['icmp', 'tcp', 'udp'], list: false };
    case 'gateway':
      return { options: refNames(ctx, 'interface'), list: false };
    case 'neg':
      return valueOptions(type.inner, ctx);
    default:
      return { options: [], list: false };
  }
}

/** Valor de `nombre=valor`: `start` es la posición justo después del `=`. */
function completeValue(type: ValueType, raw: string, start: number, ctx: MenuCtx): Completion {
  let value = raw;
  let from = start;
  if (type.kind === 'neg' && value.startsWith('!')) {
    value = value.slice(1);
    from += 1;
  }
  const { options, list } = valueOptions(type, ctx);
  if (list) {
    const comma = value.lastIndexOf(',');
    value = value.slice(comma + 1);
    from += comma + 1;
  }
  return {
    replaceFrom: from,
    candidates: finish(
      options.map((o) => ({ text: o })),
      value,
    ),
  };
}

function findSpec(pool: readonly ArgSpec[], key: string): ArgSpec | undefined {
  if (key === '') return undefined;
  const { match } = matchPrefix(
    key,
    pool.map((s) => s.name),
  );
  return pool.find((s) => s.name === match);
}

/** Argumentos ya escritos (con nombre abreviado o no), para no proponerlos otra vez. */
function givenNames(args: readonly Token[], pool: readonly ArgSpec[]): Set<string> {
  const given = new Set<string>();
  for (const token of args) {
    const kv = splitArg(token);
    const spec = findSpec(pool, kv ? kv.key : token.text);
    // Una palabra suelta solo cuenta si el argumento se escribe sin `=`.
    if (spec && (kv !== null || spec.word)) given.add(spec.name);
  }
  return given;
}

function completeArgs(
  path: string,
  command: string,
  args: readonly Token[],
  word: string,
  from: number,
  ctx: MenuCtx,
): Completion | null {
  const menu = menuAt(path);
  // Tras `print where` se escriben expresiones sobre las propiedades del menú.
  const where =
    command === 'print' &&
    menu !== undefined &&
    args.some((t) => t.eq < 0 && matchPrefix(t.text, PRINT_NAMES).match === 'where');
  const pool: readonly ArgSpec[] = where
    ? (menu?.props ?? []).map((p) => ({ ...fromProp(p), word: true }))
    : argSpecs(path, command);

  const eq = word.indexOf('=');
  if (eq >= 0) {
    let key = word.slice(0, eq);
    if (where) key = key.replace(/^!/, '').replace(/[!<>~]+$/, '');
    const spec = findSpec(pool, key);
    return spec ? completeValue(spec.type, word.slice(eq + 1), from + eq + 1, ctx) : null;
  }

  const given = where ? new Set<string>() : givenNames(args, pool);
  const list = pool
    .filter((s) => !given.has(s.name))
    .map((s) => candidate(s.word ? s.name : `${s.name}=`, s.help ?? s.about));
  return { replaceFrom: from, candidates: finish(list, word) };
}

/**
 * Candidatos para la palabra que termina en `cursor`. `replaceFrom` indica
 * desde dónde se sustituye la entrada al aceptar uno.
 */
export function complete(input: string, cursor: number, ctx: CompleteCtx): Completion {
  const end = Number.isFinite(cursor)
    ? Math.max(0, Math.min(Math.trunc(cursor), input.length))
    : input.length;
  const text = input.slice(0, end);
  const from = wordStart(text);
  const word = text.slice(from);
  const none: Completion = { replaceFrom: end, candidates: [] };

  const tokens = lastCommandTokens(text.slice(0, from));
  if (tokens === null) return none;
  const { place, args, failed } = walk(tokens, ctx.session.path);
  if (failed) return none;
  const result =
    place.command === undefined
      ? completePath(place.path, word, end)
      : completeArgs(pathKey(place.path), place.command, args, word, from, ctx.menuCtx);
  return result ?? none;
}

// ── Ayuda (`?`) ─────────────────────────────────────────────────────────────

function pathHelp(path: string): string {
  const lines = [menuAt(path)?.help ?? (path === '' ? 'Global commands' : path), ''];
  if (path !== '') {
    const parent = path.split('/').slice(0, -1).at(-1);
    lines.push(`.. -- go up to ${parent ?? 'root'}`);
  }
  const { children, commands } = namesAt(path);
  const entries = [
    ...children.map((name) => ({
      name,
      line: `${name}/ -- ${menuAt(join(path, name))?.help ?? name}`,
    })),
    ...commands.map((c) => ({ name: c.name, line: `${c.name} -- ${c.help}` })),
  ].sort((a, b) => byText(a.name, b.name));
  return [...lines, ...entries.map((e) => e.line)].join('\n');
}

function commandHelp(path: string, command: string): string {
  const title = namesAt(path).commands.find((c) => c.name === command)?.help ?? command;
  const args = [...argSpecs(path, command)].sort((a, b) => byText(a.name, b.name));
  if (args.length === 0) return title;
  return [title, '', ...args.map((a) => `${a.name} -- ${a.about ?? describeType(a.type)}`)].join(
    '\n',
  );
}

/**
 * Lo que muestra la tecla `?` con la línea escrita hasta el cursor: el menú
 * (submenús y comandos) o, si ya hay comando, sus argumentos y tipos.
 */
export function help(input: string, ctx: CompleteCtx): string {
  // Por si el llamador incluye el propio `?`.
  const text = input.endsWith('?') ? input.slice(0, -1) : input;
  const { place } = walk(lastCommandTokens(text) ?? [], ctx.session.path);
  const path = pathKey(place.path);
  return place.command === undefined ? pathHelp(path) : commandHelp(path, place.command);
}
