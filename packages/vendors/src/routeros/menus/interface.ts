import {
  type BridgePort,
  deterministicMac,
  err,
  type FrameTypes,
  formatIpv4,
  type Interface,
  type ItemId,
  type NewItem,
  ok,
  torch,
  type WifiAuth,
  type WifiBand,
  type WirelessInterface,
} from '@nos/core';
import { BUILTIN_LISTS, ifaceName, internalId, refIdLoose, refName } from '../refs';
import { fault, type MenuCtx, type MenuDef, type Props, prop, type Row, ro, T } from '../schema';
import { formatCount, formatDuration, formatRate, formatVlanIds, parseVlanIds } from '../values';
import {
  baseFrom,
  baseProps,
  COMMON_PROPS,
  collectionMenu,
  dynamicRow,
  F,
  flags,
  get,
  isYes,
  nextName,
  opt,
  props,
  withoutId,
  yn,
} from './common';

// ── Ayudantes ───────────────────────────────────────────────────────────────

const TYPE_NAMES: Readonly<Record<Interface['kind'], string>> = {
  ethernet: 'ether',
  bridge: 'bridge',
  vlan: 'vlan',
  wireless: 'wifi',
  loopback: 'loopback',
};

function operOf(ctx: MenuCtx, id: ItemId) {
  return ctx.device.oper.interfaces.find((i) => i.iface === id);
}

const isRunning = (ctx: MenuCtx, id: ItemId): boolean => operOf(ctx, id)?.running ?? false;

const isSlave = (ctx: MenuCtx, id: ItemId): boolean =>
  ctx.device.config.bridging.ports.some((p) => !p.disabled && p.iface === id);

function defaultName(ctx: MenuCtx, iface: Interface): string | undefined {
  if (iface.kind !== 'ethernet' && iface.kind !== 'wireless') return undefined;
  const port = ctx.device.hardware.ports[iface.port];
  return port ? ctx.platform.interfaceName(port) : undefined;
}

const ifaceFlags = (ctx: MenuCtx, iface: Interface): string =>
  flags(
    ['X', iface.disabled],
    ['R', !iface.disabled && isRunning(ctx, iface.id)],
    ['S', isSlave(ctx, iface.id)],
  );

const IFACE_FLAGS = [[F.dynamic], [F.disabled, F.running], [F.slave]] as const;

function statsProps(ctx: MenuCtx, id: ItemId): (readonly [string, string])[] {
  const o = operOf(ctx, id);
  return [
    ['rx-byte', formatCount(o?.rx.bytes ?? 0)],
    ['tx-byte', formatCount(o?.tx.bytes ?? 0)],
    ['rx-packet', formatCount(o?.rx.packets ?? 0)],
    ['tx-packet', formatCount(o?.tx.packets ?? 0)],
  ];
}

const STATS_PROPS = ['rx-byte', 'tx-byte', 'rx-packet', 'tx-packet'].map((name) => ({
  ...ro(name),
  hidden: true,
}));

const ifaceId = (ctx: MenuCtx, name: string): ItemId =>
  refIdLoose(ctx, 'interface', name) ?? (0 as ItemId);

// ── /interface ──────────────────────────────────────────────────────────────

const monitorTraffic = {
  help: 'Monitor traffic through interfaces',
  positional: 'interface',
  args: [prop('interface', T.ref('interface'), { required: true }), prop('once', T.flag)],
  run: (args: Props, ctx: MenuCtx) => {
    const id = ifaceId(ctx, get(args, 'interface'));
    const render = (n: MenuCtx['net']) => {
      const device = n.devices.find((d) => d.id === ctx.device.id);
      const o = device?.oper.interfaces.find((i) => i.iface === id);
      const rx = o?.rateBps.rx ?? 0;
      const tx = o?.rateBps.tx ?? 0;
      const rows: [string, string][] = [
        ['name', get(args, 'interface')],
        ['rx-packets-per-second', String(Math.round(rx / 8000))],
        ['rx-bits-per-second', formatRate(rx)],
        ['tx-packets-per-second', String(Math.round(tx / 8000))],
        ['tx-bits-per-second', formatRate(tx)],
      ];
      const width = Math.max(...rows.map(([k]) => k.length));
      return rows.map(([k, v]) => `${k.padStart(width + 2)}: ${v}`).join('\n');
    };
    if (isYes(args.get('once'))) return ok({ output: render(ctx.net) });
    return ok({ live: { mode: 'replace' as const, frame: (n: MenuCtx['net']) => render(n) } });
  },
};

export const interfaceMenu: MenuDef = collectionMenu({
  path: 'interface',
  help: 'Interface configuration',
  coll: 'interfaces',
  creatable: false,
  removable: false,
  props: [
    prop('name', T.name),
    ro('default-name'),
    ro('type'),
    prop('mtu', T.int(64, 65535)),
    ro('actual-mtu'),
    ro('mac-address'),
    ...COMMON_PROPS,
    ...STATS_PROPS,
  ],
  flags: IFACE_FLAGS,
  style: 'table',
  columns: ['name', 'type', 'actual-mtu', 'mac-address'],
  statsColumns: ['name', 'rx-byte', 'tx-byte', 'rx-packet', 'tx-packet'],
  nameProp: 'name',
  toProps: (i, ctx) =>
    props([
      ['name', i.name],
      ['default-name', defaultName(ctx, i)],
      ['type', TYPE_NAMES[i.kind]],
      ['mtu', String(i.mtu)],
      ['actual-mtu', String(i.mtu)],
      ['mac-address', i.mac],
      ...baseProps(i),
      ...statsProps(ctx, i.id),
    ]),
  flagsOf: (i, ctx) => ifaceFlags(ctx, i),
  fromProps: (p, _ctx, current) => {
    if (!current) return err(fault('not-allowed'));
    const { comment: _c, ...rest } = withoutId<'interfaces'>(current) as NewItem<'interfaces'> & {
      comment?: string;
    };
    return ok({
      ...rest,
      name: get(p, 'name'),
      mtu: Number(get(p, 'mtu')),
      ...baseFrom(p),
    } as NewItem<'interfaces'>);
  },
  actions: { 'monitor-traffic': monitorTraffic },
});

// ── /interface ethernet ─────────────────────────────────────────────────────

export const ethernetMenu: MenuDef = collectionMenu({
  path: 'interface/ethernet',
  help: 'Ethernet interfaces',
  coll: 'interfaces',
  creatable: false,
  removable: false,
  filter: (i) => i.kind === 'ethernet',
  props: [
    prop('name', T.name),
    ro('default-name'),
    prop('mtu', T.int(64, 65535), { default: '1500' }),
    ro('mac-address'),
    ro('arp'),
    ...COMMON_PROPS,
    ...STATS_PROPS,
  ],
  flags: IFACE_FLAGS,
  style: 'table',
  columns: ['name', 'mtu', 'mac-address', 'arp'],
  statsColumns: ['name', 'rx-byte', 'tx-byte', 'rx-packet', 'tx-packet'],
  nameProp: 'name',
  export: {
    order: 20,
    style: 'set-default-name',
    rowDefaults: (row) =>
      props([
        ['name', row.props.get('default-name')],
        ['mtu', '1500'],
        ['disabled', 'no'],
      ]),
  },
  toProps: (i, ctx) =>
    props([
      ['name', i.name],
      ['default-name', defaultName(ctx, i)],
      ['mtu', String(i.mtu)],
      ['mac-address', i.mac],
      ['arp', 'enabled'],
      ...baseProps(i),
      ...statsProps(ctx, i.id),
    ]),
  flagsOf: (i, ctx) => ifaceFlags(ctx, i),
  fromProps: (p, _ctx, current) => {
    if (current?.kind !== 'ethernet') return err(fault('not-allowed'));
    return ok({
      kind: 'ethernet',
      port: current.port,
      mac: current.mac,
      name: get(p, 'name'),
      mtu: Number(get(p, 'mtu')),
      ...baseFrom(p),
    });
  },
});

// ── /interface bridge ───────────────────────────────────────────────────────

export const bridgeMenu: MenuDef = collectionMenu({
  path: 'interface/bridge',
  help: 'Bridge interfaces',
  coll: 'interfaces',
  filter: (i) => i.kind === 'bridge',
  props: [
    prop('name', T.name),
    prop('mtu', T.int(64, 65535), { default: '1500' }),
    ro('actual-mtu'),
    ro('arp'),
    ro('mac-address'),
    prop('protocol-mode', T.enumOf('none', 'stp', 'rstp', 'mstp'), { default: 'rstp' }),
    prop('vlan-filtering', T.bool, { default: 'no' }),
    prop('pvid', T.int(1, 4094), { default: '1' }),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.running]],
  style: 'detail',
  columns: ['name'],
  nameProp: 'name',
  autoName: (ctx) =>
    nextName(
      'bridge',
      ctx.device.config.interfaces.map((i) => i.name),
    ),
  export: { order: 10, style: 'add' },
  toProps: (i) =>
    props(
      i.kind === 'bridge'
        ? [
            ['name', i.name],
            ['mtu', String(i.mtu)],
            ['actual-mtu', String(i.mtu)],
            ['arp', 'enabled'],
            ['mac-address', i.mac],
            ['protocol-mode', i.stp],
            ['vlan-filtering', yn(i.vlanFiltering)],
            ['pvid', String(i.pvid)],
            ...baseProps(i),
          ]
        : [],
    ),
  flagsOf: (i, ctx) => flags(['X', i.disabled], ['R', !i.disabled && isRunning(ctx, i.id)]),
  fromProps: (p, ctx, current) => {
    const name = get(p, 'name');
    return ok({
      kind: 'bridge',
      name,
      mtu: Number(get(p, 'mtu')),
      mac: current?.mac ?? deterministicMac(`${ctx.device.id}:${name}`, 0),
      vlanFiltering: isYes(p.get('vlan-filtering')),
      stp: get(p, 'protocol-mode') as 'none' | 'stp' | 'rstp' | 'mstp',
      pvid: Number(get(p, 'pvid')),
      ...baseFrom(p),
    });
  },
});

// ── /interface bridge port ──────────────────────────────────────────────────

const FRAME_TYPES: Readonly<Record<FrameTypes, string>> = {
  all: 'admit-all',
  'untagged-only': 'admit-only-untagged-and-priority-tagged',
  'tagged-only': 'admit-only-vlan-tagged',
};

const frameTypesFrom = (text: string): FrameTypes =>
  (Object.entries(FRAME_TYPES).find(([, v]) => v === text)?.[0] ?? 'all') as FrameTypes;

export const bridgePortMenu: MenuDef = collectionMenu({
  path: 'interface/bridge/port',
  help: 'Bridge ports',
  coll: 'bridgePorts',
  props: [
    prop('interface', T.ref('interface'), { required: true }),
    prop('bridge', T.ref('bridge'), { required: true }),
    prop('pvid', T.int(1, 4094), { default: '1' }),
    prop('frame-types', T.enumOf(...Object.values(FRAME_TYPES)), { default: 'admit-all' }),
    prop('ingress-filtering', T.bool, { default: 'yes' }),
    ro('hw'),
    ro('priority'),
    ro('path-cost'),
    ro('internal-path-cost'),
    ro('horizon'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.inactive], [F.dynamic], [{ letter: 'H', name: 'hw-offload' }]],
  style: 'table',
  columns: [
    'interface',
    'bridge',
    'hw',
    'pvid',
    'priority',
    'path-cost',
    'internal-path-cost',
    'horizon',
  ],
  export: { order: 40, style: 'add' },
  toProps: (p, ctx) =>
    props([
      ['interface', ifaceName(ctx, p.iface)],
      ['bridge', ifaceName(ctx, p.bridge)],
      ['pvid', String(p.pvid)],
      ['frame-types', FRAME_TYPES[p.frameTypes]],
      ['ingress-filtering', yn(p.ingressFiltering)],
      ['hw', 'yes'],
      ['priority', '0x80'],
      ['path-cost', '10'],
      ['internal-path-cost', '10'],
      ['horizon', 'none'],
      ...baseProps(p),
    ]),
  flagsOf: (p: BridgePort, ctx) =>
    flags(['X', p.disabled], ['I', !p.disabled && !isRunning(ctx, p.iface)]),
  fromProps: (p, ctx) =>
    ok({
      iface: ifaceId(ctx, get(p, 'interface')),
      bridge: refIdLoose(ctx, 'bridge', get(p, 'bridge')) ?? ifaceId(ctx, get(p, 'bridge')),
      pvid: Number(get(p, 'pvid')),
      frameTypes: frameTypesFrom(get(p, 'frame-types')),
      ingressFiltering: isYes(p.get('ingress-filtering')),
      ...baseFrom(p),
    }),
});

// ── /interface bridge vlan ──────────────────────────────────────────────────

const namesOf = (ctx: MenuCtx, ids: readonly ItemId[]): string =>
  ids.map((id) => ifaceName(ctx, id)).join(',');

const idsOf = (ctx: MenuCtx, text: string): ItemId[] =>
  text === '' ? [] : text.split(',').map((name) => ifaceId(ctx, name));

export const bridgeVlanMenu: MenuDef = collectionMenu({
  path: 'interface/bridge/vlan',
  help: 'Bridge VLAN table',
  coll: 'bridgeVlans',
  props: [
    prop('bridge', T.ref('bridge'), { required: true }),
    prop('vlan-ids', T.vlanIds, { required: true }),
    prop('tagged', T.refList('interface'), { default: '' }),
    prop('untagged', T.refList('interface'), { default: '' }),
    ro('current-tagged'),
    ro('current-untagged'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled], [F.dynamic]],
  style: 'table',
  columns: ['bridge', 'vlan-ids', 'current-tagged', 'current-untagged'],
  export: { order: 50, style: 'add' },
  toProps: (v, ctx) => {
    const membership = ctx.device.oper.vlanMembership.filter(
      (m) => m.bridge === v.bridge && v.vlanIds.includes(m.vlanId),
    );
    const current = (pick: 'tagged' | 'untagged') => [
      ...new Set(membership.flatMap((m) => m[pick])),
    ];
    return props([
      ['bridge', ifaceName(ctx, v.bridge)],
      ['vlan-ids', formatVlanIds(v.vlanIds)],
      ['tagged', namesOf(ctx, v.tagged)],
      ['untagged', namesOf(ctx, v.untagged)],
      ['current-tagged', namesOf(ctx, current('tagged'))],
      ['current-untagged', namesOf(ctx, current('untagged'))],
      ...baseProps(v),
    ]);
  },
  flagsOf: (v) => flags(['X', v.disabled]),
  fromProps: (p, ctx) =>
    ok({
      bridge: ifaceId(ctx, get(p, 'bridge')),
      vlanIds: parseVlanIds(get(p, 'vlan-ids')) ?? [],
      tagged: idsOf(ctx, get(p, 'tagged')),
      untagged: idsOf(ctx, get(p, 'untagged')),
      ...baseFrom(p),
    }),
  extraRows: (ctx) =>
    ctx.device.oper.vlanMembership
      .filter((m) => m.dynamic)
      .map((m) =>
        dynamicRow(
          `d${m.bridge}:${m.vlanId}`,
          props([
            ['bridge', ifaceName(ctx, m.bridge)],
            ['vlan-ids', String(m.vlanId)],
            ['current-tagged', namesOf(ctx, m.tagged)],
            ['current-untagged', namesOf(ctx, m.untagged)],
          ]),
          'D',
        ),
      ),
});

// ── /interface bridge host ──────────────────────────────────────────────────

export const bridgeHostMenu: MenuDef = {
  path: 'interface/bridge/host',
  help: 'Bridge host table',
  props: [ro('mac-address'), ro('vid'), ro('on-interface'), ro('bridge')],
  flags: [[F.dynamic], [{ letter: 'L', name: 'local' }]],
  style: 'table',
  columns: ['mac-address', 'vid', 'on-interface', 'bridge'],
  rows: (ctx) =>
    ctx.device.oper.bridgeHosts.map((h, i) =>
      dynamicRow(
        `h${i}`,
        props([
          ['mac-address', h.mac],
          ['vid', h.vlanId === null ? '' : String(h.vlanId)],
          ['on-interface', ifaceName(ctx, h.port)],
          ['bridge', ifaceName(ctx, h.bridge)],
        ]),
        flags(['D', true], ['L', h.local]),
      ),
    ),
};

// ── /interface vlan ─────────────────────────────────────────────────────────

export const vlanMenu: MenuDef = collectionMenu({
  path: 'interface/vlan',
  help: 'VLAN interfaces',
  coll: 'interfaces',
  filter: (i) => i.kind === 'vlan',
  props: [
    prop('name', T.name),
    prop('mtu', T.int(64, 65535), { default: '1500' }),
    ro('arp'),
    prop('vlan-id', T.int(1, 4094), { required: true }),
    prop('interface', T.ref('interface'), { required: true }),
    ro('mac-address'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.running]],
  style: 'table',
  columns: ['name', 'mtu', 'arp', 'vlan-id', 'interface'],
  nameProp: 'name',
  autoName: (ctx) =>
    nextName(
      'vlan',
      ctx.device.config.interfaces.map((i) => i.name),
    ),
  export: { order: 30, style: 'add' },
  toProps: (i, ctx) =>
    props(
      i.kind === 'vlan'
        ? [
            ['name', i.name],
            ['mtu', String(i.mtu)],
            ['arp', 'enabled'],
            ['vlan-id', String(i.vlanId)],
            ['interface', ifaceName(ctx, i.parent)],
            ['mac-address', i.mac],
            ...baseProps(i),
          ]
        : [],
    ),
  flagsOf: (i, ctx) => flags(['X', i.disabled], ['R', !i.disabled && isRunning(ctx, i.id)]),
  fromProps: (p, ctx, current) => {
    const parent = ifaceId(ctx, get(p, 'interface'));
    const parentMac = ctx.device.config.interfaces.find((i) => i.id === parent)?.mac;
    return ok({
      kind: 'vlan',
      name: get(p, 'name'),
      mtu: Number(get(p, 'mtu')),
      mac: current?.mac ?? parentMac ?? deterministicMac(`${ctx.device.id}:${get(p, 'name')}`, 0),
      vlanId: Number(get(p, 'vlan-id')),
      parent,
      ...baseFrom(p),
    });
  },
});

// ── /interface wifi ─────────────────────────────────────────────────────────

const BANDS = ['2ghz-ax', '2ghz-n', '2ghz-g', '5ghz-ax', '5ghz-ac', '5ghz-n', '5ghz-a'];
const AUTH_TYPES: readonly WifiAuth[] = ['wpa2-psk', 'wpa3-psk'];

function hardwareBand(ctx: MenuCtx, iface: WirelessInterface): WifiBand {
  const port = ctx.device.hardware.ports[iface.port];
  return port?.kind === 'wireless' ? port.band : '2ghz';
}

export const wifiMenu: MenuDef = collectionMenu({
  path: 'interface/wifi',
  help: 'Wireless interfaces',
  coll: 'interfaces',
  creatable: false,
  removable: false,
  filter: (i) => i.kind === 'wireless',
  props: [
    prop('name', T.name),
    ro('default-name'),
    ro('mac-address'),
    prop('configuration.mode', T.enumOf('ap', 'station'), { default: 'ap' }),
    prop('configuration.ssid', T.string, { default: '' }),
    prop('channel.band', T.enumOf(...BANDS), { default: '' }),
    prop('channel.frequency', T.int(2412, 5895), { default: '' }),
    prop('security.authentication-types', T.enumList(...AUTH_TYPES), { default: '' }),
    prop('security.passphrase', T.string, { default: '', sensitive: true, hidden: true }),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled, F.running]],
  style: 'table',
  columns: ['name', 'mac-address', 'configuration.mode', 'configuration.ssid'],
  nameProp: 'name',
  export: {
    order: 25,
    style: 'set-default-name',
    // Las radios salen de fábrica deshabilitadas.
    rowDefaults: (row) =>
      props([
        ['name', row.props.get('default-name')],
        ['disabled', 'yes'],
      ]),
  },
  toProps: (i, ctx) => {
    if (i.kind !== 'wireless') return props([]);
    const band = i.band === hardwareBand(ctx, i) ? '' : `${i.band}-ax`;
    return props([
      ['name', i.name],
      ['default-name', defaultName(ctx, i)],
      ['mac-address', i.mac],
      ['configuration.mode', i.mode],
      ['configuration.ssid', i.ssid],
      ['channel.band', band],
      ['channel.frequency', i.channelMhz === 'auto' ? '' : String(i.channelMhz)],
      ['security.authentication-types', i.security.auth.filter((a) => a !== 'open').join(',')],
      ['security.passphrase', i.security.passphrase ?? ''],
      ...baseProps(i),
    ]);
  },
  flagsOf: (i, ctx) => flags(['X', i.disabled], ['R', !i.disabled && isRunning(ctx, i.id)]),
  fromProps: (p, ctx, current) => {
    if (current?.kind !== 'wireless') return err(fault('not-allowed'));
    const bandText = get(p, 'channel.band');
    const band: WifiBand =
      bandText === '' ? hardwareBand(ctx, current) : bandText.startsWith('5') ? '5ghz' : '2ghz';
    const freq = get(p, 'channel.frequency');
    const auth = get(p, 'security.authentication-types')
      .split(',')
      .filter((a): a is WifiAuth => (AUTH_TYPES as readonly string[]).includes(a));
    const passphrase = opt(p, 'security.passphrase');
    return ok({
      kind: 'wireless',
      port: current.port,
      mac: current.mac,
      name: get(p, 'name'),
      mtu: current.mtu,
      mode: get(p, 'configuration.mode') === 'station' ? 'station' : 'ap',
      ssid: get(p, 'configuration.ssid'),
      band,
      channelMhz: freq === '' ? 'auto' : Number(freq),
      security: {
        auth: auth.length === 0 ? ['open'] : auth,
        ...(passphrase === undefined ? {} : { passphrase }),
      },
      ...baseFrom(p),
    });
  },
});

export const wifiRegistrationMenu: MenuDef = {
  path: 'interface/wifi/registration-table',
  help: 'Connected wireless clients',
  props: [ro('interface'), ro('ssid'), ro('mac-address'), ro('uptime'), ro('signal')],
  flags: [],
  style: 'table',
  columns: ['interface', 'ssid', 'mac-address', 'uptime', 'signal'],
  rows: (ctx) =>
    ctx.device.oper.wifiRegistrations.map((r, i) => {
      const ap = ctx.device.config.interfaces.find((x) => x.id === r.iface);
      return dynamicRow(
        `w${i}`,
        props([
          ['interface', ifaceName(ctx, r.iface)],
          ['ssid', ap?.kind === 'wireless' ? ap.ssid : ''],
          ['mac-address', r.mac],
          ['uptime', formatDuration(ctx.net.now - r.since)],
          ['signal', String(r.signalDbm)],
        ]),
        '',
      );
    }),
};

// ── /interface list ─────────────────────────────────────────────────────────

const BUILTIN_FLAG = { letter: '*', name: 'builtin' };

export const interfaceListMenu: MenuDef = collectionMenu({
  path: 'interface/list',
  help: 'Interface lists',
  coll: 'interfaceLists',
  props: [
    prop('name', T.name, { required: true }),
    prop('include', T.refList('interface-list'), { default: '' }),
    ro('exclude'),
    prop('comment', T.string),
  ],
  flags: [[BUILTIN_FLAG]],
  style: 'table',
  columns: ['name', 'include', 'exclude'],
  nameProp: 'name',
  export: { order: 35, style: 'add' },
  toProps: (l) =>
    props([
      ['name', l.name],
      ['include', l.include.join(',')],
      ['exclude', ''],
      ['comment', l.comment],
    ]),
  flagsOf: () => '',
  fromProps: (p) => {
    const comment = opt(p, 'comment');
    return ok({
      name: get(p, 'name'),
      include: get(p, 'include') === '' ? [] : get(p, 'include').split(','),
      disabled: false,
      ...(comment === undefined ? {} : { comment }),
    });
  },
  extraRows: () =>
    BUILTIN_LISTS.map((name) =>
      dynamicRow(
        `b${name}`,
        props([
          ['name', name],
          ['include', ''],
          ['exclude', ''],
        ]),
        '*',
      ),
    ),
});

export const interfaceListMemberMenu: MenuDef = collectionMenu({
  path: 'interface/list/member',
  help: 'Interface list members',
  coll: 'interfaceListMembers',
  props: [
    prop('list', T.ref('interface-list'), { required: true }),
    prop('interface', T.ref('interface'), { required: true }),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled], [F.dynamic]],
  style: 'table',
  columns: ['list', 'interface'],
  export: { order: 55, style: 'add' },
  toProps: (m, ctx) =>
    props([
      ['list', refName(ctx, 'interface-list', m.list)],
      ['interface', ifaceName(ctx, m.iface)],
      ...baseProps(m),
    ]),
  flagsOf: (m) => flags(['X', m.disabled]),
  fromProps: (p, ctx) => {
    const list = refIdLoose(ctx, 'interface-list', get(p, 'list'));
    if (list === undefined) return err(fault('no-match', undefined, { arg: 'list' }));
    return ok({ list, iface: ifaceId(ctx, get(p, 'interface')), ...baseFrom(p) });
  },
});

// ── /tool torch ─────────────────────────────────────────────────────────────

/** Torch: solo desglosa por los clasificadores que se piden, como en el equipo real. */
export function torchView(ctx: MenuCtx, args: Props) {
  const iface = ifaceId(ctx, get(args, 'interface'));
  const classifiers = ['ip-protocol', 'src-address', 'port', 'dst-address'].filter((c) =>
    args.has(c),
  );
  const columns = [
    ...(classifiers.includes('ip-protocol') ? ['IP-PROTOCOL'] : []),
    ...(classifiers.includes('src-address') ? ['SRC-ADDRESS'] : []),
    ...(classifiers.includes('port') ? ['SRC-PORT'] : []),
    ...(classifiers.includes('dst-address') ? ['DST-ADDRESS'] : []),
    ...(classifiers.includes('port') ? ['DST-PORT'] : []),
    'TX',
    'RX',
    'TX-PACKETS',
    'RX-PACKETS',
  ];
  return (net: MenuCtx['net']): string => {
    const entries = torch(net, ctx.device.id, iface);
    const groups = new Map<string, { cells: string[]; tx: number; rx: number }>();
    for (const e of entries) {
      const cells = [
        ...(classifiers.includes('ip-protocol') ? [e.protocol] : []),
        ...(classifiers.includes('src-address') ? [formatIpv4(e.src)] : []),
        ...(classifiers.includes('port') ? [e.srcPort === undefined ? '' : String(e.srcPort)] : []),
        ...(classifiers.includes('dst-address') ? [formatIpv4(e.dst)] : []),
        ...(classifiers.includes('port') ? [e.dstPort === undefined ? '' : String(e.dstPort)] : []),
      ];
      const key = cells.join('|');
      const group = groups.get(key) ?? { cells, tx: 0, rx: 0 };
      group.tx += e.txBps;
      group.rx += e.rxBps;
      groups.set(key, group);
    }
    const lines: string[][] = [];
    let tx = 0;
    let rx = 0;
    for (const g of groups.values()) {
      if (classifiers.length > 0) lines.push([...g.cells, ...rates(g.tx, g.rx)]);
      tx += g.tx;
      rx += g.rx;
    }
    lines.push([...classifiers.flatMap((c) => (c === 'port' ? ['', ''] : [''])), ...rates(tx, rx)]);
    const widths = columns.map((h, i) =>
      Math.max(h.length, ...lines.map((l) => (l[i] ?? '').length)),
    );
    const fmt = (cells: readonly string[]) =>
      cells
        .map((c, i) =>
          i >= columns.length - 4 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0),
        )
        .join('  ')
        .trimEnd();
    return [`Columns: ${columns.join(', ')}`, fmt(columns), ...lines.map(fmt)].join('\n');
  };
}

function rates(tx: number, rx: number): string[] {
  return [
    formatRate(tx),
    formatRate(rx),
    String(Math.round(tx / 8000)),
    String(Math.round(rx / 8000)),
  ];
}

export const INTERFACE_MENUS: readonly MenuDef[] = [
  interfaceMenu,
  ethernetMenu,
  bridgeMenu,
  bridgePortMenu,
  bridgeVlanMenu,
  bridgeHostMenu,
  vlanMenu,
  wifiMenu,
  wifiRegistrationMenu,
  interfaceListMenu,
  interfaceListMemberMenu,
];

export { internalId, type Row };
