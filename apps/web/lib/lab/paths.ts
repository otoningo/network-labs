/**
 * Rutas de aprendizaje: una secuencia de labs de un mismo sistema. Se
 * construyen en el servidor a partir de content/labs; al cliente llegan solo
 * los resúmenes (sin topología ni predicados).
 */
import type { LabDefinition, LocalizedText } from '@nos/core';
import { allLabs } from './content';

/** Lo que una lista de labs necesita saber de cada uno. */
export interface LabSummary {
  readonly id: string;
  readonly order: number;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly difficulty: LabDefinition['difficulty'];
  readonly minutes: number;
  readonly objectives: number;
}

export interface LearningPath {
  readonly id: string;
  /** Sistema que se practica; el nombre visible sale de i18n (`paths.os`). */
  readonly os: LabDefinition['vendor'];
  readonly labs: readonly LabSummary[];
}

/** Rutas anunciadas que todavía no tienen labs: se muestran como "en preparación". */
export interface UpcomingPath {
  readonly id: string;
  readonly os: LabDefinition['vendor'];
}

export const UPCOMING_PATHS: readonly UpcomingPath[] = [{ id: 'vyos-desde-cero', os: 'vyos' }];

const summaryOf = (lab: LabDefinition): LabSummary => ({
  id: lab.id,
  order: lab.order ?? 0,
  title: lab.title,
  summary: lab.summary,
  difficulty: lab.difficulty,
  minutes: lab.minutes,
  objectives: lab.objectives.length,
});

/** Rutas con labs publicados, en el orden de su primer lab. */
export function learningPaths(): readonly LearningPath[] {
  const byPath = new Map<string, LabDefinition[]>();
  for (const lab of allLabs()) {
    if (!lab.path) continue;
    const list = byPath.get(lab.path) ?? [];
    list.push(lab);
    byPath.set(lab.path, list);
  }
  return [...byPath].map(([id, labs]) => {
    const sorted = [...labs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const first = sorted[0];
    return { id, os: first?.vendor ?? 'routeros', labs: sorted.map(summaryOf) };
  });
}

export const pathById = (id: string): LearningPath | undefined =>
  learningPaths().find((p) => p.id === id);
