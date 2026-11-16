/**
 * La referencia de comandos de content/reference/ios: cada tema es válido,
 * enlaza labs que existen y todos sus ejemplos se comportan en el simulador
 * como dice la ficha (los marcados `fails` fallan; el resto no).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLab, type ReferenceTopic } from '@nos/core';
import { parseLabYaml, parseReferenceYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { iosStartup } from './driver';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

const CONTENT_DIR = join(import.meta.dirname, '../../../../content');
const REFERENCE_DIR = join(CONTENT_DIR, 'reference/ios');
const LABS_DIR = join(CONTENT_DIR, 'labs/ios');
const SANDBOX = join(CONTENT_DIR, 'sandbox/ios.yaml');

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
    platforms: { ios: IOS_PLATFORM },
    runStartup: iosStartup,
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
const sandbox = (): IosTerminal => new IosTerminal(loadLabFile(SANDBOX).net, 'R1');

describe('router de práctica de IOS', () => {
  it('carga y R1 tiene consola en el EXEC de usuario, con los puertos apagados', () => {
    const lab = loadLabFile(SANDBOX).lab;
    expect(lab.id).toBe('sandbox-ios');
    expect(lab.vendor).toBe('ios');
    const t = sandbox();
    expect(t.prompt).toBe('Router>');
    expect(t.device.config.interfaces.every((i) => i.disabled)).toBe(true);
  });
});

describe('content/reference/ios', () => {
  const files = yamlFiles(REFERENCE_DIR);
  const labIds = new Set(yamlFiles(LABS_DIR).map((f) => loadLabFile(join(LABS_DIR, f)).lab.id));

  it('hay temas, todos de IOS, con ids únicos y orden consecutivo', () => {
    const topics = files.map(loadTopic);
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(topic.vendor, topic.id).toBe('ios');
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

      it('la preparación deja la consola en EXEC, sin preguntas pendientes', () => {
        const t = sandbox();
        for (const line of setupLines(topic.setup)) t.ok(line);
        expect(['Router>', 'Router#']).toContain(t.prompt);
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
