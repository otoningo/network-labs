'use client';

import type { LocalizedText } from '@nos/core';
import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { ICON_WEIGHT } from '@/components/lab/worksheet/StatusBox';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useProgressSummary } from '@/lib/progress/summary';

export interface HeroLab {
  readonly id: string;
  readonly order: number;
  readonly title: LocalizedText;
}

/**
 * Acciones de la portada. Sin progreso guardado, la principal abre el lab 1;
 * con un lab a medias, pasa a "Continuar" y el lab 1 queda como enlace discreto.
 * Hasta leer el almacenamiento se muestra el lab 1, y el enlace discreto ocupa
 * su sitio aunque esté oculto: el cambio no mueve nada.
 */
export function HeroActions({
  labs,
  pathId,
}: {
  readonly labs: readonly HeroLab[];
  readonly pathId: string;
}) {
  const { locale, messages } = useI18n();
  const t = messages.landing.hero;
  const { loaded, resume } = useProgressSummary();
  const first = labs[0];
  if (!first) return null;
  const resumed = loaded && resume ? labs.find((l) => l.id === resume.labId) : undefined;
  const primary = resumed ?? first;
  const label = resumed
    ? fill(t.resume, { n: resumed.order, title: resumed.title[locale] })
    : t.start;
  const href = (id: string) => `/${locale}/lab/${id}`;

  return (
    <div className="mt-8">
      <Link
        href={href(primary.id)}
        className="inline-flex h-11 max-w-full items-center gap-2 rounded-sm bg-ink px-4 font-medium text-ground no-underline transition-colors hover:bg-ink-muted"
      >
        <span className="truncate">{label}</span>
        <ArrowRight size={15} weight={ICON_WEIGHT} aria-hidden className="shrink-0" />
      </Link>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <Link
          href={`/${locale}/rutas/${pathId}`}
          className="text-ink underline decoration-control hover:decoration-ink"
        >
          {fill(t.path, { n: labs.length })}
        </Link>
        <Link
          href={href(first.id)}
          // `invisible` lo saca también del orden de tabulación y de los lectores de pantalla.
          className={`text-ink-muted underline decoration-rule-strong hover:text-ink hover:decoration-ink ${
            resumed ? '' : 'invisible'
          }`}
        >
          {t.first}
        </Link>
      </p>

      <p className="mt-6 text-xs text-ink-faint">{t.note}</p>
    </div>
  );
}
