/**
 * Tipos concretos de intención del driver de IOS: vistas `show` (V), cambios
 * de sesión (C) y acciones propias (A) que completan `Intent` del núcleo.
 */
import type { Intent } from '@nos/core';
import type { Pending, View } from './session';

/** Filtro de salida tras `|` (`show running-config | include hostname`). */
export interface OutputFilter {
  readonly mode: 'include' | 'exclude' | 'begin' | 'section';
  readonly pattern: string;
}

/** Un `show`: qué se muestra y, si hace falta, sobre qué (interfaz, pool...). */
export interface ShowView {
  readonly kind: 'show';
  readonly what: string;
  readonly arg?: string;
  readonly filter?: OutputFilter;
}

export type IosView = ShowView;

export type IosSessionChange =
  /** Entrar en un modo (`enable`, `configure terminal`, `interface`, `ip dhcp pool`, `line`). */
  | { readonly kind: 'enter'; readonly view: View }
  /** `exit`: sube un nivel; desde EXEC cierra la sesión. */
  | { readonly kind: 'exit' }
  /** `end` o Ctrl+Z: vuelve al EXEC privilegiado. */
  | { readonly kind: 'end' }
  /** `logout`: cierra la sesión desde EXEC. */
  | { readonly kind: 'logout' }
  /** Deja una pregunta pendiente (el texto ya lo imprimió el comando). */
  | { readonly kind: 'ask'; readonly pending: Pending }
  /** Respuesta a la pregunta pendiente: la línea tal cual. */
  | { readonly kind: 'answer'; readonly text: string }
  /** Ctrl+C: cancela lo pendiente o sale de la configuración. */
  | { readonly kind: 'interrupt' };

export type IosAction =
  | {
      readonly kind: 'ping';
      readonly target: string;
      readonly count: number;
      readonly size: number;
      readonly src?: string;
    }
  | { readonly kind: 'traceroute'; readonly target: string }
  /** `write memory` / `copy running-config startup-config` ya confirmado. */
  | { readonly kind: 'save' }
  /** Mensaje que el equipo imprime tras un comando. */
  | { readonly kind: 'message'; readonly text: string }
  /** Genera las claves RSA del tamaño dado. */
  | { readonly kind: 'rsa'; readonly bits: number };

export type IosIntent = Intent<IosView, IosSessionChange, IosAction>;
