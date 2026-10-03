/**
 * Lectura de los labs de content/labs. Solo corre en el servidor (al compilar
 * las páginas): el YAML se valida aquí y al navegador llega el objeto ya limpio.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';

const ROOT = join(process.cwd(), '../../content/labs');

let cache: readonly LabDefinition[] | null = null;

/** Todos los labs, ordenados por ruta y número. Un YAML inválido rompe la compilación con su error. */
export function allLabs(): readonly LabDefinition[] {
  // En desarrollo se relee siempre para ver al momento los cambios en el YAML.
  if (cache && process.env.NODE_ENV === 'production') return cache;
  const labs: LabDefinition[] = [];
  for (const vendor of readdirSync(ROOT, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    const dir = join(ROOT, vendor.name);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const parsed = parseLabYaml(readFileSync(join(dir, file), 'utf8'));
      if (!parsed.ok) throw new Error(`content/labs/${vendor.name}/${file}\n${parsed.error}`);
      labs.push(parsed.value);
    }
  }
  labs.sort(
    (a, b) => (a.path ?? '').localeCompare(b.path ?? '') || (a.order ?? 0) - (b.order ?? 0),
  );
  cache = labs;
  return labs;
}

export const labById = (id: string): LabDefinition | undefined =>
  allLabs().find((lab) => lab.id === id);
