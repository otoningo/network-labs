/** Idiomas de la interfaz. El español es la fuente; el inglés debe cubrir las mismas claves. */
export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** Elige el idioma a partir de Accept-Language (sin dependencias: solo el idioma base). */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((entry) => entry.base !== '' && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q);
  return ranked.map((entry) => entry.base).find(isLocale) ?? DEFAULT_LOCALE;
}
