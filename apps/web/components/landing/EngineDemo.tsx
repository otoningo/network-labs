'use client';

import type { LabDefinition } from '@nos/core';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ICON_WEIGHT, StatusBox } from '@/components/lab/worksheet/StatusBox';
import { RichText } from '@/components/ui/RichText';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { describeEvidence, evidenceOf } from '@/lib/lab/evidence';
import { createLabStore, type ObjectiveState } from '@/lib/lab/store';
import { DEMO_COMMAND, DEMO_OBJECTIVE } from '@/lib/landing/demo';

/** Pausas del tecleo, en ms: arranque, cada carácter (con un vaivén fijo) y antes de Enter. */
const START_DELAY = 700;
const KEY_DELAY = 48;
const KEY_SWING = [0, 22, 6, 34, 12, 0, 28, 8];
const ENTER_DELAY = 450;

/** Lo que dejó el comando al ejecutarse en el motor. */
interface Ran {
  readonly output: string;
  readonly prompt: string;
  readonly state: ObjectiveState;
  readonly evidence: readonly string[];
}

/**
 * La firma de la portada: una tarea del lab 1 resuelta en vivo con el motor
 * real. Se escribe el comando, se ejecuta con `store.run`, el prompt cambia y
 * la casilla se marca porque el objetivo se cumple en la red simulada.
 * Se reproduce una vez al entrar en pantalla; con movimiento reducido se
 * muestra el estado final sin tecleo.
 */
export function EngineDemo({ lab }: { readonly lab: LabDefinition }) {
  const { locale, messages } = useI18n();
  const t = messages.landing.demo;
  const [store] = useState(() => createLabStore(lab));
  const [initialPrompt] = useState(() => store.getState().prompt());
  const device = store.getState().activeDevice;
  const objective = lab.objectives.find((o) => o.id === DEMO_OBJECTIVE);
  const number = lab.objectives.findIndex((o) => o.id === DEMO_OBJECTIVE) + 1;

  const [typed, setTyped] = useState(0);
  const [ran, setRan] = useState<Ran | null>(null);
  const [live, setLive] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const root = useRef<HTMLElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const execute = useCallback(
    (animate: boolean) => {
      const result = store.getState().run(DEMO_COMMAND);
      const state = store.getState().objectives[DEMO_OBJECTIVE] ?? 'pending';
      const evidence = evidenceOf(store.getState(), DEMO_OBJECTIVE).map((e) =>
        describeEvidence(e, messages),
      );
      setTyped(DEMO_COMMAND.length);
      setLive(animate);
      setRan({ output: result.output, prompt: store.getState().prompt(), state, evidence });
      if (state === 'done') setAnnouncement(fill(t.result, { evidence: evidence.join('; ') }));
    },
    [store, messages, t.result],
  );

  const play = useCallback(() => {
    stop();
    store.getState().reset();
    setRan(null);
    setTyped(0);
    setAnnouncement('');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      execute(false);
      return;
    }
    let at = START_DELAY;
    for (let i = 1; i <= DEMO_COMMAND.length; i += 1) {
      at += KEY_DELAY + (KEY_SWING[i % KEY_SWING.length] ?? 0);
      timers.current.push(setTimeout(() => setTyped(i), at));
    }
    timers.current.push(setTimeout(() => execute(true), at + ENTER_DELAY));
  }, [stop, store, execute]);

  // Se reproduce una sola vez, cuando la demostración entra en pantalla.
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      play();
      return stop;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          play();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [play, stop]);

  if (!objective) return null;
  const state = ran?.state ?? 'pending';
  const typing = ran === null;

  return (
    <figure ref={root} aria-label={t.label} className="m-0 min-w-0">
      <p className="sr-only">{fill(t.described, { device, command: DEMO_COMMAND })}</p>

      {/* La fila de tarea, como en la hoja del lab: numeral, enunciado y casilla. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 border-y border-rule py-5">
        <span
          aria-hidden
          className="-mt-1.5 text-right text-numeral leading-none font-light tabular-nums text-ink-faint"
        >
          {number}
        </span>
        <div className="min-w-0">
          <p className="text-base text-ink text-pretty">
            <span className="sr-only">
              {`${fill(messages.lab.taskNumber, { n: number })}. ${messages.lab.status[state]}. `}
            </span>
            <RichText text={objective.text[locale]} />
          </p>
          {/* La línea se reserva siempre: así marcar la tarea no mueve nada. */}
          <dl className="mt-2 min-h-[1.55em] text-xs text-ink-faint">
            <dt className="sr-only">{messages.lab.evidence.label}</dt>
            {(ran?.evidence ?? []).map((line) => (
              <dd key={line} className="tabular-nums text-pretty">
                {line}
              </dd>
            ))}
          </dl>
        </div>
        <StatusBox state={state} live={live} />
      </div>

      {/* Superficie de consola: el único sitio de la portada con mono, como en el lab. */}
      <div className="mt-6 rounded-sm bg-console">
        <div className="flex h-10 items-center justify-between gap-4 border-b border-rule pr-1 pl-4">
          <span className="text-xs text-ink-muted">{fill(messages.lab.consoleOf, { device })}</span>
          <button
            type="button"
            onClick={play}
            aria-label={t.replayLabel}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowCounterClockwise size={15} weight={ICON_WEIGHT} aria-hidden />
            {t.replay}
          </button>
        </div>
        <div
          aria-hidden
          className="min-h-[calc(13.5px*1.35*3+2rem)] px-4 py-4 font-mono text-[13.5px] leading-[1.35] whitespace-pre-wrap break-all text-ink"
        >
          <div>
            <span className="text-ink-faint">{initialPrompt}</span>
            {DEMO_COMMAND.slice(0, typed)}
            {typing && <Cursor />}
          </div>
          {ran?.output ? <div className="text-ink-muted">{ran.output.trimEnd()}</div> : null}
          {ran && (
            <div>
              <span className="text-ink-faint">{ran.prompt}</span>
              <Cursor />
            </div>
          )}
        </div>
      </div>

      <figcaption className="mt-3 max-w-[62ch] text-xs text-ink-faint text-pretty">
        <span className="font-medium text-ink-muted">{t.figure}</span> {t.caption}
      </figcaption>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </figure>
  );
}

/** Cursor de bloque sin parpadeo, como el de la consola del lab. */
function Cursor() {
  return <span className="inline-block h-[1.1em] w-[0.6em] translate-y-[0.18em] bg-ink-muted" />;
}
