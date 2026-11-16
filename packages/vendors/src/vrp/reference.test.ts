/**
 * La referencia de comandos de content/reference/vrp: cada tema es válido,
 * enlaza labs que existen y todos sus ejemplos se comportan en el simulador
 * como dice la ficha (los marcados `fails` fallan; el resto no).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLab, type ReferenceTopic } from '@nos/core';
import { parseLabYaml, parseReferenceYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

const CONTENT_DIR = join(import.meta.dirname, '../../../../content');
const REFERENCE_DIR = join(CONTENT_DIR, 'reference/vrp');
const LABS_DIR = join(CONTENT_DIR, 'labs/vrp');
const SANDBOX = join(CONTENT_DIR, 'sandbox/vrp.yaml');

const yamlFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
  } catch {
    return [];
  }
};

function loadTopic(file: string): ReferenceTopic {
  const parsed = parseReferenceYaml(readFileSync(join(REFERENCE_DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  return parsed.value;
}

function loadLabFile(path: string) {
  const parsed = parseLabYaml(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.error}`);
  const runtime = loadLab(parsed.value, {
    platforms: { vrp: VRP_PLATFORM },
    runStartup: vrpStartup,
  });
  if (!runtime.ok) throw new Error(`${path}: ${JSON.stringify(runtime.error)}`);
  return runtime.value;
}

/** Líneas de la preparación de un tema, tal como las teclea la web: una por línea. */
const setupLines = (setup: string | undefined): string[] =>
  (setup ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Consola de R1 en un router de práctica recién cargado. */
const sandbox = (): VrpTerminal => new VrpTerminal(loadLabFile(SANDBOX).net, 'R1');

describe('router de práctica de VRP', () => {
  it('carga y R1 tiene consola en la vista de usuario', () => {
    const lab = loadLabFile(SANDBOX).lab;
    expect(lab.id).toBe('sandbox-vrp');
    expect(lab.vendor).toBe('vrp');
    expect(sandbox().prompt).toBe('<Huawei>');
  });
});

describe('content/reference/vrp', () => {
  const files = yamlFiles(REFERENCE_DIR);
  const labIds = new Set(yamlFiles(LABS_DIR).map((f) => loadLabFile(join(LABS_DIR, f)).lab.id));

  it('hay temas, todos de VRP, con ids únicos y orden consecutivo', () => {
    const topics = files.map(loadTopic);
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(topic.vendor, topic.id).toBe('vrp');
    const ids = topics.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const orders = topics.map((t) => t.order).sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });

  for (const file of files) {
    describe(file, () => {
      const topic = loadTopic(file);

      it('enlaza labs que existen', () => {
        for (const lab of topic.labs) expect(labIds, lab).toContain(lab);
      });

      it('cada ejemplo se comporta como dice la ficha, en orden y sobre el mismo router', () => {
        const t = sandbox();
        for (const line of setupLines(topic.setup)) t.ok(line);
        for (const command of topic.commands) {
          for (const example of command.examples) {
            const output = t.run(example.command);
            const ok = t.last?.ok ?? false;
            const where = `${command.id}: ${example.command}\n${output}`;
            expect(ok, where).toBe(!example.fails);
          }
        }
      });
    });
  }
});
