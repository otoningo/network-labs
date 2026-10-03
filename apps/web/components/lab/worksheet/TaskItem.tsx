'use client';

import type { LabDefinition } from '@nos/core';
import { Lightbulb } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { RichText } from '@/components/ui/RichText';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import { ICON_WEIGHT, StatusBox } from './StatusBox';

type Objective = LabDefinition['objectives'][number];

/** Quita las comillas invertidas del formato de lab para leerlo en voz alta. */
const plain = (text: string): string => text.replaceAll('`', '');

/**
 * Una fila de la hoja: numeral, enunciado con sus pistas y la casilla de estado.
 * La casilla y el numeral tienen columna fija, así un cambio de estado no mueve nada.
 */
export function TaskItem({
  objective,
  number,
  live,
  announce,
}: {
  readonly objective: Objective;
  readonly number: number;
  readonly live: boolean;
  readonly announce: (text: string) => void;
}) {
  const { locale, messages } = useI18n();
  const t = messages.lab;
  const state = useLab((s) => s.objectives[objective.id] ?? 'pending');
  const shown = useLab((s) => s.hints[objective.id] ?? 0);
  const revealHint = useLab((s) => s.revealHint);
  const total = objective.hints.length;
  const task = fill(t.taskNumber, { n: number });

  // Al revelar la última pista el botón desaparece: el foco pasa a esa pista.
  const lastHint = useRef<HTMLLIElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (focusLast.current && shown >= total) {
      focusLast.current = false;
      lastHint.current?.focus();
    }
  }, [shown, total]);

  const reveal = () => {
    const hint = objective.hints[shown];
    if (!hint) return;
    revealHint(objective.id);
    if (shown + 1 >= total) {
      focusLast.current = true;
      return;
    }
    // Si el botón sigue ahí, el foco se queda en él y la pista se anuncia.
    announce(
      `${t.hints.show} ${fill(t.hints.count, { n: shown + 1, total })}: ${plain(hint[locale])}`,
    );
  };

  const action = shown === 0 ? t.hints.show : t.hints.next;
  const canAsk = state !== 'done' && shown < total;

  return (
    <li className="col-span-full grid grid-cols-subgrid items-start border-t border-rule py-5">
      <span
        aria-hidden
        className={`-mt-1.5 text-right text-numeral leading-none font-light tabular-nums ${
          state === 'done' ? 'text-ink-muted' : 'text-ink-faint'
        } ${live ? 'transition-colors duration-[260ms] ease-(--ease-out)' : ''}`}
      >
        {number}
      </span>

      <div className="min-w-0">
        <p className="text-base text-ink text-pretty">
          <span className="sr-only">{`${task}. ${t.status[state]}. `}</span>
          <RichText text={objective.text[locale]} />
        </p>
        {state === 'regressed' && <p className="mt-1.5 text-xs text-warn">{t.regressedNote}</p>}

        {shown > 0 && (
          <ol className="mt-3 space-y-2 text-sm text-ink-muted">
            {objective.hints.slice(0, shown).map((hint, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: las pistas solo se añaden al final, en orden fijo
                key={index}
                ref={index === shown - 1 ? lastHint : undefined}
                tabIndex={-1}
                className="text-pretty"
              >
                <span className="mr-2 text-ink-faint tabular-nums">
                  {fill(t.hints.count, { n: index + 1, total })}
                </span>
                <RichText text={hint[locale]} />
              </li>
            ))}
          </ol>
        )}

        {canAsk && (
          <button
            type="button"
            onClick={reveal}
            aria-label={fill(t.hints.label, { action, n: number })}
            className="mt-2 -ml-0.5 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-0.5 text-sm text-ink-muted transition-colors hover:text-ink lg:min-h-8"
          >
            <Lightbulb size={15} weight={ICON_WEIGHT} aria-hidden />
            {action}
          </button>
        )}
      </div>

      <StatusBox state={state} live={live} />
    </li>
  );
}
