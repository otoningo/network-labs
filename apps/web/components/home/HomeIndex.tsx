'use client';

import type { LocalizedText } from '@nos/core';
import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ICON_WEIGHT, StatusBox } from '@/components/lab/worksheet/StatusBox';
import { SystemTabs } from '@/components/site/SystemSwitch';
import { fill, plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { LabSummary } from '@/lib/lab/paths';
import { useProgressSummary } from '@/lib/progress/summary';
import { usePreferredSystem } from '@/lib/system-preference';
import { type SystemId, topicHref } from '@/lib/systems';

export interface HomeTopic {
  readonly id: string;
  readonly order: number;
  readonly title: LocalizedText;
  readonly commands: number;
}

/** Lo que la portada enseña de un sistema: su referencia y su ruta de labs. */
export interface HomeSystem {
  readonly id: SystemId;
  readonly topics: readonly HomeTopic[];
  readonly path: { readonly id: string; readonly labs: readonly LabSummary[] } | null;
}

const PANEL_ID = 'home-system-panel';

/**
 * Los dos capítulos del cuaderno, lado a lado: Aprender (los temas de la
 * referencia) y Practicar (los labs de la ruta, con su casilla), del sistema
 * elegido en las pestañas de arriba (D-046). La portada abre en el último
 * sistema que eligió el estudiante. Un filete vertical separa los capítulos
 * desde 1024px; en el teléfono van uno debajo del otro.
 */
export function HomeIndex({ systems }: { readonly systems: readonly HomeSystem[] }) {
  const preferred = usePreferredSystem();
  const [chosen, setChosen] = useState<SystemId | null>(null);
  const current = systems.find((s) => s.id === (chosen ?? preferred)) ?? systems[0];
  if (!current) return null;
  return (
    <div className="border-t border-rule pt-8">
      <SystemTabs value={current.id} onChange={setChosen} panelId={PANEL_ID} />
      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`system-tab-${current.id}`}
        className="grid lg:grid-cols-2"
      >
        <Learn system={current} />
        <Practice system={current} />
      </div>
    </div>
  );
}

function Chapter({
  id,
  title,
  lead,
  children,
  more,
  className = '',
}: {
  readonly id: string;
  readonly title: string;
  readonly lead: string;
  readonly children: ReactNode;
  readonly more: ReactNode;
  readonly className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`min-w-0 pt-12 pb-14 ${className}`}>
      <h2 id={id} className="text-lg leading-tight font-semibold text-ink">
        {title}
      </h2>
      <p className="mt-2 max-w-[52ch] text-ink-muted text-pretty">{lead}</p>
      {children}
      <div className="mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">{more}</div>
    </section>
  );
}

function MoreLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 font-medium text-ink underline decoration-control underline-offset-[0.2em] hover:decoration-ink"
    >
      {children}
      <ArrowRight
        size={15}
        weight={ICON_WEIGHT}
        aria-hidden
        className="transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** Fila compacta del índice: numeral ligero, título que es todo el enlace y un dato a la derecha. */
const ROW =
  'relative col-span-full grid grid-cols-subgrid items-baseline border-t border-rule py-2.5';
const NUMERAL =
  'min-w-[2ch] text-right text-lg leading-none font-light tabular-nums text-ink-faint';
const TITLE =
  'min-w-0 font-medium text-ink no-underline text-pretty after:absolute after:inset-0 hover:underline';

function Learn({ system }: { readonly system: HomeSystem }) {
  const { locale, messages } = useI18n();
  const t = messages.home.learn;
  const { topics } = system;
  return (
    <Chapter
      id="learn-heading"
      title={t.title}
      lead={t.lead[system.id]}
      className="lg:border-r lg:border-rule lg:pr-10"
      more={
        <>
          {topics.length > 0 && (
            <MoreLink href={`/${locale}/referencia/${system.id}`}>{t.cta}</MoreLink>
          )}
          <Link
            href={`/${locale}/compara`}
            className="text-ink-muted underline decoration-rule-strong underline-offset-[0.2em] hover:text-ink hover:decoration-ink"
          >
            {t.compare}
          </Link>
        </>
      }
    >
      {topics.length === 0 ? (
        <p className="mt-6 max-w-[52ch] border-t border-rule pt-4 text-sm text-ink-muted text-pretty">
          {fill(t.empty, { system: messages.systems.names[system.id] })}
        </p>
      ) : (
        <ol className="mt-6 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 border-b border-rule">
          {topics.map((topic) => (
            <li key={topic.id} className={ROW}>
              <span aria-hidden className={NUMERAL}>
                {topic.order}
              </span>
              <Link href={topicHref(locale, system.id, topic.id)} className={TITLE}>
                {topic.title[locale]}
              </Link>
              <span className="text-right text-xs whitespace-nowrap text-ink-faint">
                {plural(locale, messages.reference.commands, topic.commands)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Chapter>
  );
}

function Practice({ system }: { readonly system: HomeSystem }) {
  const { locale, messages } = useI18n();
  const t = messages.home.practice;
  const { byLab } = useProgressSummary();
  const nameOf = (id: string) => (messages.lab.paths as Record<string, string>)[id] ?? id;
  const labs = system.path?.labs ?? [];
  const pathId = system.path?.id;
  return (
    <Chapter
      id="practice-heading"
      title={t.title}
      lead={pathId ? fill(t.lead, { path: nameOf(pathId) }) : messages.paths.upcoming}
      className="border-t border-rule lg:border-t-0 lg:pl-10"
      more={
        <>
          {pathId && <MoreLink href={`/${locale}/rutas/${pathId}`}>{t.cta}</MoreLink>}
          <Link
            href={`/${locale}/rutas`}
            className="text-ink-muted underline decoration-rule-strong underline-offset-[0.2em] hover:text-ink hover:decoration-ink"
          >
            {t.allPaths}
          </Link>
          <span className="text-ink-faint">{t.upcoming}</span>
        </>
      }
    >
      <ol className="mt-6 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-4 border-b border-rule">
        {labs.map((lab) => {
          const status = byLab.get(lab.id);
          const finished = status?.finished === true;
          // A medias: el mismo aviso que en la página de la ruta, para que cuadre con "Continuar".
          const inProgress = status !== undefined && !finished;
          const progress = inProgress
            ? fill(messages.paths.inProgress, { done: status.completed, total: lab.objectives })
            : '';
          return (
            <li key={lab.id} className={ROW}>
              <span aria-hidden className={NUMERAL}>
                {lab.order}
              </span>
              <Link href={`/${locale}/lab/${lab.id}`} className={TITLE}>
                <span className="sr-only">{`${fill(messages.lab.labNumber, { n: lab.order })}. `}</span>
                {lab.title[locale]}
                {finished && <span className="sr-only">{`, ${t.done}`}</span>}
                {inProgress && (
                  <span className="block text-xs font-normal text-ink-muted sm:hidden">
                    {progress}
                  </span>
                )}
              </Link>
              <span className="text-right text-xs whitespace-nowrap text-ink-faint">
                {inProgress && (
                  <span className="mr-2 hidden text-ink-muted sm:inline">{progress}</span>
                )}
                {fill(messages.lab.minutes, { n: lab.minutes })}
              </span>
              <span className="self-center">
                <StatusBox state={finished ? 'done' : 'pending'} live={false} />
              </span>
            </li>
          );
        })}
      </ol>
    </Chapter>
  );
}
