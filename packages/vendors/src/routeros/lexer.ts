/**
 * Analizador léxico de la consola de RouterOS. Una línea puede tener varios
 * comandos separados por `;`. Cada palabra puede llevar comillas, `nombre=valor`
 * y sustituciones `[ ... ]`. Se guardan las posiciones para los mensajes
 * `(line 1 column N)`.
 */
import { err, ok, type Result, type SyntaxFault } from '@nos/core';

export interface Token {
  /** Texto sin comillas. Una sustitución aparece como `[...]`. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Posición del primer `=` fuera de comillas dentro de `text`, o -1. */
  readonly eq: number;
  /** Contenido de la sustitución `[ ... ]` del valor, si la hay. */
  readonly sub?: string;
  readonly quoted: boolean;
}

export interface LexedCommand {
  readonly tokens: readonly Token[];
  /** Texto original del comando (sin el `;`). */
  readonly source: string;
  /** Desplazamiento del comando dentro de la línea. */
  readonly offset: number;
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
  $: '$',
  '?': '?',
};

function readQuoted(
  line: string,
  start: number,
): Result<{ text: string; end: number }, SyntaxFault> {
  let text = '';
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i] as string;
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1] as string;
      text += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (ch === '"') return ok({ text, end: i + 1 });
    text += ch;
    i += 1;
  }
  return err({ code: 'syntax', at: start });
}

function readBracket(
  line: string,
  start: number,
): Result<{ inner: string; end: number }, SyntaxFault> {
  let depth = 0;
  let i = start;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      const q = readQuoted(line, i);
      if (!q.ok) return q;
      i = q.value.end;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return ok({ inner: line.slice(start + 1, i), end: i + 1 });
    }
    i += 1;
  }
  return err({ code: 'syntax', at: start });
}

/** Separa en comandos por `;` (fuera de comillas y corchetes) e ignora comentarios `#`. */
export function lexLine(line: string): Result<LexedCommand[], SyntaxFault> {
  const commands: LexedCommand[] = [];
  let tokens: Token[] = [];
  let commandStart = 0;
  let i = 0;

  const close = (endIndex: number) => {
    commands.push({ tokens, source: line.slice(commandStart, endIndex), offset: commandStart });
    tokens = [];
  };

  while (i < line.length) {
    const ch = line[i] as string;
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === ';') {
      close(i);
      i += 1;
      commandStart = i;
      continue;
    }
    if (ch === '#' && tokens.length === 0) break;

    const start = i;
    let text = '';
    let eq = -1;
    let quoted = false;
    let sub: string | undefined;
    while (i < line.length) {
      const c = line[i] as string;
      if (c === ' ' || c === '\t' || c === ';') break;
      if (c === '"') {
        const q = readQuoted(line, i);
        if (!q.ok) return q;
        text += q.value.text;
        quoted = true;
        i = q.value.end;
        continue;
      }
      if (c === '[') {
        const b = readBracket(line, i);
        if (!b.ok) return b;
        sub = b.value.inner;
        text += `[${b.value.inner}]`;
        i = b.value.end;
        continue;
      }
      if (c === ']') return err({ code: 'syntax', at: i });
      if (c === '=' && eq === -1) eq = text.length;
      text += c;
      i += 1;
    }
    tokens.push({ text, start, end: i, eq, quoted, ...(sub === undefined ? {} : { sub }) });
  }
  close(line.length);
  return ok(commands.filter((c) => c.tokens.length > 0));
}

/** Nombre y valor de un token `nombre=valor`. */
export function splitArg(token: Token): { key: string; value: string } | null {
  if (token.eq < 0) return null;
  return { key: token.text.slice(0, token.eq), value: token.text.slice(token.eq + 1) };
}
