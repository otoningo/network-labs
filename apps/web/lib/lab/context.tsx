'use client';

import type { LabDefinition } from '@nos/core';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { browserRepository, type ProgressRepository } from '../progress/repository';
import { createLabStore, type LabState, type LabStore } from './store';

const LabStoreContext = createContext<LabStore | null>(null);

/** Espera tras el último cambio antes de guardar: agrupa ráfagas de comandos. */
const SAVE_DELAY_MS = 400;

export function LabStoreProvider({
  lab,
  repository,
  children,
}: {
  readonly lab: LabDefinition;
  readonly repository?: ProgressRepository;
  readonly children: ReactNode;
}) {
  const [store] = useState(() => createLabStore(lab));
  const [repo] = useState(() => repository ?? browserRepository());

  // Restaura el progreso guardado y, desde entonces, guarda cada cambio relevante.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void repo.save(store.getState().snapshot()), SAVE_DELAY_MS);
    };
    const unsubscribe = store.subscribe((state, previous) => {
      if (!state.hydrated) return;
      if (state.epoch !== previous.epoch) {
        clearTimeout(timer);
        void repo.clear(state.runtime.lab.id);
        return;
      }
      if (
        state.log !== previous.log ||
        state.hints !== previous.hints ||
        state.completed !== previous.completed ||
        state.finishedAt !== previous.finishedAt
      ) {
        save();
      }
    });
    void repo.load(lab.id).then((progress) => {
      if (!cancelled) store.getState().hydrate(progress);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer !== undefined && store.getState().hydrated) {
        clearTimeout(timer);
        void repo.save(store.getState().snapshot());
      }
    };
  }, [store, repo, lab.id]);

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
