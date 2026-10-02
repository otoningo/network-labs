import type { Brand } from '../model/brand';

/** Dirección IPv4 como entero sin signo de 32 bits. */
export type Ipv4 = Brand<number, 'Ipv4'>;

/** Dirección con longitud de prefijo. Sirve para redes y para direcciones de interfaz. */
export interface Ipv4Prefix {
  readonly ip: Ipv4;
  readonly len: number;
}

export interface IpRange {
  readonly from: Ipv4;
  readonly to: Ipv4;
}

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const MAX = 0xffffffff;

export function parseIpv4(text: string): Ipv4 | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    value = value * 256 + Number(part);
  }
  return value as Ipv4;
}

/** Igual que parseIpv4 pero lanza: solo para fixtures y pruebas. */
export function ipv4(text: string): Ipv4 {
  const ip = parseIpv4(text);
  if (ip === null) throw new Error(`IPv4 inválida: ${text}`);
  return ip;
}

export function formatIpv4(ip: Ipv4): string {
  return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.');
}

export function maskOf(len: number): number {
  return len === 0 ? 0 : (MAX << (32 - len)) >>> 0;
}

/** Longitud de una máscara en notación decimal; null si no es contigua. */
export function lenOfMask(mask: Ipv4): number | null {
  for (let len = 0; len <= 32; len++) {
    if (maskOf(len) === mask) return len;
  }
  return null;
}

/** Acepta `a.b.c.d/len`, `a.b.c.d/m.m.m.m` y `a.b.c.d` (equivale a /32). */
export function parsePrefix(text: string): Ipv4Prefix | null {
  const slash = text.indexOf('/');
  const ip = parseIpv4(slash === -1 ? text : text.slice(0, slash));
  if (ip === null) return null;
  if (slash === -1) return { ip, len: 32 };
  const rest = text.slice(slash + 1);
  if (/^\d{1,2}$/.test(rest)) {
    const len = Number(rest);
    return len <= 32 ? { ip, len } : null;
  }
  const mask = parseIpv4(rest);
  if (mask === null) return null;
  const len = lenOfMask(mask);
  return len === null ? null : { ip, len };
}

export function prefix(text: string): Ipv4Prefix {
  const p = parsePrefix(text);
  if (p === null) throw new Error(`Prefijo inválido: ${text}`);
  return p;
}

export function formatPrefix(p: Ipv4Prefix): string {
  return `${formatIpv4(p.ip)}/${p.len}`;
}

export function networkOf(p: Ipv4Prefix): Ipv4Prefix {
  return { ip: ((p.ip & maskOf(p.len)) >>> 0) as Ipv4, len: p.len };
}

export function broadcastOf(p: Ipv4Prefix): Ipv4 {
  return ((p.ip | (~maskOf(p.len) >>> 0)) >>> 0) as Ipv4;
}

export function isNetworkAligned(p: Ipv4Prefix): boolean {
  return networkOf(p).ip === p.ip;
}

export function prefixContains(p: Ipv4Prefix, ip: Ipv4): boolean {
  const mask = maskOf(p.len);
  return (ip & mask) >>> 0 === (p.ip & mask) >>> 0;
}

/** ¿`outer` cubre por completo a `inner`? */
export function prefixCovers(outer: Ipv4Prefix, inner: Ipv4Prefix): boolean {
  return inner.len >= outer.len && prefixContains(outer, inner.ip);
}

export function samePrefix(a: Ipv4Prefix, b: Ipv4Prefix): boolean {
  return a.ip === b.ip && a.len === b.len;
}

export function sameNetwork(a: Ipv4Prefix, b: Ipv4Prefix): boolean {
  return samePrefix(networkOf(a), networkOf(b));
}

/** Rango de hosts utilizables; en /31 y /32 todas las direcciones lo son. */
export function usableHosts(p: Ipv4Prefix): IpRange {
  const net = networkOf(p).ip;
  const bcast = broadcastOf(p);
  if (p.len >= 31) return { from: net, to: bcast };
  return { from: (net + 1) as Ipv4, to: (bcast - 1) as Ipv4 };
}

/** ¿Es válida como dirección de host de una interfaz (no red ni broadcast)? */
export function isHostAddress(p: Ipv4Prefix): boolean {
  if (p.len >= 31) return true;
  return p.ip !== networkOf(p).ip && p.ip !== broadcastOf(p);
}

/** Acepta `a-b`, una sola IP o un prefijo (se convierte a rango completo). */
export function parseRange(text: string): IpRange | null {
  const dash = text.indexOf('-');
  if (dash !== -1) {
    const from = parseIpv4(text.slice(0, dash));
    const to = parseIpv4(text.slice(dash + 1));
    if (from === null || to === null || from > to) return null;
    return { from, to };
  }
  const p = parsePrefix(text);
  if (p === null) return null;
  return { from: networkOf(p).ip, to: broadcastOf(p) };
}

export function range(text: string): IpRange {
  const r = parseRange(text);
  if (r === null) throw new Error(`Rango inválido: ${text}`);
  return r;
}

export function formatRange(r: IpRange): string {
  return r.from === r.to ? formatIpv4(r.from) : `${formatIpv4(r.from)}-${formatIpv4(r.to)}`;
}

export function rangeContains(r: IpRange, ip: Ipv4): boolean {
  return ip >= r.from && ip <= r.to;
}

export function rangeSize(r: IpRange): number {
  return r.to - r.from + 1;
}

export function addToIpv4(ip: Ipv4, n: number): Ipv4 | null {
  const value = ip + n;
  return value < 0 || value > MAX ? null : (value as Ipv4);
}

export function compareIpv4(a: Ipv4, b: Ipv4): number {
  return a - b;
}

const PRIVATE: readonly Ipv4Prefix[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '169.254.0.0/16',
  '127.0.0.0/8',
].map(prefix);

/** Direcciones que no se enrutan en Internet (RFC 1918, CGNAT, link-local, loopback). */
export function isPrivateIpv4(ip: Ipv4): boolean {
  return PRIVATE.some((p) => prefixContains(p, ip));
}

/** Coincidencia contra prefijo o rango, que es como aparecen en reglas y listas. */
export function addressMatches(target: Ipv4Prefix | IpRange, ip: Ipv4): boolean {
  return 'len' in target ? prefixContains(target, ip) : rangeContains(target, ip);
}
