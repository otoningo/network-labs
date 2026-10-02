/**
 * `converge(network)` recalcula el estado operativo derivado de todos los
 * dispositivos a partir de la configuración de la red completa. Es una función
 * pura, determinista e idempotente: converge(converge(n)) da lo mismo que converge(n).
 * Los datos de ejecución (contadores, caché DNS, conntrack, log) se conservan.
 */
import type { DeviceId, ItemId } from '../model/brand';
import { COLLECTION_KEYS } from '../model/collections';
import { portKey } from '../model/lookup';
import type { Device, Network, PortRef } from '../model/network';
import {
  type ArpEntry,
  type BridgeHost,
  type DeviceOper,
  type DhcpClientStatus,
  type DynamicAddress,
  type InterfaceOper,
  type InvalidItem,
  LOG_LIMIT,
  type LogEntry,
  type Neighbor,
  type VlanMembership,
  type WifiRegistration,
  ZERO_COUNTERS,
} from '../model/oper';
import { type Ipv4, networkOf, prefixContains } from '../net/ipv4';
import { stableHash } from '../net/mac';
import { type CollectionSpec, specOf } from '../ops/registry';
import { computeDhcp, type DhcpResult } from './dhcp';
import { createL2, type L2, type L2Learn } from './l2';
import { computeLinkState, type LinkState } from './links';
import { interfaceListMembers } from './lists';
import { computeRib, type IfaceAddress } from './routing';

interface Context {
  readonly net: Network;
  readonly links: LinkState;
  readonly l2: L2;
  readonly dhcp: DhcpResult;
  readonly addresses: ReadonlyMap<DeviceId, readonly IfaceAddress[]>;
  readonly learned: ReadonlyMap<DeviceId, readonly L2Learn[]>;
}

/** Direcciones IP configuradas (habilitadas) en cualquier equipo: el DHCP no las reparte. */
function staticIps(net: Network): Set<number> {
  const ips = new Set<number>();
  for (const device of net.devices) {
    for (const a of device.config.addressing.addresses) if (!a.disabled) ips.add(a.address.ip);
  }
  return ips;
}

/** Direcciones efectivas de cada extremo: configuradas en interfaces no esclavas + obtenidas por DHCP. */
function endpointAddresses(
  device: Device,
  l2: L2,
  dhcp: readonly DhcpClientStatus[],
): IfaceAddress[] {
  const ifaces = new Set(device.config.interfaces.map((i) => i.id));
  const result: IfaceAddress[] = [];
  for (const a of device.config.addressing.addresses) {
    if (a.disabled || !ifaces.has(a.iface) || l2.isSlave({ device: device.id, iface: a.iface }))
      continue;
    result.push({ iface: a.iface, address: a.address, source: a.id, dynamic: false });
  }
  for (const status of dhcp) {
    const client = device.config.addressing.dhcpClients.find((c) => c.id === status.client);
    if (status.status !== 'bound' || !status.address || !client) continue;
    result.push({ iface: client.iface, address: status.address, source: client.id, dynamic: true });
  }
  return result;
}

function interfaceOpers(device: Device, ctx: Context): InterfaceOper[] {
  return device.config.interfaces.map((iface) => {
    const ref = { device: device.id, iface: iface.id };
    const previous = device.oper.interfaces.find((i) => i.iface === iface.id);
    const ap =
      iface.kind === 'wireless' && iface.mode === 'station'
        ? ctx.links.wifiPeers(ref)[0]
        : undefined;
    return {
      iface: iface.id,
      linkUp: ctx.links.isLinkUp(ref),
      running: ctx.links.isRunning(ref),
      ...(ap ? { wifiAp: ap } : {}),
      rx: previous?.rx ?? ZERO_COUNTERS,
      tx: previous?.tx ?? ZERO_COUNTERS,
      rateBps: previous?.rateBps ?? { rx: 0, tx: 0 },
    };
  });
}

function arpTable(device: Device, ctx: Context): ArpEntry[] {
  const own = ctx.addresses.get(device.id) ?? [];
  const entries: ArpEntry[] = [];
  const seen = new Set<string>();
  for (const s of device.config.addressing.staticArp) {
    if (s.disabled) continue;
    entries.push({ ip: s.ip, mac: s.mac, iface: s.iface, origin: 'static', complete: true });
    seen.add(`${s.iface}|${s.ip}`);
  }
  const endpoints = [...new Set(own.map((a) => a.iface))];
  for (const iface of endpoints) {
    const here: PortRef = { device: device.id, iface };
    const subnets = own.filter((a) => a.iface === iface).map((a) => networkOf(a.address));
    for (const peer of ctx.l2.flood(here).reached.values()) {
      if (peer.device === device.id || !ctx.l2.mutual(here, peer)) continue;
      const peerDevice = ctx.net.devices.find((d) => d.id === peer.device);
      const peerIface = peerDevice?.config.interfaces.find((i) => i.id === peer.iface);
      if (!peerIface) continue;
      for (const a of ctx.addresses.get(peer.device) ?? []) {
        if (a.iface !== peer.iface || !subnets.some((s) => prefixContains(s, a.address.ip)))
          continue;
        const key = `${iface}|${a.address.ip}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          ip: a.address.ip,
          mac: peerIface.mac,
          iface,
          origin: 'dynamic',
          complete: true,
        });
      }
    }
  }
  return entries;
}

function bridgeHosts(device: Device, ctx: Context): BridgeHost[] {
  const hosts: BridgeHost[] = [];
  const seen = new Set<string>();
  const ifaces = device.config.interfaces;
  for (const port of device.config.bridging.ports) {
    const bridge = ifaces.find((i) => i.id === port.bridge);
    const member = ifaces.find((i) => i.id === port.iface);
    if (port.disabled || bridge?.kind !== 'bridge' || !member) continue;
    const vlanId = bridge.vlanFiltering ? port.pvid : null;
    seen.add(`${bridge.id}|${member.mac}|${vlanId}`);
    hosts.push({ bridge: bridge.id, mac: member.mac, port: port.iface, vlanId, local: true });
  }
  for (const learn of ctx.learned.get(device.id) ?? []) {
    const key = `${learn.bridge}|${learn.mac}|${learn.vlanId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hosts.push({
      bridge: learn.bridge,
      mac: learn.mac,
      port: learn.port,
      vlanId: learn.vlanId,
      local: false,
    });
  }
  return hosts;
}

function vlanMembership(device: Device): VlanMembership[] {
  const result: VlanMembership[] = [];
  const { interfaces, bridging } = device.config;
  for (const bridge of interfaces) {
    if (bridge.kind !== 'bridge' || !bridge.vlanFiltering) continue;
    const entries = bridging.vlans.filter((v) => !v.disabled && v.bridge === bridge.id);
    const ports = bridging.ports.filter((p) => !p.disabled && p.bridge === bridge.id);
    const vlanIds = new Set<number>([
      bridge.pvid,
      ...ports.map((p) => p.pvid),
      ...entries.flatMap((e) => e.vlanIds),
    ]);
    for (const vlanId of [...vlanIds].sort((a, b) => a - b)) {
      const configured = entries.filter((e) => e.vlanIds.includes(vlanId));
      const tagged = [...new Set(configured.flatMap((e) => e.tagged))];
      const untagged = new Set(configured.flatMap((e) => e.untagged));
      for (const p of ports)
        if (p.pvid === vlanId && !tagged.includes(p.iface)) untagged.add(p.iface);
      if (bridge.pvid === vlanId && !tagged.includes(bridge.id)) untagged.add(bridge.id);
      result.push({
        bridge: bridge.id,
        vlanId,
        tagged,
        untagged: [...untagged],
        dynamic: configured.length === 0,
      });
    }
  }
  return result;
}

function inDiscoveryScope(device: Device, iface: ItemId): boolean {
  if (device.config.discovery.protocols.length === 0) return false;
  const members = interfaceListMembers(device.config, device.config.discovery.interfaceList);
  return members === 'all' || members.has(iface);
}

function neighbors(device: Device, ctx: Context): Neighbor[] {
  const result: Neighbor[] = [];
  const seen = new Set<string>();
  for (const iface of device.config.interfaces) {
    const here: PortRef = { device: device.id, iface: iface.id };
    if (!inDiscoveryScope(device, iface.id) || ctx.l2.isSlave(here) || !ctx.links.isRunning(here))
      continue;
    for (const peer of ctx.l2.flood(here).reached.values()) {
      if (peer.device === device.id || !ctx.l2.mutual(here, peer)) continue;
      const peerDevice = ctx.net.devices.find((d) => d.id === peer.device);
      const peerIface = peerDevice?.config.interfaces.find((i) => i.id === peer.iface);
      if (!peerDevice || !peerIface || !inDiscoveryScope(peerDevice, peer.iface)) continue;
      const protocol = device.config.discovery.protocols.find((p) =>
        peerDevice.config.discovery.protocols.includes(p),
      );
      const key = `${iface.id}|${peer.device}|${peer.iface}`;
      if (!protocol || seen.has(key)) continue;
      seen.add(key);
      const address = (ctx.addresses.get(peer.device) ?? []).find((a) => a.iface === peer.iface)
        ?.address.ip;
      result.push({
        iface: iface.id,
        peer: peer.device,
        peerIface: peerIface.name,
        identity: peerDevice.config.system.identity,
        ...(address === undefined ? {} : { address }),
        mac: peerIface.mac,
        os: peerDevice.os,
        protocol,
      });
    }
  }
  return result;
}

function wifiRegistrations(device: Device, ctx: Context): WifiRegistration[] {
  const result: WifiRegistration[] = [];
  for (const assoc of ctx.links.associations) {
    if (assoc.ap.device !== device.id) continue;
    const station = ctx.net.devices.find((d) => d.id === assoc.station.device);
    const stationIface = station?.config.interfaces.find((i) => i.id === assoc.station.iface);
    if (!stationIface) continue;
    const previous = device.oper.wifiRegistrations.find(
      (r) => r.iface === assoc.ap.iface && r.mac === stationIface.mac,
    );
    const hash = stableHash(`${portKey(assoc.ap.device, assoc.ap.iface)}>${stationIface.mac}`);
    result.push({
      iface: assoc.ap.iface,
      client: assoc.station,
      mac: stationIface.mac,
      signalDbm: -42 - (hash % 28),
      since: previous?.since ?? ctx.net.now,
    });
  }
  return result;
}

function invalidItems(device: Device, ctx: Context): InvalidItem[] {
  const result: InvalidItem[] = [];
  const config = device.config;
  for (const key of COLLECTION_KEYS) {
    const spec: CollectionSpec<typeof key> = specOf(key);
    for (const item of spec.get(config)) {
      const dangling = spec.refs(item).some(
        (ref) =>
          !specOf(ref.coll)
            .get(config)
            .some((t) => t.id === ref.id),
      );
      if (dangling) result.push({ coll: key, id: item.id, reason: 'dangling-ref' });
    }
  }
  const slave = (iface: ItemId) => ctx.l2.isSlave({ device: device.id, iface });
  for (const a of config.addressing.addresses) {
    if (slave(a.iface)) result.push({ coll: 'addresses', id: a.id, reason: 'slave-port' });
  }
  for (const s of config.dhcpServer.servers) {
    if (slave(s.iface)) result.push({ coll: 'dhcpServers', id: s.id, reason: 'slave-port' });
  }
  for (const c of config.addressing.dhcpClients) {
    if (slave(c.iface)) result.push({ coll: 'dhcpClients', id: c.id, reason: 'slave-port' });
  }
  return result;
}

function buildOper(device: Device, ctx: Context): DeviceOper {
  const statuses = ctx.dhcp.clients.get(device.id) ?? [];
  const clientOf = (id: ItemId) => device.config.addressing.dhcpClients.find((c) => c.id === id);

  const dynamicAddresses: DynamicAddress[] = [];
  const dhcpRoutes: { client: ItemId; gateway: Ipv4; distance: number }[] = [];
  const dynamicDns: Ipv4[] = [];
  for (const status of statuses) {
    const client = clientOf(status.client);
    if (!client || status.status !== 'bound' || !status.address) continue;
    dynamicAddresses.push({
      iface: client.iface,
      address: status.address,
      origin: 'dhcp',
      client: client.id,
    });
    if (client.addDefaultRoute && status.gateway !== undefined) {
      dhcpRoutes.push({
        client: client.id,
        gateway: status.gateway,
        distance: client.routeDistance,
      });
    }
    if (client.usePeerDns)
      for (const dns of status.dns) if (!dynamicDns.includes(dns)) dynamicDns.push(dns);
  }

  const rib = computeRib({
    addresses: ctx.addresses.get(device.id) ?? [],
    routes: device.config.routing.static,
    dhcpRoutes,
    isRunning: (iface) => ctx.links.isRunning({ device: device.id, iface }),
  });

  const newLeases: LogEntry[] = ctx.dhcp.fresh
    .filter((f) => f.device === device.id)
    .map((f) => ({
      at: ctx.net.now,
      event: { kind: 'dhcp-assigned', server: f.lease.server, ip: f.lease.ip, mac: f.lease.mac },
    }));

  return {
    interfaces: interfaceOpers(device, ctx),
    dynamicAddresses,
    dynamicDnsServers: dynamicDns,
    rib,
    arp: arpTable(device, ctx),
    bridgeHosts: bridgeHosts(device, ctx),
    vlanMembership: vlanMembership(device),
    dhcpLeases: ctx.dhcp.leases.get(device.id) ?? [],
    dhcpClients: statuses,
    neighbors: neighbors(device, ctx),
    wifiRegistrations: wifiRegistrations(device, ctx),
    invalid: invalidItems(device, ctx),
    dnsCache: device.oper.dnsCache,
    conntrack: device.oper.conntrack,
    ruleCounters: device.oper.ruleCounters,
    log:
      newLeases.length === 0
        ? device.oper.log
        : [...device.oper.log, ...newLeases].slice(-LOG_LIMIT),
  };
}

export function converge(net: Network): Network {
  const links = computeLinkState(net);
  const l2 = createL2(net, links);
  const dhcp = computeDhcp(net, links, l2, staticIps(net));

  const addresses = new Map<DeviceId, IfaceAddress[]>();
  for (const device of net.devices) {
    addresses.set(device.id, endpointAddresses(device, l2, dhcp.clients.get(device.id) ?? []));
  }

  // Los extremos con dirección "hablan": sus tramas enseñan MACs a los bridges.
  const learned = new Map<DeviceId, L2Learn[]>();
  for (const [deviceId, list] of addresses) {
    for (const iface of new Set(list.map((a) => a.iface))) {
      for (const learn of l2.flood({ device: deviceId, iface }).learned) {
        learned.set(learn.device, [...(learned.get(learn.device) ?? []), learn]);
      }
    }
  }

  const ctx: Context = { net, links, l2, dhcp, addresses, learned };
  return {
    ...net,
    devices: net.devices.map((device) => ({ ...device, oper: buildOper(device, ctx) })),
  };
}
