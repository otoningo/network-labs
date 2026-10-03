import { resolveName } from '../engine/runtime';
import { addressesOf, trace } from '../engine/trace';
import type { DeviceId, ItemId } from '../model/brand';
import { COLLECTION_KEYS, type CollectionKey } from '../model/collections';
import type { DeviceConfig } from '../model/config';
import { getDevice, interfaceByName } from '../model/lookup';
import type { Device, Network } from '../model/network';
import { type Ipv4, type Ipv4Prefix, prefixContains, prefixCovers, samePrefix } from '../net/ipv4';
import { type CollectionSpec, specOf } from '../ops/registry';
import type {
  CountCmp,
  FlowSpec,
  IfRef,
  Matcher,
  Predicate,
  Target,
  WhereClause,
} from './predicates';

export interface EvalContext {
  readonly net: Network;
  /** Configuración de cada dispositivo al cargar el lab, para `configMatches: startup`. */
  readonly startup: ReadonlyMap<DeviceId, DeviceConfig>;
}

// ── Utilidades (exportadas para evidence.ts; no salen del paquete) ───────────

export function resolveIface(device: Device, ref: IfRef): ItemId | undefined {
  if ('id' in ref)
    return device.config.interfaces.some((i) => i.id === ref.id) ? ref.id : undefined;
  return interfaceByName(device.config, ref.name)?.id;
}

function targetIp(net: Network, target: Target): Ipv4 | undefined {
  if ('ip' in target) return target.ip;
  return addressesOf(net, target.device)[0]?.address.ip;
}

export function runFlow(net: Network, spec: FlowSpec) {
  const dst = targetIp(net, spec.to);
  if (dst === undefined) return undefined;
  return trace(net, {
    from: spec.from,
    dst,
    protocol: spec.protocol,
    ...(spec.port === undefined ? {} : { dstPort: spec.port }),
  });
}

const isPrefix = (v: unknown): v is Ipv4Prefix =>
  typeof v === 'object' && v !== null && 'ip' in v && 'len' in v;

export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function matcherHolds(device: Device, value: unknown, matcher: Matcher): boolean {
  if ('eq' in matcher) return value === matcher.eq;
  if ('ip' in matcher) return value === matcher.ip;
  if ('prefix' in matcher) return isPrefix(value) && samePrefix(value, matcher.prefix);
  if ('within' in matcher) {
    if (typeof value === 'number') return prefixContains(matcher.within, value as Ipv4);
    return isPrefix(value) && prefixCovers(matcher.within, value);
  }
  if ('iface' in matcher)
    return value !== undefined && value === resolveIface(device, matcher.iface);
  if ('exists' in matcher) return (value !== undefined) === matcher.exists;
  if (!Array.isArray(value)) return false;
  const wanted = matcher.includes;
  if (typeof wanted === 'object' && 'ip' in wanted) return value.includes(wanted.ip);
  if (typeof wanted === 'object' && 'iface' in wanted) {
    const id = resolveIface(device, wanted.iface);
    return id !== undefined && value.includes(id);
  }
  return value.includes(wanted);
}

function compare(count: number, cmp: CountCmp): boolean {
  switch (cmp.op) {
    case '>=':
      return count >= cmp.n;
    case '<=':
      return count <= cmp.n;
    case '==':
      return count === cmp.n;
    case '>':
      return count > cmp.n;
    case '<':
      return count < cmp.n;
  }
}

/** Igualdad estructural que ignora el orden de las claves de los objetos. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return (
    keys.length === Object.keys(rb).length && keys.every((k) => k in rb && deepEqual(ra[k], rb[k]))
  );
}

// ── Comparación de configuraciones ──────────────────────────────────────────

/** Claves cuyo valor numérico es el id de otro ítem (ver los `refs` del registro). */
const REF_KEYS = new Set([
  'parent',
  'list',
  'iface',
  'bridge',
  'tagged',
  'untagged',
  'next',
  'pool',
  'server',
]);
/** `value` solo es un id dentro de estas coincidencias (`Neg<ItemId>`). */
const REF_VALUE_PARENTS = new Set(['inInterface', 'outInterface']);

const sortedEntries = (value: object): [string, unknown][] =>
  Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Copia de la configuración con cada id cambiado por su colección y posición.
 * Los ids son internos: una configuración importada desde un export queda
 * con otros ids pero es la misma configuración para quien la mira.
 */
function canonicalConfig(config: DeviceConfig): DeviceConfig {
  // Cada id pasa a "colección#posición": añadir un ítem en otra colección no mueve nada.
  const ids = new Map<number, string>();
  for (const coll of COLLECTION_KEYS) {
    specOf(coll)
      .get(config)
      .forEach((item, index) => {
        ids.set(item.id, `${coll}#${index}`);
      });
  }
  const mapId = (n: unknown) => (typeof n === 'number' ? (ids.get(n) ?? n) : n);
  const rewrite = (value: unknown, parentKey: string): unknown => {
    if (Array.isArray(value)) {
      return REF_KEYS.has(parentKey) ? value.map(mapId) : value.map((v) => rewrite(v, ''));
    }
    if (typeof value !== 'object' || value === null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of sortedEntries(value)) {
      const isRef =
        key === 'id' || REF_KEYS.has(key) || (key === 'value' && REF_VALUE_PARENTS.has(parentKey));
      out[key] = isRef && !Array.isArray(inner) ? mapId(inner) : rewrite(inner, key);
    }
    return out;
  };
  return rewrite(config, '') as DeviceConfig;
}

/** Misma configuración salvo los ids internos; con `scope`, solo esas colecciones. */
export function sameConfig(
  a: DeviceConfig,
  b: DeviceConfig,
  scope?: readonly CollectionKey[],
): boolean {
  const ca = canonicalConfig(a);
  const cb = canonicalConfig(b);
  if (!scope) return deepEqual(ca, cb);
  return scope.every((coll) => deepEqual(specOf(coll).get(ca), specOf(coll).get(cb)));
}

function globMatches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

export function itemsWhere(
  device: Device,
  coll: CollectionKey,
  where: readonly WhereClause[],
): number {
  const spec: CollectionSpec<CollectionKey> = specOf(coll);
  const invalid = new Set(device.oper.invalid.filter((i) => i.coll === coll).map((i) => i.id));
  const mentionsDisabled = where.some((w) => w.path[0] === 'disabled');
  return spec.get(device.config).filter((item) => {
    if (invalid.has(item.id)) return false;
    if (!mentionsDisabled && item.disabled) return false;
    return where.every((w) => matcherHolds(device, valueAt(item, w.path), w.match));
  }).length;
}

// ── Evaluador ───────────────────────────────────────────────────────────────

export function evaluate(predicate: Predicate, ctx: EvalContext): boolean {
  const { net } = ctx;
  const device = (id: DeviceId) => getDevice(net, id);

  switch (predicate.kind) {
    case 'all':
      return predicate.of.every((p) => evaluate(p, ctx));
    case 'any':
      return predicate.of.some((p) => evaluate(p, ctx));
    case 'not':
      return !evaluate(predicate.of, ctx);

    case 'hasAddress': {
      const d = device(predicate.device);
      const iface = d && resolveIface(d, predicate.iface);
      if (!d || iface === undefined) return false;
      return addressesOf(net, d.id).some((a) => {
        if (a.iface !== iface) return false;
        if (predicate.prefix && !samePrefix(a.address, predicate.prefix)) return false;
        if (predicate.within && !prefixCovers(predicate.within, a.address)) return false;
        return true;
      });
    }

    case 'routeActive': {
      const d = device(predicate.device);
      if (!d) return false;
      const via = predicate.via;
      const viaIface = via && 'iface' in via ? resolveIface(d, via.iface) : undefined;
      return d.oper.rib.some((r) => {
        if (!r.active || !samePrefix(r.dst, predicate.dst)) return false;
        if (!via) return true;
        return 'ip' in via ? r.gateway === via.ip : viaIface !== undefined && r.iface === viaIface;
      });
    }

    case 'reachable':
      return runFlow(net, predicate)?.ok ?? false;

    case 'blocked': {
      const result = runFlow(net, predicate);
      if (!result || result.ok) return false;
      if (predicate.by === 'any') return true;
      return result.forward.end.kind === 'filtered' || result.reply?.end.kind === 'filtered';
    }

    case 'natSourceIs': {
      const result = runFlow(net, predicate);
      if (!result?.ok || !result.delivered) return false;
      const expected = predicate.expect;
      if ('ip' in expected) return result.delivered.src === expected.ip;
      const owner = device(expected.addressOf.device);
      const iface = owner && resolveIface(owner, expected.addressOf.iface);
      return addressesOf(net, expected.addressOf.device).some(
        (a) => a.iface === iface && a.address.ip === result.delivered?.src,
      );
    }

    case 'leaseBound':
      return (device(predicate.server)?.oper.dhcpLeases ?? []).some(
        (l) =>
          l.client.device === predicate.client &&
          (predicate.within === undefined || prefixContains(predicate.within, l.ip)),
      );

    case 'wifiAssociated': {
      const ap = device(predicate.ap);
      if (!ap) return false;
      return ap.oper.wifiRegistrations.some((r) => {
        if (r.client.device !== predicate.client) return false;
        if (predicate.ssid === undefined) return true;
        const iface = ap.config.interfaces.find((i) => i.id === r.iface);
        return iface?.kind === 'wireless' && iface.ssid === predicate.ssid;
      });
    }

    case 'resolves': {
      const result = resolveName(net, predicate.from, predicate.name);
      if (result.outcome !== 'answered') return false;
      if (predicate.to !== undefined && result.address !== predicate.to) return false;
      return predicate.via === undefined || result.chain.slice(1).includes(predicate.via);
    }

    case 'fileExists':
      return (device(predicate.device)?.storage.files ?? []).some(
        (f) =>
          f.payload.kind === predicate.type &&
          (predicate.name === undefined || globMatches(predicate.name, f.name)),
      );

    case 'configMatches': {
      const d = device(predicate.device);
      if (!d) return false;
      const snapshot = predicate.snapshot;
      let reference: DeviceConfig | undefined;
      if (snapshot === 'startup') {
        reference = ctx.startup.get(d.id);
      } else {
        const file = d.storage.files.find((f) => f.name === snapshot.file);
        reference = file?.payload.kind === 'backup' ? file.payload.config : undefined;
      }
      if (!reference) return false;
      return sameConfig(d.config, reference, predicate.scope);
    }

    case 'exists': {
      const d = device(predicate.device);
      return d ? compare(itemsWhere(d, predicate.coll, predicate.where), predicate.count) : false;
    }

    case 'setting': {
      const d = device(predicate.device);
      if (!d) return false;
      const values = {
        system: d.config.system,
        dns: d.config.dns,
        discovery: d.config.discovery,
        l2Access: d.config.l2Access,
      };
      return matcherHolds(d, valueAt(values[predicate.key], predicate.path), predicate.match);
    }

    case 'interfaceRunning': {
      const d = device(predicate.device);
      const iface = d && resolveIface(d, predicate.iface);
      return d?.oper.interfaces.some((i) => i.iface === iface && i.running) ?? false;
    }

    case 'neighborSeen':
      return (device(predicate.device)?.oper.neighbors ?? []).some(
        (n) => n.peer === predicate.peer,
      );
  }
}
