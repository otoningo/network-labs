'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fill, plural } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab, useLabStoreApi } from '@/lib/lab/context';
import { type ConsoleSession, loadXterm, type SessionTexts, sessionFor } from './session';

/**
 * Consola del equipo activo: una franja con el equipo (y el selector si hay
 * varios) y la terminal. La instancia de xterm vive en una ConsoleSession por
 * store, así que remontar este componente no pierde la pantalla ni el historial.
 * Sin `autoFocus` (una página de lectura, como la referencia) no toma el foco al cargar.
 */
export function Console({ autoFocus = true }: { readonly autoFocus?: boolean } = {}) {
  const store = useLabStoreApi();
  const { locale, messages } = useI18n();
  const t = messages.terminal;
  const active = useLab((s) => s.activeDevice);
  const devices = useLab((s) => s.consoleDevices);
  const setActiveDevice = useLab((s) => s.setActiveDevice);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<ConsoleSession | null>(null);
  const [focused, setFocused] = useState(false);
  const keysId = useId();
  const selectId = useId();
  const label = fill(t.label, { device: active });

  const texts = useMemo<SessionTexts>(
    () => ({
      closed: t.closed,
      intro: t.intro,
      restored: (count) => plural(locale, messages.lab.restored, count),
      separator: (device) => `── ${fill(messages.lab.consoleOf, { device })} ──`,
    }),
    [locale, messages, t],
  );
  // La sesión se crea dentro de un efecto asíncrono: lee los textos de aquí.
  const textsRef = useRef(texts);
  useEffect(() => {
    textsRef.current = texts;
  }, [texts]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let cancelled = false;
    let attached: ConsoleSession | null = null;
    const observer = new ResizeObserver(() => attached?.refit());
    void loadXterm().then((xterm) => {
      if (cancelled) return;
      attached = sessionFor(store, xterm, textsRef.current);
      attached.onFocusChange = setFocused;
      attached.attach(body);
      observer.observe(body);
      setSession(attached);
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (attached) {
        attached.onFocusChange = null;
        attached.detach();
      }
    };
  }, [store]);

  useEffect(() => {
    if (!session) return;
    session.texts = texts;
    session.describe(label, keysId);
  }, [session, texts, label, keysId]);

  useEffect(() => {
    if (autoFocus) session?.focusOnFirstLoad();
  }, [session, autoFocus]);

  return (
    <section
      id="lab-console"
      aria-label={label}
      aria-describedby={keysId}
      tabIndex={-1}
      // El enlace para saltar a la consola enfoca la sección: el foco pasa a la terminal.
      onFocus={(event) => {
        if (event.target === event.currentTarget) session?.focus();
      }}
      className="flex h-full min-h-0 flex-col bg-console outline-none"
    >
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-rule px-4 font-sans">
        <p className="min-w-0 truncate text-xs text-ink-muted">
          {fill(messages.lab.consoleOf, { device: active })}
        </p>
        {devices.length > 1 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              {messages.lab.device}
            </label>
            <select
              id={selectId}
              value={active}
              onChange={(event) => {
                const next = devices.find((d) => d === event.target.value);
                if (next) setActiveDevice(next);
              }}
              className="ml-auto h-7 rounded-sm border border-rule bg-console px-2 text-xs text-ink hover:border-rule-strong"
            >
              {devices.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={bodyRef} className="absolute inset-0 overflow-hidden" />
        {/* El anillo de foco va por encima del lienzo de xterm, que taparía un outline interior. */}
        {focused && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 outline-2 -outline-offset-2 outline-(--color-focus)"
          />
        )}
      </div>
      <p id={keysId} className="sr-only">
        {t.keys}
      </p>
    </section>
  );
}
