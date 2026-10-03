import { describe, expect, it } from 'vitest';
import { finishedCount, hasPathProgress, labRowState, pathAction, totalMinutes } from './path';
import type { LabStatus } from './summary';

const labs = [
  { id: 'a', objectives: 3 },
  { id: 'b', objectives: 4 },
  { id: 'c', objectives: 2 },
];

const status = (labId: string, over: Partial<LabStatus> = {}): LabStatus => ({
  labId,
  completed: 0,
  finished: false,
  started: true,
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const mapOf = (...list: LabStatus[]) => new Map(list.map((s) => [s.labId, s]));

describe('progreso de una ruta', () => {
  it('cuenta solo los labs terminados de la ruta', () => {
    const byLab = mapOf(
      status('a', { finished: true }),
      status('b'),
      status('otra-ruta', { finished: true }),
    );
    expect(finishedCount(labs, byLab)).toBe(1);
    expect(hasPathProgress(labs, byLab)).toBe(true);
    expect(hasPathProgress(labs, mapOf(status('otra-ruta')))).toBe(false);
  });

  it('estado de cada fila', () => {
    const [a] = labs;
    if (!a) throw new Error('sin labs');
    expect(labRowState(a, undefined)).toEqual({ kind: 'not-started' });
    expect(labRowState(a, status('a', { finished: true, completed: 3 }))).toEqual({
      kind: 'done',
    });
    expect(labRowState(a, status('a', { completed: 2 }))).toEqual({
      kind: 'in-progress',
      completed: 2,
      total: 3,
    });
    // Nunca "5 de 3", aunque el guardado traiga objetivos que ya no existen.
    expect(labRowState(a, status('a', { completed: 5 }))).toMatchObject({ completed: 3 });
  });

  it('sin progreso en la ruta, empieza por el primer lab', () => {
    expect(pathAction(labs, mapOf(status('otra-ruta')))).toEqual({
      kind: 'start',
      lab: labs[0],
    });
  });

  it('continuar va al último lab tocado de la ruta que no está terminado', () => {
    const byLab = mapOf(
      status('a', { updatedAt: '2026-10-01T00:00:00.000Z' }),
      status('b', { updatedAt: '2026-10-02T00:00:00.000Z' }),
      status('c', { finished: true, updatedAt: '2026-10-05T00:00:00.000Z' }),
      // Más reciente, pero de otra ruta: no cuenta.
      status('otra-ruta', { updatedAt: '2026-10-09T00:00:00.000Z' }),
    );
    expect(pathAction(labs, byLab)).toEqual({ kind: 'continue', lab: labs[1] });
  });

  it('con solo labs terminados, continúa por el primero pendiente en orden', () => {
    const byLab = mapOf(status('a', { finished: true }), status('c', { finished: true }));
    expect(pathAction(labs, byLab)).toEqual({ kind: 'continue', lab: labs[1] });
  });

  it('con la ruta terminada, propone repasar desde el primero', () => {
    const byLab = mapOf(
      status('a', { finished: true }),
      status('b', { finished: true }),
      status('c', { finished: true }),
    );
    expect(pathAction(labs, byLab)).toEqual({ kind: 'review', lab: labs[0] });
  });

  it('una ruta vacía no tiene acción y suma cero minutos', () => {
    expect(pathAction([], new Map())).toBeNull();
    expect(totalMinutes([])).toBe(0);
    expect(totalMinutes([{ minutes: 10 }, { minutes: 15 }])).toBe(25);
  });
});
