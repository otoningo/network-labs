/**
 * La portada no puede prometer lo que el motor no hace: cada traducción
 * arranca sin cumplir y la línea de RouterOS que se escribe la cumple.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../i18n';
import { describeEvidence, evidenceOf } from '../lab/evidence';
import { createLabStore } from '../lab/store';
import { TRANSLATIONS, translationLab } from './translations';

const sandbox = () => {
  const file = join(import.meta.dirname, '../../../../content/sandbox/routeros.yaml');
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe('traductor de la portada', () => {
  for (const translation of TRANSLATIONS) {
    it(`${translation.id}: arranca pendiente y la línea de RouterOS la cumple`, () => {
      const store = createLabStore(translationLab(sandbox(), translation));
      expect(store.getState().objectives[translation.id]).toBe('pending');
      const result = store.getState().run(translation.routeros);
      expect(result.ok, result.output).toBe(true);
      expect(store.getState().objectives[translation.id]).toBe('done');
      const report = evidenceOf(store.getState(), translation.id).map((e) =>
        describeEvidence(e, messagesFor('es')),
      );
      expect(report.length).toBeGreaterThan(0);
    });
  }

  it('el NAT se comprueba por la IP con la que llega la PC', () => {
    const nat = TRANSLATIONS.find((t) => t.id === 'nat');
    if (!nat) throw new Error('falta la traducción del NAT');
    const store = createLabStore(translationLab(sandbox(), nat));
    store.getState().run(nat.routeros);
    const report = evidenceOf(store.getState(), 'nat').map((e) =>
      describeEvidence(e, messagesFor('es')),
    );
    expect(report).toEqual(['tcp/443 PC1 → 93.184.216.34: llega como 203.0.113.2']);
  });

  it('el nombre nuevo se ve en lo que reporta la red y en el prompt', () => {
    const hostname = TRANSLATIONS.find((x) => x.id === 'hostname');
    if (!hostname) throw new Error('falta la traducción del nombre');
    const store = createLabStore(translationLab(sandbox(), hostname));
    const before = store.getState().prompt();
    store.getState().run(hostname.routeros);
    expect(store.getState().prompt()).not.toBe(before);
    expect(store.getState().prompt()).toContain('Oficina');
    const report = evidenceOf(store.getState(), 'hostname').map((e) =>
      describeEvidence(e, messagesFor('es')),
    );
    expect(report.join(' ')).toContain('Oficina');
  });
});
