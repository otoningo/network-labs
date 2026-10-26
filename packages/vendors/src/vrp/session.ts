/**
 * Sesión de VRP: la vista en la que está el usuario (usuario, sistema,
 * interfaz, pool, ACL o AAA) y una pregunta [Y/N] pendiente, si la hay.
 * Las vistas no se apilan: `quit` sube un nivel y `return` vuelve a la de usuario.
 */
import type { Device, ItemId } from '@nos/core';

export type View =
  | { readonly kind: 'user' }
  | { readonly kind: 'system' }
  | { readonly kind: 'interface'; readonly iface: ItemId }
  | { readonly kind: 'pool'; readonly name: string }
  | { readonly kind: 'acl'; readonly number: number }
  | { readonly kind: 'aaa' };

export type ViewKind = View['kind'];

/** Pregunta que espera Y o N (por ejemplo, la de `save`). */
export interface Pending {
  readonly kind: 'save';
}

export interface VrpSession {
  readonly user: string;
  readonly view: View;
  readonly pending: Pending | null;
  /** Segundos de reloj del equipo al abrir la sesión (para la hora de `display clock`). */
  readonly clockBase: number;
}

export const DEFAULT_CLOCK_BASE = 1_767_225_600;

export function newSession(
  _device: Device,
  options?: { readonly user?: string; readonly clockBase?: number },
): VrpSession {
  return {
    user: options?.user ?? 'admin',
    view: { kind: 'user' },
    pending: null,
    clockBase: options?.clockBase ?? DEFAULT_CLOCK_BASE,
  };
}

/** Vista a la que lleva `quit`: de una subvista al sistema, del sistema al usuario. */
export function parentView(view: View): View | null {
  switch (view.kind) {
    case 'user':
      return null;
    case 'system':
      return { kind: 'user' };
    default:
      return { kind: 'system' };
  }
}
