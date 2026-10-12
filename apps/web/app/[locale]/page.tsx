import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FoldJourney } from '@/components/landing/FoldJourney';
import { HeroActions } from '@/components/landing/HeroActions';
import { HeroSteps } from '@/components/landing/HeroSteps';
import { LearnPractice } from '@/components/landing/LearnPractice';
import { SheetConsole } from '@/components/landing/SheetConsole';
import { SiteShell } from '@/components/site/SiteShell';
import { isLocale, messagesFor } from '@/lib/i18n';
import { learningPaths } from '@/lib/lab/paths';
import { computeJourney, demoLab } from '@/lib/landing/journey';
import { allTopics, sandboxLab } from '@/lib/reference/content';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).landing.meta;
  return { title: t.title, description: t.description };
}

/**
 * Portada (D-041): la grulla plegada. Una hoja bermellón con el router de
 * práctica en vivo; al bajar, esa hoja se pliega en el paquete y recorre la
 * red que calcula el motor; al llegar se despliega en Aprender y Practicar.
 * Todo lo que muestra sale del motor al compilar o en el navegador.
 */
export default async function LocaleHome({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messagesFor(locale).landing;
  const path = learningPaths()[0];
  if (!path) throw new Error('content/labs no tiene una ruta con labs');
  const sandbox = sandboxLab('routeros');
  const journey = computeJourney(sandbox);

  return (
    <SiteShell variant="landing">
      <section aria-labelledby="hero-heading" className="on-washi washi-fiber bg-(--washi-deep)!">
        <div className="mx-auto grid max-w-7xl gap-x-12 gap-y-14 px-4 pt-14 pb-20 sm:px-8 lg:min-h-[calc(100dvh-var(--bar-height))] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_11rem] lg:items-center lg:pt-10 lg:pb-16">
          <div className="min-w-0 @container">
            <h1
              id="hero-heading"
              className="font-display text-[clamp(2.4rem,1.5rem+3.2vw,4.25rem)] leading-[1.06] font-light tracking-[-0.025em] text-balance lg:text-[min(3.5rem,calc(100cqi/12.4))] lg:whitespace-nowrap"
            >
              <span className="block">{t.hero.title}</span>
              <span className="block font-normal">{t.hero.title2}</span>
            </h1>
            <p className="mt-7 max-w-[46ch] text-md text-pretty">{t.hero.lead}</p>
            <HeroActions
              labs={path.labs.map((l) => ({ id: l.id, order: l.order, title: l.title }))}
            />
          </div>
          <div className="flex min-w-0 justify-center">
            <SheetConsole lab={demoLab(sandbox)} />
          </div>
          <nav aria-label={t.nav} className="hidden lg:block">
            <HeroSteps journey={journey} />
          </nav>
        </div>
      </section>

      <FoldJourney journey={journey} />

      <LearnPractice labs={path.labs} topicCount={allTopics().length} pathId={path.id} />

      <section aria-labelledby="close-heading" className="on-washi washi-fiber">
        <div className="mx-auto grid max-w-7xl items-end gap-10 px-4 py-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h2
              id="close-heading"
              className="font-display text-[clamp(2.25rem,1.4rem+3.4vw,4rem)] leading-[1.05] font-light tracking-[-0.02em] text-balance"
            >
              {t.close.title}
            </h2>
            <p className="mt-5 max-w-[52ch] text-md text-pretty">{t.close.lead}</p>
          </div>
          <Link
            href={`/${locale}/lab/${path.labs[0]?.id ?? ''}`}
            className="inline-flex h-12 items-center gap-3 self-end rounded-[2px] border border-(--fold-white) px-5 font-medium no-underline transition-colors hover:bg-(--fold-white) hover:text-(--sumi)"
          >
            {t.hero.start}
          </Link>
        </div>
      </section>
    </SiteShell>
  );
}
