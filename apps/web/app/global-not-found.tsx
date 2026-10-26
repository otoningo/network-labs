import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { en } from '@/lib/i18n/messages/en';
import { es } from '@/lib/i18n/messages/es';
import './globals.css';

const ui = Geist({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = { title: `404 · ${es.app.name}` };

/**
 * Cualquier dirección que no es una página (también sin idioma, como /hola).
 * Se sirve sin pasar por el layout del idioma, así que no sabe en cuál está:
 * lo dice en los dos, con la misma hoja de grafito que el resto.
 */
export default function GlobalNotFound() {
  return (
    <html lang="es" className={ui.variable}>
      <body className="flex min-h-dvh flex-col bg-ground">
        <header className="border-b border-rule">
          <div className="mx-auto flex h-(--bar-height) max-w-6xl items-center px-4 sm:px-6">
            <a href="/es" className="font-semibold tracking-tight text-ink no-underline">
              {es.app.name}
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
          <p
            aria-hidden
            className="text-numeral leading-none font-light tabular-nums text-ink-faint"
          >
            404
          </p>
          <div className="mt-6 grid gap-10 sm:grid-cols-2">
            {[
              { lang: 'es', m: es },
              { lang: 'en', m: en },
            ].map(({ lang, m }) => (
              <section key={lang} lang={lang} className="max-w-[52ch]">
                <h1 className="text-xl leading-tight font-semibold text-balance text-ink">
                  {m.notFound.title}
                </h1>
                <p className="mt-3 text-ink-muted text-pretty">{m.notFound.lead}</p>
                <ul className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-3 text-sm">
                  <li>
                    <a
                      href={`/${lang}`}
                      className="font-medium text-ink underline decoration-control underline-offset-[0.2em] hover:decoration-ink"
                    >
                      {m.notFound.home}
                    </a>
                  </li>
                  <li>
                    <a
                      href={`/${lang}/referencia`}
                      className="text-ink-muted underline decoration-rule-strong underline-offset-[0.2em] hover:text-ink hover:decoration-ink"
                    >
                      {m.site.reference}
                    </a>
                  </li>
                  <li>
                    <a
                      href={`/${lang}/rutas`}
                      className="text-ink-muted underline decoration-rule-strong underline-offset-[0.2em] hover:text-ink hover:decoration-ink"
                    >
                      {m.site.paths}
                    </a>
                  </li>
                </ul>
              </section>
            ))}
          </div>
        </main>
        {/* El mismo pie que el resto del cuaderno, con el aviso en los dos idiomas. */}
        <footer className="border-t border-rule">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 sm:px-6">
            <p lang="es" className="max-w-[72ch] text-xs text-ink-faint">
              {es.app.disclaimer}
            </p>
            <p lang="en" className="max-w-[72ch] text-xs text-ink-faint">
              {en.app.disclaimer}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
