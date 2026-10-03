'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { Locale } from './config';
import type { Messages } from './format';

interface I18n {
  readonly locale: Locale;
  readonly messages: Messages;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: I18n & { readonly children: ReactNode }) {
  return <I18nContext value={{ locale, messages }}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n fuera de I18nProvider');
  return value;
}
