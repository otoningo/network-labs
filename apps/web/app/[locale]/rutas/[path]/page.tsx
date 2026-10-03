import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PathDetail } from '@/components/paths/PathDetail';
import { PathMeta } from '@/components/paths/PathMeta';
import { SiteShell } from '@/components/site/SiteShell';
import { fill, isLocale, LOCALES, messagesFor } from '@/lib/i18n';
import { pathDescription, pathTitle } from '@/lib/lab/path-text';
import { learningPaths, pathById } from '@/lib/lab/paths';

export const generateStaticParams = () =>
  LOCALES.flatMap((locale) => learningPaths().map((path) => ({ locale, path: path.id })));
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/rutas/[path]'>): Promise<Metadata> {
  const { locale, path: id } = await params;
  const path = pathById(id);
  if (!path || !isLocale(locale)) return {};
  const messages = messagesFor(locale);
  const description = pathDescription(messages, path.id);
  return {
    title: fill(messages.paths.meta.pathTitle, { title: pathTitle(messages, path.id) }),
    ...(description === undefined ? {} : { description }),
  };
}

/** Una ruta: qué sabrás hacer al terminarla, por dónde seguir y sus labs en orden. */
export default async function PathPage({ params }: PageProps<'/[locale]/rutas/[path]'>) {
  const { locale, path: id } = await params;
  const path = pathById(id);
  if (!path || !isLocale(locale)) notFound();
  const messages = messagesFor(locale);
  const description = pathDescription(messages, path.id);

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14">
        <div className="max-w-3xl">
          <header>
            <h1 className="text-xl leading-tight font-semibold text-balance text-ink">
              {pathTitle(messages, path.id)}
            </h1>
            {description && (
              <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{description}</p>
            )}
            <PathMeta locale={locale} path={path} className="mt-3" />
          </header>
          <PathDetail path={path} />
        </div>
      </div>
    </SiteShell>
  );
}
