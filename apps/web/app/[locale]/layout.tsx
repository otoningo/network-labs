import type { Metadata } from 'next';
import { Geist, Geist_Mono, Jost } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isLocale, LOCALES, messagesFor } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/context';
import '../globals.css';

// Geist para la interfaz; Geist Mono solo para la consola (D-031).
const ui = Geist({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-console', display: 'swap' });
// Jost solo en la portada (D-041): el titular fino del mundo de plegado.
const display = Jost({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));
export const dynamicParams = false;

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = messagesFor(locale);
  return { title: messages.meta.title, description: messages.meta.description };
}

export default async function LocaleLayout({ params, children }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} className={`${ui.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children as ReactNode}
        </I18nProvider>
      </body>
    </html>
  );
}
