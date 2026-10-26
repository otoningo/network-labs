/**
 * Motor de comandos de VRP. Cada comando es una lista de formas planas
 * (palabras clave y argumentos); las palabras se aceptan por prefijo único y
 * sin distinguir mayúsculas (`dis cu`, `int g0/0/1`), como en el equipo. Todas
 * las formas avanzan en paralelo token a token, así el error sale en la
 * posición exacta (`^`) y con el motivo que daría VRP. La misma maquinaria
 * responde a `?` y a Tab.
 */
import {
  type Device,
  type DriverContext,
  lenOfMask,
  type Network,
  parseIpv4,
  type Result,
} from '@nos/core';
import type { VrpIntent } from './intent';
import type { ViewKind, VrpSession } from './session';

// ── Nodos ───────────────────────────────────────────────────────────────────

export type ArgType =
  | { readonly kind: 'ipv4' }
  /** Máscara en formato X.X.X.X, con los unos seguidos. */
  | { readonly kind: 'mask' }
  /** Máscara X.X.X.X o longitud 0-32. */
  | { readonly kind: 'mask-or-len' }
  /** Comodín de ACL: X.X.X.X con cualquier patrón de bits. */
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'word'; readonly max: number }
  /** Nombre de interfaz completo o abreviado (`GigabitEthernet0/0/1`, `g0/0/1`). */
  | { readonly kind: 'iface' }
  /** El resto de la línea, espacios incluidos (descripciones). */
  | { readonly kind: 'text'; readonly max: number };

export type Node =
  | { readonly t: 'kw'; readonly word: string; readonly help: string }
  | { readonly t: 'arg'; readonly name: string; readonly type: ArgType; readonly help: string };

export const kw = (word: string, help: string): Node => ({ t: 'kw', word, help });
export const arg = (name: string, type: ArgType, help: string): Node => ({
  t: 'arg',
  name,
  type,
  help,
});

/** Lo que se reconoció de una línea: palabras clave (completas) y argumentos (tal cual). */
export interface Matched {
  readonly form: number;
  readonly words: readonly string[];
  readonly args: Readonly<Record<string, string>>;
  readonly has: (word: string) => boolean;
  /** Columna donde empieza cada argumento, para señalar errores de valor con `^`. */
  readonly argAt: Readonly<Record<string, number>>;
}

export interface CmdCtx {
  readonly net: Network;
  readonly device: Device;
  readonly session: VrpSession;
}

export const ctxOf = (ctx: DriverContext<VrpSession>): CmdCtx => ({
  net: ctx.net,
  device: ctx.device,
  session: ctx.session,
});

/** Error de un comando ya reconocido (valor fuera de rango, objeto que no existe...). */
export interface VrpFault {
  readonly code: string;
  readonly at?: number;
  readonly detail?: Readonly<Record<string, string | number>>;
}

export interface CommandSpec {
  readonly views: readonly ViewKind[];
  readonly forms: readonly (readonly Node[])[];
  readonly build: (m: Matched, ctx: CmdCtx) => Result<VrpIntent, VrpFault>;
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export interface Token {
  readonly text: string;
  readonly at: number;
}

/** Tipos de interfaz que VRP acepta con el número separado (`GigabitEthernet 0/0/1`). */
const IFACE_TYPES = ['GigabitEthernet', 'LoopBack', 'Vlanif', 'NULL'] as const;
const NUMBERING = /^\d+(\/\d+)*(\.\d+)?$/;

function ifaceTypeOf(word: string): string | null {
  const lower = word.toLowerCase();
  // `ge` es la abreviatura de GigabitEthernet que imprime el propio VRP.
  if (lower === 'ge') return 'GigabitEthernet';
  const hits = IFACE_TYPES.filter((t) => t.toLowerCase().startsWith(lower));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** Corta la línea en tokens y une `GigabitEthernet 0/0/1` en un solo token. */
export function tokenize(line: string): Token[] {
  const raw: Token[] = [];
  const re = /\S+/g;
  for (let m = re.exec(line); m; m = re.exec(line)) raw.push({ text: m[0], at: m.index });
  const out: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i] as Token;
    const next = raw[i + 1];
    if (next && /^[a-z-]+$/i.test(tok.text) && NUMBERING.test(next.text) && ifaceTypeOf(tok.text)) {
      out.push({ text: `${tok.text}${next.text}`, at: tok.at });
      i++;
      continue;
    }
    out.push(tok);
  }
  return out;
}

/** Nombre canónico de una interfaz escrita completa o abreviada; null si no lo parece. */
export function canonicalIface(text: string): string | null {
  const m = /^([a-z-]+)\s*(\d+(?:\/\d+)*(?:\.\d+)?)$/i.exec(text);
  if (!m) return null;
  const type = ifaceTypeOf(m[1] ?? '');
  return type ? `${type}${m[2]}` : null;
}

// ── Validación de argumentos ────────────────────────────────────────────────

const isInt = (text: string) => /^\d+$/.test(text);

export function acceptsArg(type: ArgType, text: string): boolean {
  switch (type.kind) {
    case 'ipv4':
      return parseIpv4(text) !== null;
    case 'mask': {
      const ip = parseIpv4(text);
      return ip !== null && lenOfMask(ip) !== null;
    }
    case 'mask-or-len': {
      if (isInt(text)) return Number(text) <= 32;
      const ip = parseIpv4(text);
      return ip !== null && lenOfMask(ip) !== null;
    }
    case 'wildcard':
      return parseIpv4(text) !== null;
    case 'int':
      return isInt(text) && Number(text) >= type.min && Number(text) <= type.max;
    case 'word':
      return text.length <= type.max;
    case 'iface':
      return canonicalIface(text) !== null;
    case 'text':
      return true;
  }
}

/** Cómo se rotula un argumento en la ayuda de `?`. */
export function argLabel(type: ArgType): string {
  switch (type.kind) {
    case 'ipv4':
    case 'mask':
    case 'wildcard':
      return 'X.X.X.X';
    case 'mask-or-len':
      return 'INTEGER<0-32>';
    case 'int':
      return `INTEGER<${type.min}-${type.max}>`;
    case 'word':
      return `STRING<1-${type.max}>`;
    case 'iface':
      return 'GigabitEthernet';
    case 'text':
      return `TEXT<1-${type.max}>`;
  }
}

// ── Emparejado en paralelo ──────────────────────────────────────────────────

interface Live {
  readonly cmd: number;
  readonly form: number;
  readonly node: number;
  readonly words: readonly string[];
  readonly args: Readonly<Record<string, string>>;
  readonly argAt: Readonly<Record<string, number>>;
  /** Un argumento de texto ya se tragó el resto de la línea. */
  readonly rest: boolean;
}

export type FaultCode =
  | 'unrecognized'
  | 'wrong-parameter'
  | 'incomplete'
  | 'too-many'
  | 'ambiguous';

export type MatchOutcome =
  | { readonly ok: true; readonly cmd: number; readonly matched: Matched }
  | { readonly ok: false; readonly code: FaultCode; readonly at: number };

const nodeOf = (cmds: readonly CommandSpec[], s: Live): Node | undefined =>
  cmds[s.cmd]?.forms[s.form]?.[s.node];

function start(cmds: readonly CommandSpec[]): Live[] {
  const out: Live[] = [];
  cmds.forEach((cmd, c) => {
    cmd.forms.forEach((_form, f) => {
      out.push({ cmd: c, form: f, node: 0, words: [], args: {}, argAt: {}, rest: false });
    });
  });
  return out;
}

interface Step {
  readonly live: Live[];
  readonly fault?: { readonly code: FaultCode; readonly at: number };
}

/** Avanza todas las formas vivas con un token. */
function step(cmds: readonly CommandSpec[], live: Live[], tok: Token, line: string): Step {
  const lower = tok.text.toLowerCase();
  const pending = live.filter((s) => !s.rest);
  const done = live.filter((s) => s.rest);
  if (pending.length === 0) return { live: done };

  // Palabras clave: exacta, o prefijo de una sola palabra.
  const kwStates = pending.filter((s) => {
    const n = nodeOf(cmds, s);
    return n?.t === 'kw' && n.word.startsWith(lower);
  });
  if (kwStates.length > 0) {
    const words = new Set(kwStates.map((s) => (nodeOf(cmds, s) as { word: string }).word));
    const exact = [...words].find((w) => w === lower);
    if (!exact && words.size > 1) return { live: [], fault: { code: 'ambiguous', at: tok.at } };
    const chosen = exact ?? [...words][0];
    return {
      live: kwStates
        .filter((s) => (nodeOf(cmds, s) as { word: string }).word === chosen)
        .map((s) => ({ ...s, node: s.node + 1, words: [...s.words, chosen as string] })),
    };
  }

  // Argumentos que aceptan el token.
  const argStates: Live[] = [];
  for (const s of pending) {
    const n = nodeOf(cmds, s);
    if (n?.t !== 'arg') continue;
    if (n.type.kind === 'text') {
      argStates.push({
        ...s,
        node: s.node + 1,
        args: { ...s.args, [n.name]: line.slice(tok.at).trimEnd() },
        argAt: { ...s.argAt, [n.name]: tok.at },
        rest: true,
      });
    } else if (acceptsArg(n.type, tok.text)) {
      argStates.push({
        ...s,
        node: s.node + 1,
        args: { ...s.args, [n.name]: tok.text },
        argAt: { ...s.argAt, [n.name]: tok.at },
      });
    }
  }
  if (argStates.length > 0) return { live: argStates };

  // Nadie lo acepta: el motivo depende de lo que se esperaba ahí.
  const expected = pending.map((s) => nodeOf(cmds, s));
  const code: FaultCode = expected.every((n) => n === undefined)
    ? 'too-many'
    : expected.some((n) => n?.t === 'arg')
      ? 'wrong-parameter'
      : 'unrecognized';
  return { live: [], fault: { code, at: tok.at } };
}

function complete(cmds: readonly CommandSpec[], live: Live[]): Live[] {
  return live.filter((s) => s.rest || nodeOf(cmds, s) === undefined);
}

function toMatched(s: Live): Matched {
  const words = s.words;
  return {
    form: s.form,
    words,
    args: s.args,
    argAt: s.argAt,
    has: (word) => words.includes(word),
  };
}

/** Empareja una línea con los comandos de la vista actual. */
export function matchLine(cmds: readonly CommandSpec[], line: string): MatchOutcome {
  const tokens = tokenize(line);
  let live = start(cmds);
  for (const tok of tokens) {
    const next = step(cmds, live, tok, line);
    if (next.fault) return { ok: false, ...next.fault };
    live = next.live;
  }
  const finished = complete(cmds, live);
  const first = finished[0];
  if (first) return { ok: true, cmd: first.cmd, matched: toMatched(first) };
  return { ok: false, code: 'incomplete', at: line.trimEnd().length };
}

// ── Ayuda y autocompletado ──────────────────────────────────────────────────

export interface HelpEntry {
  readonly name: string;
  readonly help: string;
}

/** Lo que puede venir después de lo escrito (o lo que empieza por la palabra a medias). */
export function helpEntries(cmds: readonly CommandSpec[], input: string): HelpEntry[] | null {
  const partial = /\S$/.test(input);
  const tokens = tokenize(input);
  const head = partial ? tokens.slice(0, -1) : tokens;
  const word = partial ? (tokens.at(-1)?.text.toLowerCase() ?? '') : '';
  let live = start(cmds);
  for (const tok of head) {
    const next = step(cmds, live, tok, input);
    if (next.fault) return null;
    live = next.live;
  }
  const entries = new Map<string, HelpEntry>();
  for (const s of live) {
    const n = nodeOf(cmds, s);
    if (s.rest || !n) {
      if (!partial) entries.set('<cr>', { name: '<cr>', help: '' });
      continue;
    }
    if (n.t === 'kw') {
      if (n.word.startsWith(word)) entries.set(n.word, { name: n.word, help: n.help });
    } else if (!partial) {
      const name = argLabel(n.type);
      entries.set(`${name}:${n.help}`, { name, help: n.help });
    }
  }
  const list = [...entries.values()];
  // Las palabras en orden alfabético, como las lista VRP; argumentos y <cr> al final.
  return list.sort((a, b) => {
    const rank = (e: HelpEntry) => (e.name === '<cr>' ? 2 : /^[a-z]/.test(e.name) ? 0 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
}

/** Ayuda de `?` con el formato de VRP: nombre y descripción en dos columnas. */
export function formatHelp(entries: readonly HelpEntry[]): string {
  if (entries.length === 0) return '';
  const width = Math.max(16, ...entries.map((e) => e.name.length + 2));
  return entries
    .map((e) => (e.help ? `  ${e.name.padEnd(width)}${e.help}` : `  ${e.name}`))
    .join('\n');
}

/** Palabras clave que completan la palabra a medias en la posición del cursor. */
export function completions(
  cmds: readonly CommandSpec[],
  input: string,
): { readonly replaceFrom: number; readonly words: readonly string[] } {
  const partial = /\S$/.test(input);
  const tokens = tokenize(input);
  const last = partial ? tokens.at(-1) : undefined;
  const entries = helpEntries(cmds, input) ?? [];
  const words = entries.filter((e) => /^[a-z]/.test(e.name)).map((e) => e.name);
  return { replaceFrom: last ? last.at : input.length, words };
}
