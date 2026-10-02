/**
 * Constructor de redes para pruebas. Usa solo operaciones públicas del núcleo,
 * así que cada prueba ejercita el mismo camino que usarán los drivers.
 */
import { BOARDS } from '../device/boards';
import { createDevice } from '../device/factory';
import { HOST_PLATFORM, INTERNET_PLATFORM, type PlatformSpec } from '../device/platform';
import { converge } from '../engine/converge';
import { deviceId, type ItemId, simTime } from '../model/brand';
import type { CollectionKey, ItemOf, NewItem } from '../model/collections';
import type { FilterAction, Match, NatAction } from '../model/config';
import { interfaceByName } from '../model/lookup';
import type { Device, Flow, Link, Network, PortRef, Scenario } from '../model/network';
import { type Ipv4, ipv4, parseIpv4, prefix, range } from '../net/ipv4';
import { deterministicMac } from '../net/mac';
import { type ApplyPolicy, applyOp, findItem, type Op } from '../ops/apply';
import { specOf } from '../ops/registry';
import { TEST_ROUTER_PLATFORM } from './platforms';

export interface Helper {
  readonly device: Device;
  iface(name: string): ItemId;
  find<K extends CollectionKey>(coll: K, predicate: (item: ItemOf<K>) => boolean): ItemId;
}

export class NetBuilder {
  private devices: Device[] = [];
  private links: Link[] = [];
  private scenario: Scenario = { flows: [] };
  private now = 0;

  private create(id: string, board: string, platform: PlatformSpec): this {
    const hw = BOARDS[board];
    if (!hw) throw new Error(`placa desconocida ${board}`);
    const result = createDevice(deviceId(id), hw, platform);
    if (!result.ok) throw new Error(`no se pudo crear ${id}`);
    this.devices.push(result.value);
    return this;
  }

  router(id: string, board = 'sim-r5w', platform: PlatformSpec = TEST_ROUTER_PLATFORM): this {
    return this.create(id, board, platform);
  }

  host(id: string, board = 'sim-host'): this {
    return this.create(id, board, HOST_PLATFORM);
  }

  cloud(id: string): this {
    return this.create(id, 'sim-cloud', INTERNET_PLATFORM);
  }

  private device(id: string): Device {
    const found = this.devices.find((d) => d.id === id);
    if (!found) throw new Error(`no existe el dispositivo ${id}`);
    return found;
  }

  private helper(device: Device): Helper {
    return {
      device,
      iface: (name) => {
        const iface = interfaceByName(device.config, name);
        if (!iface) throw new Error(`${device.id} no tiene ${name}`);
        return iface.id;
      },
      find: (coll, predicate) => {
        const item = specOf(coll).get(device.config).find(predicate);
        if (!item) throw new Error(`${device.id}: no hay ítem en ${coll}`);
        return item.id;
      },
    };
  }

  port(spec: string): PortRef {
    const [dev, name] = spec.split(':');
    if (!dev || !name) throw new Error(`puerto inválido ${spec}`);
    return { device: deviceId(dev), iface: this.helper(this.device(dev)).iface(name) };
  }

  link(a: string, b: string, up = true): this {
    this.links.push({ id: `${a}<->${b}`, a: this.port(a), b: this.port(b), up });
    return this;
  }

  op(id: string, make: (h: Helper) => Op | readonly Op[], policy?: ApplyPolicy): this {
    const made = make(this.helper(this.device(id)));
    const ops: readonly Op[] = Array.isArray(made) ? made : [made as Op];
    for (const op of ops) {
      const current = this.device(id);
      const result = applyOp(current, op, policy);
      if (!result.ok) throw new Error(`${id}: ${op.op} falló: ${JSON.stringify(result.error)}`);
      this.devices = this.devices.map((d) => (d.id === current.id ? result.value.device : d));
    }
    return this;
  }

  add<K extends CollectionKey>(id: string, coll: K, make: (h: Helper) => NewItem<K>): this {
    return this.op(id, (h) => ({ op: 'add', coll, item: make(h) }) as Op);
  }

  // ── Atajos ────────────────────────────────────────────────────────────────

  enable(id: string, iface: string, disabled = false): this {
    return this.op(id, (h) => ({
      op: 'set',
      coll: 'interfaces',
      id: h.iface(iface),
      patch: { disabled },
    }));
  }

  address(id: string, iface: string, cidr: string): this {
    return this.add(id, 'addresses', (h) => ({
      iface: h.iface(iface),
      address: prefix(cidr),
      disabled: false,
    }));
  }

  bridge(
    id: string,
    name: string,
    ports: readonly string[],
    opts: { vlanFiltering?: boolean; pvid?: number } = {},
  ): this {
    this.add(id, 'interfaces', () => ({
      kind: 'bridge',
      name,
      mtu: 1500,
      mac: deterministicMac(`${id}:${name}`, 0),
      disabled: false,
      vlanFiltering: opts.vlanFiltering ?? false,
      stp: 'rstp',
      pvid: opts.pvid ?? 1,
    }));
    for (const port of ports) this.bridgePort(id, name, port);
    return this;
  }

  bridgePort(
    id: string,
    bridge: string,
    iface: string,
    opts: {
      pvid?: number;
      frameTypes?: 'all' | 'untagged-only' | 'tagged-only';
      ingressFiltering?: boolean;
    } = {},
  ): this {
    return this.add(id, 'bridgePorts', (h) => ({
      bridge: h.iface(bridge),
      iface: h.iface(iface),
      pvid: opts.pvid ?? 1,
      frameTypes: opts.frameTypes ?? 'all',
      ingressFiltering: opts.ingressFiltering ?? true,
      disabled: false,
    }));
  }

  bridgeVlan(
    id: string,
    bridge: string,
    vlanIds: readonly number[],
    tagged: readonly string[],
    untagged: readonly string[] = [],
  ): this {
    return this.add(id, 'bridgeVlans', (h) => ({
      bridge: h.iface(bridge),
      vlanIds,
      tagged: tagged.map(h.iface),
      untagged: untagged.map(h.iface),
      disabled: false,
    }));
  }

  vlan(id: string, name: string, parent: string, vlanId: number): this {
    return this.add(id, 'interfaces', (h) => ({
      kind: 'vlan',
      name,
      mtu: 1500,
      mac:
        h.device.config.interfaces.find((i) => i.id === h.iface(parent))?.mac ??
        deterministicMac(`${id}:${name}`, 0),
      disabled: false,
      vlanId,
      parent: h.iface(parent),
    }));
  }

  dhcpClient(
    id: string,
    iface: string,
    opts: { defaultRoute?: boolean; peerDns?: boolean; distance?: number } = {},
  ): this {
    return this.add(id, 'dhcpClients', (h) => ({
      iface: h.iface(iface),
      addDefaultRoute: opts.defaultRoute ?? true,
      routeDistance: opts.distance ?? 1,
      usePeerDns: opts.peerDns ?? true,
      disabled: false,
    }));
  }

  dhcpServer(
    id: string,
    opts: {
      iface: string;
      pool: string;
      network: string;
      gateway?: string;
      dns?: readonly string[];
      leaseTimeS?: number;
      name?: string;
    },
  ): this {
    const name = opts.name ?? `dhcp-${opts.iface}`;
    this.add(id, 'pools', () => ({
      name: `${name}-pool`,
      ranges: opts.pool.split(',').map(range),
      disabled: false,
    }));
    this.add(id, 'dhcpServers', (h) => ({
      name,
      iface: h.iface(opts.iface),
      pool: h.find('pools', (p) => p.name === `${name}-pool`),
      leaseTimeS: opts.leaseTimeS ?? 600,
      authoritative: true,
      disabled: false,
    }));
    const net = prefix(opts.network);
    const existing = this.device(id).config.dhcpServer.networks.some(
      (n) => n.prefix.ip === net.ip && n.prefix.len === net.len,
    );
    if (existing) return this;
    return this.add(id, 'dhcpNetworks', () => ({
      prefix: net,
      ...(opts.gateway === undefined ? {} : { gateway: ipv4(opts.gateway) }),
      dnsServers: (opts.dns ?? []).map(ipv4),
      disabled: false,
    }));
  }

  /** `via` puede ser una IP o el nombre de una interfaz; `blackhole` crea una ruta descarte. */
  route(id: string, dst: string, via: string, distance = 1): this {
    return this.add(id, 'routes', (h) => {
      const ip = parseIpv4(via);
      const gateway =
        via === 'blackhole'
          ? ({ kind: 'blackhole' } as const)
          : ip === null
            ? ({ kind: 'iface', iface: h.iface(via) } as const)
            : ({ kind: 'ip', ip } as const);
      return { dst: prefix(dst), gateway, distance, table: 'main', disabled: false };
    });
  }

  filter(
    id: string,
    chain: string,
    action: FilterAction,
    match: (h: Helper) => Match = () => ({}),
    extra: { log?: boolean; comment?: string } = {},
  ): this {
    return this.add(id, 'filterRules', (h) => ({
      chain,
      match: match(h),
      action,
      log: extra.log ?? false,
      disabled: false,
      ...(extra.comment === undefined ? {} : { comment: extra.comment }),
    }));
  }

  nat(
    id: string,
    chain: 'srcnat' | 'dstnat',
    action: NatAction,
    match: (h: Helper) => Match = () => ({}),
  ): this {
    return this.add(id, 'natRules', (h) => ({ chain, match: match(h), action, disabled: false }));
  }

  masquerade(id: string, outIface: string): this {
    return this.nat(id, 'srcnat', { kind: 'masquerade' }, (h) => ({
      outInterface: { value: h.iface(outIface), negate: false },
    }));
  }

  interfaceList(id: string, name: string, members: readonly string[]): this {
    this.add(id, 'interfaceLists', () => ({ name, include: [], disabled: false }));
    for (const member of members) {
      this.add(id, 'interfaceListMembers', (h) => ({
        list: h.find('interfaceLists', (l) => l.name === name),
        iface: h.iface(member),
        disabled: false,
      }));
    }
    return this;
  }

  wifi(id: string, iface: string, mode: 'ap' | 'station', ssid: string, passphrase?: string): this {
    return this.op(id, (h) => ({
      op: 'set',
      coll: 'interfaces',
      id: h.iface(iface),
      patch: {
        disabled: false,
        mode,
        ssid,
        security:
          passphrase === undefined ? { auth: ['open'] } : { auth: ['wpa2-psk'], passphrase },
      },
    }));
  }

  dns(id: string, servers: readonly string[], allowRemoteRequests = false): this {
    return this.op(id, () => ({
      op: 'setSingleton',
      key: 'dns',
      patch: { servers: servers.map(ipv4), allowRemoteRequests },
    }));
  }

  service(
    id: string,
    name: 'ssh' | 'http' | 'telnet' | 'https',
    port: number,
    allowedFrom: readonly string[] = [],
  ): this {
    return this.add(id, 'services', () => ({
      name,
      port,
      allowedFrom: allowedFrom.map(prefix),
      disabled: false,
    }));
  }

  internet(
    id: string,
    opts: {
      answers?: readonly string[];
      tcpPorts?: readonly number[];
      dns?: Readonly<Record<string, string>>;
    } = {},
  ): this {
    this.scenario = {
      ...this.scenario,
      internet: {
        device: deviceId(id),
        answers: (opts.answers ?? ['0.0.0.0/0']).map(prefix),
        tcpPorts: opts.tcpPorts ?? [80, 443],
        dns: Object.entries(opts.dns ?? {}).map(([name, address]) => ({
          name,
          address: ipv4(address),
        })),
      },
    };
    return this;
  }

  flow(flow: Omit<Flow, 'from' | 'to'> & { from: string; to: string }): this {
    const full: Flow = { ...flow, from: deviceId(flow.from), to: ipv4(flow.to) as Ipv4 };
    this.scenario = { ...this.scenario, flows: [...this.scenario.flows, full] };
    return this;
  }

  at(seconds: number): this {
    this.now = seconds;
    return this;
  }

  raw(): Network {
    return {
      devices: this.devices,
      links: this.links,
      scenario: this.scenario,
      now: simTime(this.now),
    };
  }

  build(): Network {
    return converge(this.raw());
  }
}

export const net = (): NetBuilder => new NetBuilder();

/** Busca un ítem por id en una red ya construida. */
export function itemIn<K extends CollectionKey>(
  network: Network,
  device: string,
  coll: K,
  id: ItemId,
): ItemOf<K> | undefined {
  const d = network.devices.find((x) => x.id === device);
  return d ? findItem(d.config, coll, id) : undefined;
}

export function deviceIn(network: Network, id: string): Device {
  const d = network.devices.find((x) => x.id === id);
  if (!d) throw new Error(`no existe ${id}`);
  return d;
}

export function ifaceIn(network: Network, device: string, name: string): ItemId {
  const iface = interfaceByName(deviceIn(network, device).config, name);
  if (!iface) throw new Error(`${device} no tiene ${name}`);
  return iface.id;
}
