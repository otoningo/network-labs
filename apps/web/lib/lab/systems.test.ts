/**
 * La web abre cada lab con el driver de su sistema (D-046): todos los labs de
 * content/labs cargan en el store con su consola, y la de IOS responde con
 * sus modos y sus errores.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { SYSTEMS } from '../systems';
import { createLabStore } from './store';

const LABS = join(import.meta.dirname, '../../../../content/labs');

const labsOf = (system: string): LabDefinition[] =>
  readdirSync(join(LABS, system))
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((file) => {
      const parsed = parseLabYaml(readFileSync(join(LABS, system, file), 'utf8'));
      if (!parsed.ok) throw new Error(`${system}/${file}: ${parsed.error}`);
      return parsed.value;
    });

describe('labs de cada sistema en la web', () => {
  for (const system of SYSTEMS) {
    it(`${system}: cada lab carga con consola y todas las tareas pendientes`, () => {
      const labs = labsOf(system);
      expect(labs.length).toBeGreaterThan(0);
      for (const lab of labs) {
        const state = createLabStore(lab).getState();
        expect(state.prompt(), lab.id).not.toBe('');
        expect(
          Object.values(state.objectives).every((s) => s === 'pending'),
          lab.id,
        ).toBe(true);
      }
    });
  }

  it('IOS: el prompt sigue al modo y un error de tecleo sale con su ^', () => {
    const lab = labsOf('ios').find((l) => l.id === 'ios-01-acceso-inicial');
    if (!lab) throw new Error('falta el lab 1 de IOS');
    const store = createLabStore(lab);
    expect(store.getState().prompt()).toMatch(/>$/);
    store.getState().run('en');
    expect(store.getState().prompt()).toMatch(/#$/);
    store.getState().run('conf t');
    expect(store.getState().prompt()).toMatch(/\(config\)#$/);
    const typo = store.getState().run('hostnme R1');
    expect(typo.ok).toBe(false);
    expect(typo.output).toContain("% Invalid input detected at '^' marker.");
  });
});
