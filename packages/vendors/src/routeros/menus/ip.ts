import {
  type AddressListEntry,
  type CheckGateway,
  type ConnNatState,
  converge,
  type Device,
  type DhcpLease,
  type DiscoveryProtocol,
  err,
  type FilterAction,
  formatIpv4,
  formatPortSet,
  formatPrefix,
  formatRange,
  type IpRange,
  type Ipv4Prefix,
  type ItemId,
  ipv4,
  type Match,
  type NatAction,
  type Neg,
  type Network,
  networkOf,
  type Op,
  ok,
  type Pool,
  parseIpv4,
  parsePortSet,
  parsePrefix,
  parseRange,
  prefix,
  type RejectWith,
  rangeContains,
  type ServiceName,
} from '@nos/core';
import { ifaceName, refIdLoose, refName } from '../refs';
import {
  type ActionCtx,
  type ActionDef,
  fault,
  type MenuCtx,
  type MenuDef,
  type Props,
  prop,
  type Row,
  ro,
  T,
} from '../schema';
import {
  formatCount,
  formatDateTime,
  formatDuration,
  formatKib,
  parseDuration,
  parseKib,
} from '../values';
import {
  addOp,
  baseFrom,
  baseProps,
  COMMON_PROPS,
  collectionMenu,
  dynamicRow,
  F,
  flags,
  get,
  isInvalid,
  isYes,
  nextName,
  opt,
  props,
  yn,
} from './common';

const ifaceId = (ctx: MenuCtx, name: string): ItemId =>
  refIdLoose(ctx, 'interface', name) ?? (0 as ItemId);
const seconds = (text: string): number => parseDuration(text) ?? 0;

// ── /ip address ─────────────────────────────────────────────────────────────

export const addressMenu: MenuDef = collectionMenu({
  path: 'ip/address',
  help: 'Address management',
  coll: 'addresses',
  props: [
    prop('address', T.prefix, { required: true }),
    ro('network'),
    prop('interface', T.ref('interface'), { required: true }),
    ro('actual-interface'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid], [F.dynamic]],
  style: 'table',
  columns: ['address', 'network', 'interface'],
  export: { order: 60, style: 'add' },
  toProps: (a, ctx) =>
    props([
      ['address', formatPrefix(a.address)],
      ['network', formatIpv4(networkOf(a.address).ip)],
      ['interface', ifaceName(ctx, a.iface)],
      ['actual-interface', ifaceName(ctx, a.iface)],
      ...baseProps(a),
    ]),
  flagsOf: (a, ctx) => flags(['X', a.disabled], ['I', isInvalid(ctx, 'addresses', a.id)]),
  fromProps: (p, ctx) =>
    ok({
      address: prefix(get(p, 'address')),
      iface: ifaceId(ctx, get(p, 'interface')),
      ...baseFrom(p),
    }),
  extraRows: (ctx) =>
    ctx.device.oper.dynamicAddresses.map((d) =>
      dynamicRow(
        `d${d.client}`,
        props([
          ['address', formatPrefix(d.address)],
          ['network', formatIpv4(networkOf(d.address).ip)],
          ['interface', ifaceName(ctx, d.iface)],
          ['actual-interface', ifaceName(ctx, d.iface)],
        ]),
        'D',
      ),
    ),
});

// ── /ip route ───────────────────────────────────────────────────────────────

export const routeMenu: MenuDef = collectionMenu({
  path: 'ip/route',
  help: 'Static routes',
  coll: 'routes',
  props: [
    prop('dst-address', T.prefix, { default: '0.0.0.0/0' }),
    prop('gateway', T.gateway, { default: '' }),
    ro('immediate-gw'),
    prop('check-gateway', T.enumOf('ping', 'arp', 'none'), { default: '' }),
    prop('distance', T.int(1, 255), { default: '1' }),
    prop('blackhole', T.flag, { default: 'no' }),
    prop('routing-table', T.name, { default: 'main' }),
    ro('scope'),
    ro('target-scope'),
    ...COMMON_PROPS,
  ],
  flags: [
    [F.dynamic],
    [F.disabled, F.inactive, F.active],
    [
      { letter: 'c', name: 'connect' },
      { letter: 's', name: 'static' },
      { letter: 'd', name: 'dhcp' },
    ],
    [{ letter: 'B', name: 'blackhole' }],
  ],
  style: 'table',
  columns: ['dst-address', 'gateway', 'distance'],
  export: { order: 90, style: 'add' },
  toProps: (r, ctx) => {
    const gw = r.gateway;
    const gateway =
      gw.kind === 'ip'
        ? formatIpv4(gw.ip)
        : gw.kind === 'iface'
          ? ifaceName(ctx, gw.iface)
          : gw.kind === 'ip-iface'
            ? `${formatIpv4(gw.ip)}%${ifaceName(ctx, gw.iface)}`
            : '';
    const rib = ctx.device.oper.rib.find((e) => e.origin === 'static' && e.source === r.id);
    const immediate =
      rib?.iface === undefined
        ? undefined
        : rib.gateway === undefined
          ? ifaceName(ctx, rib.iface)
          : `${formatIpv4(rib.gateway)}%${ifaceName(ctx, rib.iface)}`;
    return props([
      ['dst-address', formatPrefix(r.dst)],
      ['gateway', gateway],
      ['immediate-gw', immediate],
      ['check-gateway', r.checkGateway],
      ['distance', String(r.distance)],
      ['blackhole', yn(gw.kind === 'blackhole')],
      ['routing-table', r.table],
      ['scope', '30'],
      ['target-scope', '10'],
      ...baseProps(r),
    ]);
  },
  flagsOf: (r, ctx) => {
    const active = ctx.device.oper.rib.some(
      (e) => e.origin === 'static' && e.source === r.id && e.active,
    );
    return flags(
      ['X', r.disabled],
      ['I', !r.disabled && !active],
      ['A', active],
      ['s', true],
      ['B', r.gateway.kind === 'blackhole'],
    );
  },
  fromProps: (p, ctx) => {
    const text = get(p, 'gateway');
    let gateway: Parameters<typeof addOp<'routes'>>[1]['gateway'];
    if (isYes(p.get('blackhole'))) {
      gateway = { kind: 'blackhole' };
    } else if (text === '') {
      return err(fault('missing-args', undefined, { args: 'gateway' }));
    } else if (text.includes('%')) {
      const [ip = '', iface = ''] = text.split('%');
      gateway = { kind: 'ip-iface', ip: ipv4(ip), iface: ifaceId(ctx, iface) };
    } else {
      const ip = parseIpv4(text);
      gateway = ip === null ? { kind: 'iface', iface: ifaceId(ctx, text) } : { kind: 'ip', ip };
    }
    const check = opt(p, 'check-gateway');
    const checkGateway: CheckGateway | undefined =
      check === 'ping' || check === 'arp' ? check : undefined;
    return ok({
      dst: prefix(get(p, 'dst-address')),
      gateway,
      distance: Number(get(p, 'distance')),
      table: get(p, 'routing-table'),
      ...(checkGateway === undefined ? {} : { checkGateway }),
      ...baseFrom(p),
    });
  },
  extraRows: (ctx) =>
    ctx.device.oper.rib
      .filter((e) => e.origin !== 'static')
      .map((e, i) => {
        const gateway =
          e.origin === 'connected'
            ? e.iface === undefined
              ? ''
              : ifaceName(ctx, e.iface)
            : e.gateway === undefined
              ? ''
              : formatIpv4(e.gateway);
        return dynamicRow(
          `r${i}`,
          props([
            ['dst-address', formatPrefix(e.dst)],
            ['gateway', gateway],
            ['distance', String(e.distance)],
            ['routing-table', 'main'],
            ...(e.prefSrc === undefined ? [] : ([['pref-src', formatIpv4(e.prefSrc)]] as const)),
          ]),
          flags(
            ['D', true],
            ['A', e.active],
            ['c', e.origin === 'connected'],
            ['d', e.origin === 'dhcp'],
          ),
          false,
        );
      }),
});

// ── /ip pool ────────────────────────────────────────────────────────────────

export const poolMenu: MenuDef = collectionMenu({
  path: 'ip/pool',
  help: 'IP address pools',
  coll: 'pools',
  props: [
    prop('name', T.name),
    prop('ranges', T.rangeList, { required: true }),
    prop('next-pool', T.ref('pool', 'none'), { default: 'none' }),
    prop('comment', T.string),
  ],
  flags: [],
  style: 'table',
  columns: ['name', 'ranges'],
  nameProp: 'name',
  autoName: (ctx) =>
    nextName(
      'pool',
      ctx.device.config.dhcpServer.pools.map((p) => p.name),
    ),
  export: { order: 36, style: 'add' },
  toProps: (pool, ctx) =>
    props([
      ['name', pool.name],
      ['ranges', pool.ranges.map(formatRange).join(',')],
      ['next-pool', pool.next === undefined ? 'none' : refName(ctx, 'pool', pool.next)],
      ['comment', pool.comment],
    ]),
  flagsOf: () => '',
  fromProps: (p, ctx) => {
    const next = get(p, 'next-pool');
    const nextId = next === 'none' ? undefined : refIdLoose(ctx, 'pool', next);
    const comment = opt(p, 'comment');
    return ok({
      name: get(p, 'name'),
      ranges: get(p, 'ranges')
        .split(',')
        .map((r) => parseRange(r) as IpRange),
      disabled: false,
      ...(nextId === undefined ? {} : { next: nextId }),
      ...(comment === undefined ? {} : { comment }),
    });
  },
});

/** Pool de la cadena (pool y sus `next-pool`) del que salió una dirección. */
function poolHolding(device: Device, start: ItemId, ip: DhcpLease['ip']): Pool | undefined {
  const seen = new Set<ItemId>();
  let id: ItemId | undefined = start;
  while (id !== undefined && !seen.has(id)) {
    seen.add(id);
    const pool = device.config.dhcpServer.pools.find((p) => p.id === id);
    if (!pool) return undefined;
    if (pool.ranges.some((r) => rangeContains(r, ip))) return pool;
    id = pool.next;
  }
  return undefined;
}

export const poolUsedMenu: MenuDef = {
  path: 'ip/pool/used',
  help: 'Addresses handed out from pools',
  props: [ro('pool'), ro('address'), ro('owner'), ro('info')],
  flags: [],
  style: 'table',
  columns: ['pool', 'address', 'owner', 'info'],
  rows: (ctx) =>
    ctx.device.oper.dhcpLeases.flatMap((l) => {
      const server = ctx.device.config.dhcpServer.servers.find((s) => s.id === l.server);
      if (!l.dynamic || !server || server.pool === 'static-only') return [];
      const pool = poolHolding(ctx.device, server.pool, l.ip);
      if (!pool) return [];
      return [
        dynamicRow(
          `u${l.server}:${l.ip}`,
          props([
            ['pool', pool.name],
            ['address', formatIpv4(l.ip)],
            ['owner', l.mac],
            ['info', server.name],
          ]),
          '',
        ),
      ];
    }),
};

// ── /ip dhcp-server ─────────────────────────────────────────────────────────

export const dhcpServerMenu: MenuDef = collectionMenu({
  path: 'ip/dhcp-server',
  help: 'DHCP server settings',
  coll: 'dhcpServers',
  props: [
    prop('name', T.name),
    prop('interface', T.ref('interface'), { required: true }),
    prop('address-pool', T.ref('pool', 'static-only'), { default: 'static-only' }),
    prop('lease-time', T.time, { default: '30m' }),
    prop('authoritative', T.enumOf('yes', 'no'), { default: 'yes' }),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid]],
  style: 'table',
  columns: ['name', 'interface', 'address-pool', 'lease-time'],
  nameProp: 'name',
  autoName: (ctx) =>
    nextName(
      'dhcp',
      ctx.device.config.dhcpServer.servers.map((s) => s.name),
    ),
  export: { order: 38, style: 'add' },
  toProps: (s, ctx) =>
    props([
      ['name', s.name],
      ['interface', ifaceName(ctx, s.iface)],
      ['address-pool', s.pool === 'static-only' ? 'static-only' : refName(ctx, 'pool', s.pool)],
      ['lease-time', formatDuration(s.leaseTimeS)],
      ['authoritative', yn(s.authoritative)],
      ...baseProps(s),
    ]),
  flagsOf: (s, ctx) => flags(['X', s.disabled], ['I', isInvalid(ctx, 'dhcpServers', s.id)]),
  fromProps: (p, ctx) => {
    const pool = get(p, 'address-pool');
    return ok({
      name: get(p, 'name'),
      iface: ifaceId(ctx, get(p, 'interface')),
      pool:
        pool === 'static-only' ? 'static-only' : (refIdLoose(ctx, 'pool', pool) ?? (0 as ItemId)),
      leaseTimeS: seconds(get(p, 'lease-time')),
      authoritative: isYes(p.get('authoritative')),
      ...baseFrom(p),
    });
  },
});

export const dhcpNetworkMenu: MenuDef = collectionMenu({
  path: 'ip/dhcp-server/network',
  help: 'DHCP networks',
  coll: 'dhcpNetworks',
  props: [
    prop('address', T.prefix, { required: true }),
    prop('gateway', T.ip, { default: '' }),
    prop('dns-server', T.ipList, { default: '' }),
    prop('domain', T.string, { default: '' }),
    prop('comment', T.string),
  ],
  flags: [],
  style: 'table',
  columns: ['address', 'gateway', 'dns-server'],
  export: { order: 75, style: 'add' },
  toProps: (n) =>
    props([
      ['address', formatPrefix(n.prefix)],
      ['gateway', n.gateway === undefined ? '' : formatIpv4(n.gateway)],
      ['dns-server', n.dnsServers.map(formatIpv4).join(',')],
      ['domain', n.domain ?? ''],
      ['comment', n.comment],
    ]),
  flagsOf: () => '',
  fromProps: (p) => {
    const gateway = opt(p, 'gateway');
    const domain = opt(p, 'domain');
    const comment = opt(p, 'comment');
    const dns = get(p, 'dns-server');
    return ok({
      prefix: prefix(get(p, 'address')),
      dnsServers: dns === '' ? [] : dns.split(',').map(ipv4),
      disabled: false,
      ...(gateway === undefined ? {} : { gateway: ipv4(gateway) }),
      ...(domain === undefined ? {} : { domain }),
      ...(comment === undefined ? {} : { comment }),
    });
  },
});

const makeStatic: ActionDef = {
  help: 'Convert dynamic leases to static',
  args: [],
  takesNumbers: true,
  run: (_args, ctx) => {
    const ops = ctx.rows
      .filter((row) => row.flags.includes('D'))
      .map((row) => {
        const server = get(row.props, 'server');
        return addOp('staticLeases', {
          server: server === 'all' ? 'all' : (refIdLoose(ctx, 'dhcp-server', server) ?? 'all'),
          mac: get(row.props, 'mac-address') as Parameters<typeof addOp<'staticLeases'>>[1]['mac'],
          ip: ipv4(get(row.props, 'address')),
          disabled: false,
        });
      });
    return ok({ ops });
  },
};

const leaseMenu: MenuDef = collectionMenu({
  path: 'ip/dhcp-server/lease',
  help: 'DHCP leases',
  coll: 'staticLeases',
  props: [
    prop('address', T.ip, { required: true }),
    prop('mac-address', T.mac, { required: true }),
    prop('server', T.ref('dhcp-server', 'all'), { default: 'all' }),
    ro('host-name'),
    ro('status'),
    ro('expires-after'),
    ro('last-seen'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled], [F.dynamic]],
  style: 'table',
  columns: ['address', 'mac-address', 'host-name', 'server', 'status', 'last-seen'],
  export: { order: 70, style: 'add' },
  toProps: (l, ctx) => {
    const bound = ctx.device.oper.dhcpLeases.find(
      (x) => !x.dynamic && x.mac === l.mac && x.ip === l.ip,
    );
    return props([
      ['address', formatIpv4(l.ip)],
      ['mac-address', l.mac],
      ['server', l.server === 'all' ? 'all' : refName(ctx, 'dhcp-server', l.server)],
      ['host-name', bound?.hostName ?? ''],
      ['status', bound ? 'bound' : 'waiting'],
      ['expires-after', bound ? formatDuration(bound.expiresAt - ctx.net.now) : ''],
      ['last-seen', bound ? '0s' : 'never'],
      ...baseProps(l),
    ]);
  },
  flagsOf: (l) => flags(['X', l.disabled]),
  fromProps: (p, ctx) => {
    const server = get(p, 'server');
    return ok({
      server: server === 'all' ? 'all' : (refIdLoose(ctx, 'dhcp-server', server) ?? 'all'),
      mac: get(p, 'mac-address') as Parameters<typeof addOp<'staticLeases'>>[1]['mac'],
      ip: ipv4(get(p, 'address')),
      ...baseFrom(p),
    });
  },
  extraRows: (ctx) =>
    ctx.device.oper.dhcpLeases
      .filter((l) => l.dynamic)
      .map((l) =>
        dynamicRow(
          `l${l.mac}`,
          props([
            ['address', formatIpv4(l.ip)],
            ['mac-address', l.mac],
            ['server', refName(ctx, 'dhcp-server', l.server)],
            ['host-name', l.hostName],
            ['status', 'bound'],
            ['expires-after', formatDuration(l.expiresAt - ctx.net.now)],
            ['last-seen', '0s'],
          ]),
          'D',
        ),
      ),
  actions: { 'make-static': makeStatic },
});

/**
 * Borrar un lease estático quita su configuración; uno dinámico solo se libera
 * en el servidor, y el cliente vuelve a pedir dirección enseguida.
 */
export const dhcpLeaseMenu: MenuDef = {
  ...leaseMenu,
  removeOther: (rows, ctx) => {
    const ops: Op[] = [];
    const freed = new Set<string>();
    for (const row of rows) {
      if (row.id === undefined)
        freed.add(`${get(row.props, 'mac-address')}|${get(row.props, 'address')}`);
      else ops.push({ op: 'remove', coll: 'staticLeases', id: row.id });
    }
    if (freed.size === 0) return ok({ ops });
    const released = updateOper(ctx.net, ctx.device.id, (oper) => ({
      ...oper,
      dhcpLeases: oper.dhcpLeases.filter(
        (l) => !(l.dynamic && freed.has(`${l.mac}|${formatIpv4(l.ip)}`)),
      ),
    }));
    return ok({ net: converge(released), ops });
  },
};

// ── /ip dhcp-client ─────────────────────────────────────────────────────────

const noOpAction = (help: string): ActionDef => ({
  help,
  args: [],
  takesNumbers: true,
  run: () => ok({}),
});

export const dhcpClientMenu: MenuDef = collectionMenu({
  path: 'ip/dhcp-client',
  help: 'DHCP client settings',
  coll: 'dhcpClients',
  props: [
    prop('interface', T.ref('interface'), { required: true }),
    prop('add-default-route', T.enumOf('yes', 'no'), { default: 'yes' }),
    prop('default-route-distance', T.int(0, 255), { default: '1' }),
    prop('use-peer-dns', T.bool, { default: 'yes' }),
    ro('use-peer-ntp'),
    ro('status'),
    ro('address'),
    ro('gateway'),
    ro('expires-after'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid], [F.dynamic]],
  style: 'table',
  columns: ['interface', 'use-peer-dns', 'add-default-route', 'status', 'address'],
  export: { order: 65, style: 'add' },
  toProps: (c, ctx) => {
    const status = ctx.device.oper.dhcpClients.find((s) => s.client === c.id);
    return props([
      ['interface', ifaceName(ctx, c.iface)],
      ['add-default-route', yn(c.addDefaultRoute)],
      ['default-route-distance', String(c.routeDistance)],
      ['use-peer-dns', yn(c.usePeerDns)],
      ['use-peer-ntp', 'yes'],
      ['status', c.disabled ? 'stopped' : status?.status === 'bound' ? 'bound' : 'searching...'],
      ['address', status?.address ? formatPrefix(status.address) : ''],
      ['gateway', status?.gateway === undefined ? '' : formatIpv4(status.gateway)],
      [
        'expires-after',
        status?.expiresAt === undefined ? '' : formatDuration(status.expiresAt - ctx.net.now),
      ],
      ...baseProps(c),
    ]);
  },
  flagsOf: (c, ctx) => flags(['X', c.disabled], ['I', isInvalid(ctx, 'dhcpClients', c.id)]),
  fromProps: (p, ctx) =>
    ok({
      iface: ifaceId(ctx, get(p, 'interface')),
      addDefaultRoute: isYes(p.get('add-default-route')),
      routeDistance: Number(get(p, 'default-route-distance')),
      usePeerDns: isYes(p.get('use-peer-dns')),
      ...baseFrom(p),
    }),
  actions: {
    renew: noOpAction('Renew current lease'),
    release: noOpAction('Release current lease'),
  },
});

// ── /ip arp ─────────────────────────────────────────────────────────────────

export const arpMenu: MenuDef = collectionMenu({
  path: 'ip/arp',
  help: 'ARP entries',
  coll: 'staticArp',
  props: [
    prop('address', T.ip, { required: true }),
    prop('mac-address', T.mac, { required: true }),
    prop('interface', T.ref('interface'), { required: true }),
    ro('status'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid], [F.dynamic], [{ letter: 'C', name: 'complete' }]],
  style: 'table',
  columns: ['address', 'mac-address', 'interface', 'status'],
  export: { order: 62, style: 'add' },
  toProps: (a, ctx) =>
    props([
      ['address', formatIpv4(a.ip)],
      ['mac-address', a.mac],
      ['interface', ifaceName(ctx, a.iface)],
      ['status', 'permanent'],
      ...baseProps(a),
    ]),
  flagsOf: (a) => flags(['X', a.disabled], ['C', !a.disabled]),
  fromProps: (p, ctx) =>
    ok({
      ip: ipv4(get(p, 'address')),
      mac: get(p, 'mac-address') as Parameters<typeof addOp<'staticArp'>>[1]['mac'],
      iface: ifaceId(ctx, get(p, 'interface')),
      ...baseFrom(p),
    }),
  extraRows: (ctx) =>
    ctx.device.oper.arp
      .filter((a) => a.origin === 'dynamic')
      .map((a) =>
        dynamicRow(
          `a${a.iface}:${a.ip}`,
          props([
            ['address', formatIpv4(a.ip)],
            ['mac-address', a.mac],
            ['interface', ifaceName(ctx, a.iface)],
            ['status', 'reachable'],
          ]),
          flags(['D', true], ['C', a.complete]),
        ),
      ),
});

// ── /ip neighbor ────────────────────────────────────────────────────────────

const PLATFORMS: Readonly<Record<string, string>> = {
  routeros: 'MikroTik',
  vrp: 'Huawei',
  vyos: 'VyOS',
  ios: 'Cisco',
};

export const neighborMenu: MenuDef = {
  path: 'ip/neighbor',
  help: 'Neighbor discovery',
  props: [
    ro('interface'),
    ro('address'),
    ro('mac-address'),
    ro('identity'),
    ro('platform'),
    ro('board'),
  ],
  flags: [],
  style: 'table',
  columns: ['interface', 'address', 'mac-address', 'identity', 'platform', 'board'],
  rows: (ctx) =>
    ctx.device.oper.neighbors.map((n, i) => {
      const peer = ctx.net.devices.find((d) => d.id === n.peer);
      return dynamicRow(
        `n${i}`,
        props([
          ['interface', ifaceName(ctx, n.iface)],
          ['address', n.address === undefined ? '' : formatIpv4(n.address)],
          ['mac-address', n.mac],
          ['identity', n.identity],
          ['platform', PLATFORMS[n.os] ?? ''],
          ['board', peer?.hardware.board ?? ''],
        ]),
        '',
      );
    }),
};

const PROTOCOLS: readonly DiscoveryProtocol[] = ['cdp', 'lldp', 'mndp'];

export const discoveryMenu: MenuDef = {
  path: 'ip/neighbor/discovery-settings',
  help: 'Neighbor discovery settings',
  coll: 'discovery',
  props: [
    prop('discover-interface-list', T.ref('interface-list'), { default: 'all' }),
    prop('protocol', T.enumList(...PROTOCOLS), { default: 'cdp,lldp,mndp' }),
  ],
  flags: [],
  style: 'singleton',
  columns: [],
  export: { order: 45, style: 'set' },
  rows: (ctx) => [
    dynamicRow(
      'singleton',
      props([
        ['discover-interface-list', ctx.device.config.discovery.interfaceList],
        ['protocol', ctx.device.config.discovery.protocols.join(',')],
      ]),
      '',
    ),
  ],
  update: (_row, p) =>
    ok([
      {
        op: 'setSingleton',
        key: 'discovery',
        patch: {
          interfaceList: get(p, 'discover-interface-list'),
          protocols: get(p, 'protocol')
            .split(',')
            .filter((x): x is DiscoveryProtocol => (PROTOCOLS as readonly string[]).includes(x)),
        },
      },
    ]),
};

// ── /ip service ─────────────────────────────────────────────────────────────

const SERVICE_NAMES: Readonly<Record<ServiceName, string>> = {
  telnet: 'telnet',
  ftp: 'ftp',
  http: 'www',
  ssh: 'ssh',
  https: 'www-ssl',
  api: 'api',
  'native-gui': 'winbox',
  'api-tls': 'api-ssl',
};

export const serviceMenu: MenuDef = collectionMenu({
  path: 'ip/service',
  help: 'IP services',
  coll: 'services',
  creatable: false,
  removable: false,
  props: [
    ro('name'),
    prop('port', T.int(1, 65535)),
    prop('address', T.prefixList, { default: '' }),
    prop('disabled', T.bool, { default: 'no', hidden: true }),
  ],
  flags: [[F.disabled, F.invalid]],
  style: 'table',
  columns: ['name', 'port', 'address'],
  nameProp: 'name',
  export: {
    order: 95,
    style: 'set-name',
    rowDefaults: (row) => {
      const name = row.props.get('name') ?? '';
      return props([
        ['port', String(SERVICE_DEFAULT_PORTS[name] ?? '')],
        ['address', ''],
        ['disabled', yn(name === 'www-ssl')],
      ]);
    },
  },
  toProps: (s) =>
    props([
      ['name', SERVICE_NAMES[s.name]],
      ['port', String(s.port)],
      ['address', s.allowedFrom.map(formatPrefix).join(',')],
      ['disabled', yn(s.disabled)],
    ]),
  flagsOf: (s) => flags(['X', s.disabled]),
  fromProps: (p, _ctx, current) => {
    if (!current) return err(fault('not-allowed'));
    const address = get(p, 'address');
    return ok({
      name: current.name,
      port: Number(get(p, 'port')),
      allowedFrom:
        address === '' ? [] : address.split(',').map((x) => parsePrefix(x) as Ipv4Prefix),
      disabled: isYes(p.get('disabled')),
    });
  },
});

/** Puerto por defecto de cada servicio, para que export omita los que no cambiaron. */
export const SERVICE_DEFAULT_PORTS: Readonly<Record<string, number>> = {
  telnet: 23,
  ftp: 21,
  www: 80,
  ssh: 22,
  'www-ssl': 443,
  api: 8728,
  winbox: 8291,
  'api-ssl': 8729,
};

// ── /ip dns ─────────────────────────────────────────────────────────────────

export const dnsMenu: MenuDef = {
  path: 'ip/dns',
  help: 'DNS client and cache settings',
  coll: 'dns',
  props: [
    prop('servers', T.ipList, { default: '' }),
    ro('dynamic-servers'),
    prop('allow-remote-requests', T.bool, { default: 'no' }),
    prop('cache-size', T.kib, { default: '2048KiB' }),
    ro('cache-max-ttl'),
    ro('cache-used'),
  ],
  flags: [],
  style: 'singleton',
  columns: [],
  export: { order: 77, style: 'set' },
  rows: (ctx) => {
    const dns = ctx.device.config.dns;
    const used = ctx.device.oper.dnsCache.length * 2;
    return [
      dynamicRow(
        'singleton',
        props([
          ['servers', dns.servers.map(formatIpv4).join(',')],
          ['dynamic-servers', ctx.device.oper.dynamicDnsServers.map(formatIpv4).join(',')],
          ['allow-remote-requests', yn(dns.allowRemoteRequests)],
          ['cache-size', formatKib(dns.cacheSizeKiB)],
          ['cache-max-ttl', '1w'],
          ['cache-used', formatKib(used)],
        ]),
        '',
      ),
    ];
  },
  update: (_row, p) => {
    const servers = get(p, 'servers');
    return ok([
      {
        op: 'setSingleton',
        key: 'dns',
        patch: {
          servers: servers === '' ? [] : servers.split(',').map(ipv4),
          allowRemoteRequests: isYes(p.get('allow-remote-requests')),
          cacheSizeKiB: parseKib(get(p, 'cache-size')) ?? 2048,
        },
      },
    ]);
  },
};

export const dnsStaticMenu: MenuDef = collectionMenu({
  path: 'ip/dns/static',
  help: 'Static DNS entries',
  coll: 'dnsStatic',
  props: [
    prop('name', T.name, { required: true }),
    prop('type', T.enumOf('A', 'CNAME'), { default: 'A' }),
    prop('address', T.ip, { default: '' }),
    prop('cname', T.string, { default: '' }),
    prop('ttl', T.time, { default: '1d' }),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled], [F.dynamic]],
  style: 'table',
  columns: ['name', 'type', 'address', 'ttl'],
  export: { order: 78, style: 'add' },
  toProps: (s) =>
    props([
      ['name', s.name],
      ['type', s.type],
      ['address', s.address === undefined ? '' : formatIpv4(s.address)],
      ['cname', s.cname ?? ''],
      ['ttl', formatDuration(s.ttlS)],
      ...baseProps(s),
    ]),
  flagsOf: (s) => flags(['X', s.disabled]),
  fromProps: (p) => {
    const address = opt(p, 'address');
    const cname = opt(p, 'cname');
    return ok({
      name: get(p, 'name'),
      type: get(p, 'type') === 'CNAME' ? 'CNAME' : 'A',
      ttlS: seconds(get(p, 'ttl')),
      ...(address === undefined ? {} : { address: ipv4(address) }),
      ...(cname === undefined ? {} : { cname }),
      ...baseFrom(p),
    });
  },
});

export const dnsCacheMenu: MenuDef = {
  path: 'ip/dns/cache',
  help: 'DNS cache',
  props: [ro('name'), ro('type'), ro('data'), ro('ttl')],
  flags: [],
  style: 'table',
  columns: ['name', 'type', 'data', 'ttl'],
  rows: (ctx) =>
    ctx.device.oper.dnsCache
      .filter((c) => c.expiresAt > ctx.net.now)
      .map((c, i) =>
        dynamicRow(
          `c${i}`,
          props([
            ['name', c.name],
            ['type', c.type],
            ['data', c.data],
            ['ttl', formatDuration(c.expiresAt - ctx.net.now)],
          ]),
          '',
        ),
      ),
  actions: {
    flush: {
      help: 'Flush DNS cache',
      args: [],
      run: (_args, ctx) =>
        ok({
          net: updateOper(ctx.net, ctx.device.id, (oper) => ({ ...oper, dnsCache: [] })),
        }),
    },
  },
};

function updateOper(
  net: Network,
  id: MenuCtx['device']['id'],
  change: (oper: MenuCtx['device']['oper']) => MenuCtx['device']['oper'],
): Network {
  return {
    ...net,
    devices: net.devices.map((d) => (d.id === id ? { ...d, oper: change(d.oper) } : d)),
  };
}

// ── /ip firewall ────────────────────────────────────────────────────────────

const showAddress = (a: Ipv4Prefix | IpRange): string =>
  'len' in a ? (a.len === 32 ? formatIpv4(a.ip) : formatPrefix(a)) : formatRange(a);

const parseAddress = (text: string): Ipv4Prefix | IpRange =>
  text.includes('-') ? (parseRange(text) as IpRange) : (parsePrefix(text) as Ipv4Prefix);

function negShow<T>(n: Neg<T> | undefined, show: (value: T) => string): string | undefined {
  return n === undefined ? undefined : `${n.negate ? '!' : ''}${show(n.value)}`;
}

function negRead<T>(p: Props, name: string, read: (text: string) => T): Neg<T> | undefined {
  const text = opt(p, name);
  if (text === undefined) return undefined;
  const negate = text.startsWith('!');
  return { negate, value: read(negate ? text.slice(1) : text) };
}

const NAT_STATES: readonly ConnNatState[] = ['srcnat', 'dstnat'];

const MATCH_PROPS = [
  prop('src-address', T.neg(T.address), { default: '' }),
  prop('dst-address', T.neg(T.address), { default: '' }),
  prop('src-address-list', T.neg(T.name), { default: '' }),
  prop('dst-address-list', T.neg(T.name), { default: '' }),
  prop('protocol', T.neg(T.protocol), { default: '' }),
  prop('src-port', T.neg(T.ports), { default: '' }),
  prop('dst-port', T.neg(T.ports), { default: '' }),
  prop('in-interface', T.neg(T.ref('interface')), { default: '' }),
  prop('out-interface', T.neg(T.ref('interface')), { default: '' }),
  prop('in-interface-list', T.neg(T.ref('interface-list')), { default: '' }),
  prop('out-interface-list', T.neg(T.ref('interface-list')), { default: '' }),
  prop('connection-state', T.enumList('established', 'related', 'new', 'invalid', 'untracked'), {
    default: '',
  }),
  prop('connection-nat-state', T.neg(T.enumList(...NAT_STATES)), { default: '' }),
];

function matchProps(m: Match, ctx: MenuCtx): (readonly [string, string | undefined])[] {
  const iface = (id: ItemId) => ifaceName(ctx, id);
  return [
    ['src-address', negShow(m.srcAddress, showAddress)],
    ['dst-address', negShow(m.dstAddress, showAddress)],
    ['src-address-list', negShow(m.srcAddressList, String)],
    ['dst-address-list', negShow(m.dstAddressList, String)],
    ['protocol', negShow(m.protocol, String)],
    ['src-port', negShow(m.srcPort, formatPortSet)],
    ['dst-port', negShow(m.dstPort, formatPortSet)],
    ['in-interface', negShow(m.inInterface, iface)],
    ['out-interface', negShow(m.outInterface, iface)],
    ['in-interface-list', negShow(m.inInterfaceList, String)],
    ['out-interface-list', negShow(m.outInterfaceList, String)],
    ['connection-state', m.connectionState?.join(',')],
    ['connection-nat-state', negShow(m.connectionNatState, (states) => states.join(','))],
  ];
}

function matchFrom(p: Props, ctx: MenuCtx): Match {
  const iface = (text: string) => ifaceId(ctx, text);
  const ports = (text: string) => parsePortSet(text) ?? [];
  const protocol = (text: string) =>
    text === 'tcp' || text === 'udp' || text === 'icmp' ? text : Number(text);
  const entries: [keyof Match, unknown][] = [
    ['srcAddress', negRead(p, 'src-address', parseAddress)],
    ['dstAddress', negRead(p, 'dst-address', parseAddress)],
    ['srcAddressList', negRead(p, 'src-address-list', String)],
    ['dstAddressList', negRead(p, 'dst-address-list', String)],
    ['protocol', negRead(p, 'protocol', protocol)],
    ['srcPort', negRead(p, 'src-port', ports)],
    ['dstPort', negRead(p, 'dst-port', ports)],
    ['inInterface', negRead(p, 'in-interface', iface)],
    ['outInterface', negRead(p, 'out-interface', iface)],
    ['inInterfaceList', negRead(p, 'in-interface-list', String)],
    ['outInterfaceList', negRead(p, 'out-interface-list', String)],
  ];
  const natStates = negRead(p, 'connection-nat-state', (text) =>
    text.split(',').filter((x): x is ConnNatState => (NAT_STATES as readonly string[]).includes(x)),
  );
  entries.push(['connectionNatState', natStates]);
  const match: Record<string, unknown> = {};
  for (const [key, value] of entries) if (value !== undefined) match[key] = value;
  const states = opt(p, 'connection-state');
  return (states === undefined ? match : { ...match, connectionState: states.split(',') }) as Match;
}

/** Mensaje de RouterOS cuando una regla usa como in/out-interface un puerto esclavo de un bridge. */
function slaveNote(match: Match, ctx: MenuCtx): string | undefined {
  for (const cond of [match.inInterface, match.outInterface]) {
    if (!cond) continue;
    const port = ctx.device.config.bridging.ports.find(
      (p) => !p.disabled && p.iface === cond.value,
    );
    if (port) {
      const slave = ifaceName(ctx, cond.value);
      const master = ifaceName(ctx, port.bridge);
      return `in/out-interface matcher not possible when interface (${slave}) is slave - use master instead (${master})`;
    }
  }
  return undefined;
}

function counters(ctx: MenuCtx, id: ItemId): (readonly [string, string])[] {
  const c = ctx.device.oper.ruleCounters.find((x) => x.rule === id);
  return [
    ['bytes', formatCount(c?.bytes ?? 0)],
    ['packets', formatCount(c?.packets ?? 0)],
  ];
}

const COUNTER_PROPS = [
  { ...ro('bytes'), hidden: true },
  { ...ro('packets'), hidden: true },
];

/** Pone a cero los contadores de esas filas (las reglas de un solo menú). */
function zeroCounters(ctx: ActionCtx, rows: readonly Row[]): Network {
  const ids = new Set(rows.map((r) => r.id));
  return updateOper(ctx.net, ctx.device.id, (oper) => ({
    ...oper,
    ruleCounters: oper.ruleCounters.filter((c) => !ids.has(c.rule)),
  }));
}

const resetCounters: ActionDef = {
  help: 'Reset rule counters',
  args: [],
  takesNumbers: true,
  run: (_args, ctx) =>
    ok({ net: zeroCounters(ctx, ctx.rows.length === 0 ? ctx.menu.rows(ctx) : ctx.rows) }),
};

const resetCountersAll: ActionDef = {
  help: 'Reset counters of all rules',
  args: [],
  run: (_args, ctx) => ok({ net: zeroCounters(ctx, ctx.menu.rows(ctx)) }),
};

const COUNTER_ACTIONS = { 'reset-counters': resetCounters, 'reset-counters-all': resetCountersAll };

const FILTER_ACTIONS = [
  'accept',
  'drop',
  'reject',
  'jump',
  'return',
  'passthrough',
  'fasttrack-connection',
  'log',
];
const REJECT_WITH: readonly RejectWith[] = [
  'icmp-port-unreachable',
  'icmp-admin-prohibited',
  'tcp-reset',
];

function filterAction(a: FilterAction): string {
  return a.kind === 'fasttrack' ? 'fasttrack-connection' : a.kind;
}

export const filterMenu: MenuDef = collectionMenu({
  path: 'ip/firewall/filter',
  help: 'Firewall filter rules',
  coll: 'filterRules',
  movable: true,
  props: [
    prop('chain', T.name, { required: true }),
    prop('action', T.enumOf(...FILTER_ACTIONS), { default: 'accept' }),
    prop('hw-offload', T.bool, { default: '' }),
    ...MATCH_PROPS,
    prop('jump-target', T.name, { default: '' }),
    prop('reject-with', T.enumOf(...REJECT_WITH), { default: '' }),
    prop('log', T.bool, { default: 'no' }),
    prop('log-prefix', T.string, { default: '' }),
    prop('place-before', T.string, { addOnly: true }),
    ...COUNTER_PROPS,
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid], [F.dynamic]],
  style: 'detail',
  columns: [],
  statsColumns: ['chain', 'action', 'bytes', 'packets'],
  export: { order: 82, style: 'add' },
  toProps: (r, ctx) =>
    props([
      ['chain', r.chain],
      ['action', filterAction(r.action)],
      ['hw-offload', r.hwOffload === undefined ? undefined : yn(r.hwOffload)],
      ...matchProps(r.match, ctx),
      ['jump-target', r.action.kind === 'jump' ? r.action.target : undefined],
      ['reject-with', r.action.kind === 'reject' ? r.action.with : undefined],
      ['log', yn(r.log)],
      ['log-prefix', r.logPrefix ?? ''],
      ...counters(ctx, r.id),
      ...baseProps(r),
    ]),
  flagsOf: (r, ctx) => flags(['X', r.disabled], ['I', isInvalid(ctx, 'filterRules', r.id)]),
  noteOf: (r, ctx) => slaveNote(r.match, ctx),
  fromProps: (p, ctx) => {
    const kind = get(p, 'action');
    let action: FilterAction;
    switch (kind) {
      case 'jump': {
        const target = get(p, 'jump-target');
        if (target === '') return err(fault('missing-args', undefined, { args: 'jump-target' }));
        action = { kind: 'jump', target };
        break;
      }
      case 'reject':
        action = {
          kind: 'reject',
          with: (opt(p, 'reject-with') ?? 'icmp-port-unreachable') as RejectWith,
        };
        break;
      case 'fasttrack-connection':
        action = { kind: 'fasttrack' };
        break;
      case 'log':
        action = { kind: 'passthrough' };
        break;
      default:
        action = { kind: kind as 'accept' | 'drop' | 'return' | 'passthrough' };
    }
    const logPrefix = opt(p, 'log-prefix');
    const hwOffload = opt(p, 'hw-offload');
    return ok({
      chain: get(p, 'chain'),
      match: matchFrom(p, ctx),
      action,
      log: kind === 'log' || isYes(p.get('log')),
      ...(logPrefix === undefined ? {} : { logPrefix }),
      ...(hwOffload === undefined ? {} : { hwOffload: isYes(hwOffload) }),
      ...baseFrom(p),
    });
  },
  actions: COUNTER_ACTIONS,
});

const NAT_ACTIONS = ['accept', 'masquerade', 'src-nat', 'dst-nat', 'redirect', 'netmap'];

function natAction(a: NatAction): string {
  return a.kind === 'srcNat' ? 'src-nat' : a.kind === 'dstNat' ? 'dst-nat' : a.kind;
}

export const natMenu: MenuDef = collectionMenu({
  path: 'ip/firewall/nat',
  help: 'Network address translation',
  coll: 'natRules',
  movable: true,
  props: [
    prop('chain', T.enumOf('srcnat', 'dstnat'), { required: true }),
    prop('action', T.enumOf(...NAT_ACTIONS), { default: 'accept' }),
    // v7 muestra la traducción justo después de la acción.
    prop('to-addresses', T.address, { default: '' }),
    prop('to-ports', T.ports, { default: '' }),
    ...MATCH_PROPS,
    prop('place-before', T.string, { addOnly: true }),
    ...COUNTER_PROPS,
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.invalid], [F.dynamic]],
  style: 'detail',
  columns: [],
  statsColumns: ['chain', 'action', 'bytes', 'packets'],
  export: { order: 84, style: 'add' },
  toProps: (r, ctx) => {
    const a = r.action;
    const target = 'to' in a ? a.to : undefined;
    const to =
      target === undefined
        ? undefined
        : 'len' in target
          ? formatPrefix(target)
          : formatRange(target);
    const toPorts = 'toPorts' in a && a.toPorts ? formatPortSet(a.toPorts) : undefined;
    return props([
      ['chain', r.chain],
      ['action', natAction(a)],
      ['to-addresses', to],
      ['to-ports', toPorts],
      ...matchProps(r.match, ctx),
      ...counters(ctx, r.id),
      ...baseProps(r),
    ]);
  },
  flagsOf: (r, ctx) => flags(['X', r.disabled], ['I', isInvalid(ctx, 'natRules', r.id)]),
  noteOf: (r, ctx) => slaveNote(r.match, ctx),
  fromProps: (p, ctx) => {
    const kind = get(p, 'action');
    const toText = opt(p, 'to-addresses');
    const portsText = opt(p, 'to-ports');
    const toPorts = portsText === undefined ? undefined : (parsePortSet(portsText) ?? undefined);
    const withPorts = toPorts === undefined ? {} : { toPorts };
    const needTo = (): IpRange | null =>
      toText === undefined ? null : (parseRange(toText) as IpRange);
    let action: NatAction;
    switch (kind) {
      case 'masquerade':
        action = { kind: 'masquerade', ...withPorts };
        break;
      case 'src-nat': {
        const to = needTo();
        if (!to) return err(fault('missing-args', undefined, { args: 'to-addresses' }));
        action = { kind: 'srcNat', to, ...withPorts };
        break;
      }
      case 'dst-nat': {
        // Con solo to-ports se traduce el puerto y se conserva la dirección de destino.
        const to = needTo();
        if (!to && !toPorts) return err(fault('missing-args', undefined, { args: 'to-addresses' }));
        action = { kind: 'dstNat', ...(to ? { to } : {}), ...withPorts };
        break;
      }
      case 'redirect':
        if (!toPorts) return err(fault('missing-args', undefined, { args: 'to-ports' }));
        action = { kind: 'redirect', toPorts };
        break;
      case 'netmap': {
        const to = toText === undefined ? null : parsePrefix(toText);
        if (!to) return err(fault('missing-args', undefined, { args: 'to-addresses' }));
        action = { kind: 'netmap', to };
        break;
      }
      default:
        action = { kind: 'accept' };
    }
    return ok({
      chain: get(p, 'chain') === 'dstnat' ? 'dstnat' : 'srcnat',
      match: matchFrom(p, ctx),
      action,
      ...baseFrom(p),
    });
  },
  actions: COUNTER_ACTIONS,
});

export const addressListMenu: MenuDef = collectionMenu({
  path: 'ip/firewall/address-list',
  help: 'Firewall address lists',
  coll: 'addressLists',
  props: [
    prop('list', T.name, { required: true }),
    prop('address', T.address, { required: true }),
    prop('timeout', T.time, { default: '' }),
    ro('creation-time'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled], [F.dynamic]],
  style: 'table',
  columns: ['list', 'address', 'creation-time', 'timeout'],
  export: { order: 80, style: 'add' },
  toProps: (a, ctx) =>
    props([
      ['list', a.list],
      ['address', showAddress(a.address)],
      ['timeout', a.timeoutS === undefined ? '' : formatDuration(remaining(a, ctx))],
      [
        'creation-time',
        a.createdAt === undefined ? '' : formatDateTime(ctx.clockBase, a.createdAt),
      ],
      ...baseProps(a),
    ]),
  // Las entradas con timeout son temporales: dinámicas, no se exportan y caducan solas.
  flagsOf: (a) => flags(['X', a.disabled], ['D', a.timeoutS !== undefined]),
  fromProps: (p, ctx, current) => {
    const createdAt = current?.createdAt ?? ctx.net.now;
    const timeout = opt(p, 'timeout');
    let timeoutS: number | undefined;
    if (timeout !== undefined) {
      // timeout muestra lo que falta: si no cambia se conserva el plazo; si cambia se
      // reinicia desde ahora (el modelo cuenta el plazo desde la creación).
      const wanted = seconds(timeout);
      const kept = current?.timeoutS !== undefined && wanted === remaining(current, ctx);
      timeoutS = kept ? current?.timeoutS : ctx.net.now - createdAt + wanted;
    }
    return ok({
      list: get(p, 'list'),
      address: parseAddress(get(p, 'address')),
      ...(timeoutS === undefined ? {} : { timeoutS }),
      createdAt,
      ...baseFrom(p),
    });
  },
});

/** Segundos que le quedan a una entrada temporal. */
function remaining(a: AddressListEntry, ctx: MenuCtx): number {
  const timeout = a.timeoutS ?? 0;
  return a.createdAt === undefined ? timeout : Math.max(0, a.createdAt + timeout - ctx.net.now);
}

export const connectionMenu: MenuDef = {
  path: 'ip/firewall/connection',
  help: 'Connection tracking',
  props: [
    ro('protocol'),
    ro('src-address'),
    ro('dst-address'),
    ro('reply-src-address'),
    ro('reply-dst-address'),
    ro('tcp-state'),
    ro('timeout'),
  ],
  flags: [
    [{ letter: 'S', name: 'seen-reply' }],
    [{ letter: 'A', name: 'assured' }],
    [{ letter: 'C', name: 'confirmed' }],
    [
      { letter: 's', name: 'srcnat' },
      { letter: 'd', name: 'dstnat' },
    ],
  ],
  style: 'table',
  columns: ['protocol', 'src-address', 'dst-address', 'tcp-state', 'timeout'],
  rows: (ctx) =>
    ctx.device.oper.conntrack.map((c, i) => {
      const ep = (e: { ip: Parameters<typeof formatIpv4>[0]; port?: number }) =>
        e.port === undefined ? formatIpv4(e.ip) : `${formatIpv4(e.ip)}:${e.port}`;
      return dynamicRow(
        `c${i}`,
        props([
          ['protocol', c.protocol],
          ['src-address', ep(c.original.src)],
          ['dst-address', ep(c.original.dst)],
          ['reply-src-address', ep(c.reply.src)],
          ['reply-dst-address', ep(c.reply.dst)],
          ['tcp-state', c.protocol === 'tcp' ? 'established' : ''],
          ['timeout', formatDuration(c.expiresAt - ctx.net.now)],
        ]),
        flags(['S', true], ['A', true], ['C', true], ['s', c.srcNat], ['d', c.dstNat]),
      );
    }),
};

export const IP_MENUS: readonly MenuDef[] = [
  addressMenu,
  routeMenu,
  poolMenu,
  poolUsedMenu,
  dhcpServerMenu,
  dhcpNetworkMenu,
  dhcpLeaseMenu,
  dhcpClientMenu,
  arpMenu,
  neighborMenu,
  discoveryMenu,
  serviceMenu,
  dnsMenu,
  dnsStaticMenu,
  dnsCacheMenu,
  filterMenu,
  natMenu,
  addressListMenu,
  connectionMenu,
];
