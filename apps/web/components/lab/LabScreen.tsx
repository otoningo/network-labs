'use client';

import type { LabDefinition } from '@nos/core';
import { useI18n } from '@/lib/i18n/context';
import { LabStoreProvider } from '@/lib/lab/context';
import { TopBar } from './TopBar';
import { Workbench } from './Workbench';

/** Pantalla de un lab: barra superior y las tres zonas de trabajo. */
export function LabScreen({ lab }: { readonly lab: LabDefinition }) {
  const { messages } = useI18n();
  return (
    <LabStoreProvider lab={lab}>
      <a
        href="#lab-console"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-sheet focus:px-3 focus:py-2"
      >
        {messages.app.skipToConsole}
      </a>
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-ground">
        <TopBar />
        <Workbench />
      </div>
    </LabStoreProvider>
  );
}
