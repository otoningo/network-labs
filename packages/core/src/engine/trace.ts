/**
 * Trazado de un paquete por la red, salto a salto, en ambos sentidos:
 * ida (estado `new`) y vuelta (estado `established`). En cada equipo se aplican
 * dstnat, entrega local o reenvío, cadenas de filtrado, srcnat y resolución del
 * siguiente salto en capa 2. La vuelta deshace las traducciones de la ida.
 *
 * Las validaciones de conectividad de los labs se basan en esto (ver D-014).
 */
import type { DeviceId, ItemId } from '../model/brand';
import type { IpProtocol, NatChain, NatRule } from '../model/config';
import type { Device, InternetEmulation, Network, PortRef } from '../model/network';
import type { RibEntry } from '../model/oper';
import { type Ipv4, type Ipv4Prefix, isPrivateIpv4, maskOf, prefixContains } from '../net/ipv4';
import type { Mac } from '../net/mac';
import { type ChainVerdict, firstNatRule, type PacketHeader, runFilter } from './firewall';
import { createL2, type L2 } from './l2';
import { computeLinkState, type LinkState } from './links';
import { lookupRoute } from './routing';

export interface Probe {
  readonly from: DeviceId;
  readonly dst: Ipv4;
  readonly protocol: IpProtocol;
  readonly dstPort?: number;
  readonly srcPort?: number;
  readonly src?: Ipv4;
  readonly ttl?: number;
}

export interface NatApplied {
  readonly chain: NatChain;
  readonly rule: ItemId;
  /** true cuando se deshace una traducción en el paquete de vuelta. */
  readonly reverse: boolean;
  readonly before: PacketHeader;
  readonly after: PacketHeader;
}

export interface Hop {
  readonly device: DeviceId;
  readonly inIface?: ItemId;
  readonly outIface?: ItemId;
  /** Puerto del bridge por el que entró o salió (útil para Torch en puertos esclavos). */
  readonly inPort?: ItemId;
  readonly outPort?: ItemId;
  readonly received: PacketHeader;
  readonly sent?: PacketHeader;
  readonly filters: readonly ChainVerdict[];
  readonly nat: readonly NatApplied[];
}

export type LegEnd =
  | { readonly kind: 'delivered'; readonly device: DeviceId; readonly emulated: boolean }
  | {
      readonly kind: 'filtered';
      readonly device: DeviceId;
      readonly chain: string;
      readonly action: 'drop' | 'reject';
      readonly rule?: ItemId;
    }
  | { readonly kind: 'no-route'; readonly device: DeviceId }
  | { readonly kind: 'blackhole'; readonly device: DeviceId }
  | {
      readonly kind: 'arp-failed';
      readonly device: DeviceId;
      readonly iface: ItemId;
      readonly nextHop: Ipv4;
    }
  | { readonly kind: 'ttl-exceeded'; readonly device: DeviceId }
  | { readonly kind: 'port-closed'; readonly device: DeviceId }
  | { readonly kind: 'not-forwarding'; readonly device: DeviceId }
  | { readonly kind: 'no-source'; readonly device: DeviceId }
  | { readonly kind: 'loop' };

export interface Leg {
  readonly hops: readonly Hop[];
  readonly end: LegEnd;
}

export interface TraceResult {
  readonly forward: Leg;
  readonly reply: Leg | null;
  /** La conexión se establece: la ida llega y la vuelta regresa al origen. */
  readonly ok: boolean;
  /** El paquete tal como lo recibió el destino (tras NAT). */
  readonly delivered?: PacketHeader;
}

// ── Contexto reutilizable por red ───────────────────────────────────────────

interface Ctx {
  readonly net: Network;
  readonly devices: ReadonlyMap<DeviceId, Device>;
  readonly links: LinkState;
  readonly l2: L2;
  readonly addresses: ReadonlyMap<DeviceId, readonly { iface: ItemId; address: Ipv4Prefix }[]>;
}

const CACHE = new WeakMap<Network, Ctx>();

function contextFor(net: Network): Ctx {
  const cached = CACHE.get(net);
  if (cached) return cached;
  const links = computeLinkState(net);
  const l2 = createL2(net, links);
  const addresses = new Map<DeviceId, { iface: ItemId; address: Ipv4Prefix }[]>();
  for (const device of net.devices) {
    const ifaces = new Set(device.config.interfaces.map((i) => i.id));
    const list = device.config.addressing.addresses
      .filter(
        (a) =>
          !a.disabled && ifaces.has(a.iface) && !l2.isSlave({ device: device.id, iface: a.iface }),
      )
      .map((a) => ({ iface: a.iface, address: a.address }));
    for (const d of device.oper.dynamicAddresses) list.push({ iface: d.iface, address: d.address });
    addresses.set(device.id, list);
  }
  const ctx: Ctx = {
    net,
    devices: new Map(net.devices.map((d) => [d.id, d])),
    links,
    l2,
    addresses,
  };
  CACHE.set(net, ctx);
  return ctx;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function header(
  src: Ipv4,
  dst: Ipv4,
  protocol: IpProtocol,
  srcPort: number | undefined,
  dstPort: number | undefined,
): PacketHeader {
  return {
    src,
    dst,
    protocol,
    ...(srcPort === undefined ? {} : { srcPort }),
    ...(dstPort === undefined ? {} : { dstPort }),
  };
}

const isLocal = (ctx: Ctx, device: DeviceId, ip: Ipv4): boolean =>
  (ctx.addresses.get(device) ?? []).some((a) => a.address.ip === ip);

const ifaceAddress = (ctx: Ctx, device: DeviceId, iface: ItemId): Ipv4 | undefined =>
  (ctx.addresses.get(device) ?? []).find((a) => a.iface === iface)?.address.ip;

function preferredSource(ctx: Ctx, device: DeviceId, route: RibEntry): Ipv4 | undefined {
  if (route.prefSrc !== undefined) return route.prefSrc;
  const onIface = route.iface === undefined ? undefined : ifaceAddress(ctx, device, route.iface);
  return onIface ?? ctx.addresses.get(device)?.[0]?.address.ip;
}

function resolveNeighbor(
  ctx: Ctx,
  device: DeviceId,
  outIface: ItemId,
  nextHop: Ipv4,
): PortRef | undefined {
  const from = { device, iface: outIface };
  for (const peer of ctx.l2.flood(from).reached.values()) {
    const owns = (ctx.addresses.get(peer.device) ?? []).some(
      (a) => a.iface === peer.iface && a.address.ip === nextHop,
    );
    if (owns && ctx.l2.mutual(from, peer)) return peer;
  }
  return undefined;
}

function macOf(device: Device | undefined, iface: ItemId | undefined): Mac | undefined {
  return device?.config.interfaces.find((i) => i.id === iface)?.mac;
}

/** Puerto del bridge (si la interfaz L3 vive sobre uno) por el que se alcanza una MAC. */
function portToward(device: Device, iface: ItemId, mac: Mac | undefined): ItemId | undefined {
  const own = device.config.interfaces.find((i) => i.id === iface);
  let bridge: ItemId | undefined;
  if (own?.kind === 'bridge') bridge = own.id;
  if (own?.kind === 'vlan') {
    const parent = device.config.interfaces.find((i) => i.id === own.parent);
    if (parent?.kind === 'bridge') bridge = parent.id;
  }
  if (bridge === undefined || mac === undefined) return undefined;
  return device.oper.bridgeHosts.find((h) => h.bridge === bridge && h.mac === mac && !h.local)
    ?.port;
}

function emulation(ctx: Ctx, device: DeviceId, dst: Ipv4): InternetEmulation | undefined {
  const em = ctx.net.scenario.internet;
  if (!em || em.device !== device || isPrivateIpv4(dst)) return undefined;
  return em.answers.some((p) => prefixContains(p, dst)) ? em : undefined;
}

function emulatedService(em: InternetEmulation, pkt: PacketHeader): boolean {
  if (pkt.protocol === 'icmp') return true;
  if (pkt.protocol === 'udp') return pkt.dstPort === 53;
  return pkt.dstPort !== undefined && em.tcpPorts.includes(pkt.dstPort);
}

function serviceListening(device: Device, pkt: PacketHeader): boolean {
  if (pkt.protocol === 'icmp') return true;
  if (pkt.dstPort === 53 && device.config.dns.allowRemoteRequests) return true;
  if (pkt.protocol !== 'tcp') return false;
  return device.config.services.some(
    (s) =>
      !s.disabled &&
      s.port === pkt.dstPort &&
      (s.allowedFrom.length === 0 || s.allowedFrom.some((p) => prefixContains(p, pkt.src))),
  );
}

// ── NAT ─────────────────────────────────────────────────────────────────────

interface Track {
  readonly device: DeviceId;
  readonly kind: 'src' | 'dst';
  readonly rule: ItemId;
  readonly before: PacketHeader;
  readonly after: PacketHeader;
}

function netmap(to: Ipv4Prefix, ip: Ipv4): Ipv4 {
  const mask = maskOf(to.len);
  return (((to.ip & mask) | (ip & ~mask)) >>> 0) as Ipv4;
}

function translate(
  ctx: Ctx,
  device: DeviceId,
  rule: NatRule,
  pkt: PacketHeader,
  inIface: ItemId | undefined,
  outIface: ItemId | undefined,
): PacketHeader | undefined {
  const action = rule.action;
  const firstPort = (
    ports: readonly { from: number }[] | undefined,
    fallback: number | undefined,
  ) => ports?.[0]?.from ?? fallback;
  switch (action.kind) {
    case 'masquerade': {
      const src = outIface === undefined ? undefined : ifaceAddress(ctx, device, outIface);
      return src === undefined
        ? undefined
        : header(src, pkt.dst, pkt.protocol, firstPort(action.toPorts, pkt.srcPort), pkt.dstPort);
    }
    case 'srcNat':
      return header(
        action.to.from,
        pkt.dst,
        pkt.protocol,
        firstPort(action.toPorts, pkt.srcPort),
        pkt.dstPort,
      );
    case 'dstNat':
      return header(
        pkt.src,
        action.to.from,
        pkt.protocol,
        pkt.srcPort,
        firstPort(action.toPorts, pkt.dstPort),
      );
    case 'redirect': {
      const dst =
        (inIface === undefined ? undefined : ifaceAddress(ctx, device, inIface)) ?? pkt.dst;
      return header(
        pkt.src,
        dst,
        pkt.protocol,
        pkt.srcPort,
        firstPort(action.toPorts, pkt.dstPort),
      );
    }
    case 'netmap':
      return rule.chain === 'srcnat'
        ? header(netmap(action.to, pkt.src), pkt.dst, pkt.protocol, pkt.srcPort, pkt.dstPort)
        : header(pkt.src, netmap(action.to, pkt.dst), pkt.protocol, pkt.srcPort, pkt.dstPort);
    case 'accept':
      return undefined;
  }
}

function applyNat(
  ctx: Ctx,
  device: Device,
  chain: NatChain,
  pkt: PacketHeader,
  inIface: ItemId | undefined,
  outIface: ItemId | undefined,
  nat: NatApplied[],
  tracks: Track[],
): PacketHeader {
  const rule = firstNatRule(device.config, chain, {
    packet: pkt,
    ...(inIface === undefined ? {} : { inIface }),
    ...(outIface === undefined ? {} : { outIface }),
    state: 'new',
  });
  if (!rule) return pkt;
  const after = translate(ctx, device.id, rule, pkt, inIface, outIface);
  if (!after) return pkt;
  nat.push({ chain, rule: rule.id, reverse: false, before: pkt, after });
  tracks.push({
    device: device.id,
    kind: chain === 'srcnat' ? 'src' : 'dst',
    rule: rule.id,
    before: pkt,
    after,
  });
  return after;
}

const samePort = (a: number | undefined, b: number | undefined) => a === b;

/** Vuelta de un srcnat: se restaura el destino original en el preruteo. */
function unSrcNat(
  device: DeviceId,
  pkt: PacketHeader,
  nat: NatApplied[],
  tracks: readonly Track[],
): PacketHeader {
  const t = tracks.find(
    (x) =>
      x.device === device &&
      x.kind === 'src' &&
      pkt.dst === x.after.src &&
      samePort(pkt.dstPort, x.after.srcPort) &&
      pkt.src === x.after.dst &&
      samePort(pkt.srcPort, x.after.dstPort),
  );
  if (!t) return pkt;
  const after = header(pkt.src, t.before.src, pkt.protocol, pkt.srcPort, t.before.srcPort);
  nat.push({ chain: 'srcnat', rule: t.rule, reverse: true, before: pkt, after });
  return after;
}

/** Vuelta de un dstnat: se restaura el origen original en el posruteo. */
function unDstNat(
  device: DeviceId,
  pkt: PacketHeader,
  nat: NatApplied[],
  tracks: readonly Track[],
): PacketHeader {
  const t = tracks.find(
    (x) =>
      x.device === device &&
      x.kind === 'dst' &&
      pkt.src === x.after.dst &&
      samePort(pkt.srcPort, x.after.dstPort) &&
      pkt.dst === x.after.src &&
      samePort(pkt.dstPort, x.after.srcPort),
  );
  if (!t) return pkt;
  const after = header(t.before.dst, pkt.dst, pkt.protocol, t.before.dstPort, pkt.dstPort);
  nat.push({ chain: 'dstnat', rule: t.rule, reverse: true, before: pkt, after });
  return after;
}

// ── Recorrido de un tramo ───────────────────────────────────────────────────

interface LegResult extends Leg {
  readonly final?: PacketHeader;
}

const MAX_STEPS = 64;

function runLeg(
  ctx: Ctx,
  origin: DeviceId,
  start: PacketHeader,
  mode: 'forward' | 'reply',
  initialTtl: number,
  tracks: Track[],
): LegResult {
  const hops: Hop[] = [];
  const state = mode === 'forward' ? 'new' : 'established';
  let deviceId = origin;
  let inIface: ItemId | undefined;
  let inPort: ItemId | undefined;
  let pkt = start;
  let ttl = initialTtl;

  for (let step = 0; step < MAX_STEPS; step++) {
    const device = ctx.devices.get(deviceId);
    if (!device) return { hops, end: { kind: 'no-route', device: deviceId } };
    const received = pkt;
    const filters: ChainVerdict[] = [];
    const nat: NatApplied[] = [];
    const base = {
      device: deviceId,
      ...(inIface === undefined ? {} : { inIface }),
      ...(inPort === undefined ? {} : { inPort }),
      received,
      filters,
      nat,
    };

    if (inIface === undefined) {
      if (isLocal(ctx, deviceId, pkt.dst)) {
        return { hops, end: { kind: 'delivered', device: deviceId, emulated: false }, final: pkt };
      }
    } else {
      pkt =
        mode === 'reply'
          ? unSrcNat(deviceId, pkt, nat, tracks)
          : applyNat(ctx, device, 'dstnat', pkt, inIface, undefined, nat, tracks);
      if (isLocal(ctx, deviceId, pkt.dst)) {
        const verdict = runFilter(device.config, 'input', { packet: pkt, inIface, state });
        filters.push(verdict);
        hops.push(base);
        if (verdict.verdict !== 'accept') {
          return { hops, end: filteredEnd(deviceId, verdict) };
        }
        if (mode === 'forward' && !serviceListening(device, pkt)) {
          return { hops, end: { kind: 'port-closed', device: deviceId } };
        }
        return { hops, end: { kind: 'delivered', device: deviceId, emulated: false }, final: pkt };
      }
      // "Internet" recibe tanto conexiones nuevas hacia IPs públicas como respuestas para ellas.
      const em = emulation(ctx, deviceId, pkt.dst);
      if (em) {
        hops.push(base);
        if (mode === 'forward' && !emulatedService(em, pkt)) {
          return { hops, end: { kind: 'port-closed', device: deviceId } };
        }
        return { hops, end: { kind: 'delivered', device: deviceId, emulated: true }, final: pkt };
      }
      if (!device.traits.forwards) {
        hops.push(base);
        return { hops, end: { kind: 'not-forwarding', device: deviceId } };
      }
      ttl -= 1;
      if (ttl <= 0) {
        hops.push(base);
        return { hops, end: { kind: 'ttl-exceeded', device: deviceId } };
      }
    }

    const route = lookupRoute(device.oper.rib, pkt.dst);
    if (!route || (route.iface === undefined && !route.blackhole)) {
      hops.push(base);
      return { hops, end: { kind: 'no-route', device: deviceId } };
    }
    if (route.blackhole || route.iface === undefined) {
      hops.push(base);
      return { hops, end: { kind: 'blackhole', device: deviceId } };
    }
    const outIface = route.iface;
    const nextHop = route.gateway ?? pkt.dst;

    const chain = inIface === undefined ? 'output' : 'forward';
    const verdict = runFilter(device.config, chain, {
      packet: pkt,
      ...(inIface === undefined ? {} : { inIface }),
      outIface,
      state,
    });
    filters.push(verdict);
    if (verdict.verdict !== 'accept') {
      hops.push({ ...base, outIface });
      return { hops, end: filteredEnd(deviceId, verdict) };
    }

    pkt =
      mode === 'reply'
        ? unDstNat(deviceId, pkt, nat, tracks)
        : applyNat(ctx, device, 'srcnat', pkt, inIface, outIface, nat, tracks);

    const peer = resolveNeighbor(ctx, deviceId, outIface, nextHop);
    const peerDevice = peer && ctx.devices.get(peer.device);
    const outPort = portToward(device, outIface, macOf(peerDevice, peer?.iface));
    hops.push({ ...base, outIface, ...(outPort === undefined ? {} : { outPort }), sent: pkt });
    if (!peer || !peerDevice) {
      return { hops, end: { kind: 'arp-failed', device: deviceId, iface: outIface, nextHop } };
    }
    inPort = portToward(peerDevice, peer.iface, macOf(device, outIface));
    deviceId = peer.device;
    inIface = peer.iface;
  }
  return { hops, end: { kind: 'loop' } };
}

function filteredEnd(device: DeviceId, verdict: ChainVerdict): LegEnd {
  return {
    kind: 'filtered',
    device,
    chain: verdict.chain,
    action: verdict.verdict === 'reject' ? 'reject' : 'drop',
    ...(verdict.rule === undefined ? {} : { rule: verdict.rule }),
  };
}

// ── API ─────────────────────────────────────────────────────────────────────

const EPHEMERAL_PORT = 49152;

export function trace(net: Network, probe: Probe): TraceResult {
  const ctx = contextFor(net);
  const origin = ctx.devices.get(probe.from);
  const fail = (end: LegEnd): TraceResult => ({
    forward: { hops: [], end },
    reply: null,
    ok: false,
  });
  if (!origin) return fail({ kind: 'no-route', device: probe.from });

  let src = probe.src;
  if (src === undefined) {
    if (isLocal(ctx, origin.id, probe.dst)) {
      src = probe.dst;
    } else {
      const route = lookupRoute(origin.oper.rib, probe.dst);
      if (!route) return fail({ kind: 'no-route', device: origin.id });
      src = preferredSource(ctx, origin.id, route);
    }
  }
  if (src === undefined) return fail({ kind: 'no-source', device: origin.id });

  const srcPort = probe.srcPort ?? (probe.protocol === 'icmp' ? undefined : EPHEMERAL_PORT);
  const tracks: Track[] = [];
  const forward = runLeg(
    ctx,
    origin.id,
    header(src, probe.dst, probe.protocol, srcPort, probe.dstPort),
    'forward',
    probe.ttl ?? 64,
    tracks,
  );
  const seen = forward.final;
  if (forward.end.kind !== 'delivered' || !seen) {
    return { forward: { hops: forward.hops, end: forward.end }, reply: null, ok: false };
  }
  const replyStart = header(seen.dst, seen.src, seen.protocol, seen.dstPort, seen.srcPort);
  const reply = runLeg(ctx, forward.end.device, replyStart, 'reply', 64, tracks);
  const ok = reply.end.kind === 'delivered' && reply.end.device === origin.id;
  return {
    forward: { hops: forward.hops, end: forward.end },
    reply: { hops: reply.hops, end: reply.end },
    ok,
    delivered: seen,
  };
}

/** Dirección que un dispositivo usaría como origen hacia `dst` (útil para drivers y predicados). */
export function sourceAddressFor(net: Network, device: DeviceId, dst: Ipv4): Ipv4 | undefined {
  const ctx = contextFor(net);
  const d = ctx.devices.get(device);
  if (!d) return undefined;
  const route = lookupRoute(d.oper.rib, dst);
  return route ? preferredSource(ctx, device, route) : undefined;
}

export function addressesOf(
  net: Network,
  device: DeviceId,
): readonly { iface: ItemId; address: Ipv4Prefix }[] {
  return contextFor(net).addresses.get(device) ?? [];
}
