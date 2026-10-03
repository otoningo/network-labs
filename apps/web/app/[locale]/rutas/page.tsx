import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PathIndexAction } from '@/components/paths/PathIndexAction';
import { PathMeta } from '@/components/paths/PathMeta';
import { SiteShell } from '@/components/site/SiteShell';
import { fill, isLocale, LOCALES, messagesFor } from '@/lib/i18n';
import { pathDescription, pathTitle } from '@/lib/lab/path-text';
import { learningPaths, UPCOMING_PATHS } from '@/lib/lab/paths';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/rutas'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).paths;
  return { title: t.meta.title, description: t.meta.description };
}

/** Índice de rutas: las publicadas con su progreso en este navegador y, debajo, las que vienen. */
export default async function PathsPage({ params }: PageProps<'/[locale]/rutas'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = messagesFor(locale);
  const t = messages.paths;

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14">
        <div className="max-w-3xl">
          <h1 className="text-xl leading-tight font-semibold text-balance text-ink">{t.title}</h1>
          <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.intro}</p>

          <ul className="mt-10 border-b border-rule">
            {learningPaths().map((path) => {
              const description = pathDescription(messages, path.id);
              return (
                <li key={path.id} className="border-t border-rule py-6">
                  <div className="min-w-0">
                    <h2 className="text-md font-semibold text-ink text-balance">
                      <Link
                        href={`/${locale}/rutas/${path.id}`}
                        className="underline decoration-control underline-offset-4 hover:decoration-ink"
                      >
                        {pathTitle(messages, path.id)}
                      </Link>
                    </h2>
                    {description && (
                      <p className="mt-1.5 max-w-[62ch] text-ink-muted text-pretty">
                        {description}
                      </p>
                    )}
                    <PathMeta locale={locale} path={path} className="mt-2" />
                    <PathIndexAction labs={path.labs} />
                  </div>
                </li>
              );
            })}
            {UPCOMING_PATHS.map((path) => (
              <li
                key={path.id}
                className="grid gap-x-8 gap-y-1 border-t border-rule py-6 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <h2 className="text-md font-semibold text-ink-muted text-balance">
                    {pathTitle(messages, path.id)}
                  </h2>
                  <p className="mt-2 text-xs text-ink-faint">
                    {fill(t.practise, { os: t.os[path.os] })}
                  </p>
                </div>
                <p className="text-sm text-ink-faint sm:mt-1 sm:text-right">{t.upcoming}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SiteShell>
  );
}
