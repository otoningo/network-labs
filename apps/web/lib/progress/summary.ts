'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserRepository, type LabProgress, type ProgressRepository } from './repository';

/** Estado de un lab visto desde fuera: para listas, portada y "continuar". */
export interface LabStatus {
  readonly labId: string;
  /** Objetivos que se cumplieron alguna vez. */
  readonly completed: number;
  readonly finished: boolean;
  /** El estudiante escribió algo o pidió pistas. */
  readonly started: boolean;
  readonly updatedAt: string;
}

export function statusOf(progress: LabProgress): LabStatus {
  return {
    labId: progress.labId,
    completed: Object.keys(progress.completed).length,
    finished: progress.finishedAt !== undefined,
    started: progress.log.length > 0 || Object.keys(progress.hints).length > 0,
    updatedAt: progress.updatedAt,
  };
}

export interface ProgressSummary {
  /** `false` hasta leer el almacenamiento: evita mostrar "sin empezar" de más. */
  readonly loaded: boolean;
  readonly byLab: ReadonlyMap<string, LabStatus>;
  /** Último lab tocado que no está terminado, para "Continuar". */
  readonly resume: LabStatus | null;
}

export function summarize(list: readonly LabProgress[]): Omit<ProgressSummary, 'loaded'> {
  const statuses = list.map(statusOf).filter((s) => s.started || s.finished);
  const resume =
    statuses
      .filter((s) => !s.finished)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0] ??
    null;
  return { byLab: new Map(statuses.map((s) => [s.labId, s])), resume };
}

const EMPTY: ProgressSummary = { loaded: false, byLab: new Map(), resume: null };

/**
 * Progreso de todos los labs guardados en este navegador. `refresh` lo vuelve
 * a leer (por ejemplo, tras borrar progreso) sin pasar otra vez por `loaded: false`.
 */
export function useProgressSummary(
  repository?: ProgressRepository,
): ProgressSummary & { readonly refresh: () => void } {
  const [summary, setSummary] = useState<ProgressSummary>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    const repo = repository ?? browserRepository();
    void repo.list().then((list) => {
      if (!cancelled) setSummary({ loaded: true, ...summarize(list) });
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);
  const refresh = useCallback(() => {
    void (repository ?? browserRepository())
      .list()
      .then((list) => setSummary({ loaded: true, ...summarize(list) }));
  }, [repository]);
  return { ...summary, refresh };
}
