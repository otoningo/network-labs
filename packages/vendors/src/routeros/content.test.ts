/**
 * Los labs publicados en content/labs/routeros: cada uno carga, arranca sin
 * objetivos cumplidos y se resuelve por la CLI. Cada grupo de labs tiene su
 * propio archivo (content-02-06.test.ts, content-07-12.test.ts).
 */
import { evaluateObjectives } from '@nos/core';
import { describe, expect, it } from 'vitest';
import { Bench, labFiles, loadLabFile } from './content-kit';

describe('content/labs/routeros', () => {
  it('todos los archivos cargan y ninguno arranca resuelto', () => {
    const files = labFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const runtime = loadLabFile(file);
      const done = [...evaluateObjectives(runtime).values()].filter(Boolean);
      expect(done, file).toHaveLength(0);
    }
  });

  it('los ids y el orden de la ruta son únicos y consecutivos', () => {
    const labs = labFiles().map((file) => loadLabFile(file).lab);
    const ids = labs.map((lab) => lab.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = labs
      .filter((lab) => lab.path === 'mikrotik-desde-cero')
      .map((lab) => lab.order)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(orders).toEqual(orders.map((_, index) => index + 1));
  });

  it('lab 1: cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const bench = new Bench(loadLabFile('01-acceso-inicial.yaml'));
    const r1 = bench.on('R1');
    r1.ok('/system identity set name=R1-Oficina');
    expect(bench.pending()).toEqual(['lan', 'user', 'telnet']);
    r1.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(bench.pending()).toEqual(['user', 'telnet']);
    r1.ok('/user add name=soporte group=read password=Clave123');
    expect(bench.pending()).toEqual(['telnet']);
    r1.ok('/ip service disable telnet');
    expect(bench.pending()).toEqual([]);
    expect(r1.prompt).toBe('[admin@R1-Oficina] > ');
  });

  it('lab 1: deshabilitar telnet sin dirección en la LAN no cuenta', () => {
    const bench = new Bench(loadLabFile('01-acceso-inicial.yaml'));
    bench.on('R1').ok('/ip service disable telnet');
    expect(bench.pending()).toContain('telnet');
  });
});
