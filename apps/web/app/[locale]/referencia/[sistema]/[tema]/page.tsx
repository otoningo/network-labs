import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PracticePanel, ReferenceSandbox } from '@/components/reference/Sandbox';
import { type TopicLab, type TopicLink, TopicView } from '@/components/reference/TopicView';
import { SiteShell } from '@/components/site/SiteShell';
import { fill, isLocale, LOCALES, messagesFor } from '@/lib/i18n';
import { labById } from '@/lib/lab/content';
import { allTopics, sandboxLab, topicOf, topicsOf } from '@/lib/reference/content';
import { systemName } from '@/lib/systems';

export const generateStaticParams = () =>
  LOCALES.flatMap((locale) =>
    allTopics().map((topic) => ({ locale, sistema: topic.vendor, tema: topic.id })),
  );
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/referencia/[sistema]/[tema]'>): Promise<Metadata> {
  const { locale, sistema, tema } = await params;
  const topic = topicOf(sistema, tema);
  if (!topic || !isLocale(locale)) return {};
  const messages = messagesFor(locale);
  return {
    title: fill(messages.reference.meta.topicTitle, {
      title: topic.title[locale],
      system: systemName(messages, topic.vendor),
    }),
    description: topic.summary[locale],
  };
}

/**
 * Un tema de la referencia: la lectura y, al lado (debajo en el teléfono), el
 * router de práctica del sistema, donde "Probar" deja escrito cada ejemplo.
 */
export default async function TopicPage({
  params,
}: PageProps<'/[locale]/referencia/[sistema]/[tema]'>) {
  const { locale, sistema, tema } = await params;
  const topic = topicOf(sistema, tema);
  if (!topic || !isLocale(locale)) notFound();
  const messages = messagesFor(locale);

  const labs: TopicLab[] = topic.labs.flatMap((id) => {
    const lab = labById(id);
    return lab ? [{ id, order: lab.order ?? null, title: lab.title[locale] }] : [];
  });
  const siblings = topicsOf(topic.vendor);
  const following = siblings[siblings.findIndex((t) => t.id === topic.id) + 1];
  const next: TopicLink | null = following
    ? { id: following.id, order: following.order, title: following.title[locale] }
    : null;

  return (
    <SiteShell>
      <ReferenceSandbox lab={sandboxLab(topic.vendor)} setup={topic.setup}>
        <div className="mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
          <TopicView locale={locale} messages={messages} topic={topic} labs={labs} next={next} />
          <PracticePanel setup={topic.setup} className="mt-12 lg:mt-0" />
        </div>
      </ReferenceSandbox>
    </SiteShell>
  );
}
