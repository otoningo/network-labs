import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeActions } from '@/components/home/HomeActions';
import { HomeIndex } from '@/components/home/HomeIndex';
import { Translator } from '@/components/home/Translator';
import { SiteShell } from '@/components/site/SiteShell';
import { TRANSLATIONS, translationLab } from '@/lib/home/translations';
import { isLocale, messagesFor } from '@/lib/i18n';
import { describeEvidence, evidenceOf } from '@/lib/lab/evidence';
import { learningPaths } from '@/lib/lab/paths';
import { createLabStore } from '@/lib/lab/store';
import { allTopics, sandboxLab } from '@/lib/reference/content';

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).home.meta;
  return { title: t.title, description: t.description };
}

/**
 * Portada (D-043): una página más del cuaderno. Arriba, el traductor IOS →
 * RouterOS que se ejecuta en el motor; debajo, los dos capítulos, Aprender y
 * Practicar. Todo lo que muestra sale del contenido y del motor.
 */
export default async function LocaleHome({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messagesFor(locale).home;
  const path = learningPaths()[0];
  if (!path) throw new Error('content/labs no tiene una ruta con labs');
  const sandbox = sandboxLab('routeros');
  const messages = messagesFor(locale);
  const tasks = TRANSLATIONS.map((translation) => {
    const lab = translationLab(sandbox, translation);
    // El prompt de partida y lo que la red reportará al final, calculados al
    // compilar: la consola no salta al hidratar y su alto se reserva desde el principio.
    const store = createLabStore(lab);
    const prompt = store.getState().prompt();
    store.getState().run(translation.routeros);
    const evidence = evidenceOf(store.getState(), translation.id).map((e) =>
      describeEvidence(e, messages),
    );
    return { translation, lab, prompt, evidence };
  });
  const topics = allTopics()
    .filter((topic) => topic.vendor === 'routeros')
    .map((topic) => ({
      id: topic.id,
      order: topic.order,
      title: topic.title,
      commands: topic.commands.length,
    }));

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section
          aria-labelledby="home-heading"
          className="grid items-center gap-x-14 gap-y-12 pt-12 pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-20 lg:pb-24"
        >
          <div className="min-w-0">
            <h1
              id="home-heading"
              className="text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] leading-[1.15] font-semibold tracking-[-0.02em] text-balance text-ink"
            >
              <span className="block">{t.hero.title}</span>
              <span className="block text-ink-muted">{t.hero.title2}</span>
            </h1>
            <p className="mt-5 max-w-[44ch] text-md text-ink-muted text-pretty">{t.hero.lead}</p>
            <HomeActions
              labs={path.labs.map((l) => ({ id: l.id, order: l.order, title: l.title }))}
            />
          </div>
          <Translator tasks={tasks} />
        </section>

        <HomeIndex topics={topics} labs={path.labs} pathId={path.id} />
      </div>
    </SiteShell>
  );
}
