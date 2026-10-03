'use client';

import type { LocalizedText } from '@nos/core';
import { createContext, type ReactNode, useContext } from 'react';

/** Lab vecino dentro de la misma ruta. */
export interface LabLink {
  readonly id: string;
  readonly title: LocalizedText;
  readonly order: number;
}

export interface LabNav {
  readonly previous: LabLink | null;
  readonly next: LabLink | null;
}

const NavContext = createContext<LabNav>({ previous: null, next: null });

export function LabNavProvider({
  nav,
  children,
}: {
  readonly nav: LabNav;
  readonly children: ReactNode;
}) {
  return <NavContext value={nav}>{children}</NavContext>;
}

export const useLabNav = (): LabNav => useContext(NavContext);
