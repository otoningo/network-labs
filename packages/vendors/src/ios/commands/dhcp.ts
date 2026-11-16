/**
 * Servidor DHCP de IOS: `service dhcp`, las direcciones excluidas (globales,
 * `ip dhcp excluded-address`), los pools (`ip dhcp pool` con network,
 * default-router, dns-server, domain-name y lease) y los `show ip dhcp`.
 *
 * Traducción al modelo neutral:
 * - Lo que se escribe en el pool se guarda en el comentario del Pool neutral
 *   como `ios {json}` (red, routers, DNS, dominio y lease). La reconciliación
 *   deriva de ahí todo lo que lee el motor: los rangos del Pool (los hosts de la
 *   red menos lo excluido y las direcciones del propio router), la red DHCP
 *   (DhcpNetwork) con el gateway y los DNS, y los servidores.
 * - En IOS no hay `dhcp select`: el router sirve un pool por cada interfaz cuya
 *   dirección cae en la red del pool. Por eso los servidores DHCP neutrales los
 *   crea y los borra la reconciliación, uno por interfaz, nunca un comando.
 * - Las direcciones excluidas son entradas de la lista de direcciones
 *   `dhcp-excluded` (un rango por línea); el NAT nunca usa esa lista.
 */
import {
  type Device,
  type DhcpNetwork,
  formatIpv4,
  type IpRange,
  type Ipv4,
  type Ipv4Prefix,
  type ItemId,
  networkOf,
  type Op,
  type Pool,
  parseIpv4,
  prefixContains,
  rangeSize,
  samePrefix,
  usableHosts,
} from '@nos/core';
import {
  type Area,
  type Built,
  type ConfigBlock,
  classfulLen,
  config,
  dottedMask,
  fault,
  intent,
  listedInterfaces,
  noop,
  show,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, kw, type Node } from '../grammar';
import type { IosIntent } from '../intent';
import { ipArgs, lenOfMaskText } from './shared';

/** Lease por defecto de IOS: un día. */
export const DEFAULT_LEASE_S = 86_400;
/** `lease infinite`: el máximo que admite el modelo neutral (diez años). */
const INFINITE_LEASE_S = 365 * 24 * 3600 * 10;

export const EXCLUDED_LIST = 'dhcp-excluded';

const NO = kw('no', 'Negate a command or set its defaults');
const IP = kw('ip', 'Global IP configuration subcommands');
const DHCP = kw('dhcp', 'Configure DHCP server and relay parameters');
const POOL = kw('pool', 'Configure DHCP address pools');
const POOL_NAME = arg('name', { kind: 'word', max: 64 }, 'Pool name');
const EXCLUDED = kw('excluded-address', 'Prevent DHCP from assigning certain addresses');
const LOW = arg('low', { kind: 'ipv4' }, 'Low IP address');
const HIGH = arg('high', { kind: 'ipv4' }, 'High IP address');
const SERVICE_DHCP = [
  kw('service', 'Modify use of network based services'),
  kw('dhcp', 'Enable DHCP server and relay agent'),
];
const NETWORK = kw('network', 'Network number and mask');
const DEFAULT_ROUTER = kw('default-router', 'Default routers');
const DNS_SERVER = kw('dns-server', 'DNS servers');
const DOMAIN_NAME = kw('domain-name', 'Domain name');
const LEASE = kw('lease', 'Address lease time');

const SERVER_ARGS = ['ip1', 'ip2', 'ip3', 'ip4', 'ip5', 'ip6', 'ip7', 'ip8'] as const;

// ── El pool de IOS sobre el modelo neutral ──────────────────────────────────

interface IosPool {
  readonly network?: Ipv4Prefix;
  readonly routers: readonly Ipv4[];
  readonly dns: readonly Ipv4[];
  readonly domain?: string;
  readonly leaseS: number;
}

const EMPTY_POOL: IosPool = { routers: [], dns: [], leaseS: DEFAULT_LEASE_S };
const TAG = 'ios ';

function ipList(raw: unknown): Ipv4[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => parseIpv4(String(x))).filter((ip): ip is Ipv4 => ip !== null);
}

function readPool(pool: Pool): IosPool {
  const comment = pool.comment ?? '';
  if (!comment.startsWith(TAG)) return EMPTY_POOL;
  let raw: unknown;
  try {
    raw = JSON.parse(comment.slice(TAG.length));
  } catch {
    return EMPTY_POOL;
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_POOL;
  const r = raw as Record<string, unknown>;
  const net = typeof r['network'] === 'string' ? r['network'].split('/') : [];
  const ip = parseIpv4(net[0] ?? '');
  return {
    ...(ip === null ? {} : { network: { ip, len: Number(net[1]) } }),
    routers: ipList(r['routers']),
    dns: ipList(r['dns']),
    ...(typeof r['domain'] === 'string' ? { domain: r['domain'] } : {}),
    leaseS: typeof r['leaseS'] === 'number' ? r['leaseS'] : DEFAULT_LEASE_S,
  };
}

function encodePool(p: IosPool): string {
  return `${TAG}${JSON.stringify({
    ...(p.network ? { network: `${formatIpv4(p.network.ip)}/${p.network.len}` } : {}),
    ...(p.routers.length > 0 ? { routers: p.routers.map(formatIpv4) } : {}),
    ...(p.dns.length > 0 ? { dns: p.dns.map(formatIpv4) } : {}),
    ...(p.domain === undefined ? {} : { domain: p.domain }),
    ...(p.leaseS === DEFAULT_LEASE_S ? {} : { leaseS: p.leaseS }),
  })}`;
}

const poolsOf = (device: Device): readonly Pool[] => device.config.dhcpServer.pools;
const poolByName = (device: Device, name: string): Pool | undefined =>
  poolsOf(device).find((p) => p.name === name);

/** El núcleo no admite un pool sin rangos: mientras no tiene qué repartir lleva este, vacío. */
const NO_RANGE: IpRange = { from: 0 as Ipv4, to: 0 as Ipv4 };
const isNoRange = (r: IpRange): boolean => r.from === 0 && r.to === 0;
const realRanges = (pool: Pool): IpRange[] => pool.ranges.filter((r) => !isNoRange(r));

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

/** Rangos excluidos con `ip dhcp excluded-address`, en el orden en que se escribieron. */
function excludedOf(device: Device): { readonly range: IpRange; readonly id: ItemId }[] {
  return device.config.firewall.addressLists
    .filter((e) => e.list === EXCLUDED_LIST && !('len' in e.address))
    .map((e) => ({ range: e.address as IpRange, id: e.id }));
}

/** Lo que el pool puede repartir: los hosts de su red menos lo excluido y las IP del router. */
function poolRanges(device: Device, p: IosPool): IpRange[] {
  if (!p.network) return [];
  const own = device.config.addressing.addresses.map((a) => ({
    from: a.address.ip,
    to: a.address.ip,
  }));
  return subtract([usableHosts(p.network)], [...excludedOf(device).map((e) => e.range), ...own]);
}

// ── Reconciliación ──────────────────────────────────────────────────────────

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Deja el modelo como dicen los pools: rangos, redes DHCP y un servidor por
 * interfaz cuya dirección cae en un pool con direcciones que repartir. Si ya
 * está así no devuelve nada.
 */
function reconcile(device: Device): readonly Op[] {
  const ops: Op[] = [];
  const pools = poolsOf(device).map((pool) => {
    const ios = readPool(pool);
    const ranges = poolRanges(device, ios);
    return { pool, ios, ranges };
  });

  // Rangos de cada pool.
  for (const { pool, ranges } of pools) {
    const want = ranges.length > 0 ? ranges : [NO_RANGE];
    if (!sameJson(pool.ranges, want)) {
      ops.push({ op: 'set', coll: 'pools', id: pool.id, patch: { ranges: want } });
    }
  }

  // Redes DHCP: una por pool con red; las demás sobran.
  const networks = device.config.dhcpServer.networks;
  const wanted: DhcpNetwork[] = [];
  for (const { ios } of pools) {
    if (!ios.network) continue;
    const gateway = ios.routers[0];
    const want = {
      prefix: ios.network,
      dnsServers: ios.dns,
      ...(gateway === undefined ? {} : { gateway }),
      ...(ios.domain === undefined ? {} : { domain: ios.domain }),
    };
    const current = networks.find((n) => samePrefix(n.prefix, want.prefix));
    if (!current) {
      ops.push({ op: 'add', coll: 'dhcpNetworks', item: { ...want, disabled: false } });
      continue;
    }
    wanted.push(current);
    const now = {
      prefix: current.prefix,
      dnsServers: current.dnsServers,
      ...(current.gateway === undefined ? {} : { gateway: current.gateway }),
      ...(current.domain === undefined ? {} : { domain: current.domain }),
    };
    if (sameJson(now, want)) continue;
    const unset = [
      ...(gateway === undefined && current.gateway !== undefined ? ['gateway'] : []),
      ...(ios.domain === undefined && current.domain !== undefined ? ['domain'] : []),
    ];
    ops.push({
      op: 'set',
      coll: 'dhcpNetworks',
      id: current.id,
      patch: want,
      ...(unset.length > 0 ? { unset } : {}),
    });
  }
  for (const n of networks) {
    if (!wanted.includes(n)) ops.push({ op: 'remove', coll: 'dhcpNetworks', id: n.id });
  }

  // Servidores: uno por interfaz que cae en un pool con direcciones.
  const servers = device.config.dhcpServer.servers;
  const desired = new Map<ItemId, { pool: ItemId; leaseS: number; name: string }>();
  for (const iface of listedInterfaces(device)) {
    const ips = device.config.addressing.addresses
      .filter((a) => a.iface === iface.id && !a.disabled)
      .map((a) => a.address.ip);
    const hit = pools.find(
      ({ ios, ranges }) =>
        ios.network !== undefined &&
        ranges.length > 0 &&
        ips.some((ip) => ios.network !== undefined && prefixContains(ios.network, ip)),
    );
    if (hit) desired.set(iface.id, { pool: hit.pool.id, leaseS: hit.ios.leaseS, name: iface.name });
  }
  for (const s of servers) {
    const want = desired.get(s.iface);
    if (!want) {
      ops.push({ op: 'remove', coll: 'dhcpServers', id: s.id });
    } else if (s.pool !== want.pool || s.leaseTimeS !== want.leaseS) {
      ops.push({
        op: 'set',
        coll: 'dhcpServers',
        id: s.id,
        patch: { pool: want.pool, leaseTimeS: want.leaseS },
      });
    }
  }
  for (const [iface, want] of desired) {
    if (servers.some((s) => s.iface === iface)) continue;
    ops.push({
      op: 'add',
      coll: 'dhcpServers',
      item: {
        name: want.name,
        iface,
        pool: want.pool,
        leaseTimeS: want.leaseS,
        authoritative: true,
        disabled: false,
      },
    });
  }
  return ops;
}

// ── Comandos ────────────────────────────────────────────────────────────────

/** Cambia el pool del modo dhcp-config actual. */
function editPool(ctx: CmdCtx, change: (p: IosPool) => IosPool | string): Built {
  const view = ctx.session.view;
  const pool = view.kind === 'dhcp' ? poolByName(ctx.device, view.name) : undefined;
  if (!pool) return noop();
  const next = change(readPool(pool));
  if (typeof next === 'string') return fault(next);
  const comment = encodePool(next);
  if (comment === pool.comment) return noop();
  return config([{ op: 'set', coll: 'pools', id: pool.id, patch: { comment } }]);
}

/** Listas de 1 a 8 direcciones (`default-router`, `dns-server`). */
function serverForms(head: readonly Node[], help: string): Node[][] {
  return SERVER_ARGS.map((_n, i) => [
    ...head,
    ...SERVER_ARGS.slice(0, i + 1).map((name) => arg(name, { kind: 'ipv4' }, help)),
  ]);
}

function excludedRange(m: { args: Readonly<Record<string, string>> }): IpRange | null {
  const from = parseIpv4(m.args['low'] ?? '');
  const to = m.args['high'] === undefined ? from : parseIpv4(m.args['high']);
  if (from === null || to === null || to < from) return null;
  return { from, to };
}

const commands: CommandSpec[] = [
  // ── Configuración global ──
  {
    views: ['config'],
    forms: [SERVICE_DHCP, [NO, ...SERVICE_DHCP]],
    build: (m, ctx) => {
      const enabled = !m.has('no');
      if (ctx.device.config.dhcp.serverEnabled === enabled) return noop();
      return config([{ op: 'setSingleton', key: 'dhcp', patch: { serverEnabled: enabled } }]);
    },
  },
  {
    views: ['config'],
    forms: [
      [IP, DHCP, EXCLUDED, LOW],
      [IP, DHCP, EXCLUDED, LOW, HIGH],
    ],
    build: (m, ctx) => {
      const range = excludedRange(m);
      if (!range) return fault('invalid', m.argAt['high']);
      const exists = excludedOf(ctx.device).some(
        (e) => e.range.from === range.from && e.range.to === range.to,
      );
      if (exists) return noop();
      return config([
        {
          op: 'add',
          coll: 'addressLists',
          item: { list: EXCLUDED_LIST, address: range, disabled: false },
        },
      ]);
    },
  },
  {
    views: ['config'],
    forms: [
      [NO, IP, DHCP, EXCLUDED, LOW],
      [NO, IP, DHCP, EXCLUDED, LOW, HIGH],
    ],
    build: (m, ctx) => {
      const range = excludedRange(m);
      const found = range
        ? excludedOf(ctx.device).find((e) => e.range.from === range.from && e.range.to === range.to)
        : undefined;
      if (!found) return fault('dhcp-range-not-found');
      return config([{ op: 'remove', coll: 'addressLists', id: found.id }]);
    },
  },
  {
    views: ['config'],
    forms: [[IP, DHCP, POOL, POOL_NAME]],
    build: (m, ctx) => {
      const name = m.args['name'] ?? '';
      const enter: IosIntent = {
        kind: 'session',
        change: { kind: 'enter', view: { kind: 'dhcp', name } },
      };
      if (poolByName(ctx.device, name)) return intent(enter);
      return intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'config',
            ops: [
              {
                op: 'add',
                coll: 'pools',
                item: {
                  name,
                  ranges: [NO_RANGE],
                  comment: encodePool(EMPTY_POOL),
                  disabled: false,
                },
              },
            ],
          },
          enter,
        ],
      });
    },
  },
  {
    views: ['config'],
    forms: [[NO, IP, DHCP, POOL, POOL_NAME]],
    build: (m, ctx) => {
      const pool = poolByName(ctx.device, m.args['name'] ?? '');
      if (!pool) return fault('dhcp-pool-not-found', undefined, { name: m.args['name'] ?? '' });
      // Primero los servidores que lo usan: el núcleo no deja borrar algo referenciado.
      const ops: Op[] = ctx.device.config.dhcpServer.servers
        .filter((s) => s.pool === pool.id)
        .map((s): Op => ({ op: 'remove', coll: 'dhcpServers', id: s.id }));
      ops.push({ op: 'remove', coll: 'pools', id: pool.id });
      return config(ops);
    },
  },

  // ── Modo dhcp-config ──
  {
    views: ['dhcp'],
    forms: [
      [NETWORK, arg('ip', { kind: 'ipv4' }, 'Network number in dotted-decimal notation')],
      [
        NETWORK,
        arg('ip', { kind: 'ipv4' }, 'Network number in dotted-decimal notation'),
        arg('mask', { kind: 'mask' }, 'Network mask or prefix length'),
      ],
      [
        NETWORK,
        arg('ip', { kind: 'ipv4' }, 'Network number in dotted-decimal notation'),
        arg('mask', { kind: 'slash-len' }, 'Network mask or prefix length'),
      ],
    ],
    build: (m, ctx) => {
      const ip = parseIpv4(m.args['ip'] ?? '');
      if (ip === null) return noop();
      const mask = m.args['mask'];
      const len = mask === undefined ? classfulLen(ip) : lenOfMaskText(mask);
      const network = networkOf({ ip, len });
      const view = ctx.session.view;
      const clash = poolsOf(ctx.device).find((p) => {
        if (view.kind === 'dhcp' && p.name === view.name) return false;
        const other = readPool(p).network;
        if (!other) return false;
        const shorter = Math.min(other.len, network.len);
        return (
          networkOf({ ip: other.ip, len: shorter }).ip ===
          networkOf({ ip: network.ip, len: shorter }).ip
        );
      });
      if (clash) {
        return fault('dhcp-network-overlap', undefined, {
          net: `${formatIpv4(network.ip)}/${network.len}`,
          pool: clash.name,
        });
      }
      return editPool(ctx, (p) => ({ ...p, network }));
    },
  },
  {
    views: ['dhcp'],
    forms: [[NO, NETWORK]],
    build: (_m, ctx) =>
      editPool(ctx, (p) => {
        const { network: _gone, ...rest } = p;
        return rest;
      }),
  },
  {
    views: ['dhcp'],
    forms: serverForms([DEFAULT_ROUTER], 'IP address of default router'),
    build: (m, ctx) => editPool(ctx, (p) => ({ ...p, routers: ipArgs(m.args, SERVER_ARGS) })),
  },
  {
    views: ['dhcp'],
    forms: [
      [NO, DEFAULT_ROUTER],
      ...serverForms([NO, DEFAULT_ROUTER], 'IP address of default router'),
    ],
    build: (_m, ctx) => editPool(ctx, (p) => ({ ...p, routers: [] })),
  },
  {
    views: ['dhcp'],
    forms: serverForms([DNS_SERVER], "Server's IP address"),
    build: (m, ctx) => editPool(ctx, (p) => ({ ...p, dns: ipArgs(m.args, SERVER_ARGS) })),
  },
  {
    views: ['dhcp'],
    forms: [[NO, DNS_SERVER], ...serverForms([NO, DNS_SERVER], "Server's IP address")],
    build: (_m, ctx) => editPool(ctx, (p) => ({ ...p, dns: [] })),
  },
  {
    views: ['dhcp'],
    forms: [[DOMAIN_NAME, arg('domain', { kind: 'word', max: 64 }, 'Domain name')]],
    build: (m, ctx) => editPool(ctx, (p) => ({ ...p, domain: m.args['domain'] ?? '' })),
  },
  {
    views: ['dhcp'],
    forms: [[NO, DOMAIN_NAME]],
    build: (_m, ctx) =>
      editPool(ctx, (p) => {
        const { domain: _gone, ...rest } = p;
        return rest;
      }),
  },
  {
    views: ['dhcp'],
    forms: [
      [LEASE, arg('days', { kind: 'int', min: 0, max: 365 }, 'Days')],
      [
        LEASE,
        arg('days', { kind: 'int', min: 0, max: 365 }, 'Days'),
        arg('hours', { kind: 'int', min: 0, max: 23 }, 'Hours'),
      ],
      [
        LEASE,
        arg('days', { kind: 'int', min: 0, max: 365 }, 'Days'),
        arg('hours', { kind: 'int', min: 0, max: 23 }, 'Hours'),
        arg('minutes', { kind: 'int', min: 0, max: 59 }, 'Minutes'),
      ],
      [LEASE, kw('infinite', 'Infinite lease')],
    ],
    build: (m, ctx) => {
      const leaseS = m.has('infinite')
        ? INFINITE_LEASE_S
        : Number(m.args['days'] ?? 0) * 86_400 +
          Number(m.args['hours'] ?? 0) * 3_600 +
          Number(m.args['minutes'] ?? 0) * 60;
      if (leaseS === 0) return fault('invalid', m.argAt['days']);
      return editPool(ctx, (p) => ({ ...p, leaseS }));
    },
  },
  {
    views: ['dhcp'],
    forms: [[NO, LEASE]],
    build: (_m, ctx) => editPool(ctx, (p) => ({ ...p, leaseS: DEFAULT_LEASE_S })),
  },

  // ── Show ──
  {
    views: ['priv'],
    forms: [
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        DHCP,
        kw('binding', 'DHCP address bindings'),
      ],
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        DHCP,
        kw('conflict', 'DHCP address conflicts'),
      ],
      [kw('show', 'Show running system information'), kw('ip', 'IP information'), DHCP, POOL],
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        DHCP,
        POOL,
        POOL_NAME,
      ],
    ],
    build: (m, ctx) => {
      if (m.has('binding')) return show('ip dhcp binding');
      if (m.has('conflict')) return show('ip dhcp conflict');
      const name = m.args['name'];
      if (name !== undefined && !poolByName(ctx.device, name)) return noop();
      return show('ip dhcp pool', name);
    },
  },
];

// ── Show ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Fecha de fin de un lease como la escribe IOS: `Jan 02 2026 12:00 AM`. */
function leaseDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const hour = d.getUTCHours();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(h12)}:${pad(d.getUTCMinutes())} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Client-ID de Ethernet: `01` y la MAC, en grupos de cuatro. */
function clientId(mac: string): string {
  const hex = `01${mac.replace(/[^0-9a-f]/gi, '').toLowerCase()}`;
  return hex.match(/.{1,4}/g)?.join('.') ?? hex;
}

function showBinding(ctx: CmdCtx): string {
  const rows = ctx.device.oper.dhcpLeases.map(
    (l) =>
      `${formatIpv4(l.ip).padEnd(20)}${clientId(l.mac).padEnd(24)}${leaseDate(ctx.session.clockBase + l.expiresAt).padEnd(24)}${l.dynamic ? 'Automatic' : 'Manual'}`,
  );
  return [
    'Bindings from all pools not associated with VRF:',
    `${'IP address'.padEnd(20)}${'Client-ID/'.padEnd(24)}${'Lease expiration'.padEnd(24)}Type`,
    `${''.padEnd(20)}Hardware address/`,
    `${''.padEnd(20)}User name`,
    ...rows,
  ].join('\n');
}

function showPools(ctx: CmdCtx, name: string | undefined): string {
  const device = ctx.device;
  const out: string[] = [];
  for (const pool of poolsOf(device)) {
    if (name !== undefined && pool.name !== name) continue;
    const ios = readPool(pool);
    const servers = new Set(
      device.config.dhcpServer.servers.filter((s) => s.pool === pool.id).map((s) => s.id),
    );
    const leases = device.oper.dhcpLeases.filter((l) => servers.has(l.server));
    const hosts = ios.network ? usableHosts(ios.network) : undefined;
    const total = hosts ? rangeSize(hosts) : 0;
    const free = realRanges(pool);
    const leased = new Set(leases.map((l) => l.ip));
    let next: Ipv4 | undefined;
    for (const r of free) {
      for (let ip = r.from; ip <= r.to && next === undefined; ip = (ip + 1) as Ipv4) {
        if (!leased.has(ip)) next = ip;
      }
      if (next !== undefined) break;
    }
    out.push(
      `Pool ${pool.name} :`,
      ` ${'Utilization mark (high/low)'.padEnd(31)}: 100 / 0`,
      ` ${'Subnet size (first/next)'.padEnd(31)}: 0 / 0`,
      ` ${'Total addresses'.padEnd(31)}: ${total}`,
      ` ${'Leased addresses'.padEnd(31)}: ${leases.length}`,
      ` ${'Pending event'.padEnd(31)}: none`,
    );
    if (hosts) {
      out.push(
        ' 1 subnet is currently in the pool :',
        ` ${'Current index'.padEnd(21)}${'IP address range'.padEnd(36)}Leased addresses`,
        ` ${(next === undefined ? '0.0.0.0' : formatIpv4(next)).padEnd(21)}${`${formatIpv4(hosts.from).padEnd(17)}- ${formatIpv4(hosts.to)}`.padEnd(36)}${leases.length}`,
      );
    } else {
      out.push(' 0 subnet is currently in the pool :');
    }
  }
  return out.join('\n');
}

function showConflict(): string {
  return `${'IP address'.padEnd(20)}${'Detection method'.padEnd(20)}${'Detection time'.padEnd(26)}VRF`;
}

// ── Configuración ───────────────────────────────────────────────────────────

function poolLines(pool: Pool): string[] {
  const ios = readPool(pool);
  const lines = [`ip dhcp pool ${pool.name}`];
  if (ios.network) {
    lines.push(` network ${formatIpv4(ios.network.ip)} ${dottedMask(ios.network.len)}`);
  }
  if (ios.routers.length > 0)
    lines.push(` default-router ${ios.routers.map(formatIpv4).join(' ')}`);
  if (ios.dns.length > 0) lines.push(` dns-server ${ios.dns.map(formatIpv4).join(' ')}`);
  if (ios.domain !== undefined) lines.push(` domain-name ${ios.domain}`);
  if (ios.leaseS === INFINITE_LEASE_S) {
    lines.push(' lease infinite');
  } else if (ios.leaseS !== DEFAULT_LEASE_S) {
    const days = Math.floor(ios.leaseS / 86_400);
    const hours = Math.floor((ios.leaseS % 86_400) / 3_600);
    const minutes = Math.floor((ios.leaseS % 3_600) / 60);
    lines.push(
      minutes > 0
        ? ` lease ${days} ${hours} ${minutes}`
        : hours > 0
          ? ` lease ${days} ${hours}`
          : ` lease ${days}`,
    );
  }
  return lines;
}

function blocks(device: Device): readonly ConfigBlock[] {
  const out: ConfigBlock[] = [];
  if (!device.config.dhcp.serverEnabled) out.push({ order: 11, lines: ['no service dhcp'] });
  out.push({
    order: 40,
    lines: excludedOf(device).map(({ range }) =>
      range.from === range.to
        ? `ip dhcp excluded-address ${formatIpv4(range.from)}`
        : `ip dhcp excluded-address ${formatIpv4(range.from)} ${formatIpv4(range.to)}`,
    ),
  });
  for (const pool of poolsOf(device)) out.push({ order: 45, lines: poolLines(pool) });
  return out;
}

export const DHCP_AREA: Area = {
  commands,
  shows: {
    'ip dhcp binding': (ctx) => showBinding(ctx),
    'ip dhcp pool': (ctx, name) => showPools(ctx, name),
    'ip dhcp conflict': () => showConflict(),
  },
  blocks,
  reconcile,
  messages: {
    'dhcp-pool-not-found': '%Pool {name} not found',
    'dhcp-range-not-found': '% Range not found in the excluded address list',
    'dhcp-network-overlap': '% {net} overlaps with pool {pool}',
  },
};
