'use client';

import { MagnifyingGlass, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useDeferredValue, useId, useMemo, useState } from 'react';
import { ICON_WEIGHT } from '@/components/lab/worksheet/StatusBox';
import { ConsoleQuote } from '@/components/ui/ConsoleQuote';
import { RichText } from '@/components/ui/RichText';
import { fill, plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';

/** Un comando de la referencia, ya en el idioma de la página, para buscar en el cliente. */
export interface SearchEntry {
  readonly topicId: string;
  readonly topicOrder: number;
  readonly topicTitle: string;
  readonly anchor: string;
  readonly syntax: string;
  readonly summary: string;
  readonly ios: string | null;
}

/** Minúsculas y sin tildes: «dirección» encuentra «direccion» y al revés. */
const normalize = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Escapa una palabra para usarla dentro de una expresión regular. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Indexed extends SearchEntry {
  readonly inSyntax: string;
  readonly inIos: string;
  readonly inText: string;
}

/**
 * Buscador de la referencia: filtra los comandos por lo que escribirías en
 * RouterOS o en IOS, y por lo que hacen. Sin búsqueda se ve el índice de
 * temas de siempre (children); con búsqueda, la lista de comandos que
 * coinciden, cada uno enlazado a su sitio en el tema.
 */
export function ReferenceSearch({
  entries,
  children,
}: {
  readonly entries: readonly SearchEntry[];
  readonly children: ReactNode;
}) {
  const { locale, messages } = useI18n();
  const t = messages.reference.search;
  const inputId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const index = useMemo<readonly Indexed[]>(
    () =>
      entries.map((entry) => ({
        ...entry,
        inSyntax: normalize(entry.syntax),
        inIos: normalize(entry.ios ?? ''),
        inText: normalize(`${entry.summary} ${entry.topicTitle}`.replaceAll('`', '')),
      })),
    [entries],
  );

  const needle = normalize(deferred).trim();
  const results = useMemo(() => {
    const terms = needle.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    // Si la búsqueda entera aparece tal cual en una sintaxis o en IOS
    // («show ip route»), el estudiante pegó un comando: se muestra solo eso.
    const phrase = index.filter(
      (entry) => entry.inSyntax.includes(needle) || entry.inIos.includes(needle),
    );
    if (phrase.length > 0) return phrase;
    // Si no, cada palabra tiene que ser el principio de alguna palabra del
    // comando, su resumen o su tema: «dir» encuentra «dirección», «ip» no encuentra «tipo».
    const startsWord = (text: string, term: string) =>
      text.startsWith(term) || new RegExp(`[^a-z0-9]${escapeRegExp(term)}`).test(text);
    const scored = index.flatMap((entry) => {
      const all = `${entry.inSyntax} ${entry.inIos} ${entry.inText}`;
      if (!terms.every((term) => startsWord(all, term))) return [];
      // Primero lo que coincide en la sintaxis o en IOS: es lo que el estudiante teclea.
      const score =
        (terms.every((term) => startsWord(entry.inSyntax, term)) ? 2 : 0) +
        (terms.every((term) => startsWord(entry.inIos, term)) ? 1 : 0);
      return [{ entry, score }];
    });
    return scored
      .sort((a, b) => b.score - a.score || a.entry.topicOrder - b.entry.topicOrder)
      .map((x) => x.entry);
  }, [index, needle]);

  const searching = needle !== '';

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink-muted">
        {t.label}
      </label>
      <div className="relative mt-2 max-w-[36rem]">
        <MagnifyingGlass
          size={16}
          weight={ICON_WEIGHT}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
        />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
          placeholder={t.placeholder}
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-sm border border-control bg-ground pr-10 pl-9 text-base text-ink placeholder:text-ink-faint focus:border-ink [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t.clear}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-sm text-ink-faint transition-colors hover:text-ink"
          >
            <X size={15} weight={ICON_WEIGHT} aria-hidden />
          </button>
        )}
      </div>
      <p id={hintId} className="mt-2 text-xs text-ink-faint">
        {t.hint}
      </p>

      <p aria-live="polite" className="sr-only">
        {searching
          ? results.length > 0
            ? plural(locale, t.found, results.length)
            : fill(t.empty, { q: deferred.trim() })
          : ''}
      </p>

      {searching ? (
        <div className="mt-10">
          {results.length === 0 ? (
            <p className="max-w-[62ch] border-t border-rule pt-5 text-ink-muted text-pretty">
              {fill(t.empty, { q: deferred.trim() })}
            </p>
          ) : (
            <>
              <p aria-hidden className="text-sm font-semibold text-ink-muted">
                {plural(locale, t.found, results.length)}
              </p>
              <ul className="mt-3 border-b border-rule">
                {results.map((entry) => (
                  <li
                    key={`${entry.topicId}-${entry.anchor}`}
                    className="relative border-t border-rule py-5"
                  >
                    {/* Toda la fila lleva al comando dentro de su tema. */}
                    <Link
                      href={`/${locale}/referencia/${entry.topicId}#${entry.anchor}`}
                      className="max-w-[62ch] font-medium text-ink no-underline text-pretty after:absolute after:inset-0 hover:underline"
                    >
                      <RichText text={entry.summary} />
                    </Link>
                    <p className="mt-1 text-xs text-ink-faint">
                      {fill(t.topic, { n: entry.topicOrder, title: entry.topicTitle })}
                    </p>
                    {/* Sintaxis y equivalente en IOS como en el tema: consolas citadas, la mono no sale de ahí. */}
                    <div
                      className={`mt-3 grid gap-3 ${entry.ios ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}
                    >
                      <ConsoleQuote
                        label={messages.reference.syntax}
                        lines={[{ prompt: '', command: entry.syntax }]}
                      />
                      {entry.ios && (
                        <ConsoleQuote
                          label={messages.reference.ios}
                          lines={entry.ios.split('\n').map((command) => ({ prompt: '', command }))}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
