/**
 * Tipos concretos de intención del driver de VRP: vistas `display` (V),
 * cambios de sesión (C) y acciones propias (A) que completan `Intent` del núcleo.
 */
import type { Intent } from '@nos/core';
import type { View } from './session';

/** Un `display`: qué se muestra y, si hace falta, sobre qué (interfaz, pool, ACL...). */
export interface DisplayView {
  readonly kind: 'display';
  readonly what: string;
  readonly arg?: string;
}

export type VrpView = DisplayView;

export type VrpSessionChange =
  /** Entrar en una vista (`system-view`, `interface`, `ip pool`, `acl`, `aaa`). */
  | { readonly kind: 'enter'; readonly view: View }
  /** `quit`: sube un nivel; desde la vista de usuario cierra la sesión. */
  | { readonly kind: 'quit' }
  /** `return` o Ctrl+Z: vuelve a la vista de usuario. */
  | { readonly kind: 'return' }
  /** Respuesta a una pregunta [Y/N] pendiente. */
  | { readonly kind: 'confirm'; readonly yes: boolean }
  /** Ctrl+C: cancela lo pendiente. */
  | { readonly kind: 'interrupt' };

export type VrpAction =
  | {
      readonly kind: 'ping';
      readonly target: string;
      readonly count: number;
      readonly size: number;
      readonly src?: string;
    }
  | { readonly kind: 'tracert'; readonly target: string }
  /** `save`: pregunta antes de escribir la configuración. */
  | { readonly kind: 'save' }
  /** Mensaje informativo que el equipo imprime tras un comando (`Info: ...`). */
  | { readonly kind: 'message'; readonly text: string };

export type VrpIntent = Intent<VrpView, VrpSessionChange, VrpAction>;
