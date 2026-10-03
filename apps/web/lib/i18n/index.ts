import type { LocalizedText } from '@nos/core';
import type { Locale } from './config';
import type { Messages } from './format';
import { en } from './messages/en';
import { es } from './messages/es';

export * from './config';
export * from './format';

const DICTIONARIES: Readonly<Record<Locale, Messages>> = { es, en };

export const messagesFor = (locale: Locale): Messages => DICTIONARIES[locale];

/** Texto bilingüe de un lab en el idioma activo. */
export const localized = (text: LocalizedText, locale: Locale): string => text[locale];
