/**
 * "Compara sintaxis" no puede enseñar algo que el motor no hace: cada línea de
 * RouterOS y de VRP se acepta y deja la tarea cumplida, y antes no lo estaba.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import { COMPARE_TASKS, type SimulatedOs } from './tasks';

const SIMULATED: readonly SimulatedOs[] = ['routeros', 'vrp'];

describe('Compara sintaxis', () => {
  for (const task of COMPARE_TASKS) {
    for (const os of SIMULATED) {
      it(`${task.id} en ${os}: las líneas se aceptan y cumplen la tarea`, () => {
        const sim = simulate(task, os);
        expect(
          sim.failed,
          sim.failed && `${sim.failed.line}\n${sim.failed.output}`,
        ).toBeUndefined();
        expect(sim.verified).toBe(true);
      });
    }
  }

  it('en VRP el prompt cambia con la vista, como en el equipo', () => {
    const task = COMPARE_TASKS.find((t) => t.id === 'hostname');
    if (!task) throw new Error('falta la tarea del nombre');
    expect(simulate(task, 'vrp').lines).toEqual([
      { prompt: '<Huawei>', command: 'system-view' },
      { prompt: '[Huawei]', command: 'sysname R1' },
    ]);
  });

  it('cada tarea tiene líneas para los cuatro sistemas o una nota que explica por qué no', () => {
    for (const task of COMPARE_TASKS) {
      expect(task.simulated.routeros.length).toBeGreaterThan(0);
      expect(task.simulated.vrp.length).toBeGreaterThan(0);
      expect(task.quoted.ios.length).toBeGreaterThan(0);
    }
  });
});
