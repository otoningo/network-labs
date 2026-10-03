'use client';

import Link from 'next/link';
import { StatusBox } from '@/components/lab/worksheet/StatusBox';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { LabSummary } from '@/lib/lab/paths';
import { useProgressSummary } from '@/lib/progress/summary';

/**
 * Los labs de una ruta como una página del cuaderno: numeral ligero, título,
 * minutos y la casilla, que se rellena si el lab está terminado en este navegador.
 * Las casillas tienen tamaño fijo: leer el progreso no mueve la lista.
 */
export function PathList({ labs }: { readonly labs: readonly LabSummary[] }) {
  const { locale, messages } = useI18n();
  const { byLab } = useProgressSummary();
  return (
    <ol className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-4 border-b border-rule">
      {labs.map((lab) => {
        const status = byLab.get(lab.id);
        const finished = status?.finished === true;
        // A medias: el mismo aviso que en la página de la ruta, para que cuadre con "Continuar".
        const inProgress = status !== undefined && !finished;
        return (
          <li
            key={lab.id}
            className="relative col-span-full grid grid-cols-subgrid items-baseline border-t border-rule py-3"
          >
            <span
              aria-hidden
              className="min-w-[2ch] text-right text-lg leading-none font-light tabular-nums text-ink-faint"
            >
              {lab.order}
            </span>
            <Link
              href={`/${locale}/lab/${lab.id}`}
              className="min-w-0 font-medium text-ink no-underline text-pretty after:absolute after:inset-0 hover:underline"
            >
              <span className="sr-only">{`${fill(messages.lab.labNumber, { n: lab.order })}. `}</span>
              {lab.title[locale]}
              {finished && <span className="sr-only">{`, ${messages.landing.path.done}`}</span>}
            </Link>
            <span className="text-right text-xs whitespace-nowrap text-ink-faint">
              {inProgress && (
                <span className="mr-2 text-ink-muted">
                  {fill(messages.paths.inProgress, {
                    done: status.completed,
                    total: lab.objectives,
                  })}
                </span>
              )}
              {fill(messages.lab.minutes, { n: lab.minutes })}
            </span>
            <span className="self-center">
              <StatusBox state={finished ? 'done' : 'pending'} live={false} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
