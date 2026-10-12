/**
 * Textos de la referencia que se derivan del contenido, sin tocar el YAML.
 * Puro: se usa en el servidor al compilar y en las pruebas.
 */

export interface SplitSummary {
  /** Primera frase, sin el punto final: hace de título del comando. */
  readonly lead: string;
  /** Lo que sigue, si hay algo. */
  readonly rest: string;
}

/**
 * Parte el resumen de un comando en su primera frase y el resto. Solo corta
 * en un punto seguido de espacio fuera de `código`, así una dirección
 * (192.168.88.1) o un comando citado no parten la frase.
 */
export function splitSummary(summary: string): SplitSummary {
  const text = summary.trim();
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '`') inCode = !inCode;
    if (inCode || (ch !== '.' && ch !== '?' && ch !== '!')) continue;
    const next = text[i + 1];
    if (next === undefined) break;
    if (next !== ' ' && next !== '\n') continue;
    return {
      lead: ch === '.' ? text.slice(0, i) : text.slice(0, i + 1),
      rest: text.slice(i + 1).trim(),
    };
  }
  return { lead: text.endsWith('.') ? text.slice(0, -1) : text, rest: '' };
}

/** Ancla de un comando dentro de la página de su tema. */
export const commandAnchor = (commandId: string): string => `cmd-${commandId}`;

/** Id del panel del router de práctica: destino de "Probar" y del enlace del índice del tema. */
export const PRACTICE_PANEL_ID = 'practice-router';
