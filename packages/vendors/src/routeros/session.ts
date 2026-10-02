import type { Device, DeviceConfig } from '@nos/core';

/** Acción que espera confirmación (`[y/N]`) para ejecutarse. */
export interface PendingAction {
  readonly path: string;
  readonly name: string;
  readonly args: readonly (readonly [string, string])[];
  readonly rowKeys: readonly string[];
}

export interface RouterosSession {
  readonly user: string;
  /** Menú actual: `['ip', 'address']`. */
  readonly path: readonly string[];
  /** Configuración guardada al tomar safe mode; null si no está activo. */
  readonly safe: { readonly snapshot: DeviceConfig } | null;
  /** Claves de fila por número, según el último print de cada menú. */
  readonly numbering: Readonly<Record<string, readonly string[]>>;
  readonly undo: readonly DeviceConfig[];
  readonly redo: readonly DeviceConfig[];
  readonly pending: PendingAction | null;
  /** Instante real (ms) que corresponde al segundo 0 de la simulación. */
  readonly clockBase: number;
}

/** 2026-01-05 09:00:00 UTC: fecha fija para que fechas y nombres de archivo sean deterministas. */
export const DEFAULT_CLOCK_BASE = Date.UTC(2026, 0, 5, 9, 0, 0);

const UNDO_LIMIT = 100;

export function newSession(
  _device: Device,
  options: { readonly user?: string; readonly clockBase?: number } = {},
): RouterosSession {
  return {
    user: options.user ?? 'admin',
    path: [],
    safe: null,
    numbering: {},
    undo: [],
    redo: [],
    pending: null,
    clockBase: options.clockBase ?? DEFAULT_CLOCK_BASE,
  };
}

export function pushUndo(session: RouterosSession, previous: DeviceConfig): RouterosSession {
  return { ...session, undo: [...session.undo, previous].slice(-UNDO_LIMIT), redo: [] };
}
