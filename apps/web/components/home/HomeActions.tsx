'use client';

import type { LocalizedText } from '@nos/core';
import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { ICON_WEIGHT } from '@/components/lab/worksheet/StatusBox';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useProgressSummary } from '@/lib/progress/summary';

export interface HomeLab {
  readonly id: string;
  readonly order: number;
  readonly title: LocalizedText;
}

/**
 * El único botón relleno de tinta de la web: abre el lab 1 o, si hay un lab a
 * medias en este navegador, lo continúa. Hasta leer el almacenamiento muestra
 * el lab 1; el ancho no depende del progreso, así que no salta.
 */
export function HomeActions({ labs }: { readonly labs: readonly HomeLab[] }) {
  const { locale, messages } = useI18n();
  const t = messages.home.hero;
  const { loaded, resume } = useProgressSummary();
  const first = labs[0];
  if (!first) return null;
  const resumed = loaded && resume ? labs.find((l) => l.id === resume.labId) : undefined;
  const primary = resumed ?? first;
  const label = resumed
    ? fill(t.resume, { n: resumed.order, title: resumed.title[locale] })
    : t.start;

  return (
    <Link
      href={`/${locale}/lab/${primary.id}`}
      aria-label={label}
      className="group mt-8 inline-flex h-11 max-w-full items-center gap-2 rounded-sm bg-ink px-4 font-medium text-ground no-underline transition-colors hover:bg-ink-muted active:translate-y-px"
    >
      {resumed ? (
        // En el teléfono el título del lab no cabe en un botón: se acorta la
        // etiqueta visible; el nombre accesible conserva el título completo.
        <span className="truncate">
          <span className="sm:hidden">{fill(t.resumeShort, { n: resumed.order })}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <ArrowRight
        size={15}
        weight={ICON_WEIGHT}
        aria-hidden
        className="shrink-0 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
