/**
 * Lectura de labs en YAML. Vive en una entrada aparte (`@nos/core/lab-yaml`)
 * para que el parser de YAML no llegue al navegador: los labs se validan y
 * convierten a JSON al compilar.
 */
import { parse } from 'yaml';
import { z } from 'zod';
import { err, ok, type Result } from '../model/result';
import { type LabDefinition, LabSchema } from './schema';

export function parseLabYaml(text: string): Result<LabDefinition, string> {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return err(`YAML inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = LabSchema.safeParse(raw);
  return result.success ? ok(result.data) : err(z.prettifyError(result.error));
}
