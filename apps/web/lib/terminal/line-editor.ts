/**
 * Disciplina de línea de la terminal, sin DOM ni xterm: edición de la línea,
 * historial, Tab, pegado y las secuencias para repintar el prompt. xterm solo
 * dibuja; todo lo que decide qué hay en la línea vive aquí y se prueba aparte.
 */

export interface LineState {
  readonly text: string;
  /** Posición del cursor dentro de `text` (0 = antes del primer carácter). */
  readonly cursor: number;
}

export const EMPTY_LINE: LineState = { text: '', cursor: 0 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lineOf = (text: string, cursor = text.length): LineState => ({
  text,
  cursor: clamp(cursor, 0, text.length),
});

// ── Edición ────────────────────────────────────────────────────────────────

export function insert(line: LineState, chunk: string): LineState {
  if (chunk === '') return line;
  const text = line.text.slice(0, line.cursor) + chunk + line.text.slice(line.cursor);
  return { text, cursor: line.cursor + chunk.length };
}

export function backspace(line: LineState): LineState {
  if (line.cursor === 0) return line;
  return {
    text: line.text.slice(0, line.cursor - 1) + line.text.slice(line.cursor),
    cursor: line.cursor - 1,
  };
}

export function deleteForward(line: LineState): LineState {
  if (line.cursor >= line.text.length) return line;
  return {
    text: line.text.slice(0, line.cursor) + line.text.slice(line.cursor + 1),
    cursor: line.cursor,
  };
}

export const moveLeft = (line: LineState): LineState => lineOf(line.text, line.cursor - 1);
export const moveRight = (line: LineState): LineState => lineOf(line.text, line.cursor + 1);
export const moveHome = (line: LineState): LineState => lineOf(line.text, 0);
export const moveEnd = (line: LineState): LineState => lineOf(line.text);

/** Inicio de la palabra a la izquierda del cursor (salta antes los espacios). */
function wordStartBefore(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && text[i - 1] === ' ') i -= 1;
  while (i > 0 && text[i - 1] !== ' ') i -= 1;
  return i;
}

/** Fin de la palabra a la derecha del cursor. */
function wordEndAfter(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && text[i] === ' ') i += 1;
  while (i < text.length && text[i] !== ' ') i += 1;
  return i;
}

export const wordLeft = (line: LineState): LineState =>
  lineOf(line.text, wordStartBefore(line.text, line.cursor));
export const wordRight = (line: LineState): LineState =>
  lineOf(line.text, wordEndAfter(line.text, line.cursor));

/** Ctrl+U: borra desde el inicio hasta el cursor. */
export const killToStart = (line: LineState): LineState => ({
  text: line.text.slice(line.cursor),
  cursor: 0,
});

/** Ctrl+K: borra desde el cursor hasta el final. */
export const killToEnd = (line: LineState): LineState => ({
  text: line.text.slice(0, line.cursor),
  cursor: line.cursor,
});

/** Ctrl+W: borra la palabra anterior al cursor (y los espacios que la siguen). */
export function killWordBack(line: LineState): LineState {
  const start = wordStartBefore(line.text, line.cursor);
  return { text: line.text.slice(0, start) + line.text.slice(line.cursor), cursor: start };
}

/** El cursor está dentro de una cadena entre comillas (con escapes `\"`). */
export function insideQuotes(text: string, cursor: number): boolean {
  let open = false;
  for (let i = 0; i < cursor && i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && open) i += 1;
    else if (ch === '"') open = !open;
  }
  return open;
}

// ── Historial ──────────────────────────────────────────────────────────────

const HISTORY_LIMIT = 500;

/**
 * Historial de un equipo. Las líneas en blanco no entran y una línea igual a
 * la anterior tampoco. Al recorrerlo se conserva lo que se estaba escribiendo
 * (el borrador) para volver a él al bajar del todo.
 */
export class History {
  private readonly entries: string[] = [];
  /** Posición al recorrer; `entries.length` es el borrador. */
  private index = 0;
  private draft = '';

  get size(): number {
    return this.entries.length;
  }

  push(line: string): void {
    if (line.trim() !== '' && this.entries.at(-1) !== line) {
      this.entries.push(line);
      if (this.entries.length > HISTORY_LIMIT) this.entries.shift();
    }
    this.rewind();
  }

  /** Vuelve al final (al borrador vacío) sin tocar las entradas. */
  rewind(): void {
    this.index = this.entries.length;
    this.draft = '';
  }

  /** Flecha arriba: la entrada anterior, o null si no hay más. */
  previous(current: string): string | null {
    if (this.index === 0) return null;
    if (this.index === this.entries.length) this.draft = current;
    this.index -= 1;
    return this.entries[this.index] ?? null;
  }

  /** Flecha abajo: la entrada siguiente, el borrador al final, o null si ya estaba en él. */
  next(): string | null {
    if (this.index >= this.entries.length) return null;
    this.index += 1;
    return this.index === this.entries.length ? this.draft : (this.entries[this.index] ?? null);
  }
}

// ── Tab ────────────────────────────────────────────────────────────────────

export interface CompletionCandidate {
  readonly text: string;
  readonly description?: string;
}

export interface Completion {
  readonly replaceFrom: number;
  readonly candidates: readonly CompletionCandidate[];
}

export function commonPrefix(words: readonly string[]): string {
  const [first, ...rest] = words;
  if (first === undefined) return '';
  let end = first.length;
  for (const word of rest) {
    let i = 0;
    while (i < end && i < word.length && word[i] === first[i]) i += 1;
    end = i;
  }
  return first.slice(0, end);
}

export interface TabOutcome {
  readonly line: LineState;
  /** Candidatos que hay que mostrar debajo, si Tab no pudo decidir. */
  readonly listing: readonly string[] | null;
}

/**
 * Aplica la respuesta del driver a Tab. Un candidato se acepta (con un espacio
 * detrás salvo que termine en `/` o `=`); varios completan el prefijo común si
 * aporta algo y, si no, se listan; ninguno no hace nada.
 */
export function applyCompletion(line: LineState, completion: Completion): TabOutcome {
  const { candidates } = completion;
  const from = clamp(completion.replaceFrom, 0, line.cursor);
  const typed = line.text.slice(from, line.cursor);
  const replace = (word: string): LineState => ({
    text: line.text.slice(0, from) + word + line.text.slice(line.cursor),
    cursor: from + word.length,
  });

  const [only] = candidates;
  if (only === undefined) return { line, listing: null };
  if (candidates.length === 1) {
    const word = /[/=]$/.test(only.text) ? only.text : `${only.text} `;
    return { line: replace(word), listing: null };
  }
  const texts = candidates.map((c) => c.text);
  const prefix = commonPrefix(texts);
  if (prefix.length > typed.length) return { line: replace(prefix), listing: null };
  return { line, listing: texts };
}

/** Lista en columnas, por filas, con el ancho de la terminal (como hace RouterOS). */
export function formatColumns(items: readonly string[], cols: number, gap = 2): string[] {
  if (items.length === 0) return [];
  const width = Math.max(...items.map((item) => item.length)) + gap;
  const perRow = Math.max(1, Math.floor((cols + gap) / width));
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(
      items
        .slice(i, i + perRow)
        .map((item) => item.padEnd(width))
        .join('')
        .trimEnd(),
    );
  }
  return rows;
}

// ── Pegado ─────────────────────────────────────────────────────────────────

export interface PastedText {
  /** Líneas completas, que se ejecutan en orden. */
  readonly lines: readonly string[];
  /** Lo que queda tras el último salto: se deja escrito sin ejecutar. */
  readonly tail: string;
}

/**
 * Parte un texto pegado en líneas. Normaliza los saltos, cambia tabuladores
 * por espacios, quita otros caracteres de control y une las líneas partidas
 * con `\` al final (como las de un export).
 */
export function splitPaste(raw: string): PastedText {
  const clean = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan a propósito los caracteres de control
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  const parts = clean.split('\n');
  const tailRaw = parts.pop() ?? '';
  const lines: string[] = [];
  let pending: string | null = null;
  const join = (head: string | null, next: string): string =>
    head === null ? next : `${head} ${next.trimStart()}`;
  for (const part of parts) {
    const line = join(pending, part);
    if (line.trimEnd().endsWith('\\')) {
      pending = line.trimEnd().slice(0, -1).trimEnd();
    } else {
      lines.push(line);
      pending = null;
    }
  }
  const tail = pending === null ? tailRaw : tailRaw === '' ? pending : join(pending, tailRaw);
  return { lines, tail };
}

// ── Pintado ────────────────────────────────────────────────────────────────

const ESC = '\x1b';
// biome-ignore lint/suspicious/noControlCharactersInRegex: secuencias CSI/OSC de la terminal
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** Columnas que ocupa un texto en pantalla (sin secuencias de escape). */
export const visibleLength = (text: string): number => text.replace(ANSI, '').length;

/** Filas que ocupa un bloque de texto con `cols` columnas (cada línea, al menos una). */
export function rowsOf(text: string, cols: number): number {
  const width = Math.max(1, cols);
  return text
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(visibleLength(line) / width)), 0);
}

/** Saltos de línea del driver (`\n`) a los de la terminal (`\r\n`). */
export const toTerminal = (text: string): string => text.replace(/\r?\n/g, '\r\n');

export interface Painted {
  /** Secuencia que hay que escribir en la terminal. */
  readonly sequence: string;
  /** Fila del cursor, contada desde la primera fila del prompt. */
  readonly cursorRow: number;
}

const up = (rows: number): string => (rows > 0 ? `${ESC}[${rows}A` : '');
const right = (cols: number): string => (cols > 0 ? `${ESC}[${cols}C` : '');

/**
 * Repinta prompt y línea desde cero: sube hasta la primera fila del prompt,
 * borra hasta el final de la pantalla, escribe todo y deja el cursor en su
 * sitio. Funciona con líneas largas que ocupan varias filas.
 *
 * `cursorRow` es la fila en la que está ahora el cursor respecto al prompt.
 */
export function paintLine(
  prompt: string,
  line: LineState,
  cols: number,
  cursorRow: number,
): Painted {
  const width = Math.max(1, cols);
  const start = visibleLength(prompt);
  const end = start + line.text.length;
  const target = start + line.cursor;
  let sequence = `${up(cursorRow)}\r${ESC}[J${prompt}${line.text}`;
  // Si el texto llena justo la última fila, el cursor queda "pendiente de
  // salto" en la última columna: un espacio y \r lo llevan al inicio de la
  // fila siguiente para que las cuentas de abajo sean exactas.
  if (end > 0 && end % width === 0) sequence += ' \r';
  const endRow = Math.floor(end / width);
  const targetRow = Math.floor(target / width);
  sequence += `${up(endRow - targetRow)}\r${right(target % width)}`;
  return { sequence, cursorRow: targetRow };
}

/** Fila del cursor tras escribir de corrido hasta la posición `position` (con salto pendiente). */
export function rowAfterWriting(position: number, cols: number): number {
  const width = Math.max(1, cols);
  if (position > 0 && position % width === 0) return position / width - 1;
  return Math.floor(position / width);
}
