/**
 * Normalización de valores escritos por el usuario a su forma canónica
 * (la que muestra print y export). Los errores usan los códigos que
 * `describeError` convierte en mensajes de RouterOS.
 */
import {
  err,
  formatIpv4,
  formatPortSet,
  formatPrefix,
  formatRange,
  ok,
  parseIpv4,
  parseMac,
  parsePortSet,
  parsePrefix,
  parseRange,
  type Result,
} from '@nos/core';
import { BUILTIN_LISTS, resolveRef } from './refs';
import { type Fault, fault, type MenuCtx, type ValueType } from './schema';
import {
  formatDuration,
  formatKib,
  formatVlanIds,
  parseDuration,
  parseKib,
  parseVlanIds,
} from './values';

const invalid = (arg: string, at: number): Fault => fault('invalid-value', at, { arg });

/** Coincidencia exacta o prefijo único (RouterOS acepta abreviaturas). */
export function matchPrefix(
  word: string,
  options: readonly string[],
): { match?: string; ambiguous: boolean } {
  if (options.includes(word)) return { match: word, ambiguous: false };
  const hits = options.filter((o) => o.startsWith(word));
  if (hits.length === 1) return { match: hits[0] as string, ambiguous: false };
  return { ambiguous: hits.length > 1 };
}

const PROTOCOLS: Readonly<Record<string, string>> = { '1': 'icmp', '6': 'tcp', '17': 'udp' };

function single(
  type: ValueType,
  raw: string,
  arg: string,
  at: number,
  ctx: MenuCtx,
): Result<string, Fault> {
  switch (type.kind) {
    case 'string':
      return ok(raw);
    case 'name':
      return raw.trim() === '' ? err(invalid(arg, at)) : ok(raw);
    case 'flag':
    case 'bool': {
      const v = raw.toLowerCase();
      if (v === '' && type.kind === 'flag') return ok('yes');
      if (v === 'yes' || v === 'true') return ok('yes');
      if (v === 'no' || v === 'false') return ok('no');
      return err(invalid(arg, at));
    }
    case 'int': {
      if (!/^\d+$/.test(raw)) return err(invalid(arg, at));
      const n = Number(raw);
      if (n < type.min || n > type.max)
        return err(fault('out-of-range', at, { arg, min: type.min, max: type.max }));
      return ok(String(n));
    }
    case 'time': {
      const seconds = parseDuration(raw);
      return seconds === null ? err(invalid(arg, at)) : ok(formatDuration(seconds));
    }
    case 'kib': {
      const kib = parseKib(raw);
      return kib === null ? err(invalid(arg, at)) : ok(formatKib(kib));
    }
    case 'ip': {
      const ip = parseIpv4(raw);
      return ip === null ? err(invalid(arg, at)) : ok(formatIpv4(ip));
    }
    case 'prefix': {
      const p = parsePrefix(raw);
      return p === null ? err(invalid(arg, at)) : ok(formatPrefix(p));
    }
    case 'address': {
      if (raw.includes('-')) {
        const r = parseRange(raw);
        return r === null ? err(invalid(arg, at)) : ok(formatRange(r));
      }
      const p = parsePrefix(raw);
      if (p === null) return err(invalid(arg, at));
      return ok(p.len === 32 ? formatIpv4(p.ip) : formatPrefix(p));
    }
    case 'ip-list': {
      if (raw === '') return ok('');
      const ips = raw.split(',').map((s) => parseIpv4(s.trim()));
      if (ips.some((ip) => ip === null)) return err(invalid(arg, at));
      return ok(ips.map((ip) => formatIpv4(ip as NonNullable<typeof ip>)).join(','));
    }
    case 'prefix-list': {
      if (raw === '') return ok('');
      const list = raw.split(',').map((s) => parsePrefix(s.trim()));
      if (list.some((p) => p === null)) return err(invalid(arg, at));
      return ok(list.map((p) => formatPrefix(p as NonNullable<typeof p>)).join(','));
    }
    case 'range-list': {
      const ranges = raw.split(',').map((s) => parseRange(s.trim()));
      if (raw === '' || ranges.some((r) => r === null)) return err(invalid(arg, at));
      return ok(ranges.map((r) => formatRange(r as NonNullable<typeof r>)).join(','));
    }
    case 'mac': {
      const mac = parseMac(raw);
      return mac === null ? err(invalid(arg, at)) : ok(mac);
    }
    case 'enum': {
      const { match } = matchPrefix(raw, type.values);
      return match === undefined ? err(invalid(arg, at)) : ok(match);
    }
    case 'enum-list': {
      if (raw === '') return ok('');
      const out: string[] = [];
      for (const part of raw.split(',')) {
        const { match } = matchPrefix(part.trim(), type.values);
        if (match === undefined) return err(invalid(arg, at));
        out.push(match);
      }
      return ok(out.join(','));
    }
    case 'ref': {
      if (type.extra?.includes(raw)) return ok(raw);
      if (type.target === 'interface-list' && (BUILTIN_LISTS as readonly string[]).includes(raw))
        return ok(raw);
      return resolveRef(ctx, type.target, raw) === undefined
        ? err(fault('no-match', at, { arg }))
        : ok(raw);
    }
    case 'ref-list': {
      if (raw === '') return ok('');
      const names = raw.split(',').map((s) => s.trim());
      for (const name of names) {
        const builtin =
          type.target === 'interface-list' && (BUILTIN_LISTS as readonly string[]).includes(name);
        if (!builtin && resolveRef(ctx, type.target, name) === undefined) {
          return err(fault('no-match', at, { arg }));
        }
      }
      return ok(names.join(','));
    }
    case 'vlan-ids': {
      const ids = parseVlanIds(raw);
      if (ids === null) return err(invalid(arg, at));
      const bad = ids.find((id) => id < 1 || id > 4094);
      if (bad !== undefined) return err(fault('out-of-range', at, { arg, min: 1, max: 4094 }));
      return ok(formatVlanIds(ids));
    }
    case 'ports': {
      const set = parsePortSet(raw);
      return set === null ? err(invalid(arg, at)) : ok(formatPortSet(set));
    }
    case 'protocol': {
      const v = raw.toLowerCase();
      if (/^\d+$/.test(v)) {
        const n = Number(v);
        if (n > 255) return err(fault('out-of-range', at, { arg, min: 0, max: 255 }));
        return ok(PROTOCOLS[v] ?? v);
      }
      const { match } = matchPrefix(v, ['icmp', 'tcp', 'udp']);
      return match === undefined ? err(invalid(arg, at)) : ok(match);
    }
    case 'gateway': {
      const [ipPart, ifacePart] = raw.split('%');
      const ip = parseIpv4(ipPart ?? '');
      if (ip !== null && ifacePart === undefined) return ok(formatIpv4(ip));
      if (ip !== null && ifacePart !== undefined) {
        return resolveRef(ctx, 'interface', ifacePart) === undefined
          ? err(fault('no-match', at, { arg }))
          : ok(`${formatIpv4(ip)}%${ifacePart}`);
      }
      return resolveRef(ctx, 'interface', raw) === undefined ? err(invalid(arg, at)) : ok(raw);
    }
    case 'neg':
      return single(type.inner, raw, arg, at, ctx);
  }
}

export function normalize(
  type: ValueType,
  raw: string,
  arg: string,
  at: number,
  ctx: MenuCtx,
): Result<string, Fault> {
  if (type.kind === 'neg' && raw.startsWith('!')) {
    const inner = single(type.inner, raw.slice(1), arg, at, ctx);
    return inner.ok ? ok(`!${inner.value}`) : inner;
  }
  return single(type, raw, arg, at, ctx);
}
