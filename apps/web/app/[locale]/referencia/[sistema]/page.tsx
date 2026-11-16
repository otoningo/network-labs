import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ReferenceSearch, type SearchEntry } from '@/components/reference/ReferenceSearch';
import { SiteShell } from '@/components/site/SiteShell';
import { SystemLinks } from '@/components/site/SystemSwitch';
import { RichText } from '@/components/ui/RichText';
import { fill, isLocale, LOCALES, messagesFor, plural } from '@/lib/i18n';
import { labById } from '@/lib/lab/content';
import { pathTitle } from '@/lib/lab/path-text';
import { learningPaths } from '@/lib/lab/paths';
import { topicsOf } from '@/lib/reference/content';
import { commandAnchor } from '@/lib/reference/text';
import { isSystem, SYSTEMS, topicHref } from '@/lib/systems';

/**
 * Antes de D-046 la referencia era solo de RouterOS y sus temas vivían en
 * /referencia/<tema>; esas direcciones siguen llevando a su tema.
 */
const LEGACY_TOPICS = () => topicsOf('routeros').map((t) => t.id);

export const generateStaticParams = () =>
  LOCALES.flatMap((locale) =>
    [...SYSTEMS, ...LEGACY_TOPICS()].map((sistema) => ({ locale, sistema })),
  );
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/referencia/[sistema]'>): Promise<Metadata> {
  const { locale, sistema } = await params;
  if (!isLocale(locale) || !isSystem(sistema)) return {};
  const messages = messagesFor(locale);
  const name = messages.systems.names[sistema];
  return {
    title: fill(messages.reference.meta.systemTitle, { system: name }),
    description: messages.reference.intro[sistema],
  };
}

/** Índice de la referencia de un sistema: los temas en orden, como las filas de una hoja de ejercicios. */
export default async function SystemReferencePage({
  params,
}: PageProps<'/[locale]/referencia/[sistema]'>) {
  const { locale, sistema } = await params;
  if (!isLocale(locale)) notFound();
  if (!isSystem(sistema)) {
    if (LEGACY_TOPICS().includes(sistema))
      permanentRedirect(topicHref(locale, 'routeros', sistema));
    notFound();
  }
  const messages = messagesFor(locale);
  const t = messages.reference;
  const topics = topicsOf(sistema);
  const path = learningPaths().find((p) => p.os === sistema);
  // El índice del buscador: cada comando ya en este idioma, con su ancla en el tema.
  const entries: SearchEntry[] = topics.flatMap((topic) =>
    topic.commands.map((command) => ({
      system: topic.vendor,
      topicId: topic.id,
      topicOrder: topic.order,
      topicTitle: topic.title[locale],
      anchor: commandAnchor(command.id),
      syntax: command.syntax,
      summary: command.summary[locale],
      ios: command.ios ?? null,
    })),
  );

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14">
        <div className="max-w-3xl">
          <h1 className="text-xl leading-tight font-semibold text-balance text-ink">
            {fill(t.systemHeading, { system: messages.systems.names[sistema] })}
          </h1>
          <SystemLinks current={sistema} base={`/${locale}/referencia`} className="mt-6" />
          <p className="mt-6 max-w-[62ch] text-ink-muted text-pretty">{t.intro[sistema]}</p>
          <p className="mt-3 text-sm">
            <Link
              href={`/${locale}/compara`}
              className="text-ink underline decoration-control underline-offset-[0.2em] hover:decoration-ink"
            >
              {t.compareLink}
            </Link>
          </p>

          {topics.length === 0 ? (
            <div className="mt-10 border-t border-rule pt-6">
              <p className="max-w-[62ch] text-ink text-pretty">
                {fill(t.preparing, { system: messages.systems.names[sistema] })}
              </p>
              {path && (
                <p className="mt-3 text-sm">
                  <Link
                    href={`/${locale}/rutas/${path.id}`}
                    className="text-ink underline decoration-control underline-offset-[0.2em] hover:decoration-ink"
                  >
                    {fill(t.preparingPath, { path: pathTitle(messages, path.id) })}
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <div className="mt-10">
              <ReferenceSearch entries={entries} system={sistema}>
                <h2 className="mt-12 text-sm font-semibold text-ink-muted">{t.topics}</h2>
                <ol className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 border-b border-rule sm:gap-x-5">
                  {topics.map((topic) => {
                    const labs = topic.labs.flatMap((id) => {
                      const lab = labById(id);
                      return lab ? [{ id, order: lab.order, title: lab.title[locale] }] : [];
                    });
                    return (
                      <li
                        key={topic.id}
                        className="col-span-full grid grid-cols-subgrid items-start border-t border-rule py-5"
                      >
                        <span
                          aria-hidden
                          className="-mt-1.5 min-w-[2ch] text-right text-numeral leading-none font-light tabular-nums text-ink-faint"
                        >
                          {topic.order}
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-base font-medium text-ink text-pretty">
                            <Link
                              href={topicHref(locale, sistema, topic.id)}
                              className="no-underline hover:underline"
                            >
                              {topic.title[locale]}
                            </Link>
                          </h3>
                          <p className="mt-1 max-w-[62ch] text-sm text-ink-muted text-pretty">
                            <RichText text={topic.summary[locale]} />
                          </p>
                          <p className="mt-2 text-xs text-ink-faint">
                            <span className="whitespace-nowrap">
                              {plural(locale, t.commands, topic.commands.length)}
                            </span>
                            {labs.length > 0 && (
                              <>
                                <span aria-hidden className="mx-1.5">
                                  ·
                                </span>
                                <span className="sr-only">. </span>
                                {t.practisedIn}{' '}
                                {labs.map((lab, index) => (
                                  <span key={lab.id} className="whitespace-nowrap">
                                    {index > 0 && ', '}
                                    <Link
                                      href={`/${locale}/lab/${lab.id}`}
                                      aria-label={
                                        lab.order === undefined
                                          ? lab.title
                                          : `${fill(messages.lab.labNumber, { n: lab.order })}. ${lab.title}`
                                      }
                                      className="text-ink-muted underline decoration-rule-strong underline-offset-4 hover:text-ink hover:decoration-ink"
                                    >
                                      {lab.order === undefined
                                        ? lab.title
                                        : fill(messages.lab.labNumber, { n: lab.order })}
                                    </Link>
                                  </span>
                                ))}
                              </>
                            )}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </ReferenceSearch>
            </div>
          )}
        </div>
      </div>
    </SiteShell>
  );
}
