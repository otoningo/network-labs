import { describe, expect, it } from 'vitest';
import type { LabProgress } from './repository';
import { summarize } from './summary';

const progress = (labId: string, over: Partial<LabProgress> = {}): LabProgress => ({
  version: 1,
  labId,
  log: [],
  hints: {},
  completed: {},
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('resumen de progreso', () => {
  it('ignora labs sin actividad y cuenta objetivos cumplidos', () => {
    const { byLab } = summarize([
      progress('a'),
      progress('b', { hints: { x: 1 } }),
      progress('c', {
        log: [{ device: 'R1', line: '/ip address print' }],
        completed: { x: 't', y: 't' },
      }),
    ]);
    expect([...byLab.keys()]).toEqual(['b', 'c']);
    expect(byLab.get('c')?.completed).toBe(2);
  });

  it('continuar apunta al último lab tocado que no está terminado', () => {
    const line = [{ device: 'R1', line: 'x' }];
    const { resume } = summarize([
      progress('viejo', { log: line, updatedAt: '2026-10-01T00:00:00.000Z' }),
      progress('nuevo', { log: line, updatedAt: '2026-10-03T00:00:00.000Z' }),
      progress('terminado', {
        log: line,
        finishedAt: '2026-10-04T00:00:00.000Z',
        updatedAt: '2026-10-04T00:00:00.000Z',
      }),
    ]);
    expect(resume?.labId).toBe('nuevo');
  });

  it('sin actividad no hay nada que continuar', () => {
    expect(summarize([]).resume).toBeNull();
  });
});
