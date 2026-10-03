import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Compare } from '@/components/landing/Compare';
import { EngineDemo } from '@/components/landing/EngineDemo';
import { HeroActions } from '@/components/landing/HeroActions';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { PathList } from '@/components/landing/PathList';
import { SiteShell } from '@/components/site/SiteShell';
import { fill, isLocale, type Messages, messagesFor } from '@/lib/i18n';
import { labById } from '@/lib/lab/content';
import { type LearningPath, learningPaths, UPCOMING_PATHS } from '@/lib/lab/paths';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).landing.meta;
  return { title: t.title, description: t.description };
}

/**
 * Portada: qué es, por qué importa y qué hacer, con una tarea del lab 1
 * resuelta en vivo por el motor real. Se genera estática para cada idioma;
 * lo que depende del progreso guardado se completa en el cliente.
 */
export default async function LocaleHome({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = messagesFor(locale);
  const t = messages.landing;
  const path = learningPaths()[0];
  const first = path?.labs[0];
  // Al cliente llega la definición completa del lab 1: la demostración arranca su motor.
  const lab = first ? labById(first.id) : undefined;
  if (!path || !lab) throw new Error('content/labs no tiene una ruta con labs');

  return (
    <SiteShell>
      <section aria-labelledby="hero-heading">
        <div className="mx-auto grid max-w-6xl gap-x-16 gap-y-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-24 lg:pb-24">
          <div className="min-w-0">
            <h1
              id="hero-heading"
              className="max-w-[24ch] text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] leading-[1.15] font-semibold tracking-[-0.02em] text-balance text-ink"
            >
              {t.hero.title} <span className="text-ink-muted">{t.hero.later}</span>
            </h1>
            <p className="mt-5 max-w-[52ch] text-md text-ink-muted text-pretty">{t.hero.lead}</p>
            <HeroActions
              pathId={path.id}
              labs={path.labs.map((l) => ({ id: l.id, order: l.order, title: l.title }))}
            />
          </div>
          <div className="min-w-0 lg:pt-2">
            <EngineDemo lab={lab} />
          </div>
        </div>
      </section>

      <Compare messages={messages} />
      <PathSection path={path} messages={messages} />
      <HowItWorks messages={messages} />
    </SiteShell>
  );
}

/** La ruta inicial completa y, debajo, las que están en preparación. */
function PathSection({
  path,
  messages,
}: {
  readonly path: LearningPath;
  readonly messages: Messages;
}) {
  const t = messages.landing.path;
  const name = (messages.lab.paths as Record<string, string>)[path.id] ?? path.id;
  const minutes = path.labs.map((l) => l.minutes);
  const upcomingNames = t.os as Record<string, string>;
  return (
    <section aria-labelledby="path-heading" className="border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-x-16 gap-y-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:py-24">
        <div className="min-w-0">
          <h2 id="path-heading" className="text-lg font-semibold text-balance text-ink">
            {name}
          </h2>
          <p className="mt-3 max-w-[48ch] text-ink-muted text-pretty">
            {fill(t.lead, {
              n: path.labs.length,
              min: Math.min(...minutes),
              max: Math.max(...minutes),
            })}
          </p>
          <h3 className="mt-10 text-sm font-semibold text-ink-muted">{t.upcomingTitle}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {UPCOMING_PATHS.map((upcoming) => (
              <li key={upcoming.id}>
                <span className="text-ink-muted">{upcomingNames[upcoming.os] ?? upcoming.os}</span>
                <span aria-hidden className="mx-1.5 text-ink-faint">
                  ·
                </span>
                <span className="text-ink-faint">{t.upcoming}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <PathList labs={path.labs} />
        </div>
      </div>
    </section>
  );
}
