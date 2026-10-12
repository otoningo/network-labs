'use client';

import { ArrowRight, Check } from '@phosphor-icons/react';
import Link from 'next/link';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { LabSummary } from '@/lib/lab/paths';
import { COMPARE_ROWS, type QuotedLine } from '@/lib/landing/demo';
import { useProgressSummary } from '@/lib/progress/summary';

/**
 * La hoja desplegada: dos páginas a cada lado de un pliegue central.
 * Aprender lleva a la referencia de comandos; Practicar, a los labs.
 */
export function LearnPractice({
  labs,
  topicCount,
  pathId,
}: {
  readonly labs: readonly LabSummary[];
  readonly topicCount: number;
  readonly pathId: string;
}) {
  return (
    <section className="on-cream washi-fiber">
      <div className="mx-auto grid max-w-7xl lg:grid-cols-2">
        <Learn topicCount={topicCount} />
        <Practice labs={labs} pathId={pathId} />
      </div>
    </section>
  );
}

function Verb({ id, children }: { readonly id: string; readonly children: string }) {
  return (
    <h2
      id={id}
      className="font-display text-[clamp(2.75rem,1.6rem+4.4vw,5rem)] leading-none font-light tracking-[-0.02em] text-(--washi)"
    >
      {children}
    </h2>
  );
}

function Quote({ lines }: { readonly lines: readonly QuotedLine[] }) {
  return (
    <pre className="rounded-[2px] bg-(--sumi) px-3 py-2.5 font-mono text-[0.78rem] leading-[1.5] text-(--fold-white)">
      {lines.map((line) => (
        <span
          key={`${line.prompt}${line.command}`}
          className="block whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          <span className="text-[#a39c92]">{line.prompt}</span>
          {line.command}
        </span>
      ))}
    </pre>
  );
}

function Learn({ topicCount }: { readonly topicCount: number }) {
  const { locale, messages } = useI18n();
  const t = messages.landing.learn;
  const rows = COMPARE_ROWS.filter((row) => row.id !== 'table');
  return (
    <article
      aria-labelledby="learn-heading"
      className="px-4 py-20 sm:px-8 lg:border-r lg:border-dashed lg:border-(--color-rule-strong) lg:py-28 lg:pr-14"
    >
      <Verb id="learn-heading">{t.title}</Verb>
      <p className="mt-6 max-w-[52ch] text-md text-ink-muted text-pretty">{t.lead}</p>
      <ol className="mt-10 space-y-6">
        {rows.map((row) => (
          <li key={row.id}>
            <p className="font-medium">{t.rows[row.id]}</p>
            <div className="mt-2 grid gap-2">
              <div className="min-w-0">
                <p className="fold-label mb-1 text-ink-faint">{t.ios}</p>
                <Quote lines={row.ios} />
              </div>
              <div className="min-w-0">
                <p className="fold-label mb-1 text-ink-faint">{t.routeros}</p>
                <Quote lines={row.routeros} />
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <Link
          href={`/${locale}/referencia`}
          className="group inline-flex items-center gap-2 font-medium underline decoration-(--washi) decoration-2 underline-offset-[6px]"
        >
          {t.cta}
          <ArrowRight
            size={16}
            weight="bold"
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
        <span className="text-sm text-ink-faint">{fill(t.count, { n: topicCount })}</span>
      </p>
    </article>
  );
}

function Practice({
  labs,
  pathId,
}: {
  readonly labs: readonly LabSummary[];
  readonly pathId: string;
}) {
  const { locale, messages } = useI18n();
  const t = messages.landing.practice;
  const { byLab } = useProgressSummary();
  return (
    <article aria-labelledby="practice-heading" className="px-4 pb-20 sm:px-8 lg:py-28 lg:pl-14">
      <Verb id="practice-heading">{t.title}</Verb>
      <p className="mt-6 max-w-[52ch] text-md text-ink-muted text-pretty">{t.lead}</p>
      <h3 className="fold-label mt-10 text-ink-faint">{t.path}</h3>
      <ol className="mt-3 border-t border-rule">
        {labs.map((lab) => {
          const status = byLab.get(lab.id);
          const finished = status?.finished === true;
          const inProgress = status !== undefined && !finished;
          return (
            <li
              key={lab.id}
              className="relative grid grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-b border-rule py-2.5"
            >
              <span
                aria-hidden
                className="font-display text-lg leading-none font-light text-ink-faint tabular-nums"
              >
                {lab.order}
              </span>
              <Link
                href={`/${locale}/lab/${lab.id}`}
                className="min-w-0 font-medium no-underline text-pretty after:absolute after:inset-0 hover:underline"
              >
                <span className="sr-only">{`${fill(messages.lab.labNumber, { n: lab.order })}. `}</span>
                {lab.title[locale]}
                {finished && <span className="sr-only">{`, ${t.done}`}</span>}
                {inProgress && (
                  <span className="block text-xs font-normal text-ink-muted sm:hidden">
                    {fill(messages.paths.inProgress, {
                      done: status.completed,
                      total: lab.objectives,
                    })}
                  </span>
                )}
              </Link>
              <span className="text-right text-xs whitespace-nowrap text-ink-faint">
                {inProgress && (
                  <span className="mr-2 hidden text-ink-muted sm:inline">
                    {fill(messages.paths.inProgress, {
                      done: status.completed,
                      total: lab.objectives,
                    })}
                  </span>
                )}
                {fill(t.minutes, { n: lab.minutes })}
              </span>
              <span
                aria-hidden
                className={`grid size-[18px] place-items-center self-center rounded-[2px] border ${
                  finished
                    ? 'border-(--washi) bg-(--washi) text-(--fold-white)'
                    : 'border-(--color-control) bg-(--washi-cream)'
                }`}
              >
                {finished && <Check size={12} weight="bold" />}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-10 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <Link
          href={`/${locale}/rutas/${pathId}`}
          className="group inline-flex items-center gap-2 font-medium underline decoration-(--washi) decoration-2 underline-offset-[6px]"
        >
          {t.cta}
          <ArrowRight
            size={16}
            weight="bold"
            aria-hidden
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
        <span className="text-sm text-ink-faint">{t.upcoming}</span>
      </p>
    </article>
  );
}
