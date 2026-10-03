'use client';

import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RichText } from '@/components/ui/RichText';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import { useLabNav } from '@/lib/lab/nav';
import { TaskItem } from './worksheet/TaskItem';
import { useSessionChanges } from './worksheet/useSessionChanges';

/**
 * Hoja de tareas: un cuaderno de lab que se corrige solo. Enunciado, tareas
 * numeradas con su casilla de verificación y, al terminar, la explicación.
 */
export function Worksheet() {
  const { locale, messages } = useI18n();
  const t = messages.lab;
  const lab = useLab((s) => s.runtime.lab);
  const finished = useLab((s) => s.finishedAt !== null);
  const { live, message, announce } = useSessionChanges();

  return (
    <div className="@container flex min-h-full flex-col">
      <div className="flex flex-1 flex-col px-6 pt-7 pb-6 @md:px-8 @md:pt-8">
        <div className="flex-1">
          <header>
            <p className="text-xl leading-tight font-semibold text-balance text-ink">
              {lab.title[locale]}
            </p>
            <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">
              <RichText text={lab.summary[locale]} />
            </p>
            <p className="mt-3 text-xs text-ink-faint">
              {t.difficulty[lab.difficulty]}
              <span aria-hidden className="mx-1.5">
                ·
              </span>
              {fill(t.minutes, { n: lab.minutes })}
            </p>
          </header>

          <h2 id="lab-tasks-heading" className="mt-10 text-sm font-semibold text-ink-muted">
            {t.tasks}
          </h2>
          <ol className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 border-b border-rule">
            {lab.objectives.map((objective, index) => (
              <TaskItem
                key={objective.id}
                objective={objective}
                number={index + 1}
                live={live}
                announce={announce}
              />
            ))}
          </ol>

          {finished && (
            <section aria-labelledby="lab-finished-heading" className="mt-10">
              <h3 id="lab-finished-heading" className="text-md font-semibold text-ink">
                {t.finished.title}
              </h3>
              <p className="mt-2 max-w-[62ch] text-ink-muted text-pretty">{t.finished.body}</p>
              <p className="mt-4 max-w-[62ch] text-ink text-pretty">
                <RichText text={lab.explanation[locale]} />
              </p>
              <NextLab />
            </section>
          )}
        </div>

        <footer className="mt-12 border-t border-rule pt-4">
          <p className="max-w-[62ch] text-2xs text-ink-faint">{messages.app.disclaimer}</p>
        </footer>
      </div>
      <Announcer message={message} />
    </div>
  );
}

/**
 * Región aria-live en <body>: en móvil la hoja queda oculta mientras se escribe
 * en la consola, y una región dentro de un panel oculto no se anuncia.
 */
function Announcer({ message }: { readonly message: string }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.body), []);
  if (!target) return null;
  return createPortal(
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>,
    target,
  );
}

/** Al terminar: el siguiente lab de la ruta, o el aviso de que era el último. */
function NextLab() {
  const { locale, messages } = useI18n();
  const t = messages.lab;
  const { next } = useLabNav();
  if (!next) return <p className="mt-6 text-sm text-ink-muted">{t.finished.endOfPath}</p>;
  return (
    <Link
      href={`/${locale}/lab/${next.id}`}
      className="group mt-6 inline-flex items-baseline gap-2 border-t border-rule pt-4 text-ink no-underline"
    >
      <span className="text-sm text-ink-muted">{t.finished.next}</span>
      <span className="font-medium group-hover:underline">
        {fill(t.labNumber, { n: next.order })}. {next.title[locale]}
      </span>
      <ArrowRight size={15} weight="bold" aria-hidden className="self-center" />
    </Link>
  );
}
