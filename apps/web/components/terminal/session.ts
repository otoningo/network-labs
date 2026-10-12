/**
 * Sesión de terminal de un lab: una instancia de xterm por store, que
 * sobrevive a los remontajes de <Console /> (el banco de trabajo cambia entre
 * paneles y pestañas a 1024px). xterm solo dibuja; la línea la llevamos
 * nosotros (ver lib/terminal/line-editor) y los comandos van al store.
 */
import type { DeviceId, KeyChord, LiveView } from '@nos/core';
import type { FitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal } from '@xterm/xterm';
import type { ConsoleResult } from '@/lib/lab/console';
import type { LabState, LabStore } from '@/lib/lab/store';
import {
  applyCompletion,
  backspace,
  deleteForward,
  EMPTY_LINE,
  formatColumns,
  History,
  insert,
  insideQuotes,
  killToEnd,
  killToStart,
  killWordBack,
  type LineState,
  lineOf,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  paintLine,
  rowAfterWriting,
  rowsOf,
  splitPaste,
  toTerminal,
  visibleLength,
  wordLeft,
  wordRight,
} from '@/lib/terminal/line-editor';

export interface XtermModules {
  readonly Terminal: typeof Terminal;
  readonly FitAddon: typeof FitAddon;
}

let modules: Promise<XtermModules> | null = null;

/** xterm toca `window` al cargarse: se importa solo en el navegador y una vez. */
export function loadXterm(): Promise<XtermModules> {
  modules ??= Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
    ([xterm, fit]) => ({ Terminal: xterm.Terminal, FitAddon: fit.FitAddon }),
  );
  return modules;
}

/** Textos propios de la terminal (no del equipo), ya en el idioma activo. */
export interface SessionTexts {
  readonly closed: string;
  /** Línea nuestra tras el banner del equipo: qué es esto y cómo pedir ayuda. */
  readonly intro: string;
  readonly restored: (count: number) => string;
  readonly separator: (device: string) => string;
}

type Mode = 'booting' | 'prompt' | 'confirm' | 'live' | 'closed';

interface Running {
  readonly view: LiveView;
  /** Fotogramas ya dibujados; el siguiente es `frame(net, frames)`. */
  frames: number;
  /** Filas que ocupa el último fotograma (modo replace). */
  rows: number;
  readonly timer: ReturnType<typeof setInterval>;
}

interface Queued {
  readonly text: string;
  readonly submit: boolean;
}

const ESC = '\x1b';
/** Gris tenue del tema (brightBlack = --color-ink-faint): solo para mensajes nuestros. */
const faint = (text: string): string => `${ESC}[90m${text}${ESC}[39m`;
/** Tiempo de gracia antes de destruir la terminal al desmontarse: cubre los remontajes. */
const DISPOSE_GRACE_MS = 1500;
/** Un segundo simulado por segundo real en las vistas en vivo. */
const LIVE_TICK_MS = 1000;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tema de xterm sacado de los tokens de globals.css: sin colores propios. */
function themeFromTokens(): ITheme {
  const ink = token('--color-ink');
  const background = token('--color-console');
  const faintInk = token('--color-ink-faint');
  const strong = token('--color-rule-strong');
  return {
    background,
    foreground: ink,
    cursor: ink,
    cursorAccent: background,
    selectionBackground: strong,
    selectionForeground: ink,
    selectionInactiveBackground: token('--color-rule'),
    scrollbarSliderBackground: token('--color-rule'),
    scrollbarSliderHoverBackground: strong,
    scrollbarSliderActiveBackground: faintInk,
    // La paleta ANSI se reduce a los tokens: el texto del equipo no lleva color
    // y lo nuestro solo usa el gris tenue.
    black: background,
    brightBlack: faintInk,
    white: ink,
    brightWhite: ink,
    red: token('--color-error'),
    brightRed: token('--color-error'),
    green: token('--color-done'),
    brightGreen: token('--color-done'),
    yellow: token('--color-warn'),
    brightYellow: token('--color-warn'),
    blue: ink,
    brightBlue: ink,
    magenta: ink,
    brightMagenta: ink,
    cyan: ink,
    brightCyan: ink,
  };
}

function consoleFont(): string {
  const family = token('--font-console');
  return family === '' ? 'ui-monospace, monospace' : `${family}, ui-monospace, monospace`;
}

const sessions = new WeakMap<LabStore, ConsoleSession>();

/** La sesión de un store; se crea la primera vez que se pide. */
export function sessionFor(
  store: LabStore,
  xterm: XtermModules,
  texts: SessionTexts,
): ConsoleSession {
  let session = sessions.get(store);
  if (!session) {
    session = new ConsoleSession(store, xterm, texts);
    sessions.set(store, session);
  }
  return session;
}

export class ConsoleSession {
  texts: SessionTexts;
  onFocusChange: ((focused: boolean) => void) | null = null;

  private readonly term: Terminal;
  private readonly fit: FitAddon;
  /** Elemento donde vive xterm; se mueve entre contenedores al remontar. */
  private readonly host: HTMLDivElement;
  private opened = false;
  private disposed = false;
  private mounts = 0;
  private disposeTimer: ReturnType<typeof setTimeout> | undefined;
  private autoFocused = false;

  private mode: Mode = 'booting';
  private device: DeviceId;
  private line: LineState = EMPTY_LINE;
  /** Lo que se pinta antes de la línea: el prompt o la pregunta de confirmación. */
  private promptText = '';
  /** Fila del cursor respecto a la primera fila del prompt. */
  private cursorRow = 0;
  private running: Running | null = null;
  private readonly histories = new Map<string, History>();
  private readonly closedDevices = new Set<DeviceId>();
  private queue: Queued[] = [];
  private draining = false;
  /** Se pulsó Esc: el siguiente Tab sale de la terminal (WCAG 2.1.2). */
  private escArmed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: LabStore,
    xterm: XtermModules,
    texts: SessionTexts,
  ) {
    this.texts = texts;
    this.device = store.getState().activeDevice;
    this.host = document.createElement('div');
    this.host.className = 'h-full w-full';
    this.term = new xterm.Terminal({
      screenReaderMode: true,
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      fontFamily: consoleFont(),
      fontSize: 13.5,
      lineHeight: 1.35,
      scrollback: 5000,
      reflowCursorLine: true,
      altClickMovesCursor: false,
      theme: themeFromTokens(),
    });
    this.fit = new xterm.FitAddon();
    this.term.loadAddon(this.fit);
    this.term.attachCustomKeyEventHandler((event) => this.filterKey(event));
    this.term.onData((data) => this.input(data));
    this.term.onResize(({ cols }) => this.resized(cols));
    this.unsubscribe = store.subscribe((state, previous) => this.storeChanged(state, previous));
  }

  private get state(): LabState {
    return this.store.getState();
  }

  // ── Montaje ──────────────────────────────────────────────────────────────

  /** Coloca la terminal en `container` (la primera vez la abre y saluda). */
  attach(container: HTMLElement): void {
    clearTimeout(this.disposeTimer);
    this.mounts += 1;
    container.appendChild(this.host);
    if (!this.opened) this.open();
    this.refit();
  }

  /** El contenedor se desmonta. Si nadie la vuelve a montar pronto, se destruye. */
  detach(): void {
    this.mounts = Math.max(0, this.mounts - 1);
    if (this.mounts > 0) return;
    clearTimeout(this.disposeTimer);
    this.disposeTimer = setTimeout(() => this.dispose(), DISPOSE_GRACE_MS);
  }

  private open(): void {
    this.opened = true;
    this.term.open(this.host);
    // El relleno va en el elemento de xterm para que FitAddon lo descuente.
    const element = this.term.element;
    if (element) {
      element.style.padding = '12px 16px';
      // xterm.css pinta el viewport (que cubre también el relleno) de negro puro.
      const viewport = element.querySelector<HTMLElement>('.xterm-viewport');
      if (viewport) viewport.style.backgroundColor = token('--color-console');
    }
    const textarea = this.term.textarea;
    if (textarea) {
      textarea.addEventListener('focus', () => this.onFocusChange?.(true));
      textarea.addEventListener('blur', () => this.onFocusChange?.(false));
      // Con screenReaderMode, xterm ignora los eventos `input` de tipo insertText:
      // los teclados de móvil (keydown 229) y el dictado escriben así, y hay que
      // reenviarlos. Pero con una tecla física xterm ya envió el carácter en el
      // keydown sin cancelarlo, y el navegador dispara además `input`: ese no se
      // reenvía, o cada letra saldría doble. El orden es keydown, input, keyup.
      let keyHandled = false;
      textarea.addEventListener(
        'keydown',
        (event) => {
          keyHandled =
            event.keyCode !== 229 && event.key !== 'Unidentified' && event.key !== 'Process';
        },
        true,
      );
      textarea.addEventListener('keyup', () => {
        keyHandled = false;
      });
      textarea.addEventListener('input', (event) => {
        if (!(event instanceof InputEvent)) return;
        if (event.inputType !== 'insertText' || !event.data || event.isComposing) return;
        textarea.value = '';
        if (keyHandled) {
          keyHandled = false;
          return;
        }
        this.input(event.data);
      });
    }
    // Si Geist Mono aún no había cargado, xterm midió con la fuente de reserva.
    if (document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (this.disposed) return;
        this.term.options.fontFamily = 'monospace';
        this.term.options.fontFamily = consoleFont();
        this.refit();
      });
    }
    this.boot();
  }

  /** Ajusta filas y columnas al contenedor, si es visible. */
  refit(): void {
    if (!this.opened || this.disposed) return;
    if (this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
    this.fit.fit();
  }

  /** Nombre y descripción accesibles del campo que recibe el teclado. */
  describe(label: string, describedBy: string): void {
    const textarea = this.term.textarea;
    if (!textarea) return;
    textarea.setAttribute('aria-label', label);
    textarea.setAttribute('aria-describedby', describedBy);
  }

  focus(): void {
    this.term.textarea?.focus({ preventScroll: true });
  }

  /** Foco inicial al abrir el lab, una sola vez y solo si la consola se ve (escritorio). */
  focusOnFirstLoad(): void {
    if (this.autoFocused) return;
    this.autoFocused = true;
    const idle = document.activeElement === null || document.activeElement === document.body;
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    if (idle && wide && this.host.clientHeight > 0) this.focus();
  }

  private dispose(): void {
    if (this.mounts > 0 || this.disposed) return;
    this.disposed = true;
    this.halt();
    this.unsubscribe();
    this.term.dispose();
    this.host.remove();
    sessions.delete(this.store);
  }

  // ── Store ────────────────────────────────────────────────────────────────

  private storeChanged(state: LabState, previous: LabState): void {
    if (!this.opened || this.disposed) return;
    if (state.epoch !== previous.epoch) {
      this.restart();
      return;
    }
    if (state.hydrated && !previous.hydrated && this.mode === 'booting') this.afterHydration();
    if (state.activeDevice !== this.device) this.switchTo(state.activeDevice);
  }

  /** Banner y, si el progreso ya está restaurado, el prompt. */
  private boot(): void {
    this.mode = 'booting';
    this.block(this.state.banner());
    this.note(this.texts.intro);
    if (this.state.hydrated) this.afterHydration();
  }

  private afterHydration(): void {
    const { log, restoredCount } = this.state;
    // El historial arranca con lo que se restauró, por equipo.
    for (const entry of log) this.historyOf(entry.device).push(entry.line);
    if (restoredCount > 0) this.note(this.texts.restored(restoredCount));
    this.showPrompt();
  }

  /** Reinicio del lab: pantalla limpia, banner y prompt. */
  private restart(): void {
    this.halt();
    this.queue = [];
    this.closedDevices.clear();
    this.device = this.state.activeDevice;
    this.line = EMPTY_LINE;
    this.cursorRow = 0;
    // RIS por la cola de escritura, para que no se cuele salida anterior.
    this.term.write(`${ESC}c`);
    this.boot();
  }

  private switchTo(next: DeviceId): void {
    const onPromptLine = this.mode === 'prompt' || this.mode === 'confirm';
    this.halt();
    this.queue = [];
    this.device = next;
    if (this.mode === 'booting') return;
    if (onPromptLine) {
      this.edit(moveEnd(this.line));
      this.term.write('\r\n');
    }
    this.line = EMPTY_LINE;
    this.note(this.texts.separator(next));
    if (this.closedDevices.has(next)) {
      this.note(this.texts.closed);
      this.mode = 'closed';
      return;
    }
    this.showPrompt();
  }

  private historyOf(device: string = this.device): History {
    let history = this.histories.get(device);
    if (!history) {
      history = new History();
      this.histories.set(device, history);
    }
    return history;
  }

  // ── Escritura ────────────────────────────────────────────────────────────

  /** Texto del equipo tal cual, terminado en salto de línea. */
  private block(text: string): void {
    if (text === '') return;
    this.term.write(toTerminal(text) + (text.endsWith('\n') ? '' : '\r\n'));
  }

  /** Mensaje nuestro (no del equipo), en gris tenue. */
  private note(text: string): void {
    this.term.write(`${faint(text)}\r\n`);
  }

  /** Prompt nuevo en una fila vacía. Con prompt vacío hay una confirmación pendiente. */
  private showPrompt(keep: LineState = EMPTY_LINE, question?: string): void {
    const prompt = this.state.prompt();
    this.mode = prompt === '' ? 'confirm' : 'prompt';
    this.promptText = prompt === '' ? (question ?? '') : prompt;
    this.line = this.mode === 'prompt' ? keep : EMPTY_LINE;
    this.cursorRow = 0;
    this.historyOf().rewind();
    this.repaint();
  }

  private repaint(): void {
    const painted = paintLine(this.promptText, this.line, this.term.cols, this.cursorRow);
    this.cursorRow = painted.cursorRow;
    this.term.write(painted.sequence);
  }

  /**
   * Cambia la línea y la redibuja. Escribir o borrar al final se hace sin
   * repintar todo, para que un lector de pantalla no relea el prompt.
   */
  private edit(next: LineState): void {
    const prev = this.line;
    if (next.text === prev.text && next.cursor === prev.cursor) return;
    this.line = next;
    const start = visibleLength(this.promptText);
    const cols = this.term.cols;
    const atEnd = prev.cursor === prev.text.length && next.cursor === next.text.length;
    if (atEnd && next.text.length > prev.text.length && next.text.startsWith(prev.text)) {
      this.term.write(next.text.slice(prev.text.length));
      this.cursorRow = rowAfterWriting(start + next.cursor, cols);
      return;
    }
    const column = (start + prev.cursor) % cols;
    if (
      atEnd &&
      prev.text.length - next.text.length === 1 &&
      prev.text.startsWith(next.text) &&
      column !== 0
    ) {
      this.term.write('\b \b');
      return;
    }
    this.repaint();
  }

  /** Deja el cursor al final de la línea y baja a una fila nueva. */
  private leaveLine(): void {
    this.edit(moveEnd(this.line));
    this.term.write('\r\n');
    this.cursorRow = 0;
  }

  /** Muestra un bloque debajo de la línea y vuelve a pintar prompt y línea intactos. */
  private showBelow(text: string): void {
    const kept = this.line;
    this.leaveLine();
    this.block(text);
    this.line = kept;
    this.repaint();
  }

  private resized(cols: number): void {
    if (this.mode !== 'prompt' && this.mode !== 'confirm') return;
    // xterm reajusta las filas partidas; se recoloca la cuenta y se repinta.
    this.cursorRow = Math.floor((visibleLength(this.promptText) + this.line.cursor) / cols);
    this.repaint();
  }

  // ── Teclado ──────────────────────────────────────────────────────────────

  /** Filtro previo de xterm: true = xterm procesa la tecla; false = la deja al navegador. */
  private filterKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    if (event.key === 'Escape') {
      this.escArmed = true;
      return false;
    }
    if (event.key === 'Tab') {
      // Esc y luego Tab, o Mayús+Tab: el foco sale de la terminal.
      const leave = this.escArmed || event.shiftKey;
      this.escArmed = false;
      return !leave;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) this.escArmed = false;
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      // Pegar con Ctrl+V y copiar con Ctrl+C (si hay selección) o Ctrl+Mayús+C.
      if (key === 'v') return false;
      if (key === 'c' && (event.shiftKey || this.term.hasSelection())) return false;
    }
    return true;
  }

  private input(data: string): void {
    if (this.mode === 'booting') return;
    if (this.mode === 'live') {
      if (data === '\x03' || data === 'q' || data === 'Q') this.finishLive();
      return;
    }
    if (this.mode === 'closed') {
      if (data.includes('\r')) this.reconnect();
      return;
    }
    if (data.startsWith(ESC)) {
      this.escapeSequence(data);
      return;
    }
    if (data.length === 1 && (data < ' ' || data === '\x7f')) {
      this.control(data);
      return;
    }
    if (/[\r\n]/.test(data)) {
      this.paste(data);
      return;
    }
    if (data.length > 1) {
      this.typed(splitPaste(data).tail);
      return;
    }
    if (data === '?' && this.mode === 'prompt' && !insideQuotes(this.line.text, this.line.cursor)) {
      this.showBelow(this.state.help(this.line.text.slice(0, this.line.cursor)));
      return;
    }
    this.typed(data);
  }

  private typed(text: string): void {
    if (text === '') return;
    if (this.mode === 'confirm') {
      // Las confirmaciones [y/N] responden con una sola tecla, como RouterOS.
      this.answer(text.slice(0, 1));
      return;
    }
    this.edit(insert(this.line, text));
  }

  private control(ch: string): void {
    if (this.mode === 'confirm') {
      if (ch === '\r') this.answer('');
      else if (ch === '\x03') this.interrupt();
      return;
    }
    switch (ch) {
      case '\r':
        this.enter();
        return;
      case '\x7f':
      case '\b':
        this.edit(backspace(this.line));
        return;
      case '\t':
        this.tab();
        return;
      case '\x01':
        this.edit(moveHome(this.line));
        return;
      case '\x05':
        this.edit(moveEnd(this.line));
        return;
      case '\x02':
        this.edit(moveLeft(this.line));
        return;
      case '\x06':
        this.edit(moveRight(this.line));
        return;
      case '\x15':
        this.edit(killToStart(this.line));
        return;
      case '\x0b':
        this.edit(killToEnd(this.line));
        return;
      case '\x17':
        this.edit(killWordBack(this.line));
        return;
      case '\x10':
        this.recall('previous');
        return;
      case '\x0e':
        this.recall('next');
        return;
      case '\x03':
        this.interrupt();
        return;
      case '\x04':
        if (this.line.text === '') this.chord('ctrl-d');
        else this.edit(deleteForward(this.line));
        return;
      case '\x18':
        this.chord('ctrl-x');
        return;
      case '\x1a':
        this.chord('ctrl-z');
        return;
      case '\x0c':
        this.clearScreen();
        return;
    }
  }

  private escapeSequence(seq: string): void {
    if (this.mode !== 'prompt') return;
    switch (seq) {
      case `${ESC}[A`:
      case `${ESC}OA`:
        this.recall('previous');
        return;
      case `${ESC}[B`:
      case `${ESC}OB`:
        this.recall('next');
        return;
      case `${ESC}[C`:
      case `${ESC}OC`:
        this.edit(moveRight(this.line));
        return;
      case `${ESC}[D`:
      case `${ESC}OD`:
        this.edit(moveLeft(this.line));
        return;
      case `${ESC}[H`:
      case `${ESC}OH`:
      case `${ESC}[1~`:
      case `${ESC}[7~`:
        this.edit(moveHome(this.line));
        return;
      case `${ESC}[F`:
      case `${ESC}OF`:
      case `${ESC}[4~`:
      case `${ESC}[8~`:
        this.edit(moveEnd(this.line));
        return;
      case `${ESC}[3~`:
        this.edit(deleteForward(this.line));
        return;
      case `${ESC}[1;5C`:
      case `${ESC}[1;3C`:
      case `${ESC}f`:
        this.edit(wordRight(this.line));
        return;
      case `${ESC}[1;5D`:
      case `${ESC}[1;3D`:
      case `${ESC}b`:
        this.edit(wordLeft(this.line));
        return;
    }
  }

  private recall(direction: 'previous' | 'next'): void {
    const history = this.historyOf();
    const found = direction === 'previous' ? history.previous(this.line.text) : history.next();
    if (found !== null) this.edit(lineOf(found));
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  private enter(): void {
    const text = this.line.text;
    this.leaveLine();
    this.historyOf().push(text);
    this.line = EMPTY_LINE;
    this.settle(this.state.run(text));
  }

  /** Respuesta a una confirmación: se ve la tecla y se ejecuta como una línea. */
  private answer(text: string): void {
    this.term.write(`${text}\r\n`);
    this.cursorRow = 0;
    this.settle(this.state.run(text));
  }

  private reconnect(): void {
    this.closedDevices.delete(this.device);
    this.state.reconnect();
    this.block(this.state.banner());
    this.note(this.texts.intro);
    this.showPrompt();
  }

  /** Ctrl+C: abandona la línea (y la confirmación pendiente) con `^C`. */
  private interrupt(): void {
    this.queue = [];
    this.edit(moveEnd(this.line));
    this.term.write('^C\r\n');
    this.cursorRow = 0;
    this.line = EMPTY_LINE;
    this.settle(this.state.key('ctrl-c'));
  }

  /** Atajos que maneja el equipo (modo seguro, cerrar sesión...). */
  private chord(chord: KeyChord): void {
    const kept = this.line;
    const before = this.promptText;
    const result = this.state.key(chord);
    const quiet = !result.live && !result.closed && result.output === '';
    if (quiet && this.state.prompt() === before) return;
    this.leaveLine();
    this.line = EMPTY_LINE;
    // Al cambiar de modo seguro, lo escrito sigue en la línea.
    this.settle(result, chord === 'ctrl-x' ? kept : EMPTY_LINE);
  }

  /** Muestra el resultado de un comando y deja la terminal lista para lo siguiente. */
  private settle(result: ConsoleResult, keep: LineState = EMPTY_LINE): void {
    const { output } = result;
    if (result.live) {
      this.block(output);
      this.startLive(result.live);
      return;
    }
    if (result.closed) {
      this.block(output);
      this.note(this.texts.closed);
      this.closedDevices.add(this.device);
      this.mode = 'closed';
      this.queue = [];
      return;
    }
    if (this.state.prompt() === '') {
      // Confirmación pendiente: la última línea de la salida hace de prompt.
      const lines = output.split('\n');
      const question = lines.pop() ?? '';
      this.block(lines.join('\n'));
      this.showPrompt(EMPTY_LINE, question === '' ? '' : `${question.trimEnd()} `);
      return;
    }
    this.block(output);
    this.showPrompt(keep);
  }

  private tab(): void {
    const outcome = applyCompletion(
      this.line,
      this.state.complete(this.line.text, this.line.cursor),
    );
    if (outcome.listing) {
      this.showBelow(formatColumns(outcome.listing, this.term.cols).join('\n'));
      return;
    }
    this.edit(outcome.line);
  }

  private clearScreen(): void {
    this.term.write(`${ESC}[H${ESC}[2J${ESC}[3J`);
    this.cursorRow = 0;
    this.repaint();
  }

  // ── Pegado ───────────────────────────────────────────────────────────────

  /** Varias líneas pegadas se ejecutan en orden; lo último sin salto se queda escrito. */
  private paste(data: string): void {
    const { lines, tail } = splitPaste(data);
    this.queue.push(
      ...lines.map((text) => ({ text, submit: true })),
      ...(tail === '' ? [] : [{ text: tail, submit: false }]),
    );
    this.drain();
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && (this.mode === 'prompt' || this.mode === 'confirm')) {
        const item = this.queue.shift();
        if (!item) break;
        if (this.mode === 'confirm') {
          this.answer(item.text.trim().slice(0, 1));
          continue;
        }
        this.edit(insert(this.line, item.text));
        if (item.submit) this.enter();
      }
    } finally {
      this.draining = false;
    }
  }

  // ── Vistas en vivo (Torch, ping continuo) ────────────────────────────────

  private startLive(view: LiveView): void {
    this.mode = 'live';
    const running: Running = {
      view,
      frames: 0,
      rows: 0,
      timer: setInterval(() => this.tick(), LIVE_TICK_MS),
    };
    this.running = running;
    this.drawFrame(running);
  }

  private tick(): void {
    const running = this.running;
    if (!running) return;
    if (running.view.duration !== undefined && running.frames >= running.view.duration) {
      this.finishLive();
      return;
    }
    this.state.advance(1);
    this.drawFrame(running);
  }

  private drawFrame(running: Running): void {
    const text = running.view.frame(this.state.net, running.frames);
    running.frames += 1;
    if (running.view.mode === 'append') {
      this.block(text);
      return;
    }
    // replace: se sube sobre el fotograma anterior, se borra y se escribe el nuevo.
    const back = running.rows > 0 ? `${ESC}[${running.rows}A\r${ESC}[J` : '';
    this.term.write(`${back}${toTerminal(text)}\r\n`);
    running.rows = Math.min(rowsOf(text, this.term.cols), this.term.rows - 1);
  }

  /** Ctrl+C, `q` o fin de la duración: resumen del equipo (si lo hay) y prompt. */
  private finishLive(): void {
    const running = this.running;
    if (!running) return;
    this.halt();
    this.block(running.view.stop?.(this.state.net, running.frames) ?? '');
    this.showPrompt();
    this.drain();
  }

  /** Para la vista en vivo sin escribir nada (reinicio o cambio de equipo). */
  private halt(): void {
    if (!this.running) return;
    clearInterval(this.running.timer);
    this.running = null;
  }
}
