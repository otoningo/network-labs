'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { useI18n } from '@/lib/i18n/context';

/**
 * Marco de las páginas fuera del lab (portada, rutas, referencia): barra con el nombre y
 * la navegación, el contenido en `<main id="main">` y el pie con el aviso de
 * no afiliación. La pantalla de lab tiene su propia barra.
 */
export function SiteShell({ children }: { readonly children: ReactNode }) {
  const { messages } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-sheet focus:px-3 focus:py-2"
      >
        {messages.site.skipToContent}
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const { locale, messages } = useI18n();
  const pathname = usePathname();
  // En el teléfono no caben tres enlaces junto al nombre y el idioma: Comparar
  // aparece desde 640px y, más estrecho, se llega a él desde Aprender y la portada.
  const links = [
    { href: `/${locale}/referencia`, label: messages.site.reference, wide: false },
    { href: `/${locale}/rutas`, label: messages.site.paths, wide: false },
    { href: `/${locale}/compara`, label: messages.site.compare, wide: true },
  ];
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-(--bar-height) max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link
          href={`/${locale}`}
          className="font-semibold tracking-tight whitespace-nowrap text-ink no-underline"
        >
          {messages.app.name}
        </Link>
        <nav aria-label={messages.site.nav} className="text-sm">
          <ul className="flex items-center gap-4 sm:gap-5">
            {links.map(({ href, label, wide }) => {
              const current = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href} className={wide ? 'hidden sm:list-item' : undefined}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={`no-underline ${current ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="ml-auto">
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  const { messages } = useI18n();
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="max-w-[72ch] text-xs text-ink-faint">{messages.app.disclaimer}</p>
      </div>
    </footer>
  );
}
