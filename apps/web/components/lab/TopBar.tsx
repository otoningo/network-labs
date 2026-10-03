'use client';

import { ArrowCounterClockwise } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { fill, plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import type { ObjectiveState } from '@/lib/lab/store';

const SEGMENT: Record<ObjectiveState, string> = {
  // Monocromo: la casilla de cada tarea es la única que lleva color de estado.
  done: 'bg-ink-muted border-ink-muted',
  regressed: 'bg-transparent border-control',
  pending: 'bg-transparent border-control',
};

/** Barra superior: dónde estás (ruta, lab), cuánto llevas y los controles globales. */
export function TopBar() {
  const { locale, messages } = useI18n();
  const t = messages.lab;
  const lab = useLab((s) => s.runtime.lab);
  const objectives = useLab((s) => s.objectives);
  const states = lab.objectives.map((o) => objectives[o.id] ?? 'pending');
  const done = states.filter((s) => s === 'done').length;
  const pathName = lab.path ? (t.paths as Record<string, string>)[lab.path] : undefined;

  return (
    <header className="flex h-(--bar-height) items-center gap-3 border-b border-rule px-4 sm:gap-5 sm:px-5">
      <Link
        href={`/${locale}`}
        className="shrink-0 font-semibold tracking-tight text-ink no-underline"
      >
        {messages.app.name}
      </Link>
      <nav aria-label={t.tasks} className="hidden min-w-0 items-center gap-2 text-sm md:flex">
        {pathName && (
          <>
            <span className="truncate text-ink-faint">{pathName}</span>
            <span aria-hidden className="text-ink-faint">
              /
            </span>
          </>
        )}
        {lab.order !== undefined && (
          <span className="shrink-0 text-ink-muted">{fill(t.labNumber, { n: lab.order })}</span>
        )}
      </nav>
      <h1 className="min-w-0 truncate text-base font-medium text-ink">{lab.title[locale]}</h1>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-5">
        <div className="flex items-center gap-3">
          <ol
            aria-hidden
            className="flex items-center gap-1"
            title={plural(locale, t.progress, lab.objectives.length, {
              done,
              total: lab.objectives.length,
            })}
          >
            {states.map((state, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: un segmento por objetivo, en orden fijo
                key={index}
                className={`size-2.5 rounded-[1px] border transition-colors duration-500 ${SEGMENT[state]}`}
              />
            ))}
          </ol>
          <p className="hidden text-sm text-ink-muted sm:block">
            {plural(locale, t.progress, lab.objectives.length, {
              done,
              total: lab.objectives.length,
            })}
          </p>
        </div>
        <LanguageSwitch />
        <ResetButton />
      </div>
    </header>
  );
}

/** Reiniciar pide confirmación en el sitio, sin ventana modal. */
function ResetButton() {
  const { messages } = useI18n();
  const t = messages.lab;
  const reset = useLab((s) => s.reset);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <fieldset className="flex items-center gap-2 text-sm">
        <legend className="sr-only">{t.resetConfirm}</legend>
        <span className="hidden text-ink-muted lg:inline">{t.resetConfirm}</span>
        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: el foco va a la acción que se acaba de pedir confirmar
          autoFocus
          onClick={() => {
            reset();
            setConfirming(false);
          }}
          className="rounded-sm border border-error px-2 py-0.5 text-error hover:bg-error-quiet"
        >
          {t.reset}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
          className="rounded-sm px-2 py-0.5 text-ink-muted hover:text-ink"
        >
          {t.cancel}
        </button>
      </fieldset>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={t.reset}
      title={t.reset}
      className="grid size-8 place-items-center rounded-sm text-ink-faint hover:bg-rule hover:text-ink"
    >
      <ArrowCounterClockwise size={16} weight="regular" aria-hidden />
    </button>
  );
}
