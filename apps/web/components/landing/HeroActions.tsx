'use client';

import type { LocalizedText } from '@nos/core';
import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useProgressSummary } from '@/lib/progress/summary';

export interface HeroLab {
  readonly id: string;
  readonly order: number;
  readonly title: LocalizedText;
}

/**
 * La acción del hero: blanco de pliegue sobre el bermellón, con el punto
 * dorado. Sin progreso abre el lab 1; con un lab a medias pasa a "Continuar" y
 * el lab 1 queda como enlace discreto. Hasta leer el almacenamiento se muestra
 * el lab 1, y el enlace discreto ocupa su sitio aunque esté oculto.
 */
export function HeroActions({ labs }: { readonly labs: readonly HeroLab[] }) {
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
    <div className="mt-10">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link
          href={href(primary.id)}
          aria-label={label}
          className="group inline-flex h-12 max-w-full items-center gap-3 rounded-[2px] bg-(--fold-white) px-5 font-medium text-(--sumi) no-underline shadow-[0_10px_24px_rgb(60_8_4/0.35)] transition-transform duration-200 hover:-translate-y-px active:translate-y-px"
        >
          {resumed ? (
            <span>
              <span className="sm:hidden">{fill(t.resumeShort, { n: resumed.order })}</span>
              <span className="hidden sm:inline">{label}</span>
            </span>
          ) : (
            <span>{label}</span>
          )}
          <ArrowRight
            size={16}
            weight="bold"
            aria-hidden
            className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
        <Link
          href={href(first.id)}
          // `invisible` lo saca también del orden de tabulación y de los lectores de pantalla.
          className={`text-sm underline decoration-(--crease) underline-offset-4 hover:decoration-(--fold-white) ${
            resumed ? '' : 'invisible'
          }`}
        >
          {t.first}
        </Link>
      </div>
      <p className="mt-5 text-sm">{t.note}</p>
    </div>
  );
}
