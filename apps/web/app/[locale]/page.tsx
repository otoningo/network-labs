import { redirect } from 'next/navigation';
import { allLabs } from '@/lib/lab/content';

// Hasta la portada (fase 5), la raíz de cada idioma abre el primer lab.
export default async function LocaleHome({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  const first = allLabs()[0];
  if (!first) throw new Error('content/labs está vacío');
  redirect(`/${locale}/lab/${first.id}`);
}
