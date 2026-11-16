/**
 * Rutas estáticas: `ip route` con siguiente salto, interfaz de salida o ambas
 * (y `Null0` para descartar), su `no`, las líneas de `show running-config` y
 * `show ip route` leído de la RIB, con las rutas C y L (locales /32) de IOS 15.
 *
 * Una ruta de IOS es una ruta del modelo neutral en la tabla `main`; la
 * distancia administrativa vale 1 por defecto, como en el equipo.
 */
import {
  type Device,
  formatIpv4,
  type Gateway,
  type Ipv4,
  type Ipv4Prefix,
  networkOf,
  type Op,
  parseIpv4,
  type RibEntry,
  type StaticRoute,
} from '@nos/core';
import {
  type Area,
  type Built,
  type ConfigBlock,
  classfulLen,
  config,
  dottedMask,
  fault,
  ifaceById,
  ifaceByName,
  noop,
  show,
} from '../area';
import {
  arg,
  type CmdCtx,
  type CommandSpec,
  canonicalIface,
  kw,
  type Matched,
  type Node,
} from '../grammar';
import { EXEC_VIEWS } from '../session';
import { lenOfMaskText } from './shared';

/** Distancia administrativa de una ruta estática cuando no se escribe. */
export const DEFAULT_DISTANCE = 1;

const TABLE = 'main';

const NO = kw('no', 'Negate a command or set its defaults');
const IP = kw('ip', 'Global IP configuration subcommands');
const ROUTE = kw('route', 'Establish static routes');
const DEST = arg('dest', { kind: 'ipv4' }, 'Destination prefix');
const MASK = arg('mask', { kind: 'mask' }, 'Destination prefix mask');
const IFACE = arg('iface', { kind: 'iface' }, 'Interface for the route');
const NEXTHOP = arg('nexthop', { kind: 'ipv4' }, "Forwarding router's address");
const DISTANCE = arg(
  'distance',
  { kind: 'int', min: 1, max: 255 },
  'Distance metric for this route',
);

/** Formas planas de `ip route`: interfaz y siguiente salto (al menos uno al añadir) y distancia al final. */
function routeForms(no: boolean): Node[][] {
  const head: Node[] = [...(no ? [NO] : []), IP, ROUTE, DEST, MASK];
  const forms: Node[][] = [];
  for (const iface of [false, true]) {
    for (const nexthop of [false, true]) {
      if (!iface && !nexthop) continue;
      const body = [...head, ...(iface ? [IFACE] : []), ...(nexthop ? [NEXTHOP] : [])];
      forms.push(body, [...body, DISTANCE]);
    }
  }
  if (no) forms.unshift(head);
  return forms;
}

const routesOf = (device: Device): readonly StaticRoute[] =>
  device.config.routing.static.filter((r) => r.table === TABLE);

type IfaceArg =
  | { readonly kind: 'none' }
  | { readonly kind: 'null0' }
  | { readonly kind: 'iface'; readonly id: StaticRoute['id'] }
  | { readonly kind: 'bad' };

function ifaceArg(m: Matched, ctx: CmdCtx): IfaceArg {
  const text = m.args['iface'];
  if (text === undefined) return { kind: 'none' };
  const name = canonicalIface(text) ?? '';
  if (name.toLowerCase() === 'null0') return { kind: 'null0' };
  const iface = ifaceByName(ctx.device, name);
  return iface ? { kind: 'iface', id: iface.id } : { kind: 'bad' };
}

const sameGateway = (a: Gateway, b: Gateway): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameDest = (a: Ipv4Prefix, b: Ipv4Prefix) => a.ip === b.ip && a.len === b.len;

/** Destino del comando; null si tiene bits de host (IOS lo rechaza). */
function destOf(m: Matched): Ipv4Prefix | null {
  const ip = parseIpv4(m.args['dest'] ?? '') ?? (0 as Ipv4);
  const dst = { ip, len: lenOfMaskText(m.args['mask'] ?? '') };
  return networkOf(dst).ip === ip ? dst : null;
}

function addRoute(m: Matched, ctx: CmdCtx): Built {
  const dst = destOf(m);
  if (!dst) return fault('inconsistent-mask');
  const out = ifaceArg(m, ctx);
  if (out.kind === 'bad') return fault('invalid', m.argAt['iface']);
  const nhText = m.args['nexthop'];
  const nexthop = nhText === undefined ? undefined : (parseIpv4(nhText) ?? undefined);
  if (out.kind === 'null0' && nexthop !== undefined) return fault('invalid', m.argAt['nexthop']);
  if (nexthop !== undefined) {
    if (ctx.device.config.addressing.addresses.some((a) => a.address.ip === nexthop)) {
      return fault('nexthop-self');
    }
    const first = nexthop >>> 24;
    if (nexthop === 0 || first === 127 || first >= 224) return fault('nexthop-invalid');
  }
  const gateway: Gateway =
    out.kind === 'null0'
      ? { kind: 'blackhole' }
      : out.kind === 'iface'
        ? nexthop === undefined
          ? { kind: 'iface', iface: out.id }
          : { kind: 'ip-iface', ip: nexthop, iface: out.id }
        : { kind: 'ip', ip: nexthop ?? (0 as Ipv4) };
  const distance = m.args['distance'] === undefined ? DEFAULT_DISTANCE : Number(m.args['distance']);
  // El mismo destino por el mismo camino es la misma ruta: solo cambia su distancia.
  const existing = routesOf(ctx.device).find(
    (r) => sameDest(r.dst, dst) && sameGateway(r.gateway, gateway),
  );
  if (existing) {
    if (existing.distance === distance) return noop();
    return config([{ op: 'set', coll: 'routes', id: existing.id, patch: { distance } }]);
  }
  return config([
    { op: 'add', coll: 'routes', item: { dst, gateway, distance, table: TABLE, disabled: false } },
  ]);
}

function removeRoute(m: Matched, ctx: CmdCtx): Built {
  const dst = destOf(m);
  if (!dst) return fault('inconsistent-mask');
  const out = ifaceArg(m, ctx);
  if (out.kind === 'bad') return fault('invalid', m.argAt['iface']);
  const nhText = m.args['nexthop'];
  const nexthop = nhText === undefined ? undefined : parseIpv4(nhText);
  const targets = routesOf(ctx.device).filter((r) => {
    if (!sameDest(r.dst, dst)) return false;
    const gw = r.gateway;
    if (out.kind === 'null0' && gw.kind !== 'blackhole') return false;
    if (
      out.kind === 'iface' &&
      !((gw.kind === 'iface' || gw.kind === 'ip-iface') && gw.iface === out.id)
    ) {
      return false;
    }
    return (
      nexthop === undefined || ((gw.kind === 'ip' || gw.kind === 'ip-iface') && gw.ip === nexthop)
    );
  });
  if (targets.length === 0) return fault('route-not-found');
  return config(targets.map((r): Op => ({ op: 'remove', coll: 'routes', id: r.id })));
}

const commands: CommandSpec[] = [
  { views: ['config'], forms: routeForms(false), build: addRoute },
  { views: ['config'], forms: routeForms(true), build: removeRoute },
  {
    views: EXEC_VIEWS,
    forms: [
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        kw('route', 'IP routing table'),
      ],
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        kw('route', 'IP routing table'),
        kw('static', 'Static routes'),
      ],
      [
        kw('show', 'Show running system information'),
        kw('ip', 'IP information'),
        kw('route', 'IP routing table'),
        kw('connected', 'Connected networks'),
      ],
    ],
    build: (m) =>
      show('ip route', m.has('static') ? 'static' : m.has('connected') ? 'connected' : undefined),
  },
];

// ── show ip route ───────────────────────────────────────────────────────────

interface Row {
  readonly code: string;
  readonly dst: Ipv4Prefix;
  readonly text: string;
}

const LEGEND = [
  'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
  '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
  '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
  '       E1 - OSPF external type 1, E2 - OSPF external type 2',
  '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2',
  '       ia - IS-IS inter area, * - candidate default, U - per-user static route',
  '       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP',
  '       + - replicated route, % - next hop override',
];

const ifaceName = (device: Device, id: RibEntry['iface']): string =>
  (id === undefined ? undefined : ifaceById(device, id)?.name) ?? 'Null0';

function rowsOf(device: Device, e: RibEntry): Row[] {
  const name = ifaceName(device, e.iface);
  const connected = `is directly connected, ${name}`;
  switch (e.origin) {
    case 'connected': {
      const own = e.prefSrc;
      const rows: Row[] = [{ code: 'C', dst: e.dst, text: connected }];
      if (own !== undefined && e.dst.len < 32) {
        rows.push({ code: 'L', dst: { ip: own, len: 32 }, text: connected });
      }
      return rows;
    }
    case 'static':
    case 'dhcp': {
      const code = e.dst.len === 0 ? 'S*' : 'S';
      if (e.blackhole) return [{ code, dst: e.dst, text: 'is directly connected, Null0' }];
      const route = device.config.routing.static.find((r) => r.id === e.source);
      const gw = route?.gateway;
      const metric = `[${e.distance}/0]`;
      if (gw?.kind === 'iface') return [{ code, dst: e.dst, text: connected }];
      const via = e.gateway === undefined ? '0.0.0.0' : formatIpv4(e.gateway);
      const text =
        gw?.kind === 'ip-iface' ? `${metric} via ${via}, ${name}` : `${metric} via ${via}`;
      return [{ code, dst: e.dst, text }];
    }
  }
}

const prefixText = (p: Ipv4Prefix) => `${formatIpv4(p.ip)}/${p.len}`;

/** Agrupa por red con clase, como IOS: «is subnetted» o «is variably subnetted». */
function formatRows(rows: readonly Row[]): string[] {
  const sorted = [...rows].sort((a, b) => a.dst.ip - b.dst.ip || a.dst.len - b.dst.len);
  const out: string[] = [];
  const groups = new Map<string, Row[]>();
  const order: (Row | string)[] = [];
  for (const r of sorted) {
    const cl = classfulLen(r.dst.ip);
    if (r.dst.len < cl) {
      order.push(r);
      continue;
    }
    const key = prefixText(networkOf({ ip: r.dst.ip, len: cl }));
    const group = groups.get(key);
    if (group) group.push(r);
    else {
      groups.set(key, [r]);
      order.push(key);
    }
  }
  const flat = (r: Row) => `${r.code.padEnd(6)}${prefixText(r.dst)} ${r.text}`;
  for (const item of order) {
    if (typeof item !== 'string') {
      out.push(flat(item));
      continue;
    }
    const group = groups.get(item) ?? [];
    const first = group[0];
    if (!first) continue;
    const cl = classfulLen(first.dst.ip);
    if (group.length === 1 && first.dst.len === cl) {
      out.push(flat(first));
      continue;
    }
    const masks = new Set(group.map((r) => r.dst.len));
    const net = formatIpv4(networkOf({ ip: first.dst.ip, len: cl }).ip);
    const n = group.length;
    out.push(
      masks.size > 1
        ? `      ${net}/${cl} is variably subnetted, ${n} subnets, ${masks.size} masks`
        : `      ${net}/${first.dst.len} is subnetted, ${n} subnets`,
    );
    for (const r of group) out.push(`${r.code.padEnd(9)}${prefixText(r.dst)} ${r.text}`);
  }
  return out;
}

function showIpRoute(device: Device, which: string | undefined): string {
  const active = device.oper.rib.filter((e) => e.active);
  const rows = active
    .flatMap((e) => rowsOf(device, e))
    .filter((r) =>
      which === 'static'
        ? r.code.startsWith('S')
        : which === 'connected'
          ? r.code === 'C' || r.code === 'L'
          : true,
    );
  const body = formatRows(rows);
  if (which !== undefined) return body.join('\n');
  const def = active.find((e) => e.dst.len === 0);
  const gateway = def
    ? `Gateway of last resort is ${def.gateway === undefined ? '0.0.0.0' : formatIpv4(def.gateway)} to network 0.0.0.0`
    : 'Gateway of last resort is not set';
  return [...LEGEND, '', gateway, '', ...body].join('\n');
}

// ── Configuración ───────────────────────────────────────────────────────────

function routeLine(device: Device, r: StaticRoute): string {
  const gw = r.gateway;
  const parts = ['ip route', formatIpv4(r.dst.ip), dottedMask(r.dst.len)];
  if (gw.kind === 'blackhole') parts.push('Null0');
  if (gw.kind === 'iface' || gw.kind === 'ip-iface') {
    parts.push(ifaceById(device, gw.iface)?.name ?? 'Null0');
  }
  if (gw.kind === 'ip' || gw.kind === 'ip-iface') parts.push(formatIpv4(gw.ip));
  if (r.distance !== DEFAULT_DISTANCE) parts.push(String(r.distance));
  return parts.join(' ');
}

function blocks(device: Device): readonly ConfigBlock[] {
  const lines = routesOf(device)
    .filter((r) => !r.disabled)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.dst.ip - b.r.dst.ip || a.r.dst.len - b.r.dst.len || a.i - b.i)
    .map(({ r }) => routeLine(device, r));
  return [{ order: 140, lines }];
}

export const ROUTING_AREA: Area = {
  commands,
  shows: { 'ip route': (ctx, which) => showIpRoute(ctx.device, which) },
  blocks,
  messages: {
    'inconsistent-mask': '%Inconsistent address and mask',
    'nexthop-self': "%Invalid next hop address (it's this router)",
    'nexthop-invalid': '%Invalid next hop address',
    'route-not-found': '%No matching route to delete',
  },
};
