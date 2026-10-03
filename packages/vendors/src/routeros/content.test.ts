/**
 * Los labs publicados en content/labs/routeros: cada uno carga, arranca sin
 * objetivos cumplidos y se resuelve por la CLI. La fase 4 añade el resto.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateObjectives, type LabRuntime, loadLab } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { routerosStartup } from './driver';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

const DIR = join(import.meta.dirname, '../../../../content/labs/routeros');

function load(file: string): LabRuntime {
  const parsed = parseLabYaml(readFileSync(join(DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const runtime = loadLab(parsed.value, {
    platforms: { routeros: ROUTEROS_PLATFORM },
    runStartup: routerosStartup,
  });
  if (!runtime.ok) throw new Error(`${file}: ${JSON.stringify(runtime.error)}`);
  return runtime.value;
}

const pending = (runtime: LabRuntime, t: Terminal): string[] =>
  [...evaluateObjectives(runtime, t.net)].filter(([, done]) => !done).map(([id]) => id);

describe('content/labs/routeros', () => {
  it('todos los archivos cargan y ninguno arranca resuelto', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const runtime = load(file);
      const done = [...evaluateObjectives(runtime).values()].filter(Boolean);
      expect(done, file).toHaveLength(0);
    }
  });

  it('lab 1: cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const runtime = load('01-acceso-inicial.yaml');
    const t = new Terminal(runtime.net, 'R1');
    t.ok('/system identity set name=R1-Oficina');
    expect(pending(runtime, t)).toEqual(['lan', 'user', 'telnet']);
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(pending(runtime, t)).toEqual(['user', 'telnet']);
    t.ok('/user add name=soporte group=read password=Clave123');
    expect(pending(runtime, t)).toEqual(['telnet']);
    t.ok('/ip service disable telnet');
    expect(pending(runtime, t)).toEqual([]);
  });

  it('lab 1: deshabilitar telnet sin dirección en la LAN no cuenta', () => {
    const runtime = load('01-acceso-inicial.yaml');
    const t = new Terminal(runtime.net, 'R1');
    t.ok('/ip service disable telnet');
    expect(pending(runtime, t)).toContain('telnet');
  });
});
