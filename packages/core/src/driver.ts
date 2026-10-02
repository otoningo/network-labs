/**
 * Contrato que cumple cada driver de fabricante. El núcleo no implementa
 * ninguno: solo define la forma, y los drivers viven en `@nos/vendors`.
 *
 * Diferencias con el brief original, justificadas en DECISIONES.md (D-017):
 * `complete` recibe el contexto (necesita el menú actual y los nombres de
 * interfaz), y se añaden `key` (Ctrl+X para safe mode) y `describeError`
 * (errores con la voz real del fabricante).
 */
import type { PlatformSpec } from './device/platform';
import type { DeviceId, ItemId } from './model/brand';
import type { CoreError } from './model/errors';
import type { Device, Network, OsId } from './model/network';
import { err, ok, type Result } from './model/result';
import type { Ipv4 } from './net/ipv4';
import type { ApplyPolicy, Op } from './ops/apply';

/** Acciones neutrales que el núcleo sabe ejecutar. */
export type DeviceAction =
  | { readonly kind: 'ping'; readonly dst: Ipv4; readonly count: number; readonly src?: Ipv4 }
  | { readonly kind: 'traceroute'; readonly dst: Ipv4 }
  | { readonly kind: 'resolve'; readonly name: string }
  | { readonly kind: 'torch'; readonly iface: ItemId }
  | { readonly kind: 'backup-save'; readonly name: string }
  | { readonly kind: 'backup-load'; readonly name: string }
  | { readonly kind: 'export'; readonly file?: string }
  | { readonly kind: 'import'; readonly file: string }
  | { readonly kind: 'file-remove'; readonly name: string }
  | { readonly kind: 'reboot' }
  | { readonly kind: 'reset-config'; readonly keepUsers: boolean };

/**
 * Lo que entiende el driver de una línea de comando.
 * `V` son sus vistas (print, display, show), `C` sus cambios de sesión
 * (entrar a un menú, cambiar de vista, safe mode) y `A` sus acciones propias
 * que no tienen equivalente neutral (por ejemplo, vaciar la caché DNS).
 */
export type Intent<V, C, A = never> =
  | { readonly kind: 'config'; readonly ops: readonly Op[]; readonly policy?: ApplyPolicy }
  | { readonly kind: 'show'; readonly view: V }
  | { readonly kind: 'session'; readonly change: C }
  | { readonly kind: 'action'; readonly action: DeviceAction }
  | { readonly kind: 'vendor'; readonly action: A }
  | { readonly kind: 'sequence'; readonly steps: readonly Intent<V, C, A>[] }
  | { readonly kind: 'noop' };

/** Error de sintaxis con un código propio del driver y la posición del problema. */
export interface SyntaxFault {
  readonly code: string;
  /** Columna (base 0) donde empieza el problema. */
  readonly at?: number;
  readonly token?: string;
  /** Datos extra para redactar el mensaje (nombre de argumento, rango...). */
  readonly detail?: Readonly<Record<string, string | number>>;
}

export type DriverError =
  | { readonly kind: 'syntax'; readonly fault: SyntaxFault }
  | { readonly kind: 'core'; readonly error: CoreError }
  | { readonly kind: 'vendor'; readonly code: string; readonly detail?: string };

export interface DriverContext<S> {
  readonly net: Network;
  readonly device: Device;
  readonly session: S;
}

/**
 * Vista que se refresca con el tiempo hasta que el usuario la corta:
 * Torch y monitor-traffic reemplazan la pantalla; un ping continuo va sumando líneas.
 */
export interface LiveView {
  readonly mode: 'replace' | 'append';
  /** Contenido tras `elapsed` segundos simulados. */
  frame(net: Network, elapsed: number): string;
  /** Texto final al interrumpir (por ejemplo, el resumen de un ping). */
  stop?(net: Network, elapsed: number): string;
  /** Si se define, la vista termina sola tras estos segundos. */
  readonly duration?: number;
}

export interface DriverOutcome<S> {
  readonly net: Network;
  readonly session: S;
  /** Texto ya formateado como lo mostraría el equipo. */
  readonly output: string;
  readonly live?: LiveView;
  /** El usuario cerró la sesión (quit, Ctrl+D, reinicio). */
  readonly closed?: boolean;
}

export interface CompletionCandidate {
  readonly text: string;
  readonly description?: string;
}

export interface Completion {
  /** Índice desde el que se reemplaza la entrada al aceptar un candidato. */
  readonly replaceFrom: number;
  readonly candidates: readonly CompletionCandidate[];
}

export type KeyChord = 'ctrl-x' | 'ctrl-c' | 'ctrl-d' | 'ctrl-z';

export interface VendorDriver<S, V, C, A = never> {
  readonly os: OsId;
  readonly platform: PlatformSpec;
  session(device: Device, options?: { readonly user?: string; readonly clockBase?: number }): S;
  /** Texto que se muestra al abrir la sesión. */
  banner(ctx: DriverContext<S>): string;
  parse(input: string, ctx: DriverContext<S>): Result<Intent<V, C, A>, SyntaxFault>;
  apply(intent: Intent<V, C, A>, ctx: DriverContext<S>): Result<DriverOutcome<S>, DriverError>;
  render(view: V, ctx: DriverContext<S>): string;
  prompt(ctx: DriverContext<S>): string;
  complete(input: string, cursor: number, ctx: DriverContext<S>): Completion;
  /** Ayuda contextual: lo que muestra la tecla `?` con la línea escrita hasta el cursor. */
  help(input: string, ctx: DriverContext<S>): string;
  key(chord: KeyChord, ctx: DriverContext<S>): Intent<V, C, A> | null;
  describeError(error: DriverError, ctx: DriverContext<S>): string;
}

export interface CommandResult<S> {
  readonly net: Network;
  readonly session: S;
  readonly output: string;
  readonly ok: boolean;
  readonly live?: LiveView;
  readonly closed?: boolean;
}

function finish<S, V, C, A>(
  driver: VendorDriver<S, V, C, A>,
  ctx: DriverContext<S>,
  intent: Intent<V, C, A>,
): CommandResult<S> {
  const applied = driver.apply(intent, ctx);
  if (!applied.ok) {
    return {
      net: ctx.net,
      session: ctx.session,
      ok: false,
      output: driver.describeError(applied.error, ctx),
    };
  }
  const value = applied.value;
  return {
    net: value.net,
    session: value.session,
    output: value.output,
    ok: true,
    ...(value.live ? { live: value.live } : {}),
    ...(value.closed ? { closed: true } : {}),
  };
}

/** Ejecuta una línea con cualquier driver: parse, apply y, si falla, el error con la voz del fabricante. */
export function runCommand<S, V, C, A>(
  driver: VendorDriver<S, V, C, A>,
  net: Network,
  deviceId: DeviceId,
  session: S,
  line: string,
): CommandResult<S> {
  const device = net.devices.find((d) => d.id === deviceId);
  if (!device) return { net, session, output: '', ok: false };
  const ctx: DriverContext<S> = { net, device, session };
  const parsed = driver.parse(line, ctx);
  if (!parsed.ok) {
    return {
      net,
      session,
      ok: false,
      output: driver.describeError({ kind: 'syntax', fault: parsed.error }, ctx),
    };
  }
  return finish(driver, ctx, parsed.value);
}

/** Pulsa una combinación de teclas (Ctrl+X, Ctrl+D...) en una sesión. */
export function pressKey<S, V, C, A>(
  driver: VendorDriver<S, V, C, A>,
  net: Network,
  deviceId: DeviceId,
  session: S,
  chord: KeyChord,
): CommandResult<S> {
  const device = net.devices.find((d) => d.id === deviceId);
  if (!device) return { net, session, output: '', ok: false };
  const ctx: DriverContext<S> = { net, device, session };
  const intent = driver.key(chord, ctx);
  if (!intent) return { net, session, output: '', ok: true };
  return finish(driver, ctx, intent);
}

/** Ejecuta un script línea a línea en una sesión nueva; se detiene en el primer error. */
export function runScript<S, V, C, A>(
  driver: VendorDriver<S, V, C, A>,
  net: Network,
  deviceId: DeviceId,
  lines: readonly string[],
): Result<Network, { readonly line: number; readonly message: string }> {
  const device = net.devices.find((d) => d.id === deviceId);
  if (!device) return err({ line: 0, message: 'no such device' });
  let session = driver.session(device);
  let current = net;
  for (const [index, line] of lines.entries()) {
    const result = runCommand(driver, current, deviceId, session, line);
    if (!result.ok) return err({ line: index + 1, message: result.output });
    current = result.net;
    session = result.session;
  }
  return ok(current);
}
