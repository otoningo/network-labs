import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReferenceSearch, type SearchEntry } from '@/components/reference/ReferenceSearch';
import { SiteShell } from '@/components/site/SiteShell';
import { RichText } from '@/components/ui/RichText';
import { fill, isLocale, LOCALES, messagesFor, plural } from '@/lib/i18n';
import { labById } from '@/lib/lab/content';
import { allTopics } from '@/lib/reference/content';
import { commandAnchor } from '@/lib/reference/text';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/referencia'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).reference;
  return { title: t.meta.title, description: t.meta.description };
}

/** Índice de la referencia: los temas en orden, como las filas de una hoja de ejercicios. */
export default async function ReferencePage({ params }: PageProps<'/[locale]/referencia'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = messagesFor(locale);
  const t = messages.reference;
  // El índice del buscador: cada comando ya en este idioma, con su ancla en el tema.
  const entries: SearchEntry[] = allTopics().flatMap((topic) =>
    topic.commands.map((command) => ({
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
          <h1 className="text-xl leading-tight font-semibold text-balance text-ink">{t.title}</h1>
          <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.intro}</p>

          <div className="mt-10">
            <ReferenceSearch entries={entries}>
              <h2 className="mt-12 text-sm font-semibold text-ink-muted">{t.topics}</h2>
              <ol className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 border-b border-rule sm:gap-x-5">
                {allTopics().map((topic) => {
                  const labs = topic.labs.flatMap((id) => {
                    const lab = labById(id);
                    return lab ? [{ id, order: lab.order, title: lab.title[locale] }] : [];
                  });
                  return (
                    <li
                      key={`${topic.vendor}-${topic.id}`}
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
                            href={`/${locale}/referencia/${topic.id}`}
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
        </div>
      </div>
    </SiteShell>
  );
}
