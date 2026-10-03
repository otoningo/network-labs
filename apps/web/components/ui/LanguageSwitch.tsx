'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LOCALES } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';

/** Cambia de idioma conservando la página actual. */
export function LanguageSwitch() {
  const { locale, messages } = useI18n();
  const pathname = usePathname();
  const rest = pathname.split('/').slice(2).join('/');
  return (
    <nav aria-label={messages.app.language}>
      <ul className="flex items-center gap-1 text-sm">
        {LOCALES.map((code) => (
          <li key={code}>
            <Link
              href={`/${code}${rest ? `/${rest}` : ''}`}
              hrefLang={code}
              lang={code}
              aria-current={code === locale ? 'true' : undefined}
              aria-label={messages.app.languageNames[code]}
              className={`rounded-sm px-1.5 py-0.5 uppercase no-underline ${
                code === locale ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'
              }`}
            >
              {code}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
