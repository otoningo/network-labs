'use client';

import type { LabDefinition } from '@nos/core';
import { ArrowCounterClockwise, ArrowUp } from '@phosphor-icons/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Console } from '@/components/terminal/Console';
import { ConsoleQuote } from '@/components/ui/ConsoleQuote';
import { useI18n } from '@/lib/i18n/context';
import { LabStoreProvider, useLab, useLabStoreApi } from '@/lib/lab/context';
import type { LabStore } from '@/lib/lab/store';
import { PRACTICE_PANEL_ID } from '@/lib/reference/text';

/** Id que <Console /> da a su sección. */
const CONSOLE_ID = 'lab-console';
const PROMPT = '[admin@MikroTik] > ';

interface TryApi {
  /** Escribe `command` en el prompt sin ejecutarlo y lleva el foco a la terminal. */
  readonly tryCommand: (command: string, source: HTMLElement) => void;
  /** Último botón "Probar" pulsado, para volver a él en el teléfono. */
  readonly source: HTMLElement | null;
  readonly announce: (message: string) => void;
}

const TryContext = createContext<TryApi | null>(null);

function useTry(): TryApi {
  const api = useContext(TryContext);
  if (!api) throw new Error('useTry fuera de ReferenceSandbox');
  return api;
}

const setupLines = (setup: string | undefined): readonly string[] =>
  (setup ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Stores ya preparados: en desarrollo los efectos corren dos veces y la preparación no se repite. */
const prepared = new WeakSet<LabStore>();

/**
 * Router de práctica de un tema de la referencia: un store del lab de
 * práctica que no guarda progreso (no debe aparecer como lab en curso), la
 * preparación del tema y una región que anuncia lo que hace "Probar".
 */
export function ReferenceSandbox({
  lab,
  setup,
  children,
}: {
  readonly lab: LabDefinition;
  readonly setup?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <LabStoreProvider lab={lab} persist={false}>
      <TryProvider setup={setup}>{children}</TryProvider>
    </LabStoreProvider>
  );
}

function TryProvider({
  setup,
  children,
}: {
  readonly setup: string | undefined;
  readonly children: ReactNode;
}) {
  const store = useLabStoreApi();
  const [message, setMessage] = useState('');
  const [source, setSource] = useState<HTMLElement | null>(null);

  // La preparación del tema (si la hay) corre al abrir y tras cada reinicio,
  // directamente en el store: la terminal muestra el router ya preparado.
  useEffect(() => {
    const lines = setupLines(setup);
    if (lines.length === 0) return;
    const apply = () => {
      for (const line of lines) store.getState().run(line);
    };
    if (!prepared.has(store)) {
      prepared.add(store);
      apply();
    }
    return store.subscribe((state, previous) => {
      if (state.epoch !== previous.epoch) apply();
    });
  }, [store, setup]);

  // Un espacio duro alterno hace que el mismo aviso se lea otra vez.
  const announce = useCallback((text: string) => {
    setMessage((previous) => (previous === text ? `${text} ` : text));
  }, []);

  const { messages } = useI18n();
  const written = messages.reference.written;
  const tryCommand = useCallback(
    (command: string, from: HTMLElement) => {
      setSource(from);
      store.getState().suggest(command);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .getElementById(PRACTICE_PANEL_ID)
        ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      // La terminal ya toma el foco al escribir la propuesta; si aún no estaba
      // lista, el foco va a la sección, que lo pasa a la terminal al cargar.
      const consoleSection = document.getElementById(CONSOLE_ID);
      if (consoleSection && !consoleSection.contains(document.activeElement)) {
        consoleSection.focus({ preventScroll: true });
      }
      announce(written);
    },
    [store, announce, written],
  );

  const api = useMemo<TryApi>(
    () => ({ tryCommand, source, announce }),
    [tryCommand, source, announce],
  );

  return (
    <TryContext value={api}>
      {children}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
    </TryContext>
  );
}

/** "Probar": propone el ejemplo en la consola del router de práctica, sin ejecutarlo. */
export function TryButton({
  command,
  describedBy,
}: {
  readonly command: string;
  /** Id de la línea citada, para que el botón diga qué prueba. */
  readonly describedBy: string;
}) {
  const { messages } = useI18n();
  const { tryCommand } = useTry();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      aria-describedby={describedBy}
      onClick={() => {
        if (ref.current) tryCommand(command, ref.current);
      }}
      className="-mr-1.5 min-h-11 shrink-0 rounded-sm px-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink lg:min-h-7"
    >
      {messages.reference.try}
    </button>
  );
}

/**
 * Panel del router de práctica: título, reinicio en dos pasos y la consola
 * real. En escritorio queda fijo junto a la lectura; en el teléfono va debajo.
 */
export function PracticePanel({
  setup,
  className = '',
}: {
  readonly setup?: string | undefined;
  readonly className?: string;
}) {
  const { messages } = useI18n();
  const t = messages.reference;
  const { source, announce } = useTry();
  const reset = useLab((s) => s.reset);
  const lines = setupLines(setup);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Al cerrar la confirmación, el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (!confirming && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  const close = () => {
    returnFocus.current = true;
    setConfirming(false);
  };

  return (
    <aside
      id={PRACTICE_PANEL_ID}
      aria-labelledby="practice-router-title"
      className={`flex h-[min(34rem,85dvh)] scroll-mt-4 flex-col overflow-hidden rounded-sm border border-rule lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:max-h-[52rem] ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-rule px-4 py-1">
        <h2 id="practice-router-title" className="text-sm font-semibold text-ink">
          {t.sandbox.title}
        </h2>
        <p className="hidden text-xs text-ink-faint sm:block">{t.sandbox.note}</p>
        <div className="ml-auto flex items-center gap-1">
          {source && (
            <button
              type="button"
              onClick={() => {
                source.focus({ preventScroll: true });
                source.scrollIntoView({ block: 'center' });
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1.5 text-xs text-ink-muted transition-colors hover:text-ink lg:hidden"
            >
              <ArrowUp size={14} weight="bold" aria-hidden />
              {t.back}
            </button>
          )}
          <button
            ref={trigger}
            type="button"
            aria-expanded={confirming}
            onClick={() => setConfirming(true)}
            className="-mr-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1.5 text-xs text-ink-muted transition-colors hover:text-ink lg:min-h-8"
          >
            <ArrowCounterClockwise size={14} aria-hidden />
            {t.sandbox.reset}
          </button>
        </div>
      </div>
      {confirming && (
        // Reiniciar pide confirmación en el sitio, sin ventana modal.
        <fieldset
          onKeyDown={(e) => e.key === 'Escape' && close()}
          className="min-w-0 shrink-0 border-b border-rule px-4 py-2 text-sm"
        >
          {/* float + w-full: la leyenda se comporta como un párrafo y no se monta en el borde. */}
          <legend className="float-left w-full text-xs text-ink-muted text-pretty">
            {t.sandbox.resetConfirm}
          </legend>
          <div className="clear-both flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: el foco va a la acción que se acaba de pedir confirmar
              autoFocus
              onClick={() => {
                reset();
                announce(t.sandbox.resetDone);
                close();
              }}
              className="min-h-11 rounded-sm border border-error px-3 text-error transition-colors hover:bg-error-quiet lg:min-h-8"
            >
              {t.sandbox.confirm}
            </button>
            <button
              type="button"
              onClick={close}
              className="min-h-11 rounded-sm px-2 text-ink-muted transition-colors hover:text-ink lg:min-h-8"
            >
              {t.sandbox.cancel}
            </button>
          </div>
        </fieldset>
      )}
      {lines.length > 0 && <SetupNote lines={lines} />}
      <div className="min-h-0 flex-1">
        <Console autoFocus={false} />
      </div>
    </aside>
  );
}

/** Lo que el tema deja hecho en el router antes de los ejemplos. */
function SetupNote({ lines }: { readonly lines: readonly string[] }) {
  const { messages } = useI18n();
  return (
    <details className="shrink-0 border-b border-rule px-4 py-2 text-xs text-ink-muted">
      <summary className="cursor-pointer hover:text-ink">{messages.reference.prepared}</summary>
      <ConsoleQuote
        label={messages.reference.sandbox.title}
        lines={lines.map((command) => ({ prompt: PROMPT, command }))}
        className="mt-2 mb-1"
      />
    </details>
  );
}
