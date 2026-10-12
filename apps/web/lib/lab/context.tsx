'use client';

import type { LabDefinition } from '@nos/core';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { browserRepository, type ProgressRepository } from '../progress/repository';
import { connectProgress } from './persistence';
import { createLabStore, type LabState, type LabStore } from './store';

const LabStoreContext = createContext<LabStore | null>(null);

export function LabStoreProvider({
  lab,
  repository,
  persist = true,
  children,
}: {
  readonly lab: LabDefinition;
  readonly repository?: ProgressRepository;
  /** Guarda y restaura el progreso. El router de práctica de la referencia no lo hace. */
  readonly persist?: boolean;
  readonly children: ReactNode;
}) {
  const [store] = useState(() => createLabStore(lab));
  const [repo] = useState(() => repository ?? browserRepository());

  // Restaura el progreso guardado y, desde entonces, guarda cada cambio relevante.
  useEffect(() => connectProgress(store, repo, lab.id, persist), [store, repo, lab.id, persist]);

  return <LabStoreContext value={store}>{children}</LabStoreContext>;
}

export function useLabStoreApi(): LabStore {
  const store = useContext(LabStoreContext);
  if (!store) throw new Error('useLab fuera de LabStoreProvider');
  return store;
}

/** Lee una parte del estado del lab y se vuelve a renderizar solo si cambia. */
export function useLab<T>(selector: (state: LabState) => T): T {
  return useStore(useLabStoreApi(), selector);
}
