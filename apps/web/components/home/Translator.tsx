'use client';

import type { LabDefinition } from '@nos/core';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ICON_WEIGHT, StatusBox } from '@/components/lab/worksheet/StatusBox';
import { ConsoleQuote } from '@/components/ui/ConsoleQuote';
import type { Translation, TranslationId } from '@/lib/home/translations';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { describeEvidence, evidenceOf } from '@/lib/lab/evidence';
import { createLabStore, type LabStore, type ObjectiveState } from '@/lib/lab/store';

/** Pausas del tecleo, en ms: arranque, cada carácter (con un vaivén fijo) y antes de Enter. */
const START_DELAY = 500;
const KEY_DELAY = 26;
const KEY_SWING = [0, 14, 4, 22, 8, 0, 18, 6];
const ENTER_DELAY = 380;

/** Lo que dejó la línea al ejecutarse en el motor. */
interface Ran {
  readonly output: string;
  readonly prompt: string;
  readonly state: ObjectiveState;
  readonly evidence: readonly string[];
}

/** Lo que se ve de la tarea activa mientras se teclea y después. */
interface Session {
  readonly startPrompt: string;
  readonly typed: number;
  readonly ran: Ran | null;
  readonly live: boolean;
}

export interface TranslatorTask {
  readonly translation: Translation;
  readonly lab: LabDefinition;
  /** El prompt del router antes de escribir, con su configuración previa. */
  readonly prompt: string;
  /** Lo que la red reporta al terminar: reserva su alto antes de que aparezca. */
  readonly evidence: readonly string[];
}

/**
 * La firma de la portada: una tarea de IOS y su traducción a RouterOS. La cita
 * de IOS es texto; la línea de RouterOS se teclea en una consola real, se
 * ejecuta con `store.run` y la casilla se marca porque la red cambió. Cambiar
 * de pestaña reproduce esa tarea; la primera se reproduce sola al entrar en
 * pantalla. Con movimiento reducido se muestra el estado final, sin tecleo.
 */
export function Translator({ tasks }: { readonly tasks: readonly TranslatorTask[] }) {
  const { messages } = useI18n();
  const t = messages.home.translator;
  const [activeId, setActiveId] = useState<TranslationId>(tasks[0]?.translation.id ?? 'hostname');
  const stores = useRef(new Map<TranslationId, LabStore>());
  const [session, setSession] = useState<Session>({
    startPrompt: tasks[0]?.prompt ?? '',
    typed: 0,
    ran: null,
    live: false,
  });
  const [announcement, setAnnouncement] = useState('');
  const root = useRef<HTMLElement>(null);
  const tabs = useRef(new Map<TranslationId, HTMLButtonElement>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const storeFor = useCallback(
    (id: TranslationId): LabStore | undefined => {
      const cached = stores.current.get(id);
      if (cached) return cached;
      const task = tasks.find((x) => x.translation.id === id);
      if (!task) return undefined;
      const store = createLabStore(task.lab);
      stores.current.set(id, store);
      return store;
    },
    [tasks],
  );

  const stop = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  /**
   * Teclea y ejecuta la línea de una tarea. Solo lo que pide el usuario (una
   * pestaña, Repetir) se anuncia; la reproducción automática al cargar, no.
   */
  const play = useCallback(
    (id: TranslationId, announce: boolean) => {
      const task = tasks.find((x) => x.translation.id === id);
      const store = storeFor(id);
      if (!task || !store) return;
      const line = task.translation.routeros;
      stop();
      store.getState().reset();
      const startPrompt = store.getState().prompt();
      setSession({ startPrompt, typed: 0, ran: null, live: false });
      setAnnouncement('');
      const execute = (animate: boolean) => {
        const result = store.getState().run(line);
        const state = store.getState().objectives[id] ?? 'pending';
        const evidence = evidenceOf(store.getState(), id).map((e) => describeEvidence(e, messages));
        setSession({
          startPrompt,
          typed: line.length,
          live: animate,
          ran: { output: result.output, prompt: store.getState().prompt(), state, evidence },
        });
        if (announce && state === 'done') {
          setAnnouncement(fill(t.result, { evidence: evidence.join('; ') }));
        }
      };
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        execute(false);
        return;
      }
      let at = START_DELAY;
      for (let i = 1; i <= line.length; i += 1) {
        at += KEY_DELAY + (KEY_SWING[i % KEY_SWING.length] ?? 0);
        timers.current.push(setTimeout(() => setSession((s) => ({ ...s, typed: i })), at));
      }
      timers.current.push(setTimeout(() => execute(true), at + ENTER_DELAY));
    },
    [tasks, storeFor, stop, messages, t.result],
  );

  // La primera tarea se reproduce una sola vez, cuando la figura entra en pantalla.
  const first = tasks[0]?.translation.id;
  useEffect(() => {
    const node = root.current;
    if (!node || !first) return stop;
    if (typeof IntersectionObserver === 'undefined') {
      play(first, false);
      return stop;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          play(first, false);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [first, play, stop]);

  const select = (id: TranslationId) => {
    setActiveId(id);
    play(id, true);
  };

  // Pestañas con flechas, Inicio y Fin (patrón de tablist de WAI-ARIA).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = tasks.map((x) => x.translation.id);
    const index = ids.indexOf(activeId);
    const next =
      event.key === 'ArrowRight'
        ? ids[(index + 1) % ids.length]
        : event.key === 'ArrowLeft'
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

  return (
    <figure ref={root} aria-labelledby="translator-caption" className="m-0 min-w-0">
      <div
        role="tablist"
        aria-label={t.tasks}
        onKeyDown={onKeyDown}
        className="flex border-b border-rule"
      >
        {tasks.map(({ translation: x }) => {
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
              id={`translator-tab-${x.id}`}
              aria-selected={selected}
              aria-controls={`translator-panel-${x.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(x.id)}
              className={`relative h-11 px-3 text-sm whitespace-nowrap transition-colors first:pl-0 ${
                selected ? 'text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t.tab[x.id]}
              <span
                aria-hidden
                className={`absolute right-3 -bottom-px left-3 h-0.5 bg-ink transition-opacity [button:first-child>&]:left-0 ${
                  selected ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/*
        Las cuatro tareas ocupan la misma celda: la figura mide lo que la más
        alta a cualquier ancho y cambiar de pestaña no mueve nada. Solo la
        activa se ve y se lee; las demás quedan invisibles y fuera del árbol
        de accesibilidad.
      */}
      <div className="grid">
        {tasks.map((task) => {
          const active = task.translation.id === activeId;
          return (
            <Panel
              key={task.translation.id}
              task={task}
              active={active}
              session={active ? session : null}
              onReplay={() => play(task.translation.id, true)}
            />
          );
        })}
      </div>

      <figcaption id="translator-caption" className="mt-3 text-xs text-ink-faint text-pretty">
        <span className="font-medium text-ink-muted">{t.figure}</span> {t.caption}
      </figcaption>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </figure>
  );
}

function Panel({
  task,
  active,
  session,
  onReplay,
}: {
  readonly task: TranslatorTask;
  readonly active: boolean;
  /** Solo la tarea activa tiene sesión; las demás se pintan quietas para medir su alto. */
  readonly session: Session | null;
  readonly onReplay: () => void;
}) {
  const { locale, messages } = useI18n();
  const t = messages.home.translator;
  const { translation } = task;
  const device = 'R1';
  const ran = session?.ran ?? null;
  const state = ran?.state ?? 'pending';
  const typed = session ? session.typed : translation.routeros.length;
  const typing = session !== null && ran === null;

  return (
    <div
      role="tabpanel"
      id={`translator-panel-${translation.id}`}
      aria-labelledby={`translator-tab-${translation.id}`}
      aria-hidden={!active}
      inert={!active}
      className={`col-start-1 row-start-1 flex min-w-0 flex-col ${active ? '' : 'invisible'}`}
    >
      {/* La fila de tarea, como en la hoja del lab: enunciado, lo que reporta la red y la casilla. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-rule py-4">
        <div className="min-w-0">
          <p className="text-base text-ink text-pretty">
            <span className="sr-only">{`${messages.lab.status[state]}. `}</span>
            {translation.objective[locale]}
          </p>
          {/* Hasta que la red lo reporta, la línea ocupa su sitio sin verse: marcar la tarea no mueve nada. */}
          <dl
            aria-hidden={ran === null}
            className={`mt-1.5 min-h-[1.55em] text-xs text-ink-faint ${ran ? '' : 'invisible'}`}
          >
            <dt className="sr-only">{messages.lab.evidence.label}</dt>
            {(ran?.evidence ?? task.evidence).map((line) => (
              <dd key={line} className="tabular-nums text-pretty">
                {line}
              </dd>
            ))}
          </dl>
        </div>
        <StatusBox state={state} live={session?.live ?? false} />
      </div>

      <ConsoleQuote label={t.ios} lines={translation.ios} className="mt-5" />

      {/* La consola de RouterOS: el mismo escalón y la misma mono que la del lab. Se estira: el hueco es la terminal esperando. */}
      <div className="mt-3 flex flex-1 flex-col rounded-sm bg-console">
        <div className="flex min-h-7 items-center justify-between gap-3 border-b border-rule pl-3">
          <p className="py-1.5 text-2xs text-ink-faint">{fill(t.routeros, { device })}</p>
          <button
            type="button"
            onClick={onReplay}
            aria-label={t.replayLabel}
            className="-my-2 inline-flex h-11 items-center gap-1.5 rounded-sm px-3 text-xs text-ink-muted transition-colors hover:text-ink lg:my-0 lg:h-7"
          >
            <ArrowCounterClockwise size={13} weight={ICON_WEIGHT} aria-hidden />
            {t.replay}
          </button>
        </div>
        <p className="sr-only">{fill(t.described, { device, command: translation.routeros })}</p>
        <div
          aria-hidden
          className="flex-1 px-3 py-2.5 font-mono text-[13.5px] leading-[1.45] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]"
        >
          <div>
            <span className="text-ink-faint">{session?.startPrompt ?? task.prompt}</span>
            {translation.routeros.slice(0, typed)}
            {typing && <Cursor />}
          </div>
          {ran?.output ? <div className="text-ink-muted">{ran.output.trimEnd()}</div> : null}
          {/* La línea del prompt nuevo se reserva aunque aún no haya salido. */}
          <div className={ran ? '' : 'invisible'}>
            <span className="text-ink-faint">{ran?.prompt ?? task.prompt}</span>
            <Cursor />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cursor de bloque sin parpadeo, como el de la consola del lab. */
function Cursor() {
  return <span className="inline-block h-[1.1em] w-[0.6em] translate-y-[0.18em] bg-ink-muted" />;
}
