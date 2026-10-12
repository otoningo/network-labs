/**
 * Enlace entre el store de un lab y el progreso guardado: restaura lo que
 * hubiera y, desde entonces, guarda cada cambio relevante. Sin `persist`
 * (el router de práctica de la referencia) no lee ni escribe nada, para que
 * no aparezca como un lab en curso.
 */
import type { ProgressRepository } from '../progress/repository';
import type { LabStore } from './store';

/** Espera tras el último cambio antes de guardar: agrupa ráfagas de comandos. */
export const SAVE_DELAY_MS = 400;

/** Conecta el store con el repositorio. Devuelve la desconexión. */
export function connectProgress(
  store: LabStore,
  repo: ProgressRepository,
  labId: string,
  persist = true,
): () => void {
  if (!persist) {
    // Sin progreso que restaurar: la consola puede mostrar el prompt ya.
    store.getState().hydrate(null);
    return () => {};
  }

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
  void repo.load(labId).then((progress) => {
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
}
