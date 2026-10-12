/**
 * La referencia de comandos de content/reference/routeros: cada tema es
 * válido, enlaza labs que existen y todos sus ejemplos se comportan en el
 * simulador como dice la ficha (los marcados `fails` fallan; el resto no).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReferenceTopic } from '@nos/core';
import { parseReferenceYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { scriptLines } from './apply';
import { LABS_DIR, labFiles, loadLabFile } from './content-kit';
import { Terminal } from './terminal';

const REFERENCE_DIR = join(import.meta.dirname, '../../../../content/reference/routeros');
const SANDBOX = join(LABS_DIR, '../../sandbox/routeros.yaml');

const topicFiles = (): string[] => {
  try {
    return readdirSync(REFERENCE_DIR).filter((f) => f.endsWith('.yaml'));
  } catch {
    return [];
  }
};

function loadTopic(file: string): ReferenceTopic {
  const parsed = parseReferenceYaml(readFileSync(join(REFERENCE_DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  return parsed.value;
}

/** Consola de R1 en un router de práctica recién cargado. */
const sandbox = (): Terminal => new Terminal(loadLabFile(SANDBOX).net, 'R1');

describe('router de práctica', () => {
  it('carga y R1 tiene consola', () => {
    expect(sandbox().prompt).toBe('[admin@MikroTik] > ');
  });
});

describe('content/reference/routeros', () => {
  const files = topicFiles();
  const labIds = new Set(labFiles().map((f) => loadLabFile(f).lab.id));

  it('ids únicos y orden consecutivo', () => {
    const topics = files.map(loadTopic);
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
        for (const line of scriptLines(topic.setup ?? '')) t.ok(line);
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
