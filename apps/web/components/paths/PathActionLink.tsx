'use client';

import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import type { Ref } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { LabSummary } from '@/lib/lab/paths';
import { pathAction } from '@/lib/progress/path';
import type { LabStatus } from '@/lib/progress/summary';

/**
 * Acción principal de una ruta: "Empezar", "Continuar: Lab N. …" o "Repasar".
 * Botón con borde (superficies de trabajo). Hasta leer el progreso ocupa su
 * sitio sin verse, para no mostrar "Empezar" a quien ya va por el lab 5.
 */
export function PathActionLink({
  labs,
  byLab,
  loaded,
  ref,
}: {
  readonly labs: readonly LabSummary[];
  readonly byLab: ReadonlyMap<string, LabStatus>;
  readonly loaded: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
}) {
  const { locale, messages } = useI18n();
  const t = messages.paths;
  const action = pathAction(labs, byLab);
  if (!action) return null;
  const labLabel = (lab: LabSummary) =>
    `${fill(messages.lab.labNumber, { n: lab.order })}. ${lab.title[locale]}`;
  const text =
    action.kind === 'start'
      ? t.start
      : fill(action.kind === 'continue' ? t.continue : t.review, { lab: labLabel(action.lab) });
  return (
    <Link
      ref={ref}
      href={`/${locale}/lab/${action.lab.id}`}
      aria-hidden={loaded ? undefined : true}
      tabIndex={loaded ? undefined : -1}
      className={`inline-flex min-h-11 items-center gap-2 rounded-sm border border-control px-4 py-2 font-medium text-ink no-underline transition-colors hover:border-ink hover:bg-rule ${
        loaded ? '' : 'invisible'
      }`}
    >
      <span className="text-pretty">{text}</span>
      <ArrowRight size={15} weight="bold" aria-hidden className="shrink-0" />
    </Link>
  );
}
