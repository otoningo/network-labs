'use client';

import { useEffect, useRef, useState } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import type { ObjectiveState } from '@/lib/lab/store';

interface Baseline {
  readonly epoch: number;
  readonly objectives: Readonly<Record<string, ObjectiveState>>;
  readonly finished: boolean;
}

/**
 * Distingue lo que pasa durante la sesión de lo que llega restaurado. El estado
 * con el que se hidrata (o el que deja un reinicio) es la línea base: no se
 * anima ni se anuncia. Desde ahí, cada cambio de una tarea se anuncia.
 */
export function useSessionChanges(): {
  /** Ya hay línea base: los cambios que lleguen ahora son del estudiante. */
  readonly live: boolean;
  /** Texto de la región aria-live. */
  readonly message: string;
  readonly announce: (text: string) => void;
} {
  const { messages } = useI18n();
  const t = messages.lab;
  const hydrated = useLab((s) => s.hydrated);
  const epoch = useLab((s) => s.epoch);
  const objectives = useLab((s) => s.objectives);
  const finished = useLab((s) => s.finishedAt !== null);
  const list = useLab((s) => s.runtime.lab.objectives);
  const baseline = useRef<Baseline | null>(null);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!hydrated) return;
    const before = baseline.current;
    baseline.current = { epoch, objectives, finished };
    if (!before) {
      setLive(true);
      return;
    }
    // Un reinicio devuelve todo a pendiente a propósito: no hay nada que contar.
    if (before.epoch !== epoch) return;
    const lines: string[] = [];
    list.forEach((objective, index) => {
      const now = objectives[objective.id] ?? 'pending';
      if (now !== (before.objectives[objective.id] ?? 'pending')) {
        lines.push(`${fill(t.taskNumber, { n: index + 1 })}: ${t.status[now]}`);
      }
    });
    if (finished && !before.finished) lines.push(t.finished.title);
    if (lines.length > 0) setMessage(`${lines.join('. ')}.`);
  }, [hydrated, epoch, objectives, finished, list, t]);

  return { live, message, announce: setMessage };
}
