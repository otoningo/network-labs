'use client';

import type { LabSummary } from '@/lib/lab/paths';
import { useProgressSummary } from '@/lib/progress/summary';
import { PathActionLink } from './PathActionLink';
import { PathFinished } from './PathFinished';

/** En el índice de rutas: la misma acción principal que la página de la ruta y su avance. */
export function PathIndexAction({ labs }: { readonly labs: readonly LabSummary[] }) {
  const { loaded, byLab } = useProgressSummary();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
      <PathActionLink labs={labs} byLab={byLab} loaded={loaded} />
      <PathFinished labs={labs} className="text-sm text-ink-muted" />
    </div>
  );
}
