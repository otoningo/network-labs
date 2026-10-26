/**
 * Rutas estáticas: `ip route-static` con siguiente salto, interfaz de salida o
 * ambas (y `NULL0` para descartar), su `undo`, el bloque de configuración y
 * `display ip routing-table` (también `protocol static`) leído de la RIB.
 *
 * Una ruta de VRP es una ruta del modelo neutral en la tabla `main`; la
 * preferencia es la distancia y vale 60 por defecto, como en el equipo.
 */
import {
  broadcastOf,
  type Device,
  formatIpv4,
  type Gateway,
  type Ipv4,
  type Ipv4Prefix,
  networkOf,
  type Op,
  parseIpv4,
  type Result,
  type RibEntry,
  type StaticRoute,
} from '@nos/core';
import {
  type Area,
  type ConfigBlock,
  config,
  dottedMask,
  fault,
  ifaceById,
  ifaceByName,
  intent,
  lenOf,
  noop,
} from '../area';
import {
  arg,
  type CmdCtx,
  type CommandSpec,
  canonicalIface,
  kw,
  type Matched,
  type Node,
  type VrpFault,
} from '../grammar';
import type { VrpIntent } from '../intent';
import type { ViewKind } from '../session';

/** Preferencia de una ruta estática cuando no se escribe `preference`. */
export const DEFAULT_PREFERENCE = 60;

const TABLE = 'main';
const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];
/**
 * VRP acepta en una subvista los comandos de la vista de sistema y vuelve a
 * ella (`[Huawei-GigabitEthernet0/0/1]ip route-static ...` deja `[Huawei]`).
 * Así también se lee una configuración donde las rutas van tras las interfaces.
 */
const CONFIG_VIEWS: readonly ViewKind[] = ['system', 'interface', 'pool', 'acl', 'aaa'];

const UNDO = kw('undo', 'Negate a command or set its default');
const IP = kw('ip', 'Specify IP configurations');
const ROUTE_STATIC = kw('route-static', 'Establish a static route');
const DEST = arg('dest', { kind: 'ipv4' }, 'Destination IP address');
const MASK = arg('mask', { kind: 'mask-or-len' }, 'IP address mask or mask length');
const IFACE = arg('iface', { kind: 'iface' }, 'Interface type and number');
const NEXTHOP = arg('nexthop', { kind: 'ipv4' }, 'Next hop IP address');
const PREFERENCE: readonly Node[] = [
  kw('preference', 'Set the preference of the static route'),
  arg('pref', { kind: 'int', min: 1, max: 255 }, 'Preference value'),
];

/**
 * Formas planas de `ip route-static`: interfaz y siguiente salto opcionales
 * (al menos uno al añadir) y `preference` al final. En `undo` basta el destino.
 */
function routeForms(undo: boolean): Node[][] {
  const head: Node[] = [...(undo ? [UNDO] : []), IP, ROUTE_STATIC, DEST, MASK];
  const forms: Node[][] = [];
  for (const iface of [false, true]) {
    for (const nexthop of [false, true]) {
      if (!iface && !nexthop) continue;
      const body = [...head, ...(iface ? [IFACE] : []), ...(nexthop ? [NEXTHOP] : [])];
      forms.push(body, [...body, ...PREFERENCE]);
    }
  }
  if (undo) forms.unshift(head);
  return forms;
}

// ── Lectura de los argumentos ───────────────────────────────────────────────

const routesOf = (device: Device): readonly StaticRoute[] =>
  device.config.routing.static.filter((r) => r.table === TABLE);

/**
 * Destino ya normalizado. VRP no rechaza un destino con bits de host
 * (`ip route-static 10.1.1.7 24 ...`): aplica la máscara y guarda la red,
 * 10.1.1.0/24, que es lo que luego muestra la configuración.
 */
function destOf(m: Matched): Ipv4Prefix {
  const ip = parseIpv4(m.args['dest'] ?? '') ?? (0 as Ipv4);
  return networkOf({ ip, len: lenOf(m.args['mask'] ?? '') });
}

/** Interfaz de salida escrita: `NULL0` es el descarte; `none` si no se escribió. */
type IfaceArg =
  | { readonly kind: 'none' }
  | { readonly kind: 'null0' }
  | { readonly kind: 'iface'; readonly id: StaticRoute['id'] };

function ifaceArg(m: Matched, ctx: CmdCtx): Result<IfaceArg, VrpFault> {
  const text = m.args['iface'];
  if (text === undefined) return { ok: true, value: { kind: 'none' } };
  const name = canonicalIface(text) ?? '';
  if (name.toUpperCase() === 'NULL0') return { ok: true, value: { kind: 'null0' } };
  const iface = ifaceByName(ctx.device, name);
  if (!iface) {
    return {
      ok: false,
      error: {
        code: 'wrong-parameter',
        ...(m.argAt['iface'] === undefined ? {} : { at: m.argAt['iface'] }),
      },
    };
  }
  return { ok: true, value: { kind: 'iface', id: iface.id } };
}

/** Un siguiente salto que no puede serlo: 0.0.0.0, loopback, multicast o una dirección propia. */
function badNexthop(device: Device, ip: Ipv4): boolean {
  const first = ip >>> 24;
  if (ip === 0 || first === 127 || first >= 224) return true;
  return device.config.addressing.addresses.some((a) => a.address.ip === ip);
}

const sameGateway = (a: Gateway, b: Gateway): boolean => {
  switch (a.kind) {
    case 'blackhole':
      return b.kind === 'blackhole';
    case 'ip':
      return b.kind === 'ip' && b.ip === a.ip;
    case 'iface':
      return b.kind === 'iface' && b.iface === a.iface;
    case 'ip-iface':
      return b.kind === 'ip-iface' && b.ip === a.ip && b.iface === a.iface;
  }
};

const sameDest = (a: Ipv4Prefix, b: Ipv4Prefix) => a.ip === b.ip && a.len === b.len;

/** Desde una subvista, el comando deja al usuario en la vista de sistema. */
function inSystemView(
  ctx: CmdCtx,
  change: Result<VrpIntent, VrpFault>,
): Result<VrpIntent, VrpFault> {
  if (!change.ok || ctx.session.view.kind === 'system') return change;
  return intent({
    kind: 'sequence',
    steps: [change.value, { kind: 'session', change: { kind: 'enter', view: { kind: 'system' } } }],
  });
}

// ── Añadir y quitar ─────────────────────────────────────────────────────────

function addRoute(m: Matched, ctx: CmdCtx): Result<VrpIntent, VrpFault> {
  const dst = destOf(m);
  const out = ifaceArg(m, ctx);
  if (!out.ok) return { ok: false, error: out.error };
  const nhText = m.args['nexthop'];
  const nexthop = nhText === undefined ? undefined : (parseIpv4(nhText) ?? undefined);
  // Lo que se manda a NULL0 se descarta: no lleva siguiente salto.
  if (out.value.kind === 'null0' && nexthop !== undefined) {
    return fault('wrong-parameter', m.argAt['nexthop']);
  }
  if (nexthop !== undefined && badNexthop(ctx.device, nexthop)) {
    return fault('route-invalid-nexthop');
  }
  const iface = out.value;
  const gateway: Gateway =
    iface.kind === 'null0'
      ? { kind: 'blackhole' }
      : iface.kind === 'iface'
        ? nexthop === undefined
          ? { kind: 'iface', iface: iface.id }
          : { kind: 'ip-iface', ip: nexthop, iface: iface.id }
        : { kind: 'ip', ip: nexthop ?? (0 as Ipv4) };
  const distance = m.args['pref'] === undefined ? DEFAULT_PREFERENCE : Number(m.args['pref']);

  // El mismo destino por el mismo camino es la misma ruta: solo cambia su preferencia.
  const existing = routesOf(ctx.device).find(
    (r) => sameDest(r.dst, dst) && sameGateway(r.gateway, gateway),
  );
  if (existing) {
    if (existing.distance === distance) return inSystemView(ctx, noop());
    return inSystemView(
      ctx,
      config([{ op: 'set', coll: 'routes', id: existing.id, patch: { distance } }]),
    );
  }
  return inSystemView(
    ctx,
    config([
      {
        op: 'add',
        coll: 'routes',
        item: { dst, gateway, distance, table: TABLE, disabled: false },
      },
    ]),
  );
}

function removeRoute(m: Matched, ctx: CmdCtx): Result<VrpIntent, VrpFault> {
  const dst = destOf(m);
  const out = ifaceArg(m, ctx);
  if (!out.ok) return { ok: false, error: out.error };
  const nhText = m.args['nexthop'];
  const nexthop = nhText === undefined ? undefined : parseIpv4(nhText);
  const pref = m.args['pref'] === undefined ? undefined : Number(m.args['pref']);
  const iface = out.value;
  const targets = routesOf(ctx.device).filter((r) => {
    if (!sameDest(r.dst, dst)) return false;
    const gw = r.gateway;
    if (iface.kind === 'null0' && gw.kind !== 'blackhole') return false;
    if (
      iface.kind === 'iface' &&
      !((gw.kind === 'iface' || gw.kind === 'ip-iface') && gw.iface === iface.id)
    ) {
      return false;
    }
    if (
      nexthop !== undefined &&
      !((gw.kind === 'ip' || gw.kind === 'ip-iface') && gw.ip === nexthop)
    ) {
      return false;
    }
    return pref === undefined || r.distance === pref;
  });
  if (targets.length === 0) return fault('route-not-exist');
  return inSystemView(
    ctx,
    config(targets.map((r): Op => ({ op: 'remove', coll: 'routes', id: r.id }))),
  );
}

const commands: CommandSpec[] = [
  { views: CONFIG_VIEWS, forms: routeForms(false), build: addRoute },
  { views: CONFIG_VIEWS, forms: routeForms(true), build: removeRoute },
  {
    views: ALL_VIEWS,
    forms: [
      [
        kw('display', 'Display information'),
        kw('ip', 'IP information'),
        kw('routing-table', 'IP routing table'),
      ],
      [
        kw('display', 'Display information'),
        kw('ip', 'IP information'),
        kw('routing-table', 'IP routing table'),
        kw('protocol', 'Information of specified protocol'),
        kw('static', 'Static routes'),
      ],
    ],
    build: (m) =>
      intent({
        kind: 'show',
        view: {
          kind: 'display',
          what: 'ip routing-table',
          ...(m.has('static') ? { arg: 'static' } : {}),
        },
      }),
  },
];

// ── display ip routing-table ────────────────────────────────────────────────

interface Row {
  readonly dst: Ipv4Prefix;
  readonly proto: 'Static' | 'Direct' | 'Unr';
  readonly pre: number;
  readonly flags: string;
  readonly nexthop: string;
  readonly iface: string;
}

const LOOPBACK = '127.0.0.1';
const ip = (text: string): Ipv4 => parseIpv4(text) ?? (0 as Ipv4);

/** Las rutas de InLoopBack0 que VRP tiene siempre. */
const INLOOPBACK: readonly Row[] = [
  ['127.0.0.0', 8],
  ['127.0.0.1', 32],
  ['127.255.255.255', 32],
  ['255.255.255.255', 32],
].map(([addr, len]) => ({
  dst: { ip: ip(String(addr)), len: Number(len) },
  proto: 'Direct',
  pre: 0,
  flags: 'D',
  nexthop: LOOPBACK,
  iface: 'InLoopBack0',
}));

const ifaceName = (device: Device, id: RibEntry['iface']): string =>
  (id === undefined ? undefined : ifaceById(device, id)?.name) ?? 'Unknown';

/**
 * Una ruta directa de la RIB son tres en VRP: la red, la dirección propia /32
 * y la de difusión /32, estas dos entregadas al propio equipo (127.0.0.1).
 */
function directRows(device: Device, e: RibEntry): Row[] {
  const name = ifaceName(device, e.iface);
  const own = e.prefSrc;
  const base = { proto: 'Direct' as const, pre: 0, flags: 'D', iface: name };
  if (own === undefined) return [{ ...base, dst: e.dst, nexthop: '0.0.0.0' }];
  const host = (addr: Ipv4): Row => ({ ...base, dst: { ip: addr, len: 32 }, nexthop: LOOPBACK });
  if (e.dst.len === 32) return [host(own)];
  const rows = [{ ...base, dst: e.dst, nexthop: formatIpv4(own) }, host(own)];
  if (e.dst.len < 31) rows.push(host(broadcastOf({ ip: own, len: e.dst.len })));
  return rows;
}

/** Fila de una ruta estática: `R` si el siguiente salto se resuelve por iteración. */
function staticRow(device: Device, e: RibEntry, active: boolean): Row {
  const route = device.config.routing.static.find((r) => r.id === e.source);
  const relay = route?.gateway.kind === 'ip';
  let nexthop = e.gateway === undefined ? undefined : formatIpv4(e.gateway);
  let iface = ifaceName(device, e.iface);
  if (e.blackhole) {
    nexthop = '0.0.0.0';
    iface = 'NULL0';
  } else if (nexthop === undefined) {
    // Sin siguiente salto, VRP muestra la dirección de la propia interfaz de salida.
    const addr = device.config.addressing.addresses.find((a) => a.iface === e.iface);
    nexthop = addr ? formatIpv4(addr.address.ip) : '0.0.0.0';
  }
  const flags = `${relay ? 'R' : ''}${active ? 'D' : ''}`;
  return { dst: e.dst, proto: 'Static', pre: e.distance, flags, nexthop, iface };
}

function entryRows(device: Device, e: RibEntry, active: boolean): Row[] {
  switch (e.origin) {
    case 'connected':
      return directRows(device, e);
    case 'static':
      return [staticRow(device, e, active)];
    case 'dhcp':
      // La ruta por defecto que aprende un cliente DHCP sale como «Unr» en VRP.
      return [
        {
          dst: e.dst,
          proto: 'Unr',
          pre: e.distance,
          flags: active ? 'RD' : 'R',
          nexthop: e.gateway === undefined ? '0.0.0.0' : formatIpv4(e.gateway),
          iface: ifaceName(device, e.iface),
        },
      ];
  }
}

const ribRows = (device: Device, entries: readonly RibEntry[], active: boolean): Row[] =>
  entries.flatMap((e) => entryRows(device, e, active));

/** VRP ordena por dirección de destino y, a igualdad, por longitud de máscara. */
const byDest = (a: Row, b: Row) => a.dst.ip - b.dst.ip || a.dst.len - b.dst.len;

const SEPARATOR = '-'.repeat(78);
const HEADER = `${'Destination/Mask'.padEnd(20)}${'Proto'.padEnd(8)}${'Pre'.padEnd(5)}${'Cost'.padEnd(10)}${'Flags'.padEnd(6)}${'NextHop'.padEnd(16)}Interface`;

/** VRP alinea las barras: la dirección a la derecha en 15 y `/len` a la izquierda en 3. */
function formatRow(r: Row): string {
  const dst = `${formatIpv4(r.dst.ip).padStart(15)}${`/${r.dst.len}`.padEnd(3)}`;
  return `${dst}  ${r.proto.padEnd(8)}${String(r.pre).padEnd(5)}${'0'.padEnd(10)}${r.flags.padStart(3)}   ${r.nexthop.padEnd(16)}${r.iface}`;
}

function counts(rows: readonly Row[]): string {
  const dests = new Set(rows.map((r) => `${r.dst.ip}/${r.dst.len}`)).size;
  return `         Destinations : ${String(dests).padEnd(9)}Routes : ${rows.length}`;
}

function table(rows: readonly Row[]): string[] {
  if (rows.length === 0) return [];
  return ['', HEADER, '', ...[...rows].sort(byDest).map(formatRow)];
}

function displayRoutingTable(device: Device): string {
  // La tabla pública solo lista lo que se baja a la FIB: las rutas activas.
  const active = device.oper.rib.filter((e) => e.active);
  const rows = [...ribRows(device, active, true), ...INLOOPBACK];
  return [
    'Route Flags: R - relay, D - download to fib',
    SEPARATOR,
    'Routing Tables: Public',
    counts(rows),
    ...table(rows),
  ].join('\n');
}

function displayStatic(device: Device): string {
  const statics = device.oper.rib.filter((e) => e.origin === 'static');
  const active = ribRows(
    device,
    statics.filter((e) => e.active),
    true,
  );
  const inactive = ribRows(
    device,
    statics.filter((e) => !e.active),
    false,
  );
  const configured = routesOf(device).length;
  return [
    'Route Flags: R - relay, D - download to fib',
    SEPARATOR,
    'Public routing table : Static',
    `${counts([...active, ...inactive])}        Configured Routes : ${configured}`,
    '',
    'Static routing table status : <Active>',
    counts(active),
    ...table(active),
    '',
    'Static routing table status : <Inactive>',
    counts(inactive),
    ...table(inactive),
  ].join('\n');
}

// ── Configuración ───────────────────────────────────────────────────────────

function routeLine(device: Device, r: StaticRoute): string {
  const gw = r.gateway;
  const parts = ['ip route-static', formatIpv4(r.dst.ip), dottedMask(r.dst.len)];
  if (gw.kind === 'blackhole') parts.push('NULL0');
  if (gw.kind === 'iface' || gw.kind === 'ip-iface') {
    parts.push(ifaceById(device, gw.iface)?.name ?? 'NULL0');
  }
  if (gw.kind === 'ip' || gw.kind === 'ip-iface') parts.push(formatIpv4(gw.ip));
  if (r.distance !== DEFAULT_PREFERENCE) parts.push('preference', String(r.distance));
  return ` ${parts.join(' ')}`;
}

/** Las rutas, en su propio bloque tras las interfaces y ordenadas por destino. */
function blocks(device: Device): readonly ConfigBlock[] {
  const routes = routesOf(device)
    .filter((r) => !r.disabled)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.dst.ip - b.r.dst.ip || a.r.dst.len - b.r.dst.len || a.i - b.i);
  return [{ order: 200, lines: routes.map(({ r }) => routeLine(device, r)) }];
}

export const ROUTING_AREA: Area = {
  commands,
  displays: {
    'ip routing-table': (ctx, which) =>
      which === 'static' ? displayStatic(ctx.device) : displayRoutingTable(ctx.device),
  },
  blocks,
  messages: {
    'route-not-exist': 'Error: The static route does not exist.',
    'route-invalid-nexthop': 'Error: The next hop address is invalid.',
  },
};
