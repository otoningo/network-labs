/**
 * Progreso de un lab: se restaura y se guarda, salvo en el router de práctica
 * de la referencia, que no debe aparecer como un lab en curso.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabProgress, ProgressRepository } from '../progress/repository';
import { connectProgress, SAVE_DELAY_MS } from './persistence';
import { createLabStore } from './store';

const sandbox = (): LabDefinition => {
  const file = join(import.meta.dirname, '../../../../content/sandbox/routeros.yaml');
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

/** Repositorio en memoria que anota cada llamada. */
function spyRepository(): ProgressRepository & { readonly calls: string[] } {
  const calls: string[] = [];
  const saved = new Map<string, LabProgress>();
  return {
    calls,
    load: async (labId) => {
      calls.push(`load ${labId}`);
      return saved.get(labId) ?? null;
    },
    save: async (progress) => {
      calls.push(`save ${progress.labId}`);
      saved.set(progress.labId, progress);
    },
    list: async () => [...saved.values()],
    clear: async (labId) => {
      calls.push(`clear ${labId}`);
      saved.delete(labId);
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50);

describe('progreso del lab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restaura y guarda cada cambio', async () => {
    const lab = sandbox();
    const store = createLabStore(lab);
    const repo = spyRepository();
    const disconnect = connectProgress(store, repo, lab.id);
    await flush();
    expect(store.getState().hydrated).toBe(true);
    store.getState().run('/system identity set name=R9');
    await flush();
    expect(repo.calls).toEqual([`load ${lab.id}`, `save ${lab.id}`]);
    disconnect();
  });

  it('sin persistencia no lee ni escribe, y la consola queda lista', async () => {
    const lab = sandbox();
    const store = createLabStore(lab);
    const repo = spyRepository();
    const disconnect = connectProgress(store, repo, lab.id, false);
    expect(store.getState().hydrated).toBe(true);
    store.getState().run('/system identity set name=R9');
    store.getState().suggest('/ip address print');
    await flush();
    store.getState().reset();
    store.getState().run('/ip address print');
    disconnect();
    await flush();
    expect(repo.calls).toEqual([]);
    expect(await repo.list()).toEqual([]);
  });
});
