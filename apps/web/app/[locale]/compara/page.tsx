import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CompareView, type ShownTask } from '@/components/compare/CompareView';
import { SiteShell } from '@/components/site/SiteShell';
import { simulate } from '@/lib/compare/simulate';
import { COMPARE_TASKS } from '@/lib/compare/tasks';
import { isLocale, LOCALES, messagesFor } from '@/lib/i18n';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/compara'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = messagesFor(locale).compare.meta;
  return { title: t.title, description: t.description };
}

/**
 * "Compara sintaxis" (D-044): la misma tarea en los cuatro sistemas. Las
 * líneas de RouterOS y VRP se ejecutan aquí, al compilar, y lo que se muestra
 * es lo que dejó el motor: el prompt real antes de cada línea y si la tarea
 * quedó cumplida.
 */
export default async function ComparePage({ params }: PageProps<'/[locale]/compara'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messagesFor(locale).compare;

  const tasks: ShownTask[] = COMPARE_TASKS.map((task) => {
    const routeros = simulate(task, 'routeros');
    const vrp = simulate(task, 'vrp');
    return {
      id: task.id,
      systems: [
        { os: 'routeros', lines: routeros.lines, verified: routeros.verified },
        { os: 'vrp', lines: vrp.lines, verified: vrp.verified },
        { os: 'vyos', lines: task.quoted.vyos, verified: false },
        { os: 'ios', lines: task.quoted.ios, verified: false },
      ],
    };
  });

  return (
    <SiteShell>
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
        <h1 className="text-xl leading-tight font-semibold text-balance text-ink">{t.title}</h1>
        <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.intro}</p>
        <p className="mt-3 max-w-[62ch] text-xs text-ink-faint text-pretty">{t.ports}</p>
        <CompareView tasks={tasks} />
      </div>
    </SiteShell>
  );
}
