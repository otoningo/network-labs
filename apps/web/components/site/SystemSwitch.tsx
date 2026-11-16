'use client';

import Link from 'next/link';
import { type KeyboardEvent, useRef } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { choosePreferredSystem } from '@/lib/system-preference';
import { SYSTEMS, type SystemId } from '@/lib/systems';

/** Pestaña como las del traductor de la portada: texto y un filete de tinta debajo de la elegida. */
const item = (selected: boolean, first: boolean) =>
  `relative inline-flex h-11 items-center pr-3 text-sm whitespace-nowrap no-underline transition-colors ${
    first ? 'pl-0' : 'pl-3'
  } ${selected ? 'text-ink' : 'text-ink-muted hover:text-ink'}`;
const bar = (first: boolean) =>
  `absolute right-3 -bottom-px h-0.5 bg-ink ${first ? 'left-0' : 'left-3'}`;

function Name({ system }: { readonly system: SystemId }) {
  const { messages } = useI18n();
  const { vendors, short } = messages.systems;
  // En el teléfono no caben los tres nombres completos: el fabricante aparece desde 640px.
  return (
    // Un solo hijo: dentro de la pestaña (inline-flex) el espacio entre dos piezas se perdería.
    <span>
      <span className="hidden sm:inline">{vendors[system]} </span>
      {short[system]}
    </span>
  );
}

/**
 * Elegir sistema navegando: cada sistema es una página (la referencia de
 * RouterOS, la de VRP...). Recuerda la elección para la portada.
 */
export function SystemLinks({
  current,
  base,
  available = SYSTEMS,
  className = '',
}: {
  readonly current: SystemId;
  /** Dirección a la que se añade el id del sistema, como `/es/referencia`. */
  readonly base: string;
  readonly available?: readonly SystemId[];
  readonly className?: string;
}) {
  const { messages } = useI18n();
  return (
    <nav aria-label={messages.systems.label} className={className}>
      <ul className="flex border-b border-rule">
        {available.map((system, index) => {
          const selected = system === current;
          return (
            <li key={system}>
              <Link
                href={`${base}/${system}`}
                aria-current={selected ? 'page' : undefined}
                onClick={() => choosePreferredSystem(system)}
                className={item(selected, index === 0)}
              >
                <Name system={system} />
                {selected && <span aria-hidden className={bar(index === 0)} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Elegir sistema sin salir de la página (la portada): pestañas con flechas,
 * Inicio y Fin, como el traductor. Controla el panel `panelId`.
 */
export function SystemTabs({
  value,
  onChange,
  panelId,
  className = '',
}: {
  readonly value: SystemId;
  readonly onChange: (system: SystemId) => void;
  readonly panelId: string;
  readonly className?: string;
}) {
  const { messages } = useI18n();
  const tabs = useRef(new Map<SystemId, HTMLButtonElement>());
  const select = (system: SystemId) => {
    onChange(system);
    choosePreferredSystem(system);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = SYSTEMS.indexOf(value);
    const target =
      event.key === 'ArrowRight'
        ? SYSTEMS[(index + 1) % SYSTEMS.length]
        : event.key === 'ArrowLeft'
          ? SYSTEMS[(index - 1 + SYSTEMS.length) % SYSTEMS.length]
          : event.key === 'Home'
            ? SYSTEMS[0]
            : event.key === 'End'
              ? SYSTEMS[SYSTEMS.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    select(target);
    tabs.current.get(target)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={messages.systems.label}
      onKeyDown={onKeyDown}
      className={`flex border-b border-rule ${className}`}
    >
      {SYSTEMS.map((system, index) => {
        const selected = system === value;
        return (
          <button
            key={system}
            ref={(node) => {
              if (node) tabs.current.set(system, node);
              else tabs.current.delete(system);
            }}
            type="button"
            role="tab"
            id={`system-tab-${system}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(system)}
            className={item(selected, index === 0)}
          >
            <Name system={system} />
            {selected && <span aria-hidden className={bar(index === 0)} />}
          </button>
        );
      })}
    </div>
  );
}
