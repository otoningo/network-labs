/**
 * Textos visibles de una ruta, buscados por su id en el diccionario. Los
 * diccionarios tipan solo las claves que existen; aquí se leen como mapa.
 */
import type { Messages } from '@/lib/i18n';

const lookup = (map: Readonly<Record<string, string>>, key: string): string | undefined => map[key];

/** Título de una ruta publicada (`lab.paths`) o anunciada (`paths.titles`); si falta, su id. */
export const pathTitle = (messages: Messages, id: string): string =>
  lookup(messages.lab.paths, id) ?? lookup(messages.paths.titles, id) ?? id;

/** Qué sabrás hacer al terminar la ruta, si está escrito. */
export const pathDescription = (messages: Messages, id: string): string | undefined =>
  lookup(messages.paths.descriptions, id);
