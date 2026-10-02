import type { Brand } from '../model/brand';

/** MAC canónica: seis octetos hexadecimales en mayúsculas separados por `:`. */
export type Mac = Brand<string, 'Mac'>;

/** Acepta `aa:bb:cc:dd:ee:ff`, `aa-bb-cc-dd-ee-ff`, `aabb.ccdd.eeff` y `aabb-ccdd-eeff`. */
const MAC_FORMATS = [
  /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i,
  /^[0-9a-f]{4}([.-])[0-9a-f]{4}\1[0-9a-f]{4}$/i,
  /^[0-9a-f]{12}$/i,
];

export function parseMac(text: string): Mac | null {
  if (!MAC_FORMATS.some((format) => format.test(text))) return null;
  const octets = text.replace(/[:.-]/g, '').toUpperCase().match(/.{2}/g) ?? [];
  return octets.join(':') as Mac;
}

export function mac(text: string): Mac {
  const value = parseMac(text);
  if (value === null) throw new Error(`MAC inválida: ${text}`);
  return value;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * MAC determinista de administración local (`02:...`): no usa prefijos OUI de
 * ningún fabricante y siempre da el mismo valor para el mismo dispositivo y puerto.
 */
export function deterministicMac(seed: string, index: number): Mac {
  const hash = fnv1a(`${seed}#${index}`);
  const bytes = [
    0x02,
    (hash >>> 24) & 255,
    (hash >>> 16) & 255,
    (hash >>> 8) & 255,
    hash & 255,
    index & 255,
  ];
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':') as Mac;
}

/** Hash estable de texto, útil para valores deterministas como la señal wifi. */
export function stableHash(text: string): number {
  return fnv1a(text);
}
