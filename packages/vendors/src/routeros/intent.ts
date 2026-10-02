/**
 * Tipos concretos de intención del driver de RouterOS: vistas (V), cambios de
 * sesión (C) y acciones propias (A) que completan `Intent` del núcleo.
 */
import type { Intent } from '@nos/core';
import type { Expr } from './expr';

export type PrintMode = 'table' | 'detail' | 'terse' | 'count' | 'stats';

/** `print` de un menú. */
export interface PrintView {
  readonly kind: 'print';
  /** Ruta del menú con `/`: `ip/address`. */
  readonly path: string;
  readonly mode: PrintMode;
  readonly where: Expr | null;
}

export type RosView = PrintView;

export type RosSessionChange =
  /** Entrar a un menú (`/ip address`, `..`, `/`). */
  | { readonly kind: 'cd'; readonly path: readonly string[] }
  /** Ctrl+X. */
  | { readonly kind: 'safe-toggle' }
  /** `/quit` o Ctrl+D: cierra la sesión y deshace lo hecho en safe mode. */
  | { readonly kind: 'quit' }
  /** Respuesta a una pregunta `[y/N]` pendiente. */
  | { readonly kind: 'confirm'; readonly yes: boolean }
  /** Ctrl+C: cancela lo pendiente. */
  | { readonly kind: 'interrupt' };

export type ArgList = readonly (readonly [string, string])[];

export type RosAction =
  /** Comando propio de un menú (make-static, flush, save, torch...). */
  | {
      readonly kind: 'menu-action';
      readonly path: string;
      readonly name: string;
      readonly args: ArgList;
      readonly rowKeys: readonly string[];
    }
  /** Borrado que no toca la configuración (archivos). */
  | { readonly kind: 'remove-other'; readonly path: string; readonly rowKeys: readonly string[] }
  | {
      readonly kind: 'ping';
      /** IP o nombre DNS. */
      readonly target: string;
      readonly count?: number;
      readonly src?: string;
      readonly size: number;
    }
  | {
      readonly kind: 'export';
      /** Menú desde el que se exporta (`''` = todo). */
      readonly path: string;
      readonly verbose: boolean;
      readonly showSensitive: boolean;
      readonly file?: string;
    }
  | { readonly kind: 'import'; readonly file: string }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'resolve'; readonly name: string }
  | { readonly kind: 'put'; readonly text: string };

export type RosIntent = Intent<RosView, RosSessionChange, RosAction>;
