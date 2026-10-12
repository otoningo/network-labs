'use client';

import type { LabDefinition } from '@nos/core';
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText } from '@/components/ui/RichText';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { describeEvidence, evidenceOf } from '@/lib/lab/evidence';
import { createLabStore, type ObjectiveState } from '@/lib/lab/store';
import { DEMO_COMMAND, DEMO_OBJECTIVE } from '@/lib/landing/demo';

/** Pausas del tecleo, en ms: arranque, cada carácter (con un vaivén fijo) y antes de Enter. */
const START_DELAY = 900;
const KEY_DELAY = 34;
const KEY_SWING = [0, 18, 4, 26, 10, 0, 22, 6];
const ENTER_DELAY = 420;

interface Ran {
  readonly output: string;
  readonly prompt: string;
  readonly state: ObjectiveState;
  readonly evidence: readonly string[];
}

/**
 * La hoja del hero: un cuadrado de washi con sus guías de pliegue y, escrito
 * en él, el router de práctica en vivo. Se teclea la regla de NAT, el motor la
 * ejecuta y la tarea se marca porque la PC ya sale con la IP pública. Es la
 * misma hoja que, al bajar, se pliega y viaja.
 */
export function SheetConsole({ lab }: { readonly lab: LabDefinition }) {
  const { locale, messages } = useI18n();
  const t = messages.landing.sheet;
  const [store] = useState(() => createLabStore(lab));
  const [initialPrompt] = useState(() => store.getState().prompt());
  const device = store.getState().activeDevice;
  const objective = lab.objectives.find((o) => o.id === DEMO_OBJECTIVE);

  const [typed, setTyped] = useState(0);
  const [ran, setRan] = useState<Ran | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const root = useRef<HTMLElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const execute = useCallback(() => {
    const result = store.getState().run(DEMO_COMMAND);
    const state = store.getState().objectives[DEMO_OBJECTIVE] ?? 'pending';
    const evidence = evidenceOf(store.getState(), DEMO_OBJECTIVE).map((e) =>
      describeEvidence(e, messages),
    );
    setTyped(DEMO_COMMAND.length);
    setRan({ output: result.output, prompt: store.getState().prompt(), state, evidence });
    if (state === 'done') setAnnouncement(fill(t.result, { evidence: evidence.join('; ') }));
  }, [store, messages, t.result]);

  const play = useCallback(() => {
    stop();
    store.getState().reset();
    setRan(null);
    setTyped(0);
    setAnnouncement('');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      execute();
      return;
    }
    let at = START_DELAY;
    for (let i = 1; i <= DEMO_COMMAND.length; i += 1) {
      at += KEY_DELAY + (KEY_SWING[i % KEY_SWING.length] ?? 0);
      timers.current.push(setTimeout(() => setTyped(i), at));
    }
    timers.current.push(setTimeout(execute, at + ENTER_DELAY));
  }, [stop, store, execute]);

  // Se escribe una vez, cuando la hoja entra en pantalla.
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
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [play, stop]);

  if (!objective) return null;
  const state = ran?.state ?? 'pending';
  const done = state === 'done';

  return (
    <figure
      ref={root}
      aria-label={fill(t.label, { device })}
      className="relative m-0 min-h-[24rem] w-full max-w-[34rem] washi-fiber bg-(--washi) shadow-[0_24px_48px_rgb(60_8_4/0.45)] sm:aspect-square sm:min-h-0"
    >
      <CreaseGuides />
      <p className="sr-only">{fill(t.described, { device, command: DEMO_COMMAND })}</p>

      <div className="relative flex h-full flex-col p-[7%]">
        {/* La tarea, con su casilla. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <p className="text-base text-pretty">
            <span className="sr-only">{`${messages.lab.status[state]}. `}</span>
            <RichText text={objective.text[locale]} />
          </p>
          <span
            aria-hidden
            className={`mt-0.5 grid size-5 place-items-center rounded-[2px] border transition-colors duration-500 ${
              done
                ? 'border-(--fold-white) bg-(--fold-white) text-(--sumi)'
                : 'border-(--fold-white)'
            }`}
          >
            {done && <Check size={14} weight="bold" />}
          </span>
        </div>
        <dl className="mt-1 min-h-[1.5em] text-xs">
          <dt className="sr-only">{messages.lab.evidence.label}</dt>
          {(ran?.evidence ?? []).map((line) => (
            <dd key={line} className="tabular-nums">
              {line}
            </dd>
          ))}
        </dl>

        {/* La consola, en tinta sobre el papel. */}
        <div
          aria-hidden
          className="mt-auto font-mono text-[0.8125rem] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          <p>
            <span>{initialPrompt}</span>
            {DEMO_COMMAND.slice(0, typed)}
            {ran === null && (
              <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-(--fold-white)" />
            )}
          </p>
          {ran?.output && <p>{ran.output}</p>}
          {ran && (
            <p>
              <span>{ran.prompt}</span>
              <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-(--fold-white)" />
            </p>
          )}
        </div>

        <figcaption className="mt-5 flex items-end justify-between gap-4 border-t border-(--crease) pt-3">
          <span className="max-w-[40ch] text-xs text-pretty">{t.caption}</span>
          <button
            type="button"
            onClick={play}
            aria-label={t.replayLabel}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] px-1 py-0.5 text-xs hover:underline"
          >
            <ArrowCounterClockwise size={14} weight="bold" aria-hidden />
            {t.replay}
          </button>
        </figcaption>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </figure>
  );
}

/** Las guías de pliegue del cuadrado: diagonales, medianas y el cuadrado interior. */
function CreaseGuides() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <g stroke="var(--crease)" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
        <path
          d="M0 0 L100 100 M100 0 L0 100 M50 0 L50 100 M0 50 L100 50"
          vectorEffect="non-scaling-stroke"
        />
        <path d="M50 0 L100 50 L50 100 L0 50 Z" vectorEffect="non-scaling-stroke" />
        <path
          d="M25 0 L25 100 M75 0 L75 100"
          strokeDasharray="1.5 1.5"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}
