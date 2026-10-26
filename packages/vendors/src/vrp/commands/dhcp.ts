/**
 * DHCP: el servicio del equipo (`dhcp enable`), los pools globales (`ip pool`
 * con network, gateway-list, dns-list, excluded-ip-address y lease), el
 * servidor de cada interfaz (`dhcp select global`) y `display ip pool`.
 *
 * Traducción al modelo neutral (D-044):
 * - Un `ip pool` es un Pool cuyos rangos son los hosts de la red menos la
 *   puerta de enlace y lo excluido, más una red DHCP (DhcpNetwork) con el
 *   gateway y los DNS para el mismo prefijo.
 * - `dhcp select global` es un servidor DHCP en la interfaz, enlazado con el
 *   pool cuya red contiene la dirección de la interfaz (o `static-only` si
 *   todavía no hay ninguno). La reconciliación lo vuelve a enlazar tras cada cambio.
 *
 * Lo que VRP guarda en el pool y el modelo neutral no tiene dónde poner va en
 * el comentario del Pool, que VRP no deja escribir ni muestra (ver `PoolMeta`).
 * Las direcciones excluidas no se guardan: se deducen de los huecos de los rangos.
 */
import {
  type Device,
  type DhcpNetwork,
  type DhcpServer,
  formatIpv4,
  formatPrefix,
  type Interface,
  type IpRange,
  type Ipv4,
  type Ipv4Prefix,
  type ItemId,
  networkOf,
  type Op,
  type Pool,
  parseIpv4,
  parsePrefix,
  prefixContains,
  type Result,
  rangeSize,
  samePrefix,
  usableHosts,
} from '@nos/core';
import {
  type Area,
  type ConfigBlock,
  config,
  currentIface,
  dottedMask,
  fault,
  intent,
  lenOf,
  noop,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, kw, type Node, type VrpFault } from '../grammar';
import type { VrpIntent } from '../intent';
import type { View, ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];

/** Lease por defecto de VRP: un día. */
const DEFAULT_LEASE_S = 86_400;

const UNDO = kw('undo', 'Negate a command or set its default');
const DHCP = kw('dhcp', 'Dynamic host configure protocol');
const ENABLE = kw('enable', 'Enable DHCP');
const IP = kw('ip', 'Specify IP configurations');
const POOL = kw('pool', 'Configure an IP address pool');
const POOL_NAME = arg('name', { kind: 'word', max: 64 }, 'Name of an IP address pool');
const SELECT_GLOBAL = [
  kw('select', 'Specify the address allocation mode'),
  kw('global', 'Allocate addresses from global pools'),
];
const NETWORK = kw('network', 'Specify the network segment of the pool');
const GATEWAY_LIST = kw('gateway-list', 'Specify the gateway of the pool');
const DNS_LIST = kw('dns-list', 'Specify the DNS servers of the pool');
const EXCLUDED = kw('excluded-ip-address', 'Exclude addresses from the pool');
const LEASE = kw('lease', 'Specify the lease time of the pool');
const ALL = kw('all', 'All entries');
const START = arg('start', { kind: 'ipv4' }, 'Start IP address');
const END = arg('end', { kind: 'ipv4' }, 'End IP address');

// ── Rangos ──────────────────────────────────────────────────────────────────

/**
 * El núcleo no admite un pool sin rangos. Mientras el pool de VRP no tiene
 * direcciones que repartir (sin `network`, o todo excluido) lleva este rango
 * vacío, que la reconciliación nunca enlaza con un servidor.
 */
const NO_RANGE: IpRange = { from: 0 as Ipv4, to: 0 as Ipv4 };

const isNoRange = (r: IpRange): boolean => r.from === 0 && r.to === 0;

/** Rangos de verdad de un pool (sin el marcador de pool vacío). */
const realRanges = (pool: Pool): IpRange[] => pool.ranges.filter((r) => !isNoRange(r));

/** Ordena y une rangos solapados o contiguos. */
function normalize(ranges: readonly IpRange[]): IpRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: IpRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.from <= last.to + 1) {
      out[out.length - 1] = { from: last.from, to: Math.max(last.to, r.to) as Ipv4 };
    } else {
      out.push(r);
    }
  }
  return out;
}

/** Las direcciones de `from` que no están en `cut`. */
function subtract(from: readonly IpRange[], cut: readonly IpRange[]): IpRange[] {
  let pieces = normalize(from);
  for (const c of normalize(cut)) {
    pieces = pieces.flatMap((p): IpRange[] => {
      if (c.to < p.from || c.from > p.to) return [p];
      const parts: IpRange[] = [];
      if (c.from > p.from) parts.push({ from: p.from, to: (c.from - 1) as Ipv4 });
      if (c.to < p.to) parts.push({ from: (c.to + 1) as Ipv4, to: p.to });
      return parts;
    });
  }
  return pieces;
}

/** Lo que el pool podría repartir antes de excluir nada: los hosts de la red sin el gateway. */
function baseRanges(network: Ipv4Prefix, gateway: Ipv4 | undefined): IpRange[] {
  const hosts = usableHosts(network);
  return subtract([hosts], gateway === undefined ? [] : [{ from: gateway, to: gateway }]);
}

const total = (ranges: readonly IpRange[]): number =>
  ranges.reduce((sum, r) => sum + rangeSize(r), 0);

// ── El pool de VRP sobre el modelo neutral ──────────────────────────────────

/**
 * Lo que el comentario del Pool guarda, como `vrp network=192.168.1.0/24 lease=259200`:
 * - `network`: el prefijo de su red DHCP, que es como se encuentra (el prefijo
 *   es único en el núcleo). Así el enlace sobrevive aunque los rangos queden vacíos.
 * - `lease`: el lease del pool, solo si no es el de fábrica. Se guarda en el pool
 *   y no en los servidores porque lo normal es configurar el pool antes de
 *   `dhcp select global`: guardarlo en los servidores lo perdería si aún no
 *   hay ninguno. La reconciliación lo copia a los servidores enlazados.
 * - `gateway` y `dns`: solo mientras el pool no tiene `network` (VRP los
 *   admite antes, y la configuración los imprime antes que la red). En cuanto
 *   hay red, viven en la DhcpNetwork, que es lo que lee el motor.
 */
interface PoolMeta {
  readonly network?: Ipv4Prefix;
  readonly leaseS?: number;
  readonly gateway?: Ipv4;
  readonly dns: readonly Ipv4[];
}

const META_TAG = 'vrp';

function parseMeta(comment: string | undefined): PoolMeta {
  const words = (comment ?? '').split(/\s+/);
  if (words[0] !== META_TAG) return { dns: [] };
  let meta: PoolMeta = { dns: [] };
  for (const word of words.slice(1)) {
    const [key, value = ''] = word.split('=');
    if (key === 'network') {
      const p = parsePrefix(value);
      if (p) meta = { ...meta, network: p };
    } else if (key === 'lease' && /^\d+$/.test(value)) {
      meta = { ...meta, leaseS: Number(value) };
    } else if (key === 'gateway') {
      const ip = parseIpv4(value);
      if (ip !== null) meta = { ...meta, gateway: ip };
    } else if (key === 'dns') {
      const ips = value.split(',').map(parseIpv4);
      meta = { ...meta, dns: ips.filter((ip): ip is Ipv4 => ip !== null) };
    }
  }
  return meta;
}

function formatMeta(meta: PoolMeta): string | undefined {
  const parts: string[] = [];
  if (meta.network) parts.push(`network=${formatPrefix(meta.network)}`);
  if (meta.leaseS !== undefined) parts.push(`lease=${meta.leaseS}`);
  if (meta.gateway !== undefined) parts.push(`gateway=${formatIpv4(meta.gateway)}`);
  if (meta.dns.length > 0) parts.push(`dns=${meta.dns.map(formatIpv4).join(',')}`);
  return parts.length === 0 ? undefined : [META_TAG, ...parts].join(' ');
}

/** Un `ip pool` tal como lo ve el usuario de VRP. */
interface VrpPool {
  readonly name: string;
  readonly network?: Ipv4Prefix;
  readonly gateway?: Ipv4;
  readonly dns: readonly Ipv4[];
  readonly excluded: readonly IpRange[];
  readonly leaseS: number;
}

const poolsOf = (device: Device): readonly Pool[] => device.config.dhcpServer.pools;

const poolByName = (device: Device, name: string): Pool | undefined =>
  poolsOf(device).find((p) => p.name === name);

/** La red DHCP del pool, por el prefijo que guarda su comentario. */
function networkItem(device: Device, pool: Pool): DhcpNetwork | undefined {
  const network = parseMeta(pool.comment).network;
  if (!network) return undefined;
  return device.config.dhcpServer.networks.find((n) => samePrefix(n.prefix, network));
}

function readPool(device: Device, pool: Pool): VrpPool {
  const meta = parseMeta(pool.comment);
  const net = networkItem(device, pool);
  const gateway = net ? net.gateway : meta.gateway;
  const dns = net ? net.dnsServers : meta.dns;
  const network = meta.network;
  // Lo excluido es lo que falta en los rangos respecto a la red sin el gateway.
  const excluded = network ? subtract(baseRanges(network, gateway), realRanges(pool)) : [];
  return {
    name: pool.name,
    ...(network === undefined ? {} : { network }),
    ...(gateway === undefined ? {} : { gateway }),
    dns,
    excluded,
    leaseS: meta.leaseS ?? DEFAULT_LEASE_S,
  };
}

/** Operaciones que dejan el modelo como dice `next` (el pool existe ya o se crea). */
function writePool(device: Device, pool: Pool | undefined, next: VrpPool): Op[] {
  const ranges = next.network
    ? subtract(baseRanges(next.network, next.gateway), next.excluded)
    : [];
  const comment = formatMeta({
    ...(next.network === undefined ? {} : { network: next.network }),
    ...(next.leaseS === DEFAULT_LEASE_S ? {} : { leaseS: next.leaseS }),
    ...(next.network !== undefined || next.gateway === undefined ? {} : { gateway: next.gateway }),
    dns: next.network === undefined ? next.dns : [],
  });
  const poolRanges = ranges.length > 0 ? ranges : [NO_RANGE];
  const ops: Op[] = [];
  if (!pool) {
    ops.push({
      op: 'add',
      coll: 'pools',
      item: {
        name: next.name,
        ranges: poolRanges,
        disabled: false,
        ...(comment === undefined ? {} : { comment }),
      },
    });
  } else {
    ops.push({
      op: 'set',
      coll: 'pools',
      id: pool.id,
      patch: { ranges: poolRanges, ...(comment === undefined ? {} : { comment }) },
      ...(comment === undefined ? { unset: ['comment'] } : {}),
    });
  }
  const current = pool ? networkItem(device, pool) : undefined;
  if (next.network) {
    const fields = { prefix: next.network, dnsServers: next.dns };
    if (current) {
      ops.push({
        op: 'set',
        coll: 'dhcpNetworks',
        id: current.id,
        patch: { ...fields, ...(next.gateway === undefined ? {} : { gateway: next.gateway }) },
        ...(next.gateway === undefined ? { unset: ['gateway'] } : {}),
      });
    } else {
      ops.push({
        op: 'add',
        coll: 'dhcpNetworks',
        item: {
          ...fields,
          ...(next.gateway === undefined ? {} : { gateway: next.gateway }),
          disabled: false,
        },
      });
    }
  } else if (current) {
    ops.push({ op: 'remove', coll: 'dhcpNetworks', id: current.id });
  }
  return ops;
}

// ── Servidores ──────────────────────────────────────────────────────────────

const serverOn = (device: Device, iface: ItemId): DhcpServer | undefined =>
  device.config.dhcpServer.servers.find((s) => s.iface === iface);

/**
 * Pool y lease que le tocan al servidor de una interfaz: el pool cuya red
 * contiene la dirección de la interfaz. Sin pool, o con uno sin direcciones
 * que repartir, el servidor queda `static-only` con el lease de fábrica.
 */
function bindingFor(
  device: Device,
  iface: ItemId,
): { readonly pool: ItemId | 'static-only'; readonly leaseS: number } {
  const ips = device.config.addressing.addresses
    .filter((a) => a.iface === iface && !a.disabled)
    .map((a) => a.address.ip);
  for (const pool of poolsOf(device)) {
    const { network } = parseMeta(pool.comment);
    if (!network || !ips.some((ip) => prefixContains(network, ip))) continue;
    const leaseS = readPool(device, pool).leaseS;
    return { pool: realRanges(pool).length > 0 ? pool.id : 'static-only', leaseS };
  }
  return { pool: 'static-only', leaseS: DEFAULT_LEASE_S };
}

/**
 * Tras cada cambio, cada servidor apunta al pool de su interfaz y lleva su
 * lease. Si ya está así no devuelve nada: correrla dos veces no cambia nada.
 */
function reconcile(device: Device): readonly Op[] {
  const ops: Op[] = [];
  for (const server of device.config.dhcpServer.servers) {
    const want = bindingFor(device, server.iface);
    if (server.pool === want.pool && server.leaseTimeS === want.leaseS) continue;
    ops.push({
      op: 'set',
      coll: 'dhcpServers',
      id: server.id,
      patch: { pool: want.pool, leaseTimeS: want.leaseS },
    });
  }
  return ops;
}

/** Leases repartidos por los servidores enlazados con el pool. */
function leasesOf(device: Device, pool: Pool) {
  const servers = new Set(
    device.config.dhcpServer.servers.filter((s) => s.pool === pool.id).map((s) => s.id),
  );
  return device.oper.dhcpLeases.filter((l) => servers.has(l.server));
}

// ── Comandos ────────────────────────────────────────────────────────────────

type Built = Result<VrpIntent, VrpFault>;

/** El pool de la vista actual, ya leído; null si la vista no es de pool o el pool no existe. */
function currentPool(ctx: CmdCtx): { readonly pool: Pool; readonly vrp: VrpPool } | null {
  const view = ctx.session.view;
  if (view.kind !== 'pool') return null;
  const pool = poolByName(ctx.device, view.name);
  return pool ? { pool, vrp: readPool(ctx.device, pool) } : null;
}

/** Cambia el pool de la vista actual. */
function editPool(ctx: CmdCtx, change: (current: VrpPool) => VrpPool | VrpFault): Built {
  const found = currentPool(ctx);
  if (!found) return fault('dhcp-pool-not-exist');
  const next = change(found.vrp);
  if ('code' in next) return fault(next.code, next.at);
  return config(writePool(ctx.device, found.pool, next));
}

/** El pool sin gateway o sin red. */
function without(p: VrpPool, key: 'gateway' | 'network'): VrpPool {
  const { gateway, network, ...rest } = p;
  if (key === 'gateway') return network === undefined ? rest : { ...rest, network };
  return gateway === undefined ? rest : { ...rest, gateway };
}

const DNS_ARGS = ['ip1', 'ip2', 'ip3', 'ip4', 'ip5', 'ip6', 'ip7', 'ip8'] as const;

/** `dns-list` con 1 a 8 direcciones. */
function dnsForms(head: readonly Node[]): Node[][] {
  return DNS_ARGS.map((_name, n) => [
    ...head,
    ...DNS_ARGS.slice(0, n + 1).map((name) => arg(name, { kind: 'ipv4' }, 'IP address')),
  ]);
}

const dnsArgs = (args: Readonly<Record<string, string>>): Ipv4[] => {
  const ips = DNS_ARGS.map((name) => parseIpv4(args[name] ?? '')).filter(
    (ip): ip is Ipv4 => ip !== null,
  );
  return [...new Set(ips)];
};

/** Rango START [END] ya validado; un fallo si END va antes que START. */
function rangeArg(
  args: Readonly<Record<string, string>>,
  argAt: Readonly<Record<string, number>>,
): IpRange | VrpFault {
  const from = parseIpv4(args['start'] ?? '');
  const to = args['end'] === undefined ? from : parseIpv4(args['end']);
  if (from === null || to === null) return { code: 'wrong-parameter' };
  if (to < from) return { code: 'wrong-parameter', ...withAt(argAt['end']) };
  return { from, to };
}

const withAt = (at: number | undefined): { at?: number } => (at === undefined ? {} : { at });

const LEASE_ARGS = {
  day: arg('day', { kind: 'int', min: 0, max: 999 }, 'Days'),
  hour: arg('hour', { kind: 'int', min: 0, max: 23 }, 'Hours'),
  minute: arg('minute', { kind: 'int', min: 0, max: 59 }, 'Minutes'),
};
const DAY = kw('day', 'Specify the number of days');
const HOUR = kw('hour', 'Specify the number of hours');
const MINUTE = kw('minute', 'Specify the number of minutes');

const commands: CommandSpec[] = [
  // ── Sistema ──
  {
    views: ['system'],
    forms: [[DHCP, ENABLE]],
    build: (_m, ctx) =>
      config(
        ctx.device.config.dhcp.serverEnabled
          ? []
          : [{ op: 'setSingleton', key: 'dhcp', patch: { serverEnabled: true } }],
        'Info: The operation may take a few seconds. Please wait for a moment.done.',
      ),
  },
  {
    views: ['system'],
    forms: [[UNDO, DHCP, ENABLE]],
    build: (_m, ctx) =>
      config(
        ctx.device.config.dhcp.serverEnabled
          ? [{ op: 'setSingleton', key: 'dhcp', patch: { serverEnabled: false } }]
          : [],
      ),
  },
  {
    views: ['system'],
    forms: [[IP, POOL, POOL_NAME]],
    build: (m, ctx) => {
      const name = m.args['name'] ?? '';
      const enter: VrpIntent = {
        kind: 'session',
        change: { kind: 'enter', view: { kind: 'pool', name } },
      };
      if (poolByName(ctx.device, name)) return intent(enter);
      const created: VrpPool = { name, dns: [], excluded: [], leaseS: DEFAULT_LEASE_S };
      return intent({
        kind: 'sequence',
        steps: [
          { kind: 'config', ops: writePool(ctx.device, undefined, created) },
          {
            kind: 'vendor',
            action: {
              kind: 'message',
              text: "Info: It's successful to create an IP address pool.",
            },
          },
          enter,
        ],
      });
    },
  },
  {
    views: ['system'],
    forms: [[UNDO, IP, POOL, POOL_NAME]],
    build: (m, ctx) => {
      const pool = poolByName(ctx.device, m.args['name'] ?? '');
      if (!pool) return fault('dhcp-pool-not-exist');
      // Con direcciones repartidas, VRP no deja borrar el pool.
      if (leasesOf(ctx.device, pool).length > 0) return fault('dhcp-pool-in-use');
      // Las interfaces conservan su `dhcp select global`: sus servidores se
      // quedan sin pool hasta que otro cubra su red.
      const ops: Op[] = ctx.device.config.dhcpServer.servers
        .filter((s) => s.pool === pool.id)
        .map(
          (s): Op => ({
            op: 'set',
            coll: 'dhcpServers',
            id: s.id,
            patch: { pool: 'static-only' },
          }),
        );
      const net = networkItem(ctx.device, pool);
      if (net) ops.push({ op: 'remove', coll: 'dhcpNetworks', id: net.id });
      ops.push({ op: 'remove', coll: 'pools', id: pool.id });
      return config(ops);
    },
  },

  // ── Interfaz ──
  {
    views: ['interface'],
    forms: [[DHCP, ...SELECT_GLOBAL]],
    build: (_m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      if (!ctx.device.config.dhcp.serverEnabled) return fault('dhcp-disabled');
      if (serverOn(ctx.device, iface.id)) return noop();
      const binding = bindingFor(ctx.device, iface.id);
      return config([
        {
          op: 'add',
          coll: 'dhcpServers',
          item: {
            name: iface.name,
            iface: iface.id,
            pool: binding.pool,
            leaseTimeS: binding.leaseS,
            authoritative: true,
            disabled: false,
          },
        },
      ]);
    },
  },
  {
    views: ['interface'],
    forms: [[UNDO, DHCP, ...SELECT_GLOBAL]],
    build: (_m, ctx) => {
      const iface = currentIface(ctx);
      const server = iface ? serverOn(ctx.device, iface.id) : undefined;
      if (!server) return noop();
      return config([{ op: 'remove', coll: 'dhcpServers', id: server.id }]);
    },
  },

  // ── Pool ──
  {
    views: ['pool'],
    forms: [
      [
        NETWORK,
        arg('ip', { kind: 'ipv4' }, 'Network address'),
        kw('mask', 'Specify the network mask'),
        arg('mask', { kind: 'mask-or-len' }, 'Network mask or mask length'),
      ],
    ],
    build: (m, ctx) => {
      const ip = parseIpv4(m.args['ip'] ?? '');
      if (ip === null) return noop();
      const network = networkOf({ ip, len: lenOf(m.args['mask'] ?? '') });
      const view = ctx.session.view;
      // Dos pools no pueden cubrir el mismo segmento.
      const clash = poolsOf(ctx.device).some((p) => {
        if (view.kind === 'pool' && p.name === view.name) return false;
        const other = parseMeta(p.comment).network;
        if (!other) return false;
        const len = Math.min(other.len, network.len);
        return networkOf({ ip: other.ip, len }).ip === networkOf({ ip: network.ip, len }).ip;
      });
      if (clash) return fault('dhcp-network-conflict', m.argAt['ip']);
      return editPool(ctx, (p) => ({ ...p, network }));
    },
  },
  {
    views: ['pool'],
    forms: [[UNDO, NETWORK]],
    build: (_m, ctx) => editPool(ctx, (p) => ({ ...without(p, 'network'), excluded: [] })),
  },
  {
    views: ['pool'],
    forms: [[GATEWAY_LIST, arg('ip', { kind: 'ipv4' }, 'Gateway IP address')]],
    build: (m, ctx) => {
      const gateway = parseIpv4(m.args['ip'] ?? '');
      if (gateway === null) return noop();
      return editPool(ctx, (p) => ({ ...p, gateway }));
    },
  },
  {
    views: ['pool'],
    forms: [
      [UNDO, GATEWAY_LIST],
      [UNDO, GATEWAY_LIST, ALL],
      [UNDO, GATEWAY_LIST, arg('ip', { kind: 'ipv4' }, 'Gateway IP address')],
    ],
    build: (m, ctx) =>
      editPool(ctx, (p) => {
        const ip = m.args['ip'];
        if (ip !== undefined && (p.gateway === undefined || formatIpv4(p.gateway) !== ip)) {
          return { code: 'dhcp-gateway-not-exist' };
        }
        return without(p, 'gateway');
      }),
  },
  {
    views: ['pool'],
    forms: dnsForms([DNS_LIST]),
    build: (m, ctx) => editPool(ctx, (p) => ({ ...p, dns: dnsArgs(m.args) })),
  },
  {
    views: ['pool'],
    forms: [[UNDO, DNS_LIST], [UNDO, DNS_LIST, ALL], ...dnsForms([UNDO, DNS_LIST])],
    build: (m, ctx) =>
      editPool(ctx, (p) => {
        const gone = dnsArgs(m.args);
        if (gone.length === 0) return { ...p, dns: [] };
        if (gone.some((ip) => !p.dns.includes(ip))) return { code: 'dhcp-dns-not-exist' };
        return { ...p, dns: p.dns.filter((ip) => !gone.includes(ip)) };
      }),
  },
  {
    views: ['pool'],
    forms: [
      [EXCLUDED, START],
      [EXCLUDED, START, END],
    ],
    build: (m, ctx) =>
      editPool(ctx, (p) => {
        const r = rangeArg(m.args, m.argAt);
        if ('code' in r) return r;
        // Solo se excluye dentro de la red del pool, y hace falta que la tenga.
        const network = p.network;
        if (!network) return { code: 'dhcp-network-unset' };
        if (!prefixContains(network, r.from) || !prefixContains(network, r.to)) {
          return { code: 'dhcp-not-in-network', ...withAt(m.argAt['start']) };
        }
        return { ...p, excluded: normalize([...p.excluded, r]) };
      }),
  },
  {
    views: ['pool'],
    forms: [
      [UNDO, EXCLUDED, START],
      [UNDO, EXCLUDED, START, END],
    ],
    build: (m, ctx) =>
      editPool(ctx, (p) => {
        const r = rangeArg(m.args, m.argAt);
        if ('code' in r) return r;
        return { ...p, excluded: subtract(p.excluded, [r]) };
      }),
  },
  {
    views: ['pool'],
    forms: [
      [LEASE, DAY, LEASE_ARGS.day],
      [LEASE, DAY, LEASE_ARGS.day, HOUR, LEASE_ARGS.hour],
      [LEASE, DAY, LEASE_ARGS.day, HOUR, LEASE_ARGS.hour, MINUTE, LEASE_ARGS.minute],
    ],
    build: (m, ctx) => {
      const leaseS =
        Number(m.args['day'] ?? 0) * 86_400 +
        Number(m.args['hour'] ?? 0) * 3_600 +
        Number(m.args['minute'] ?? 0) * 60;
      if (leaseS === 0) return fault('wrong-parameter', m.argAt['day']);
      return editPool(ctx, (p) => ({ ...p, leaseS }));
    },
  },
  {
    views: ['pool'],
    forms: [[UNDO, LEASE]],
    build: (_m, ctx) => editPool(ctx, (p) => ({ ...p, leaseS: DEFAULT_LEASE_S })),
  },

  // ── Display ──
  {
    views: ALL_VIEWS,
    forms: [
      [kw('display', 'Display information'), kw('ip', 'IP information'), POOL],
      [
        kw('display', 'Display information'),
        kw('ip', 'IP information'),
        POOL,
        kw('name', 'Specify the name of an IP address pool'),
        POOL_NAME,
      ],
    ],
    build: (m, ctx) => {
      const name = m.args['name'];
      if (name !== undefined && !poolByName(ctx.device, name)) return fault('dhcp-pool-not-exist');
      return intent({
        kind: 'show',
        view: { kind: 'display', what: 'ip pool', ...(name === undefined ? {} : { arg: name }) },
      });
    },
  },
];

// ── Display ─────────────────────────────────────────────────────────────────

const RULE = `  ${'-'.repeat(77)}`;

/** Lease en el formato de `display ip pool`: `1 Days 0 Hours 0 Minutes`. */
function leaseParts(seconds: number): { day: number; hour: number; minute: number } {
  return {
    day: Math.floor(seconds / 86_400),
    hour: Math.floor((seconds % 86_400) / 3_600),
    minute: Math.floor((seconds % 3_600) / 60),
  };
}

interface PoolStats {
  readonly start: string;
  readonly end: string;
  readonly total: number;
  readonly used: number;
  readonly idle: number;
  readonly disabled: number;
}

/** Cuentas de un pool: lo que cabe en la red, lo repartido, lo libre y lo excluido. */
function statsOf(device: Device, pool: Pool, vrp: VrpPool): PoolStats {
  if (!vrp.network) return { start: '-', end: '-', total: 0, used: 0, idle: 0, disabled: 0 };
  const hosts = usableHosts(vrp.network);
  const free = total(realRanges(pool));
  const used = leasesOf(device, pool).length;
  return {
    start: formatIpv4(hosts.from),
    end: formatIpv4(hosts.to),
    total: rangeSize(hosts),
    used,
    idle: Math.max(0, free - used),
    disabled: rangeSize(hosts) - free,
  };
}

const field = (name: string, value: string): string => `  ${name.padEnd(15)}: ${value}`;

function poolHeader(vrp: VrpPool, index: number): string[] {
  return [field('Pool-name', vrp.name), field('Pool-No', String(index))];
}

function poolPlace(vrp: VrpPool): string[] {
  return [
    '  Position       : Local           Status           : Unlocked',
    field('Gateway-0', vrp.gateway === undefined ? '-' : formatIpv4(vrp.gateway)),
    field('Mask', vrp.network ? dottedMask(vrp.network.len) : '-'),
    field('VPN instance', '--'),
  ];
}

function displayPools(ctx: CmdCtx, name: string | undefined): string {
  const device = ctx.device;
  const pools = poolsOf(device);
  if (name !== undefined) {
    const index = pools.findIndex((p) => p.name === name);
    const pool = pools[index];
    if (!pool) return '';
    const vrp = readPool(device, pool);
    const lease = leaseParts(vrp.leaseS);
    const s = statsOf(device, pool, vrp);
    const dns =
      vrp.dns.length === 0
        ? [field('DNS-server0', '-')]
        : vrp.dns.map((ip, i) => field(`DNS-server${i}`, formatIpv4(ip)));
    return [
      ...poolHeader(vrp, index),
      field('Lease', `${lease.day} Days ${lease.hour} Hours ${lease.minute} Minutes`),
      field('Domain-name', '-'),
      ...dns,
      field('NBNS-server0', '-'),
      field('Netbios-type', '-'),
      ...poolPlace(vrp),
      RULE,
      `${'Start'.padStart(16)}${'End'.padStart(16)}${'Total'.padStart(8)}${'Used'.padStart(6)}${'Idle(Expired)'.padStart(15)}${'Conflict'.padStart(10)}${'Disable'.padStart(9)}`,
      RULE,
      `${s.start.padStart(16)}${s.end.padStart(16)}${String(s.total).padStart(8)}${String(s.used).padStart(6)}${`${s.idle}(0)`.padStart(15)}${'0'.padStart(10)}${String(s.disabled).padStart(9)}`,
      RULE,
    ].join('\n');
  }
  const lines: string[] = [];
  let sum = { total: 0, used: 0, idle: 0, disabled: 0 };
  pools.forEach((pool, index) => {
    const vrp = readPool(device, pool);
    const s = statsOf(device, pool, vrp);
    sum = {
      total: sum.total + s.total,
      used: sum.used + s.used,
      idle: sum.idle + s.idle,
      disabled: sum.disabled + s.disabled,
    };
    lines.push(RULE, ...poolHeader(vrp, index), ...poolPlace(vrp));
  });
  lines.push(
    RULE,
    '',
    '  IP address Statistic',
    `    Total       :${sum.total}`,
    `    Used        :${String(sum.used).padEnd(11)}Idle        :${sum.idle}`,
    `    Expired     :${'0'.padEnd(11)}Conflict    :${'0'.padEnd(11)}Disable    :${sum.disabled}`,
  );
  return lines.join('\n');
}

// ── Configuración ───────────────────────────────────────────────────────────

/** El bloque de un pool, en el orden en que lo imprime VRP. */
function poolLines(device: Device, pool: Pool): string[] {
  const vrp = readPool(device, pool);
  const lines = [`ip pool ${vrp.name}`];
  if (vrp.gateway !== undefined) lines.push(` gateway-list ${formatIpv4(vrp.gateway)}`);
  if (vrp.network) {
    lines.push(` network ${formatIpv4(vrp.network.ip)} mask ${dottedMask(vrp.network.len)}`);
  }
  for (const r of vrp.excluded) {
    lines.push(
      r.from === r.to
        ? ` excluded-ip-address ${formatIpv4(r.from)}`
        : ` excluded-ip-address ${formatIpv4(r.from)} ${formatIpv4(r.to)}`,
    );
  }
  if (vrp.leaseS !== DEFAULT_LEASE_S) {
    const l = leaseParts(vrp.leaseS);
    lines.push(` lease day ${l.day} hour ${l.hour} minute ${l.minute}`);
  }
  if (vrp.dns.length > 0) lines.push(` dns-list ${vrp.dns.map(formatIpv4).join(' ')}`);
  return lines;
}

function blocks(device: Device): readonly ConfigBlock[] {
  const out: ConfigBlock[] = [];
  if (device.config.dhcp.serverEnabled) out.push({ order: 30, lines: [' dhcp enable'] });
  for (const pool of poolsOf(device)) out.push({ order: 50, lines: poolLines(device, pool) });
  return out;
}

function interfaceLines(device: Device, iface: Interface): readonly string[] {
  return serverOn(device, iface.id) ? [' dhcp select global'] : [];
}

function viewBlock(device: Device, view: View): readonly string[] | null {
  if (view.kind !== 'pool') return null;
  const pool = poolByName(device, view.name);
  return pool ? poolLines(device, pool) : null;
}

export const DHCP_AREA: Area = {
  commands,
  displays: { 'ip pool': (ctx, name) => displayPools(ctx, name) },
  blocks,
  interfaceLines,
  viewBlock,
  reconcile,
  messages: {
    'dhcp-disabled': 'Error: Please enable DHCP in the system view first.',
    'dhcp-pool-not-exist': 'Error: The IP address pool does not exist.',
    'dhcp-pool-in-use': 'Error: The IP address pool is in use and cannot be deleted.',
    'dhcp-network-conflict': 'Error: The network segment overlaps that of another IP address pool.',
    'dhcp-network-unset': 'Error: Configure the network segment of the IP address pool first.',
    'dhcp-not-in-network': 'Error: The IP address is not in the network segment of the pool.',
    'dhcp-gateway-not-exist': 'Error: The gateway does not exist.',
    'dhcp-dns-not-exist': 'Error: The DNS server does not exist.',
  },
};
