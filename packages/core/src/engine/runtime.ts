/**
 * Acciones con efecto en el estado de ejecución: ping, resolución DNS con
 * caché, Torch y el avance del reloj con el tráfico de fondo del escenario.
 * Todo es determinista: el tiempo lo pasa quien llama.
 */
import type { DeviceId, ItemId, SimTime } from '../model/brand';
import type { IpProtocol } from '../model/config';
import type { Device, Flow, Network } from '../model/network';
import {
  type Connection,
  type Counters,
  type DnsCacheEntry,
  type InterfaceOper,
  LOG_LIMIT,
  type LogEntry,
  type RuleCounter,
} from '../model/oper';
import { formatIpv4, type Ipv4, parseIpv4 } from '../net/ipv4';
import { converge } from './converge';
import type { PacketHeader } from './firewall';
import { type Hop, type TraceResult, trace } from './trace';

const add = (c: Counters, packets: number, bytes: number): Counters => ({
  packets: c.packets + packets,
  bytes: c.bytes + bytes,
});

const AVG_PACKET_BYTES = 1000;

function updateDevice(net: Network, id: DeviceId, update: (d: Device) => Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === id ? update(d) : d)) };
}

// ── Efectos de un trazado ───────────────────────────────────────────────────

/** Suma contadores de reglas y deja en el log las reglas con `log` que coincidieron. */
export function recordTrace(net: Network, result: TraceResult, bytes = 84): Network {
  let next = net;
  const legs = [result.forward, ...(result.reply ? [result.reply] : [])];
  for (const leg of legs) {
    for (const hop of leg.hops) {
      next = updateDevice(next, hop.device, (device) => {
        let counters = device.oper.ruleCounters;
        const log: LogEntry[] = [];
        for (const verdict of hop.filters) {
          for (const rule of verdict.matched) counters = bumpRule(counters, rule, 1, bytes);
          for (const rule of verdict.logged) {
            const r = device.config.firewall.filter.find((x) => x.id === rule);
            log.push({
              at: net.now,
              event: {
                kind: 'firewall',
                rule,
                chain: verdict.chain,
                ...(r?.logPrefix === undefined ? {} : { prefix: r.logPrefix }),
                protocol: hop.received.protocol,
                src: endpoint(hop.received, 'src'),
                dst: endpoint(hop.received, 'dst'),
                ...(hop.inIface === undefined ? {} : { inIface: hop.inIface }),
                ...(hop.outIface === undefined ? {} : { outIface: hop.outIface }),
              },
            });
          }
        }
        for (const nat of hop.nat)
          if (!nat.reverse) counters = bumpRule(counters, nat.rule, 1, bytes);
        return {
          ...device,
          oper: {
            ...device.oper,
            ruleCounters: counters,
            log:
              log.length === 0 ? device.oper.log : [...device.oper.log, ...log].slice(-LOG_LIMIT),
          },
        };
      });
    }
  }
  return next;
}

function endpoint(p: PacketHeader, side: 'src' | 'dst') {
  const ip = side === 'src' ? p.src : p.dst;
  const port = side === 'src' ? p.srcPort : p.dstPort;
  return port === undefined ? { ip } : { ip, port };
}

function bumpRule(
  counters: readonly RuleCounter[],
  rule: ItemId,
  packets: number,
  bytes: number,
): RuleCounter[] {
  const existing = counters.find((c) => c.rule === rule);
  if (!existing) return [...counters, { rule, packets, bytes }];
  return counters.map((c) =>
    c.rule === rule ? { rule, packets: c.packets + packets, bytes: c.bytes + bytes } : c,
  );
}

// ── Ping ────────────────────────────────────────────────────────────────────

export interface PingReply {
  readonly seq: number;
  readonly ok: boolean;
  readonly rttMs?: number;
}

export interface PingResult {
  readonly replies: readonly PingReply[];
  readonly trace: TraceResult;
  readonly net: Network;
}

/** Tiempo de ida y vuelta sintético pero estable: depende de saltos y de si cruza "Internet". */
function rtt(result: TraceResult, seq: number): number {
  const hops = result.forward.hops.length + (result.reply?.hops.length ?? 0);
  const internet = result.forward.end.kind === 'delivered' && result.forward.end.emulated ? 14 : 0;
  return Math.round((0.4 * hops + internet + (seq % 3) * 0.3) * 10) / 10;
}

export function ping(
  net: Network,
  from: DeviceId,
  dst: Ipv4,
  options: { count?: number; src?: Ipv4; ttl?: number } = {},
): PingResult {
  const result = trace(net, {
    from,
    dst,
    protocol: 'icmp',
    ...(options.src === undefined ? {} : { src: options.src }),
    ...(options.ttl === undefined ? {} : { ttl: options.ttl }),
  });
  const count = options.count ?? 4;
  const replies: PingReply[] = [];
  let next = net;
  for (let seq = 0; seq < count; seq++) {
    replies.push(result.ok ? { seq, ok: true, rttMs: rtt(result, seq) } : { seq, ok: false });
    next = recordTrace(next, result);
  }
  return { replies, trace: result, net: next };
}

// ── DNS ─────────────────────────────────────────────────────────────────────

export interface ResolveResult {
  readonly outcome: 'answered' | 'nxdomain' | 'timeout' | 'no-servers';
  readonly address?: Ipv4;
  /** Resolutores consultados, en orden. */
  readonly chain: readonly DeviceId[];
  readonly net: Network;
}

const EMULATED_TTL = 300;

interface Resolution {
  outcome: ResolveResult['outcome'];
  address?: Ipv4;
  ttl: number;
}

function resolveAt(
  net: Network,
  deviceId: DeviceId,
  name: string,
  depth: number,
  chain: DeviceId[],
  cache: { device: DeviceId; entry: DnsCacheEntry }[],
): Resolution {
  const device = net.devices.find((d) => d.id === deviceId);
  if (!device || depth > 6) return { outcome: 'timeout', ttl: 0 };
  chain.push(deviceId);
  const lname = name.toLowerCase();

  const record = device.config.dns.static.find(
    (r) => !r.disabled && r.name.toLowerCase() === lname,
  );
  if (record?.type === 'A' && record.address !== undefined) {
    return { outcome: 'answered', address: record.address, ttl: record.ttlS };
  }
  if (record?.type === 'CNAME' && record.cname !== undefined) {
    return resolveAt(net, deviceId, record.cname, depth + 1, chain, cache);
  }

  const cached = device.oper.dnsCache.find(
    (c) => c.name === lname && c.type === 'A' && c.expiresAt > net.now,
  );
  const cachedAddress = cached ? parseIpv4(cached.data) : null;
  if (cached && cachedAddress !== null) {
    return { outcome: 'answered', address: cachedAddress, ttl: cached.expiresAt - net.now };
  }

  const em = net.scenario.internet;
  if (em?.device === deviceId) {
    const hit = em.dns.find((r) => r.name.toLowerCase() === lname);
    return hit
      ? { outcome: 'answered', address: hit.address, ttl: EMULATED_TTL }
      : { outcome: 'nxdomain', ttl: 0 };
  }

  const servers = [...new Set([...device.config.dns.servers, ...device.oper.dynamicDnsServers])];
  if (servers.length === 0) return { outcome: 'no-servers', ttl: 0 };

  for (const server of servers) {
    const result = trace(net, { from: deviceId, dst: server, protocol: 'udp', dstPort: 53 });
    if (!result.ok || result.forward.end.kind !== 'delivered') continue;
    const end = result.forward.end;
    const answer: Resolution = end.emulated
      ? resolveAt(net, net.scenario.internet?.device ?? end.device, name, depth + 1, chain, cache)
      : resolveAt(net, end.device, name, depth + 1, chain, cache);
    if (answer.outcome === 'timeout' || answer.outcome === 'no-servers') continue;
    if (answer.outcome === 'answered' && answer.address !== undefined && device.os !== 'host') {
      cache.push({
        device: deviceId,
        entry: {
          name: lname,
          type: 'A',
          data: formatIpv4(answer.address),
          expiresAt: (net.now + answer.ttl) as SimTime,
        },
      });
    }
    return answer;
  }
  return { outcome: 'timeout', ttl: 0 };
}

/** Resuelve un nombre desde un dispositivo, siguiendo sus servidores DNS reales por la red. */
export function resolveName(net: Network, from: DeviceId, name: string): ResolveResult {
  const chain: DeviceId[] = [];
  const cache: { device: DeviceId; entry: DnsCacheEntry }[] = [];
  const result = resolveAt(net, from, name, 0, chain, cache);
  let next = net;
  for (const { device, entry } of cache) {
    next = updateDevice(next, device, (d) => ({
      ...d,
      oper: {
        ...d.oper,
        dnsCache: [
          ...d.oper.dnsCache.filter((c) => !(c.name === entry.name && c.type === entry.type)),
          entry,
        ],
      },
    }));
  }
  return {
    outcome: result.outcome,
    ...(result.address === undefined ? {} : { address: result.address }),
    chain,
    net: next,
  };
}

// ── Torch ───────────────────────────────────────────────────────────────────

export interface TorchEntry {
  readonly protocol: IpProtocol;
  readonly src: Ipv4;
  readonly dst: Ipv4;
  readonly srcPort?: number;
  readonly dstPort?: number;
  readonly txBps: number;
  readonly rxBps: number;
  readonly flow: string;
}

const touches = (hop: Hop, iface: ItemId, side: 'in' | 'out'): boolean =>
  side === 'in'
    ? hop.inIface === iface || hop.inPort === iface
    : hop.outIface === iface || hop.outPort === iface;

/** Tráfico de fondo que cruza una interfaz, visto desde ese dispositivo. */
export function torch(net: Network, deviceId: DeviceId, iface: ItemId): TorchEntry[] {
  const entries: TorchEntry[] = [];
  for (const flow of net.scenario.flows) {
    const result = trace(net, flowProbe(flow));
    let tx = 0;
    let rx = 0;
    let seen: PacketHeader | undefined;
    for (const hop of result.forward.hops) {
      if (hop.device !== deviceId) continue;
      seen ??= hop.received;
      if (touches(hop, iface, 'in')) rx += flow.bps;
      if (touches(hop, iface, 'out')) tx += flow.bps;
    }
    if (result.reply && result.forward.end.kind === 'delivered') {
      for (const hop of result.reply.hops) {
        if (hop.device !== deviceId) continue;
        if (touches(hop, iface, 'in')) rx += flow.replyBps;
        if (touches(hop, iface, 'out')) tx += flow.replyBps;
      }
    }
    if ((tx > 0 || rx > 0) && seen) {
      entries.push({
        protocol: seen.protocol,
        src: seen.src,
        dst: seen.dst,
        ...(seen.srcPort === undefined ? {} : { srcPort: seen.srcPort }),
        ...(seen.dstPort === undefined ? {} : { dstPort: seen.dstPort }),
        txBps: tx,
        rxBps: rx,
        flow: flow.id,
      });
    }
  }
  return entries;
}

function flowProbe(flow: Flow) {
  return {
    from: flow.from,
    dst: flow.to,
    protocol: flow.protocol,
    ...(flow.dstPort === undefined ? {} : { dstPort: flow.dstPort }),
    ...(flow.srcPort === undefined ? {} : { srcPort: flow.srcPort }),
  };
}

// ── Avance del reloj ────────────────────────────────────────────────────────

const CONNECTION_TIMEOUT: Readonly<Record<IpProtocol, number>> = { tcp: 86400, udp: 180, icmp: 10 };

interface Traffic {
  rx: number;
  tx: number;
  rateRx: number;
  rateTx: number;
}

/**
 * Avanza el reloj `dt` segundos: el tráfico de fondo suma en contadores de
 * interfaces y reglas, mantiene las conexiones vivas y caduca la caché DNS.
 */
export function tick(net: Network, dt: number): Network {
  const now = (net.now + dt) as SimTime;
  const traffic = new Map<string, Traffic>();
  const ruleBytes = new Map<string, number>();
  const conns = new Map<DeviceId, Connection[]>();
  const bump = (device: DeviceId, iface: ItemId | undefined, side: 'rx' | 'tx', bps: number) => {
    if (iface === undefined || bps === 0) return;
    const key = `${device}#${iface}`;
    const t = traffic.get(key) ?? { rx: 0, tx: 0, rateRx: 0, rateTx: 0 };
    if (side === 'rx') {
      t.rx += (bps * dt) / 8;
      t.rateRx += bps;
    } else {
      t.tx += (bps * dt) / 8;
      t.rateTx += bps;
    }
    traffic.set(key, t);
  };

  for (const flow of net.scenario.flows) {
    const result = trace(net, flowProbe(flow));
    const legs = [{ leg: result.forward, bps: flow.bps }];
    if (result.reply && result.forward.end.kind === 'delivered')
      legs.push({ leg: result.reply, bps: flow.replyBps });
    for (const { leg, bps } of legs) {
      for (const hop of leg.hops) {
        bump(hop.device, hop.inIface, 'rx', bps);
        if (hop.inPort !== undefined) bump(hop.device, hop.inPort, 'rx', bps);
        if (hop.sent) {
          bump(hop.device, hop.outIface, 'tx', bps);
          if (hop.outPort !== undefined) bump(hop.device, hop.outPort, 'tx', bps);
        }
        for (const verdict of hop.filters) {
          for (const rule of verdict.matched) {
            const key = `${hop.device}#${rule}`;
            ruleBytes.set(key, (ruleBytes.get(key) ?? 0) + (bps * dt) / 8);
          }
        }
      }
    }
    if (!result.ok) continue;
    for (const hop of result.forward.hops) {
      const device = net.devices.find((d) => d.id === hop.device);
      if (!device?.traits.forwards || !hop.sent) continue;
      const original = hop.received;
      const translated = hop.sent;
      conns.set(hop.device, [
        ...(conns.get(hop.device) ?? []),
        {
          protocol: original.protocol,
          original: { src: endpoint(original, 'src'), dst: endpoint(original, 'dst') },
          reply: { src: endpoint(translated, 'dst'), dst: endpoint(translated, 'src') },
          srcNat: hop.nat.some((n) => n.chain === 'srcnat' && !n.reverse),
          dstNat: hop.nat.some((n) => n.chain === 'dstnat' && !n.reverse),
          expiresAt: (now + CONNECTION_TIMEOUT[original.protocol]) as SimTime,
          flow: flow.id,
        },
      ]);
    }
  }

  const devices = net.devices.map((device) => {
    const interfaces: InterfaceOper[] = device.oper.interfaces.map((i) => {
      const t = traffic.get(`${device.id}#${i.iface}`);
      const rxBytes = Math.round(t?.rx ?? 0);
      const txBytes = Math.round(t?.tx ?? 0);
      return {
        ...i,
        rx: add(i.rx, Math.ceil(rxBytes / AVG_PACKET_BYTES), rxBytes),
        tx: add(i.tx, Math.ceil(txBytes / AVG_PACKET_BYTES), txBytes),
        rateBps: { rx: t?.rateRx ?? 0, tx: t?.rateTx ?? 0 },
      };
    });
    let ruleCounters = device.oper.ruleCounters;
    for (const [key, bytes] of ruleBytes) {
      const [owner, rule] = key.split('#');
      if (owner !== device.id || rule === undefined) continue;
      const rounded = Math.round(bytes);
      ruleCounters = bumpRule(
        ruleCounters,
        Number(rule) as ItemId,
        Math.ceil(rounded / AVG_PACKET_BYTES),
        rounded,
      );
    }
    const kept = device.oper.conntrack.filter((c) => c.flow === undefined && c.expiresAt > now);
    return {
      ...device,
      oper: {
        ...device.oper,
        interfaces,
        ruleCounters,
        conntrack: [...kept, ...(conns.get(device.id) ?? [])],
        dnsCache: device.oper.dnsCache.filter((c) => c.expiresAt > now),
      },
    };
  });

  return converge({ ...net, devices, now });
}
