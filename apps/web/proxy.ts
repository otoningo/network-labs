import { type NextRequest, NextResponse } from 'next/server';
import { isLocale, negotiateLocale } from './lib/i18n/config';

/** Toda ruta lleva el idioma delante; sin él, se elige por Accept-Language. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1] ?? '';
  if (isLocale(first)) return;
  const locale = negotiateLocale(request.headers.get('accept-language'));
  request.nextUrl.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\..*).*)'],
};
