/**
 * Asignación DHCP determinista. Cada cliente se une al primer servidor con el
 * que tiene alcance L2 mutuo. Las direcciones se reparten en cuatro pasadas
 * para que el resultado no dependa del orden en que aparecen los clientes:
 * elegir servidor, leases estáticos, leases previos (pegajosos) y asignación nueva.
 */
import type { DeviceId, ItemId, SimTime } from '../model/brand';
import type { DhcpClient, DhcpServer, Pool } from '../model/config';
import type { Device, Network, PortRef } from '../model/network';
import type { DhcpClientStatus, DhcpLease } from '../model/oper';
import {
  broadcastOf,
  type Ipv4,
  type Ipv4Prefix,
  networkOf,
  prefixContains,
  rangeContains,
} from '../net/ipv4';
import type { L2 } from './l2';
import type { LinkState } from './links';

export interface DhcpResult {
  readonly leases: ReadonlyMap<DeviceId, readonly DhcpLease[]>;
  readonly clients: ReadonlyMap<DeviceId, readonly DhcpClientStatus[]>;
  /** Leases que no existían antes de esta convergencia (para el log). */
  readonly fresh: readonly { readonly device: DeviceId; readonly lease: DhcpLease }[];
  /**
   * Clientes que se acaban de quedar sin dirección porque el pool de su
   * servidor está agotado (para el log del servidor; no se repite mientras sigan así).
   */
  readonly exhausted: readonly {
    readonly device: DeviceId;
    readonly server: ItemId;
    readonly pool: ItemId;
  }[];
}

interface ServerCtx {
  readonly device: Device;
  readonly server: DhcpServer;
  readonly ref: PortRef;
}

interface ClientCtx {
  readonly device: Device;
  readonly client: DhcpClient;
  readonly ref: PortRef;
  server?: ServerCtx | undefined;
  lease?: DhcpLease | undefined;
}

function poolChain(device: Device, start: ItemId): Pool[] {
  const chain: Pool[] = [];
  let id: ItemId | undefined = start;
  while (id !== undefined && !chain.some((p) => p.id === id)) {
    const pool = device.config.dhcpServer.pools.find((p) => p.id === id);
    if (!pool || pool.disabled) break;
    chain.push(pool);
    id = pool.next;
  }
  return chain;
}

function* candidates(device: Device, server: DhcpServer): Generator<Ipv4> {
  if (server.pool === 'static-only') return;
  const ranges = poolChain(device, server.pool).flatMap((p) => p.ranges);
  if (device.traits.poolAllocation === 'highest') {
    for (const r of [...ranges].reverse()) for (let ip = r.to; ip >= r.from; ip--) yield ip as Ipv4;
  } else {
    for (const r of ranges) for (let ip = r.from; ip <= r.to; ip++) yield ip as Ipv4;
  }
}

function inPool(device: Device, server: DhcpServer, ip: Ipv4): boolean {
  if (server.pool === 'static-only') return false;
  return poolChain(device, server.pool).some((p) => p.ranges.some((r) => rangeContains(r, ip)));
}

/** Red DHCP más específica que contiene la dirección. */
function networkFor(device: Device, ip: Ipv4) {
  let best: (typeof device.config.dhcpServer.networks)[number] | undefined;
  for (const net of device.config.dhcpServer.networks) {
    if (net.disabled || !prefixContains(net.prefix, ip)) continue;
    if (!best || net.prefix.len > best.prefix.len) best = net;
  }
  return best;
}

function prefixLenFor(server: ServerCtx, ip: Ipv4): number {
  const net = networkFor(server.device, ip);
  if (net) return net.prefix.len;
  const own = server.device.config.addressing.addresses.find(
    (a) => !a.disabled && a.iface === server.server.iface && prefixContains(a.address, ip),
  );
  return own ? own.address.len : 32;
}

/** No se entregan la dirección de red ni la de broadcast de la subred del servidor. */
function reserved(server: ServerCtx, ip: Ipv4): boolean {
  const len = prefixLenFor(server, ip);
  if (len >= 31) return false;
  const subnet: Ipv4Prefix = { ip, len };
  return networkOf(subnet).ip === ip || broadcastOf(subnet) === ip;
}

export function computeDhcp(
  net: Network,
  links: LinkState,
  l2: L2,
  staticIps: ReadonlySet<number>,
): DhcpResult {
  const now = net.now;
  const usable = (device: Device, iface: ItemId): boolean => {
    const ref = { device: device.id, iface };
    return links.isRunning(ref) && !l2.isSlave(ref);
  };

  const servers: ServerCtx[] = [];
  const clients: ClientCtx[] = [];
  for (const device of net.devices) {
    for (const server of device.config.dhcpServer.servers) {
      if (server.disabled || !device.config.dhcp.serverEnabled || !usable(device, server.iface))
        continue;
      servers.push({ device, server, ref: { device: device.id, iface: server.iface } });
    }
    for (const client of device.config.addressing.dhcpClients) {
      if (client.disabled || !usable(device, client.iface)) continue;
      clients.push({ device, client, ref: { device: device.id, iface: client.iface } });
    }
  }

  // 1. Servidor de cada cliente.
  for (const c of clients) {
    const server = servers.find((s) => s.device.id !== c.device.id && l2.mutual(s.ref, c.ref));
    if (server) c.server = server;
  }

  const macOf = (c: ClientCtx) =>
    c.device.config.interfaces.find((i) => i.id === c.client.iface)?.mac;
  const taken = new Set<string>();
  const takenKey = (s: ServerCtx, ip: Ipv4) => `${s.device.id}|${ip}`;
  const makeLease = (
    c: ClientCtx,
    s: ServerCtx,
    ip: Ipv4,
    dynamic: boolean,
  ): DhcpLease | undefined => {
    const mac = macOf(c);
    if (!mac) return undefined;
    const previous = s.device.oper.dhcpLeases.find(
      (l) => l.server === s.server.id && l.mac === mac && l.ip === ip,
    );
    const boundAt = previous?.boundAt ?? now;
    const expiresAt =
      previous && previous.expiresAt > now
        ? previous.expiresAt
        : ((now + s.server.leaseTimeS) as SimTime);
    taken.add(takenKey(s, ip));
    return {
      server: s.server.id,
      ip,
      mac,
      client: c.ref,
      hostName: c.device.config.system.identity,
      status: 'bound',
      dynamic,
      boundAt,
      expiresAt,
    };
  };

  // 2. Leases estáticos.
  for (const c of clients) {
    const s = c.server;
    const mac = macOf(c);
    if (!s || !mac) continue;
    const fixed = s.device.config.dhcpServer.staticLeases.find(
      (l) => !l.disabled && l.mac === mac && (l.server === 'all' || l.server === s.server.id),
    );
    if (fixed && !taken.has(takenKey(s, fixed.ip))) c.lease = makeLease(c, s, fixed.ip, false);
  }

  const staticLeaseIps = (s: ServerCtx) =>
    new Set<number>(
      s.device.config.dhcpServer.staticLeases.filter((l) => !l.disabled).map((l) => l.ip),
    );

  // 3. Leases previos que siguen siendo válidos.
  for (const c of clients) {
    const s = c.server;
    const mac = macOf(c);
    if (!s || !mac || c.lease) continue;
    const previous = s.device.oper.dhcpLeases.find(
      (l) => l.server === s.server.id && l.mac === mac && l.dynamic,
    );
    if (!previous) continue;
    const ip = previous.ip;
    const free =
      inPool(s.device, s.server, ip) &&
      !taken.has(takenKey(s, ip)) &&
      !staticIps.has(ip) &&
      !staticLeaseIps(s).has(ip);
    if (free) c.lease = makeLease(c, s, ip, true);
  }

  // 4. Asignación nueva.
  for (const c of clients) {
    const s = c.server;
    if (!s || c.lease) continue;
    const blocked = staticLeaseIps(s);
    for (const ip of candidates(s.device, s.server)) {
      if (taken.has(takenKey(s, ip)) || staticIps.has(ip) || blocked.has(ip) || reserved(s, ip))
        continue;
      c.lease = makeLease(c, s, ip, true);
      break;
    }
  }

  // 5. DNS que recibe cada cliente. Sin servidores en la red, algunos sistemas
  // entregan los del propio servidor, que a su vez pueden venir de su cliente DHCP.
  const resolving = new Set<DeviceId>();
  const clientDns = (c: ClientCtx): readonly Ipv4[] => {
    const s = c.server;
    const lease = c.lease;
    const network = s && lease ? networkFor(s.device, lease.ip) : undefined;
    if (!s || !network) return [];
    if (network.dnsServers.length > 0 || !s.device.traits.dhcpDnsFallback)
      return network.dnsServers;
    return serverDns(s.device);
  };
  const serverDns = (device: Device): readonly Ipv4[] => {
    const result = [...device.config.dns.servers];
    // Un ciclo de servidores que se remiten entre sí se corta en sus DNS estáticos.
    if (resolving.has(device.id)) return result;
    resolving.add(device.id);
    for (const c of clients) {
      if (c.device.id !== device.id || !c.client.usePeerDns) continue;
      for (const ip of clientDns(c)) if (!result.includes(ip)) result.push(ip);
    }
    resolving.delete(device.id);
    return result;
  };

  const leases = new Map<DeviceId, DhcpLease[]>();
  const statuses = new Map<DeviceId, DhcpClientStatus[]>();
  const fresh: { device: DeviceId; lease: DhcpLease }[] = [];
  const exhausted: { device: DeviceId; server: ItemId; pool: ItemId }[] = [];
  for (const c of clients) {
    const s = c.server;
    const lease = c.lease;
    const pool = s ? poolOf(s) : undefined;
    let status: DhcpClientStatus;
    if (s && lease) {
      leases.set(s.device.id, [...(leases.get(s.device.id) ?? []), lease]);
      const existed = s.device.oper.dhcpLeases.some(
        (l) => l.server === lease.server && l.mac === lease.mac && l.ip === lease.ip,
      );
      if (!existed) fresh.push({ device: s.device.id, lease });
      const network = networkFor(s.device, lease.ip);
      status = {
        client: c.client.id,
        status: 'bound',
        server: s.ref,
        address: { ip: lease.ip, len: prefixLenFor(s, lease.ip) },
        ...(network?.gateway === undefined ? {} : { gateway: network.gateway }),
        dns: clientDns(c),
        expiresAt: lease.expiresAt,
      };
    } else if (s && pool !== undefined) {
      // Hay servidor pero ninguna dirección libre: el pool está agotado.
      status = { client: c.client.id, status: 'searching', dns: [], exhausted: s.ref };
      const previous = c.device.oper.dhcpClients.find((x) => x.client === c.client.id)?.exhausted;
      const already = previous?.device === s.ref.device && previous.iface === s.ref.iface;
      if (!already) exhausted.push({ device: s.device.id, server: s.server.id, pool });
    } else {
      status = { client: c.client.id, status: 'searching', dns: [] };
    }
    statuses.set(c.device.id, [...(statuses.get(c.device.id) ?? []), status]);
  }

  return { leases, clients: statuses, fresh, exhausted };
}

/** Pool del que reparte el servidor, si existe (no es solo de leases estáticos). */
function poolOf(s: ServerCtx): ItemId | undefined {
  const pool = s.server.pool;
  if (pool === 'static-only') return undefined;
  return s.device.config.dhcpServer.pools.some((p) => p.id === pool) ? pool : undefined;
}
