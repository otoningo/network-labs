'use client';

import { plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { finishedCount, type PathLab } from '@/lib/progress/path';
import { useProgressSummary } from '@/lib/progress/summary';

/**
 * "N de 12 labs terminados" en este navegador, en texto. Hasta leer el
 * almacenamiento ocupa su sitio sin mostrarse, para no anunciar un cero falso
 * ni mover la fila al aparecer.
 */
export function PathFinished({
  labs,
  className = '',
}: {
  readonly labs: readonly PathLab[];
  readonly className?: string;
}) {
  const { locale, messages } = useI18n();
  const { loaded, byLab } = useProgressSummary();
  const done = loaded ? finishedCount(labs, byLab) : 0;
  return (
    <p className={`tabular-nums ${loaded ? '' : 'invisible'} ${className}`}>
      {plural(locale, messages.paths.finished, labs.length, { done })}
    </p>
  );
}
