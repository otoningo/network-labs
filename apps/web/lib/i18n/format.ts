import type { Locale } from './config';
import type { es } from './messages/es';

/** Misma forma que el diccionario fuente, con cadenas libres en cada hoja. */
type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof es>;

export interface Plural {
  readonly one: string;
  readonly other: string;
}

type Vars = Readonly<Record<string, string | number>>;

/** Sustituye `{nombre}` por su valor; un hueco sin valor queda tal cual para que se note. */
export function fill(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

const rulesCache = new Map<Locale, Intl.PluralRules>();

/** Elige la forma de plural del idioma según `count` y rellena el resultado. */
export function plural(locale: Locale, forms: Plural, count: number, vars: Vars = {}): string {
  let rules = rulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    rulesCache.set(locale, rules);
  }
  const form = rules.select(count) === 'one' ? forms.one : forms.other;
  return fill(form, { n: count, ...vars });
}
