'use client';

import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';

/** Hoja de tareas. Provisional: la versión completa la escribe el agente de objetivos. */
export function Worksheet() {
  const { locale, messages } = useI18n();
  const lab = useLab((s) => s.runtime.lab);
  return (
    <div className="px-6 py-6">
      <h2 id="lab-tasks-heading" className="text-sm text-ink-muted">
        {messages.lab.tasks}
      </h2>
      <ol>
        {lab.objectives.map((o) => (
          <li key={o.id}>{o.text[locale]}</li>
        ))}
      </ol>
    </div>
  );
}
