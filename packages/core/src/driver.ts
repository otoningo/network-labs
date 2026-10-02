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
import type { ItemId } from './model/brand';
import type { CoreError } from './model/errors';
import type { Device, Network, OsId } from './model/network';
import type { Result } from './model/result';
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
 * `V` son sus vistas (print, display, show) y `C` sus cambios de sesión
 * (entrar a un menú, cambiar de vista, safe mode).
 */
export type Intent<V, C> =
  | { readonly kind: 'config'; readonly ops: readonly Op[]; readonly policy?: ApplyPolicy }
  | { readonly kind: 'show'; readonly view: V }
  | { readonly kind: 'session'; readonly change: C }
  | { readonly kind: 'action'; readonly action: DeviceAction }
  | { readonly kind: 'sequence'; readonly steps: readonly Intent<V, C>[] }
  | { readonly kind: 'noop' };

/** Error de sintaxis con un código propio del driver y la posición del problema. */
export interface SyntaxFault {
  readonly code: string;
  readonly at?: number;
  readonly token?: string;
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

export interface DriverOutcome<S> {
  readonly net: Network;
  readonly session: S;
  /** Texto ya formateado como lo mostraría el equipo. */
  readonly output: string;
  /** Vista que se refresca hasta que el usuario la corta (Torch, monitor). */
  readonly live?: boolean;
  /** El usuario cerró la sesión (quit, exit, Ctrl+D). */
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
  /** Ayuda contextual (la tecla `?`). */
  readonly help?: string;
}

export type KeyChord = 'ctrl-x' | 'ctrl-c' | 'ctrl-d' | 'ctrl-z';

export interface VendorDriver<S, V, C> {
  readonly os: OsId;
  readonly platform: PlatformSpec;
  session(device: Device): S;
  parse(input: string, ctx: DriverContext<S>): Result<Intent<V, C>, SyntaxFault>;
  apply(intent: Intent<V, C>, ctx: DriverContext<S>): Result<DriverOutcome<S>, DriverError>;
  render(view: V, ctx: DriverContext<S>): string;
  prompt(ctx: DriverContext<S>): string;
  complete(input: string, cursor: number, ctx: DriverContext<S>): Completion;
  key(chord: KeyChord, ctx: DriverContext<S>): Intent<V, C> | null;
  describeError(error: DriverError, ctx: DriverContext<S>): string;
}

/** Driver con tipos de sesión y vista opacos, para registros heterogéneos. */
export interface AnyDriver {
  readonly os: OsId;
  readonly platform: PlatformSpec;
}
