/**
 * Lectura de labs en YAML. Vive en una entrada aparte (`@nos/core/lab-yaml`)
 * para que el parser de YAML no llegue al navegador: los labs se validan y
 * convierten a JSON al compilar.
 */
import { parse } from 'yaml';
import { z } from 'zod';
import { err, ok, type Result } from '../model/result';
import { type ReferenceTopic, ReferenceTopicSchema } from './reference';
import { type LabDefinition, LabSchema } from './schema';

function readYaml(text: string): Result<unknown, string> {
  try {
    return ok(parse(text));
  } catch (error) {
    return err(`YAML inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseLabYaml(text: string): Result<LabDefinition, string> {
  const raw = readYaml(text);
  if (!raw.ok) return raw;
  const result = LabSchema.safeParse(raw.value);
  return result.success ? ok(result.data) : err(z.prettifyError(result.error));
}

/** Un tema de la referencia de comandos (content/reference). */
export function parseReferenceYaml(text: string): Result<ReferenceTopic, string> {
  const raw = readYaml(text);
  if (!raw.ok) return raw;
  const result = ReferenceTopicSchema.safeParse(raw.value);
  return result.success ? ok(result.data) : err(z.prettifyError(result.error));
}
