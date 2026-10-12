/**
 * La portada no puede prometer lo que el motor no hace: la demostración
 * resuelve una tarea real, el viaje del paquete usa esa misma regla y los
 * comandos de RouterOS de la comparación se ejecutan sin error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../i18n';
import { describeEvidence, evidenceOf } from '../lab/evidence';
import { createLabStore } from '../lab/store';
import { COMPARE_ROWS, DEMO_COMMAND, DEMO_OBJECTIVE } from './demo';
import { demoLab, JOURNEY_SCRIPT } from './journey';

const sandbox = () => {
  const file = join(import.meta.dirname, '../../../../content/sandbox/routeros.yaml');
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe('portada', () => {
  it('la demostración arranca sin cumplir y la regla de NAT la cumple', () => {
    const store = createLabStore(demoLab(sandbox()));
    expect(store.getState().objectives[DEMO_OBJECTIVE]).toBe('pending');
    const result = store.getState().run(DEMO_COMMAND);
    expect(result.ok, result.output).toBe(true);
    expect(store.getState().objectives[DEMO_OBJECTIVE]).toBe('done');
    const report = evidenceOf(store.getState(), DEMO_OBJECTIVE).map((e) =>
      describeEvidence(e, messagesFor('es')),
    );
    expect(report).toEqual(['tcp/443 PC1 → 93.184.216.34: llega como 203.0.113.2']);
  });

  it('el viaje termina con la misma línea que escribe la demostración', () => {
    expect(JOURNEY_SCRIPT.at(-1)).toBe(DEMO_COMMAND);
  });

  it('los comandos de RouterOS de la comparación los acepta un router de fábrica', () => {
    const store = createLabStore(sandbox());
    for (const row of COMPARE_ROWS) {
      for (const line of row.routeros) {
        const result = store.getState().run(line.command);
        expect(result.ok, `${line.command}\n${result.output}`).toBe(true);
      }
    }
  });
});
