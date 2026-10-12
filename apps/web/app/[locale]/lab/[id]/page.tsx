import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LabScreen } from '@/components/lab/LabScreen';
import { fill, isLocale, LOCALES, messagesFor } from '@/lib/i18n';
import { allLabs, labById, labNav } from '@/lib/lab/content';
import { topicsForLab } from '@/lib/reference/content';

export const generateStaticParams = () =>
  LOCALES.flatMap((locale) => allLabs().map((lab) => ({ locale, id: lab.id })));
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/lab/[id]'>): Promise<Metadata> {
  const { locale, id } = await params;
  const lab = labById(id);
  if (!lab || !isLocale(locale)) return {};
  return {
    title: fill(messagesFor(locale).meta.labTitle, { title: lab.title[locale] }),
    description: lab.summary[locale],
  };
}

export default async function LabPage({ params }: PageProps<'/[locale]/lab/[id]'>) {
  const { locale, id } = await params;
  const lab = labById(id);
  if (!lab || !isLocale(locale)) notFound();
  // De la referencia solo viaja lo que enlaza la hoja: id y título.
  const topics = topicsForLab(id).map((topic) => ({ id: topic.id, title: topic.title }));
  return <LabScreen lab={lab} nav={{ ...labNav(id), topics }} />;
}
