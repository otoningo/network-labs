'use client';

import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { JourneyStep } from './journeySteps';

/**
 * La columna numerada del diagrama de plegado: 01 a 07, con el punto dorado
 * en el paso activo. Cada paso lleva al punto del viaje donde ocurre.
 */
export function StepList({
  steps,
  active,
  onSelect,
  className = '',
}: {
  readonly steps: readonly JourneyStep[];
  readonly active: number;
  readonly onSelect: (index: number) => void;
  readonly className?: string;
}) {
  const { messages } = useI18n();
  const t = messages.landing.journey;
  return (
    <ol aria-label={t.steps} className={`border-l border-rule ${className}`}>
      {steps.map((step, index) => {
        const current = index === active;
        return (
          <li key={step.id} aria-current={current ? 'step' : undefined}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-label={fill(t.jump, { n: index + 1, name: step.name })}
              className={`group relative flex w-full items-baseline gap-3 py-1.5 pl-4 text-left transition-colors duration-300 ${
                current ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-1/2 -left-[5px] size-[9px] -translate-y-1/2 rounded-full transition-[background-color,transform] duration-300 ${
                  current ? 'scale-100 bg-(--gold)' : 'scale-0 bg-transparent'
                }`}
              />
              <span className="font-display text-sm tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="fold-label">{step.name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
