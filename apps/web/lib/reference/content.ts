/**
 * Lectura de la referencia de comandos (content/reference) y del router de
 * práctica (content/sandbox). Solo en el servidor, al compilar.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LabDefinition, ReferenceTopic } from '@nos/core';
import { parseLabYaml, parseReferenceYaml } from '@nos/core/lab-yaml';

const CONTENT = join(process.cwd(), '../../content');

let cache: readonly ReferenceTopic[] | null = null;

/** Todos los temas, por sistema y orden. Un YAML inválido rompe la compilación. */
export function allTopics(): readonly ReferenceTopic[] {
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const root = join(CONTENT, 'reference');
  const topics: ReferenceTopic[] = [];
  for (const vendor of readdirSync(root, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    const dir = join(root, vendor.name);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const parsed = parseReferenceYaml(readFileSync(join(dir, file), 'utf8'));
      if (!parsed.ok) throw new Error(`content/reference/${vendor.name}/${file}\n${parsed.error}`);
      topics.push(parsed.value);
    }
  }
  topics.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.order - b.order);
  cache = topics;
  return topics;
}

export const topicById = (id: string): ReferenceTopic | undefined =>
  allTopics().find((t) => t.id === id);

/** Temas que enlazan un lab: la pantalla del lab los ofrece como lectura. */
export const topicsForLab = (labId: string): readonly ReferenceTopic[] =>
  allTopics().filter((t) => t.labs.includes(labId));

/** Router de práctica de un sistema, sin tareas, para probar los ejemplos. */
export function sandboxLab(vendor: ReferenceTopic['vendor']): LabDefinition {
  const file = join(CONTENT, 'sandbox', `${vendor}.yaml`);
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`content/sandbox/${vendor}.yaml\n${parsed.error}`);
  return parsed.value;
}
