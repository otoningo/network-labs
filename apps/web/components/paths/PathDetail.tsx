'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { StatusBox } from '@/components/lab/worksheet/StatusBox';
import { RichText } from '@/components/ui/RichText';
import { fill, plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { LabSummary, LearningPath } from '@/lib/lab/paths';
import { finishedCount, hasPathProgress, labRowState, pathAction } from '@/lib/progress/path';
import { browserRepository } from '@/lib/progress/repository';
import { useProgressSummary } from '@/lib/progress/summary';
import { Dot } from './Dot';
import { PathActionLink } from './PathActionLink';

/**
 * Cuerpo de la página de una ruta: la acción principal (empezar o continuar),
 * la lista de labs con su casilla y el borrado del progreso de la ruta.
 * Todo lo que depende del progreso espera a leer el almacenamiento.
 */
export function PathDetail({ path }: { readonly path: LearningPath }) {
  const { locale, messages } = useI18n();
  const t = messages.paths;
  const { loaded, byLab, refresh } = useProgressSummary();
  const labs = path.labs;
  const action = pathAction(labs, byLab);
  const progress = loaded && hasPathProgress(labs, byLab);
  const actionRef = useRef<HTMLAnchorElement>(null);
  const [message, setMessage] = useState('');

  const clearPath = async () => {
    const repo = browserRepository();
    await Promise.all(labs.map((lab) => repo.clear(lab.id)));
    refresh();
    setMessage(t.reset.done);
    // La sección de borrado desaparece: el foco pasa a la acción principal, que vuelve a "Empezar".
    actionRef.current?.focus();
  };

  return (
    <>
      {action && (
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <PathActionLink ref={actionRef} labs={labs} byLab={byLab} loaded={loaded} />
          <p className={`text-sm text-ink-muted tabular-nums ${loaded ? '' : 'invisible'}`}>
            {plural(locale, t.finished, labs.length, {
              done: loaded ? finishedCount(labs, byLab) : 0,
            })}
          </p>
        </div>
      )}

      <h2 className="mt-12 text-sm font-semibold text-ink-muted">{t.labs}</h2>
      <ol className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 border-b border-rule sm:gap-x-5">
        {labs.map((lab) => (
          <LabRow
            key={lab.id}
            lab={lab}
            loaded={loaded}
            state={labRowState(lab, byLab.get(lab.id))}
          />
        ))}
      </ol>

      {progress && <ResetPath onConfirm={clearPath} />}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
    </>
  );
}

/** Una fila de la lista, con la forma de la fila de tarea de la hoja: numeral, texto y casilla. */
function LabRow({
  lab,
  loaded,
  state,
}: {
  readonly lab: LabSummary;
  readonly loaded: boolean;
  readonly state: ReturnType<typeof labRowState>;
}) {
  const { locale, messages } = useI18n();
  const t = messages.paths;
  return (
    <li className="col-span-full grid grid-cols-subgrid items-start border-t border-rule py-5">
      <span
        aria-hidden
        className="-mt-1.5 text-right text-numeral leading-none font-light tabular-nums text-ink-faint"
      >
        {lab.order}
      </span>

      <div className="min-w-0">
        <h3 className="text-base font-medium text-ink text-pretty">
          <Link href={`/${locale}/lab/${lab.id}`} className="no-underline hover:underline">
            <span className="sr-only">{`${fill(messages.lab.labNumber, { n: lab.order })}. `}</span>
            {lab.title[locale]}
          </Link>
        </h3>
        <p className="mt-1 max-w-[62ch] text-sm text-ink-muted text-pretty">
          <RichText text={lab.summary[locale]} />
        </p>
        <p className="mt-2 text-xs text-ink-faint">
          {messages.lab.difficulty[lab.difficulty]}
          <Dot />
          {fill(messages.lab.minutes, { n: lab.minutes })}
          <Dot />
          {plural(locale, t.objectives, lab.objectives)}
          {state.kind === 'in-progress' && (
            <>
              <Dot />
              <span className="whitespace-nowrap text-ink-muted">
                {fill(t.inProgress, { done: state.completed, total: state.total })}
              </span>
            </>
          )}
          {loaded && state.kind !== 'in-progress' && (
            <span className="sr-only">{`. ${state.kind === 'done' ? t.status.done : t.status.notStarted}`}</span>
          )}
        </p>
      </div>

      <StatusBox state={state.kind === 'done' ? 'done' : 'pending'} live={false} />
    </li>
  );
}

/** Borrar el progreso de la ruta pide confirmación en el sitio, sin ventana modal. */
function ResetPath({ onConfirm }: { readonly onConfirm: () => Promise<void> }) {
  const { messages } = useI18n();
  const t = messages.paths.reset;
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Al cancelar, el foco vuelve al botón que abrió la confirmación.
  useEffect(() => {
    if (!confirming && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  const cancel = () => {
    returnFocus.current = true;
    setConfirming(false);
  };

  return (
    <div className="mt-10">
      {confirming ? (
        <fieldset onKeyDown={(e) => e.key === 'Escape' && cancel()} className="min-w-0 text-sm">
          {/* float + w-full: la leyenda se comporta como un párrafo y no se monta en el borde. */}
          <legend className="float-left w-full max-w-[62ch] text-ink-muted text-pretty">
            {t.confirm}
          </legend>
          <div className="clear-both flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: el foco va a la acción que se acaba de pedir confirmar
              autoFocus
              onClick={() => void onConfirm()}
              className="min-h-11 rounded-sm border border-error px-3 text-error transition-colors hover:bg-error-quiet lg:min-h-8"
            >
              {t.confirmButton}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="min-h-11 rounded-sm px-2 text-ink-muted transition-colors hover:text-ink lg:min-h-8"
            >
              {t.cancel}
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          ref={trigger}
          type="button"
          onClick={() => setConfirming(true)}
          className="-ml-0.5 min-h-11 rounded-sm px-0.5 text-sm text-ink-muted transition-colors hover:text-ink lg:min-h-8"
        >
          {t.action}
        </button>
      )}
    </div>
  );
}
