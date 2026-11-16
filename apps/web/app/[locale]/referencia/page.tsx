import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site/SiteShell';
import { isLocale, LOCALES, messagesFor, plural } from '@/lib/i18n';
import { pathTitle } from '@/lib/lab/path-text';
import { learningPaths } from '@/lib/lab/paths';
import { topicsOf } from '@/lib/reference/content';
import { SYSTEMS } from '@/lib/systems';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/referencia'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).reference;
  return { title: t.meta.title, description: t.meta.description };
}

/**
 * Aprender (D-046): primero se elige el sistema. Una fila por sistema, con lo
 * que cubre su referencia y la ruta de labs donde se practica.
 */
export default async function ReferencePage({ params }: PageProps<'/[locale]/referencia'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = messagesFor(locale);
  const t = messages.reference;
  const paths = learningPaths();

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14">
        <div className="max-w-3xl">
          <h1 className="text-xl leading-tight font-semibold text-balance text-ink">{t.title}</h1>
          <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.lead}</p>

          <h2 className="mt-10 text-sm font-semibold text-ink-muted">{t.chooseSystem}</h2>
          <ul className="mt-3 border-b border-rule">
            {SYSTEMS.map((system) => {
              const topics = topicsOf(system);
              const commands = topics.reduce((n, topic) => n + topic.commands.length, 0);
              const path = paths.find((p) => p.os === system);
              return (
                <li
                  key={system}
                  className="relative grid gap-x-8 gap-y-1 border-t border-rule py-6 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <h3 className="text-md font-semibold text-ink text-balance">
                      <Link
                        href={`/${locale}/referencia/${system}`}
                        className="underline decoration-control underline-offset-4 after:absolute after:inset-0 hover:decoration-ink"
                      >
                        {messages.systems.names[system]}
                      </Link>
                    </h3>
                    <p className="mt-1.5 max-w-[62ch] text-ink-muted text-pretty">
                      {t.blurb[system]}
                    </p>
                    {path && (
                      <p className="relative mt-2 text-xs text-ink-faint">
                        {t.practisedIn}{' '}
                        <Link
                          href={`/${locale}/rutas/${path.id}`}
                          className="text-ink-muted underline decoration-rule-strong underline-offset-4 hover:text-ink hover:decoration-ink"
                        >
                          {pathTitle(messages, path.id)}
                        </Link>
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-ink-faint tabular-nums sm:mt-1 sm:text-right">
                    {topics.length === 0 ? (
                      messages.paths.upcoming
                    ) : (
                      <>
                        <span className="whitespace-nowrap">
                          {plural(locale, t.topicCount, topics.length)}
                        </span>
                        <span aria-hidden className="mx-1.5">
                          ·
                        </span>
                        <span className="whitespace-nowrap">
                          {plural(locale, t.commands, commands)}
                        </span>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 text-sm">
            <Link
              href={`/${locale}/compara`}
              className="text-ink underline decoration-control underline-offset-[0.2em] hover:decoration-ink"
            >
              {t.compareLink}
            </Link>
          </p>
        </div>
      </div>
    </SiteShell>
  );
}
