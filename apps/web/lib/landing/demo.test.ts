/**
 * La portada no puede prometer lo que el motor no hace: la demostración
 * resuelve una tarea real y los comandos de RouterOS de la comparación se
 * ejecutan sin error en el simulador.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../i18n';
import { describeEvidence, evidenceOf } from '../lab/evidence';
import { createLabStore } from '../lab/store';
import { COMPARE_ROWS, DEMO_COMMAND, DEMO_OBJECTIVE } from './demo';

const lab1 = () => {
  const file = join(
    import.meta.dirname,
    '../../../../content/labs/routeros/01-acceso-inicial.yaml',
  );
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe('portada', () => {
  it('la demostración cumple la tarea del lab 1 y cambia el prompt', () => {
    const store = createLabStore(lab1());
    expect(store.getState().runtime.lab.objectives.map((o) => o.id)).toContain(DEMO_OBJECTIVE);
    expect(store.getState().prompt()).toBe('[admin@MikroTik] > ');
    const result = store.getState().run(DEMO_COMMAND);
    expect(result.ok).toBe(true);
    expect(store.getState().objectives[DEMO_OBJECTIVE]).toBe('done');
    expect(store.getState().prompt()).toBe('[admin@R1-Oficina] > ');
    const report = evidenceOf(store.getState(), DEMO_OBJECTIVE).map((e) =>
      describeEvidence(e, messagesFor('es')),
    );
    expect(report).toEqual(['R1: identity = R1-Oficina']);
  });

  it('los comandos de RouterOS de la comparación los acepta el simulador', () => {
    const store = createLabStore(lab1());
    for (const row of COMPARE_ROWS) {
      for (const line of row.routeros) {
        const result = store.getState().run(line.command);
        expect(result.ok, `${line.command}\n${result.output}`).toBe(true);
      }
    }
    expect(store.getState().prompt()).toBe('[admin@R1] > ');
  });
});
