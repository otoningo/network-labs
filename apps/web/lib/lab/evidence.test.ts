import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../i18n';
import { describeEvidence, evidenceOf } from './evidence';
import { createLabStore } from './store';

const lab1 = () => {
  const file = join(
    import.meta.dirname,
    '../../../../content/labs/routeros/01-acceso-inicial.yaml',
  );
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const report = (store: ReturnType<typeof createLabStore>, id: string, locale: 'es' | 'en' = 'es') =>
  evidenceOf(store.getState(), id).map((e) => describeEvidence(e, messagesFor(locale)));

describe('evidencia redactada', () => {
  it('cuenta lo que la red reporta para cada tarea del lab 1', () => {
    const store = createLabStore(lab1());
    const run = store.getState().run;
    run('/system identity set name=R1-Oficina');
    run('/ip address add address=192.168.88.1/24 interface=ether2');
    run('/user add name=soporte group=read password=Clave123');
    run('/ip service disable telnet');
    expect(report(store, 'identity')).toEqual(['R1: identity = R1-Oficina']);
    expect(report(store, 'lan')).toEqual(['ping PC1 → 192.168.88.1: llega']);
    expect(report(store, 'user')).toEqual(['R1: 1 en users']);
    expect(report(store, 'telnet')).toEqual([
      'ping PC1 → 192.168.88.1: llega',
      'tcp/23 PC1 → 192.168.88.1: no llega, puerto cerrado en R1',
    ]);
    expect(report(store, 'telnet', 'en')[1]).toBe(
      'tcp/23 PC1 → 192.168.88.1: does not get through, port closed at R1',
    );
  });

  it('un objetivo desconocido no tiene evidencia', () => {
    expect(evidenceOf(createLabStore(lab1()).getState(), 'nada')).toEqual([]);
  });
});
