'use client';

import { Check } from '@phosphor-icons/react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ICON_WEIGHT } from '@/components/lab/worksheet/StatusBox';
import { ConsoleQuote, type QuotedLine } from '@/components/ui/ConsoleQuote';
import type { CompareOs, CompareTaskId } from '@/lib/compare/tasks';
import { useI18n } from '@/lib/i18n/context';

/** Lo que la página muestra de cada sistema en una tarea. */
export interface ShownSystem {
  readonly os: CompareOs;
  readonly lines: readonly QuotedLine[];
  /** Ejecutado en el simulador y comprobado por el estado de la red. */
  readonly verified: boolean;
}

export interface ShownTask {
  readonly id: CompareTaskId;
  readonly systems: readonly ShownSystem[];
}

/**
 * La vista "Compara sintaxis": la lista de tareas como pestañas (a la
 * izquierda desde 1024px, arriba en el teléfono) y la tarea elegida con los
 * cuatro sistemas en una rejilla. La tarea va en el hash (#nat) para poder
 * enlazarla.
 */
export function CompareView({ tasks }: { readonly tasks: readonly ShownTask[] }) {
  const { messages } = useI18n();
  const t = messages.compare;
  const [activeId, setActiveId] = useState<CompareTaskId>(tasks[0]?.id ?? 'hostname');
  const tabs = useRef(new Map<CompareTaskId, HTMLButtonElement>());

  // Al cargar, la tarea del hash si es una de las nuestras.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    const known = tasks.find((x) => x.id === fromHash);
    if (known) setActiveId(known.id);
  }, [tasks]);

  const select = (id: CompareTaskId) => {
    setActiveId(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  // Pestañas con flechas, Inicio y Fin (patrón de tablist de WAI-ARIA).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = tasks.map((x) => x.id);
    const index = ids.indexOf(activeId);
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const next = forward
      ? ids[(index + 1) % ids.length]
      : back
        ? ids[(index - 1 + ids.length) % ids.length]
        : event.key === 'Home'
          ? ids[0]
          : event.key === 'End'
            ? ids.at(-1)
            : undefined;
    if (!next) return;
    event.preventDefault();
    select(next);
    tabs.current.get(next)?.focus();
  };

  const task = tasks.find((x) => x.id === activeId);
  if (!task) return null;

  return (
    <div className="mt-10 grid gap-x-12 gap-y-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div
        role="tablist"
        aria-label={t.tasks}
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-rule px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0 lg:self-start lg:overflow-visible lg:border-b-0 lg:border-l lg:px-0"
      >
        {tasks.map((x) => {
          const selected = x.id === activeId;
          return (
            <button
              key={x.id}
              ref={(node) => {
                if (node) tabs.current.set(x.id, node);
                else tabs.current.delete(x.id);
              }}
              type="button"
              role="tab"
              id={`compare-tab-${x.id}`}
              aria-selected={selected}
              aria-controls="compare-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(x.id)}
              className={`relative shrink-0 py-2.5 text-left text-sm whitespace-nowrap transition-colors max-lg:h-11 lg:py-2 lg:pl-4 lg:whitespace-normal ${
                selected ? 'text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t.task[x.id].title}
              <span
                aria-hidden
                className={`absolute bg-ink transition-opacity max-lg:right-0 max-lg:-bottom-px max-lg:left-0 max-lg:h-0.5 lg:top-0 lg:bottom-0 lg:-left-px lg:w-0.5 ${
                  selected ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id="compare-panel"
        aria-labelledby={`compare-tab-${task.id}`}
        className="min-w-0"
      >
        <h2 className="text-lg leading-tight font-semibold text-balance text-ink">
          {t.task[task.id].title}
        </h2>
        <p className="mt-2 max-w-[62ch] text-ink-muted text-pretty">{t.task[task.id].note}</p>
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {task.systems.map((system) => (
            <SystemBlock key={system.os} taskId={task.id} system={system} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SystemBlock({
  taskId,
  system,
}: {
  readonly taskId: CompareTaskId;
  readonly system: ShownSystem;
}) {
  const { messages } = useI18n();
  const t = messages.compare;
  const status = system.verified ? (
    <span className="inline-flex items-center gap-1 py-1.5 text-2xs text-ink-faint">
      <Check size={12} weight={ICON_WEIGHT} aria-hidden className="text-done" />
      {t.verified}
    </span>
  ) : (
    <span className="py-1.5 text-2xs text-ink-faint">{t.quoted}</span>
  );
  if (system.lines.length === 0) {
    const absent = (t.absent as Record<string, Record<string, string>>)[system.os]?.[taskId] ?? '';
    return (
      <div className="min-w-0 rounded-sm border border-rule">
        <div className="flex min-h-7 items-center justify-between gap-3 border-b border-rule px-3">
          <p className="py-1.5 text-2xs text-ink-faint">{t.os[system.os]}</p>
        </div>
        <p className="px-3 py-2.5 text-sm text-ink-muted text-pretty">{absent}</p>
      </div>
    );
  }
  return <ConsoleQuote label={t.os[system.os]} lines={system.lines} action={status} />;
}
