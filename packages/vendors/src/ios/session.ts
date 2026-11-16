/**
 * Sesión de IOS: el modo en el que está el usuario (EXEC de usuario, EXEC
 * privilegiado, configuración global o un submodo) y una pregunta pendiente,
 * si la hay (`copy` pide el destino, `crypto key generate rsa` el tamaño...).
 * Los modos no se apilan: `exit` sube un nivel y `end` (o Ctrl+Z) vuelve al EXEC privilegiado.
 */
import type { Device, ItemId } from '@nos/core';

export type View =
  | { readonly kind: 'user' }
  | { readonly kind: 'priv' }
  | { readonly kind: 'config' }
  | { readonly kind: 'interface'; readonly iface: ItemId }
  | { readonly kind: 'dhcp'; readonly name: string }
  | { readonly kind: 'line'; readonly line: 'vty' | 'con' };

export type ViewKind = View['kind'];

/** Modos de EXEC (`>` y `#`). */
export const EXEC_VIEWS: readonly ViewKind[] = ['user', 'priv'];
/** Todos los modos de configuración. */
export const CONFIG_VIEWS: readonly ViewKind[] = ['config', 'interface', 'dhcp', 'line'];
export const ALL_VIEWS: readonly ViewKind[] = [...EXEC_VIEWS, ...CONFIG_VIEWS];

/** Pregunta que espera respuesta en la línea siguiente. */
export type Pending =
  /** `copy running-config startup-config`: `Destination filename [startup-config]?` */
  | { readonly kind: 'copy' }
  /** `erase startup-config`: `[confirm]`. */
  | { readonly kind: 'erase' }
  /** `crypto key generate rsa` sin `modulus`: el tamaño de la clave. */
  | { readonly kind: 'rsa' }
  /** `configure` a secas: `Configuring from terminal, memory, or network [terminal]?` */
  | { readonly kind: 'configure' };

export interface IosSession {
  readonly user: string;
  readonly view: View;
  readonly pending: Pending | null;
  /** Segundos de reloj del equipo al abrir la sesión (para las fechas de los leases). */
  readonly clockBase: number;
}

export const DEFAULT_CLOCK_BASE = 1_767_225_600;

export function newSession(
  _device: Device,
  options?: { readonly user?: string; readonly clockBase?: number },
): IosSession {
  return {
    user: options?.user ?? 'console',
    view: { kind: 'user' },
    pending: null,
    clockBase: options?.clockBase ?? DEFAULT_CLOCK_BASE,
  };
}

export const isConfigView = (view: View): boolean => CONFIG_VIEWS.includes(view.kind);

/** Modo al que lleva `exit`: de un submodo a configuración, de configuración al EXEC privilegiado. */
export function parentView(view: View): View | null {
  switch (view.kind) {
    case 'user':
    case 'priv':
      return null;
    case 'config':
      return { kind: 'priv' };
    default:
      return { kind: 'config' };
  }
}
