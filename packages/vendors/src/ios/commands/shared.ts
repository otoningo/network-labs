/** Utilidades de lectura de argumentos compartidas por las áreas de IOS. */
import { type Ipv4, lenOfMask, parseIpv4 } from '@nos/core';

/** Longitud de una máscara A.B.C.D ya validada (o `/nn`). */
export function lenOfMaskText(text: string): number {
  if (text.startsWith('/')) return Number(text.slice(1));
  const ip = parseIpv4(text);
  return (ip && lenOfMask(ip)) ?? 0;
}

/** Comodín A.B.C.D → longitud de prefijo; null si los bits no son contiguos. */
export function lenOfWildcard(text: string): number | null {
  const wildcard = parseIpv4(text);
  if (wildcard === null) return null;
  return lenOfMask((~wildcard >>> 0) as Ipv4);
}

/** Direcciones IP de una lista de argumentos con nombre `ip1`, `ip2`... sin repetir. */
export function ipArgs(args: Readonly<Record<string, string>>, names: readonly string[]): Ipv4[] {
  const ips = names.map((n) => parseIpv4(args[n] ?? '')).filter((ip): ip is Ipv4 => ip !== null);
  return [...new Set(ips)];
}
