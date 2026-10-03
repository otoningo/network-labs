/**
 * Store de un lab: los objetivos siguen a la red, las pistas avanzan de una en
 * una y el progreso guardado se restaura volviendo a ejecutar lo escrito.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { LocalProgressRepository, parseProgress } from '../progress/repository';
import { createLabStore } from './store';

const lab1 = (): LabDefinition => {
  const file = join(
    import.meta.dirname,
    '../../../../content/labs/routeros/01-acceso-inicial.yaml',
  );
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const SOLUTION = [
  '/system identity set name=R1-Oficina',
  '/ip address add address=192.168.88.1/24 interface=ether2',
  '/user add name=soporte group=read password=Clave123',
  '/ip service disable telnet',
];

class MemoryStorage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('store del lab', () => {
  it('arranca con todo pendiente y la consola en el router', () => {
    const store = createLabStore(lab1());
    const state = store.getState();
    expect(Object.values(state.objectives)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(state.consoleDevices).toEqual(['R1']);
    expect(state.prompt()).toBe('[admin@MikroTik] > ');
  });

  it('cada comando reevalúa los objetivos y el lab termina al cumplirse todos', () => {
    const store = createLabStore(lab1());
    store.getState().run(SOLUTION[0] ?? '');
    expect(store.getState().objectives['identity']).toBe('done');
    expect(store.getState().prompt()).toBe('[admin@R1-Oficina] > ');
    expect(store.getState().finishedAt).toBeNull();
    for (const line of SOLUTION.slice(1)) store.getState().run(line);
    expect(Object.values(store.getState().objectives).every((s) => s === 'done')).toBe(true);
    expect(store.getState().finishedAt).not.toBeNull();
  });

  it('un objetivo que se deshace pasa a regresión', () => {
    const store = createLabStore(lab1());
    store.getState().run('/system identity set name=R1-Oficina');
    store.getState().run('/system identity set name=Otro');
    expect(store.getState().objectives['identity']).toBe('regressed');
  });

  it('un error de sintaxis no cambia la red ni los objetivos, pero queda en el registro', () => {
    const store = createLabStore(lab1());
    const before = store.getState().net;
    const result = store.getState().run('/sistem identity print');
    expect(result.ok).toBe(false);
    expect(store.getState().net).toBe(before);
    expect(store.getState().log).toHaveLength(1);
  });

  it('las pistas se revelan de una en una y no pasan del total', () => {
    const store = createLabStore(lab1());
    for (let i = 0; i < 5; i += 1) store.getState().revealHint('identity');
    expect(store.getState().hints['identity']).toBe(2);
    store.getState().revealHint('no-existe');
    expect(store.getState().hints['no-existe']).toBeUndefined();
  });

  it('restaura el progreso volviendo a ejecutar las líneas, incluido el contexto de menú', () => {
    const first = createLabStore(lab1());
    first.getState().run('/ip address');
    first.getState().run('add address=192.168.88.1/24 interface=ether2');
    first.getState().revealHint('user');
    const saved = parseProgress(JSON.parse(JSON.stringify(first.getState().snapshot())));
    expect(saved).not.toBeNull();

    const second = createLabStore(lab1());
    second.getState().hydrate(saved);
    const state = second.getState();
    expect(state.hydrated).toBe(true);
    expect(state.restoredCount).toBe(2);
    expect(state.objectives['lan']).toBe('done');
    expect(state.hints['user']).toBe(1);
    expect(state.prompt()).toBe('[admin@MikroTik] /ip/address> ');
  });

  it('reiniciar vuelve al estado de fábrica y cambia la época', () => {
    const store = createLabStore(lab1());
    store.getState().hydrate(null);
    store.getState().run(SOLUTION[0] ?? '');
    store.getState().reset();
    const state = store.getState();
    expect(state.epoch).toBe(1);
    expect(state.log).toEqual([]);
    expect(state.objectives['identity']).toBe('pending');
    expect(state.prompt()).toBe('[admin@MikroTik] > ');
  });
});

describe('repositorio local de progreso', () => {
  it('guarda, lista y borra', async () => {
    const repo = new LocalProgressRepository(new MemoryStorage());
    const store = createLabStore(lab1());
    store.getState().run(SOLUTION[0] ?? '');
    await repo.save(store.getState().snapshot());
    const loaded = await repo.load('ros-01-acceso-inicial');
    expect(loaded?.log).toEqual([{ device: 'R1', line: SOLUTION[0] }]);
    expect(await repo.list()).toHaveLength(1);
    await repo.clear('ros-01-acceso-inicial');
    expect(await repo.load('ros-01-acceso-inicial')).toBeNull();
  });

  it('descarta datos corruptos o de otra versión sin romper', async () => {
    const storage = new MemoryStorage();
    const repo = new LocalProgressRepository(storage);
    storage.setItem('nos-labs:progress:v1:a', '{no es json');
    storage.setItem('nos-labs:progress:v1:b', JSON.stringify({ version: 2 }));
    storage.setItem(
      'nos-labs:progress:v1:c',
      JSON.stringify({
        version: 1,
        labId: 'c',
        log: [{ device: 1 }],
        hints: {},
        completed: {},
        updatedAt: '',
      }),
    );
    expect(await repo.load('a')).toBeNull();
    expect(await repo.load('b')).toBeNull();
    expect(await repo.load('c')).toBeNull();
  });

  it('sin almacenamiento (servidor o navegación privada bloqueada) no falla', async () => {
    const repo = new LocalProgressRepository(null);
    await expect(repo.save(createLabStore(lab1()).getState().snapshot())).resolves.toBeUndefined();
    expect(await repo.load('x')).toBeNull();
    expect(await repo.list()).toEqual([]);
  });
});
