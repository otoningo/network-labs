/**
 * Metadatos de cada colección: cómo leerla y escribirla dentro de la
 * configuración, a qué otras colecciones referencia, qué valores deben ser
 * únicos y qué reglas de coherencia tiene. `applyOp` es genérico gracias a esto.
 */

import type { ItemId } from '../model/brand';
import type { CollectionKey, ItemOf, NewItem } from '../model/collections';
import {
  BUILTIN_FILTER_CHAINS,
  type DeviceConfig,
  type Interface,
  type Match,
  type NatRule,
  type WirelessInterface,
} from '../model/config';
import type { CoreError, ErrorScope, ExpectedValue } from '../model/errors';
import {
  formatPrefix,
  formatRange,
  type IpRange,
  type Ipv4Prefix,
  isNetworkAligned,
} from '../net/ipv4';
import { parseMac } from '../net/mac';

export interface ItemRef {
  readonly field: string;
  readonly coll: CollectionKey;
  readonly id: ItemId;
}

export interface UniqueKey {
  readonly field: string;
  readonly value: string;
}

export interface CollectionSpec<K extends CollectionKey> {
  readonly key: K;
  get(config: DeviceConfig): readonly ItemOf<K>[];
  put(config: DeviceConfig, items: readonly ItemOf<K>[]): DeviceConfig;
  refs(item: ItemOf<K>): readonly ItemRef[];
  uniques(item: ItemOf<K>): readonly UniqueKey[];
  check(item: ItemOf<K>, config: DeviceConfig): CoreError | null;
  /** Campos que se pueden quitar (unset). */
  readonly optional: readonly string[];
  creatable(item: NewItem<K>): boolean;
  removable(item: ItemOf<K>): boolean;
}

export type Registry = { readonly [K in CollectionKey]: CollectionSpec<K> };

// ── Ayudantes de validación ─────────────────────────────────────────────────

const VLAN_MIN = 1;
const VLAN_MAX = 4094;
const RESERVED_LISTS = ['all', 'none', 'dynamic', 'static'];
const HOSTNAME = /^[A-Za-z0-9_*]([A-Za-z0-9_.*-]*[A-Za-z0-9_])?$/;

function outOfRange(
  scope: ErrorScope,
  field: string,
  value: number,
  min: number,
  max: number,
): CoreError | null {
  return Number.isInteger(value) && value >= min && value <= max
    ? null
    : { code: 'out-of-range', scope, field, value, min, max };
}

function invalid(
  scope: ErrorScope,
  field: string,
  value: string,
  expected: ExpectedValue,
): CoreError {
  return { code: 'invalid-value', scope, field, value, expected };
}

function required(scope: ErrorScope, field: string, value: string): CoreError | null {
  return value.trim() === '' ? { code: 'missing-required', scope, field } : null;
}

function first(...checks: readonly (CoreError | null)[]): CoreError | null {
  for (const c of checks) if (c) return c;
  return null;
}

function ifaceRef(field: string, id: ItemId): ItemRef {
  return { field, coll: 'interfaces', id };
}

function findIface(config: DeviceConfig, id: ItemId): Interface | undefined {
  return config.interfaces.find((i) => i.id === id);
}

function addressKey(address: Ipv4Prefix | IpRange): string {
  return 'len' in address ? formatPrefix(address) : formatRange(address);
}

function matchRefs(match: Match): ItemRef[] {
  const refs: ItemRef[] = [];
  if (match.inInterface) refs.push(ifaceRef('match.inInterface', match.inInterface.value));
  if (match.outInterface) refs.push(ifaceRef('match.outInterface', match.outInterface.value));
  return refs;
}

function portsNeedTcpUdp(scope: ErrorScope, match: Match, toPorts: boolean): CoreError | null {
  const usesPorts = match.srcPort !== undefined || match.dstPort !== undefined || toPorts;
  if (!usesPorts) return null;
  const proto = match.protocol;
  const tcpOrUdp = ['tcp', 'udp', 6, 17];
  const ok = proto && !proto.negate && tcpOrUdp.includes(proto.value);
  return ok
    ? null
    : { code: 'conflict', scope, field: 'match.protocol', detail: 'port-requires-tcp-udp' };
}

function wifiChannelOk(iface: WirelessInterface): boolean {
  if (iface.channelMhz === 'auto') return true;
  return iface.band === '2ghz'
    ? iface.channelMhz >= 2412 && iface.channelMhz <= 2484
    : iface.channelMhz >= 5150 && iface.channelMhz <= 5895;
}

function checkInterface(item: Interface): CoreError | null {
  const base = first(
    required('interfaces', 'name', item.name),
    outOfRange('interfaces', 'mtu', item.mtu, 64, 65535),
    parseMac(item.mac) === item.mac ? null : invalid('interfaces', 'mac', item.mac, 'mac'),
  );
  if (base) return base;
  switch (item.kind) {
    case 'vlan': {
      if (item.parent === item.id) {
        return { code: 'conflict', scope: 'interfaces', field: 'parent', detail: 'self-reference' };
      }
      return outOfRange('interfaces', 'vlanId', item.vlanId, VLAN_MIN, VLAN_MAX);
    }
    case 'bridge':
      return outOfRange('interfaces', 'pvid', item.pvid, VLAN_MIN, VLAN_MAX);
    case 'wireless': {
      if (item.ssid.length > 32) return invalid('interfaces', 'ssid', item.ssid, 'ssid');
      if (!wifiChannelOk(item)) {
        return invalid('interfaces', 'channelMhz', String(item.channelMhz), 'wifi-channel');
      }
      const pass = item.security.passphrase;
      if (pass !== undefined && (pass.length < 8 || pass.length > 63)) {
        return invalid('interfaces', 'security.passphrase', '', 'passphrase');
      }
      return null;
    }
    case 'ethernet':
    case 'loopback':
      return null;
  }
}

function checkNat(item: NatRule): CoreError | null {
  const srcOnly = ['masquerade', 'srcNat'];
  const dstOnly = ['dstNat', 'redirect'];
  const kind = item.action.kind;
  if (
    (item.chain === 'dstnat' && srcOnly.includes(kind)) ||
    (item.chain === 'srcnat' && dstOnly.includes(kind))
  ) {
    return {
      code: 'conflict',
      scope: 'natRules',
      field: 'action',
      detail: 'action-chain-mismatch',
    };
  }
  const toPorts = 'toPorts' in item.action && item.action.toPorts !== undefined;
  return portsNeedTcpUdp('natRules', item.match, toPorts);
}

// ── Especificaciones ────────────────────────────────────────────────────────

const always = (): boolean => true;
const noRefs = (): readonly ItemRef[] => [];
const noUniques = (): readonly UniqueKey[] => [];
const noCheck = (): CoreError | null => null;

export const REGISTRY: Registry = {
  interfaces: {
    key: 'interfaces',
    get: (c) => c.interfaces,
    put: (c, items) => ({ ...c, interfaces: items }),
    refs: (i) => (i.kind === 'vlan' ? [ifaceRef('parent', i.parent)] : []),
    uniques: (i) => {
      const keys: UniqueKey[] = [{ field: 'name', value: i.name }];
      if (i.kind === 'vlan') keys.push({ field: 'vlanId', value: `${i.parent}:${i.vlanId}` });
      return keys;
    },
    check: checkInterface,
    optional: ['comment'],
    creatable: (i) => i.kind === 'bridge' || i.kind === 'vlan' || i.kind === 'loopback',
    removable: (i) => i.kind !== 'ethernet' && i.kind !== 'wireless',
  },

  interfaceLists: {
    key: 'interfaceLists',
    get: (c) => c.interfaceLists,
    put: (c, items) => ({ ...c, interfaceLists: items }),
    refs: noRefs,
    uniques: (l) => [{ field: 'name', value: l.name }],
    check: (l, c) => {
      const base = required('interfaceLists', 'name', l.name);
      if (base) return base;
      if (RESERVED_LISTS.includes(l.name)) {
        return {
          code: 'conflict',
          scope: 'interfaceLists',
          field: 'name',
          detail: 'reserved-name',
        };
      }
      for (const name of l.include) {
        if (name === l.name) {
          return {
            code: 'conflict',
            scope: 'interfaceLists',
            field: 'include',
            detail: 'self-reference',
          };
        }
        const known =
          RESERVED_LISTS.includes(name) || c.interfaceLists.some((x) => x.name === name);
        if (!known)
          return { code: 'not-found', scope: 'interfaceLists', field: 'include', ref: name };
      }
      return null;
    },
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  interfaceListMembers: {
    key: 'interfaceListMembers',
    get: (c) => c.interfaceListMembers,
    put: (c, items) => ({ ...c, interfaceListMembers: items }),
    refs: (m) => [
      { field: 'list', coll: 'interfaceLists', id: m.list },
      ifaceRef('iface', m.iface),
    ],
    uniques: (m) => [{ field: 'iface', value: `${m.list}:${m.iface}` }],
    check: noCheck,
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  bridgePorts: {
    key: 'bridgePorts',
    get: (c) => c.bridging.ports,
    put: (c, items) => ({ ...c, bridging: { ...c.bridging, ports: items } }),
    refs: (p) => [ifaceRef('bridge', p.bridge), ifaceRef('iface', p.iface)],
    uniques: (p) => [{ field: 'iface', value: String(p.iface) }],
    check: (p, c) => {
      if (p.iface === p.bridge) {
        return { code: 'conflict', scope: 'bridgePorts', field: 'iface', detail: 'self-reference' };
      }
      const bridge = findIface(c, p.bridge);
      if (bridge && bridge.kind !== 'bridge') {
        return invalid('bridgePorts', 'bridge', bridge.name, 'bridge-interface');
      }
      const iface = findIface(c, p.iface);
      if (iface && iface.kind === 'bridge') {
        return invalid('bridgePorts', 'iface', iface.name, 'non-bridge-interface');
      }
      return outOfRange('bridgePorts', 'pvid', p.pvid, VLAN_MIN, VLAN_MAX);
    },
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  bridgeVlans: {
    key: 'bridgeVlans',
    get: (c) => c.bridging.vlans,
    put: (c, items) => ({ ...c, bridging: { ...c.bridging, vlans: items } }),
    refs: (v) => [
      ifaceRef('bridge', v.bridge),
      ...v.tagged.map((t) => ifaceRef('tagged', t)),
      ...v.untagged.map((u) => ifaceRef('untagged', u)),
    ],
    uniques: noUniques,
    check: (v, c) => {
      const bridge = findIface(c, v.bridge);
      if (bridge && bridge.kind !== 'bridge') {
        return invalid('bridgeVlans', 'bridge', bridge.name, 'bridge-interface');
      }
      if (v.vlanIds.length === 0)
        return { code: 'missing-required', scope: 'bridgeVlans', field: 'vlanIds' };
      for (const id of v.vlanIds) {
        const e = outOfRange('bridgeVlans', 'vlanIds', id, VLAN_MIN, VLAN_MAX);
        if (e) return e;
      }
      if (v.tagged.some((t) => v.untagged.includes(t))) {
        return {
          code: 'conflict',
          scope: 'bridgeVlans',
          field: 'untagged',
          detail: 'tagged-and-untagged',
        };
      }
      return null;
    },
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  addresses: {
    key: 'addresses',
    get: (c) => c.addressing.addresses,
    put: (c, items) => ({ ...c, addressing: { ...c.addressing, addresses: items } }),
    refs: (a) => [ifaceRef('iface', a.iface)],
    uniques: (a) => [{ field: 'address', value: `${a.iface}:${formatPrefix(a.address)}` }],
    check: noCheck,
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  staticArp: {
    key: 'staticArp',
    get: (c) => c.addressing.staticArp,
    put: (c, items) => ({ ...c, addressing: { ...c.addressing, staticArp: items } }),
    refs: (a) => [ifaceRef('iface', a.iface)],
    uniques: (a) => [{ field: 'ip', value: String(a.ip) }],
    check: (a) => (parseMac(a.mac) === a.mac ? null : invalid('staticArp', 'mac', a.mac, 'mac')),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  dhcpClients: {
    key: 'dhcpClients',
    get: (c) => c.addressing.dhcpClients,
    put: (c, items) => ({ ...c, addressing: { ...c.addressing, dhcpClients: items } }),
    refs: (d) => [ifaceRef('iface', d.iface)],
    uniques: (d) => [{ field: 'iface', value: String(d.iface) }],
    check: (d) => outOfRange('dhcpClients', 'routeDistance', d.routeDistance, 0, 255),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  routes: {
    key: 'routes',
    get: (c) => c.routing.static,
    put: (c, items) => ({ ...c, routing: { ...c.routing, static: items } }),
    refs: (r) =>
      r.gateway.kind === 'iface' || r.gateway.kind === 'ip-iface'
        ? [ifaceRef('gateway', r.gateway.iface)]
        : [],
    uniques: noUniques,
    check: (r) =>
      first(
        isNetworkAligned(r.dst)
          ? null
          : invalid('routes', 'dst', formatPrefix(r.dst), 'network-address'),
        outOfRange('routes', 'distance', r.distance, 1, 255),
        required('routes', 'table', r.table),
      ),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  pools: {
    key: 'pools',
    get: (c) => c.dhcpServer.pools,
    put: (c, items) => ({ ...c, dhcpServer: { ...c.dhcpServer, pools: items } }),
    refs: (p) => (p.next === undefined ? [] : [{ field: 'next', coll: 'pools', id: p.next }]),
    uniques: (p) => [{ field: 'name', value: p.name }],
    check: (p) => {
      const base = required('pools', 'name', p.name);
      if (base) return base;
      if (p.ranges.length === 0)
        return { code: 'missing-required', scope: 'pools', field: 'ranges' };
      const bad = p.ranges.find((r) => r.from > r.to);
      if (bad) return invalid('pools', 'ranges', formatRange(bad), 'ip-range');
      if (p.next === p.id)
        return { code: 'conflict', scope: 'pools', field: 'next', detail: 'self-reference' };
      return null;
    },
    optional: ['comment', 'next'],
    creatable: always,
    removable: always,
  },

  dhcpServers: {
    key: 'dhcpServers',
    get: (c) => c.dhcpServer.servers,
    put: (c, items) => ({ ...c, dhcpServer: { ...c.dhcpServer, servers: items } }),
    refs: (s) => [
      ifaceRef('iface', s.iface),
      ...(s.pool === 'static-only' ? [] : [{ field: 'pool', coll: 'pools' as const, id: s.pool }]),
    ],
    uniques: (s) => [
      { field: 'name', value: s.name },
      { field: 'iface', value: String(s.iface) },
    ],
    check: (s) =>
      first(
        required('dhcpServers', 'name', s.name),
        outOfRange('dhcpServers', 'leaseTimeS', s.leaseTimeS, 1, 365 * 24 * 3600 * 10),
      ),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  dhcpNetworks: {
    key: 'dhcpNetworks',
    get: (c) => c.dhcpServer.networks,
    put: (c, items) => ({ ...c, dhcpServer: { ...c.dhcpServer, networks: items } }),
    refs: noRefs,
    uniques: (n) => [{ field: 'prefix', value: formatPrefix(n.prefix) }],
    check: (n) =>
      isNetworkAligned(n.prefix)
        ? null
        : invalid('dhcpNetworks', 'prefix', formatPrefix(n.prefix), 'network-address'),
    optional: ['comment', 'gateway', 'domain'],
    creatable: always,
    removable: always,
  },

  staticLeases: {
    key: 'staticLeases',
    get: (c) => c.dhcpServer.staticLeases,
    put: (c, items) => ({ ...c, dhcpServer: { ...c.dhcpServer, staticLeases: items } }),
    refs: (l) =>
      l.server === 'all' ? [] : [{ field: 'server', coll: 'dhcpServers', id: l.server }],
    uniques: (l) => [{ field: 'mac', value: `${l.server}:${l.mac}` }],
    check: (l) => (parseMac(l.mac) === l.mac ? null : invalid('staticLeases', 'mac', l.mac, 'mac')),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  dnsStatic: {
    key: 'dnsStatic',
    get: (c) => c.dns.static,
    put: (c, items) => ({ ...c, dns: { ...c.dns, static: items } }),
    refs: noRefs,
    uniques: noUniques,
    check: (d) => {
      if (!HOSTNAME.test(d.name)) return invalid('dnsStatic', 'name', d.name, 'hostname');
      if (d.type === 'A' && d.address === undefined) {
        return { code: 'missing-required', scope: 'dnsStatic', field: 'address' };
      }
      if (d.type === 'CNAME' && (d.cname === undefined || d.cname === '')) {
        return { code: 'missing-required', scope: 'dnsStatic', field: 'cname' };
      }
      return outOfRange('dnsStatic', 'ttlS', d.ttlS, 0, 2 ** 31 - 1);
    },
    optional: ['comment', 'address', 'cname'],
    creatable: always,
    removable: always,
  },

  filterRules: {
    key: 'filterRules',
    get: (c) => c.firewall.filter,
    put: (c, items) => ({ ...c, firewall: { ...c.firewall, filter: items } }),
    refs: (r) => matchRefs(r.match),
    uniques: noUniques,
    check: (r) => {
      const base = required('filterRules', 'chain', r.chain);
      if (base) return base;
      if (r.action.kind === 'jump') {
        const target = r.action.target;
        if (target === '')
          return { code: 'missing-required', scope: 'filterRules', field: 'action.target' };
        if ((BUILTIN_FILTER_CHAINS as readonly string[]).includes(target)) {
          return invalid('filterRules', 'action.target', target, 'custom-chain');
        }
      }
      return portsNeedTcpUdp('filterRules', r.match, false);
    },
    optional: ['comment', 'logPrefix'],
    creatable: always,
    removable: always,
  },

  natRules: {
    key: 'natRules',
    get: (c) => c.firewall.nat,
    put: (c, items) => ({ ...c, firewall: { ...c.firewall, nat: items } }),
    refs: (r) => matchRefs(r.match),
    uniques: noUniques,
    check: checkNat,
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  addressLists: {
    key: 'addressLists',
    get: (c) => c.firewall.addressLists,
    put: (c, items) => ({ ...c, firewall: { ...c.firewall, addressLists: items } }),
    refs: noRefs,
    uniques: (a) => [{ field: 'address', value: `${a.list}:${addressKey(a.address)}` }],
    check: (a) => required('addressLists', 'list', a.list),
    optional: ['comment', 'timeoutS'],
    creatable: always,
    removable: always,
  },

  users: {
    key: 'users',
    get: (c) => c.system.users,
    put: (c, items) => ({ ...c, system: { ...c.system, users: items } }),
    refs: noRefs,
    uniques: (u) => [{ field: 'name', value: u.name }],
    check: (u) => required('users', 'name', u.name),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },

  services: {
    key: 'services',
    get: (c) => c.services,
    put: (c, items) => ({ ...c, services: items }),
    refs: noRefs,
    uniques: (s) => [{ field: 'name', value: s.name }],
    check: (s) => outOfRange('services', 'port', s.port, 1, 65535),
    optional: ['comment'],
    creatable: always,
    removable: always,
  },
};

/** Acceso tipado a la especificación de una colección. */
export function specOf<K extends CollectionKey>(key: K): CollectionSpec<K> {
  return REGISTRY[key];
}

export function itemsOf<K extends CollectionKey>(
  config: DeviceConfig,
  key: K,
): readonly ItemOf<K>[] {
  return specOf(key).get(config);
}
