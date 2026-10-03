/**
 * Progreso de una ruta a partir del resumen de progreso: cuántos labs están
 * terminados, el estado de cada fila y a qué lab lleva la acción principal.
 * Funciones puras: las usan las páginas de rutas en el cliente.
 */
import type { LabStatus } from './summary';

/** Lo mínimo que estas funciones necesitan de un lab de la ruta (en orden). */
export interface PathLab {
  readonly id: string;
  readonly objectives: number;
}

type ByLab = ReadonlyMap<string, LabStatus>;

/** Labs de la ruta terminados en este navegador. */
export function finishedCount(labs: readonly PathLab[], byLab: ByLab): number {
  return labs.filter((lab) => byLab.get(lab.id)?.finished === true).length;
}

/** Hay algo guardado de algún lab de la ruta (empezado o terminado). */
export function hasPathProgress(labs: readonly PathLab[], byLab: ByLab): boolean {
  return labs.some((lab) => byLab.has(lab.id));
}

export type LabRowState =
  | { readonly kind: 'done' }
  | { readonly kind: 'in-progress'; readonly completed: number; readonly total: number }
  | { readonly kind: 'not-started' };

/** Estado de una fila de la lista: terminado, en curso (con objetivos cumplidos) o sin empezar. */
export function labRowState(lab: PathLab, status: LabStatus | undefined): LabRowState {
  if (!status) return { kind: 'not-started' };
  if (status.finished) return { kind: 'done' };
  if (!status.started) return { kind: 'not-started' };
  // Un objetivo que se cumplió y luego se quitó del lab no debe pasar del total.
  return {
    kind: 'in-progress',
    completed: Math.min(status.completed, lab.objectives),
    total: lab.objectives,
  };
}

export type PathAction<L extends PathLab> =
  | { readonly kind: 'start'; readonly lab: L }
  | { readonly kind: 'continue'; readonly lab: L }
  | { readonly kind: 'review'; readonly lab: L };

/**
 * A dónde lleva la acción principal de la ruta:
 * - sin progreso en la ruta, a empezar por el primer lab;
 * - con labs en curso, al último que se tocó;
 * - si solo hay labs terminados, al primero sin terminar en orden;
 * - con todo terminado, a repasar desde el primero.
 * `null` solo si la ruta no tiene labs.
 */
export function pathAction<L extends PathLab>(
  labs: readonly L[],
  byLab: ByLab,
): PathAction<L> | null {
  const first = labs[0];
  if (!first) return null;
  if (!hasPathProgress(labs, byLab)) return { kind: 'start', lab: first };

  let latest: { lab: L; updatedAt: string } | null = null;
  for (const lab of labs) {
    const status = byLab.get(lab.id);
    if (!status || status.finished || !status.started) continue;
    if (!latest || status.updatedAt > latest.updatedAt) {
      latest = { lab, updatedAt: status.updatedAt };
    }
  }
  if (latest) return { kind: 'continue', lab: latest.lab };

  const pending = labs.find((lab) => byLab.get(lab.id)?.finished !== true);
  return pending ? { kind: 'continue', lab: pending } : { kind: 'review', lab: first };
}

/** Minutos estimados de todos los labs de la ruta. */
export const totalMinutes = (labs: readonly { readonly minutes: number }[]): number =>
  labs.reduce((sum, lab) => sum + lab.minutes, 0);
