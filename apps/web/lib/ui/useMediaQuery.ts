'use client';

import { useSyncExternalStore } from 'react';

/**
 * Estado de una media query. En el servidor (y en la primera pasada de
 * hidratación) devuelve `null`: quien la usa decide qué mostrar mientras tanto.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}
