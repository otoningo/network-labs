'use client';

/**
 * El sistema que el estudiante eligió por última vez (D-046), en este
 * navegador. La portada lo usa para abrir en ese sistema; si el
 * almacenamiento falla o está vacío, se usa RouterOS.
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_SYSTEM, isSystem, type SystemId } from './systems';

const KEY = 'nos-labs:system';
const listeners = new Set<() => void>();

function read(): SystemId {
  try {
    const value = window.localStorage.getItem(KEY);
    return value && isSystem(value) ? value : DEFAULT_SYSTEM;
  } catch {
    return DEFAULT_SYSTEM;
  }
}

export function choosePreferredSystem(system: SystemId): void {
  try {
    window.localStorage.setItem(KEY, system);
  } catch {
    // Sin almacenamiento la elección dura lo que la página.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const usePreferredSystem = (): SystemId =>
  useSyncExternalStore(subscribe, read, () => DEFAULT_SYSTEM);
