import { fill, type Locale, messagesFor, plural } from '@/lib/i18n';
import type { LearningPath } from '@/lib/lab/paths';
import { totalMinutes } from '@/lib/progress/path';
import { Dot } from './Dot';

/** Metadatos de una ruta: sistema que se practica, número de labs y minutos en total. */
export function PathMeta({
  locale,
  path,
  className = '',
}: {
  readonly locale: Locale;
  readonly path: LearningPath;
  readonly className?: string;
}) {
  const t = messagesFor(locale).paths;
  return (
    <p className={`text-xs text-ink-faint ${className}`}>
      {fill(t.practise, { os: t.os[path.os] })}
      <Dot />
      {/* En pantallas estrechas se corta entre datos, no dentro de "205 min en total". */}
      <span className="whitespace-nowrap">{plural(locale, t.labCount, path.labs.length)}</span>
      <Dot />
      <span className="whitespace-nowrap">{fill(t.minutes, { n: totalMinutes(path.labs) })}</span>
    </p>
  );
}
