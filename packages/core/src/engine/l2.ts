/**
 * Capa 2. Responde "¿a qué extremos L3 llega una trama de difusión enviada
 * desde este extremo?" siguiendo cables, asociaciones wifi, bridges con o sin
 * filtrado de VLAN y subinterfaces 802.1Q. De paso registra qué MAC aprende cada
 * bridge en qué puerto, que es la tabla de hosts.
 *
 * La búsqueda es dirigida: con un pvid mal puesto, A puede llegar a B sin que B
 * llegue a A. Por eso ARP y DHCP exigen alcance mutuo.
 */
import type { DeviceId, ItemId } from '../model/brand';
import type { BridgeInterface, BridgePort, Interface, VlanInterface } from '../model/config';
import { portKey } from '../model/lookup';
import type { Device, Network, PortRef } from '../model/network';
import type { Mac } from '../net/mac';
import type { LinkState } from './links';

export interface L2Learn {
  readonly device: DeviceId;
  readonly bridge: ItemId;
  readonly port: ItemId;
  readonly vlanId: number | null;
  readonly mac: Mac;
}

export interface Flood {
  /** Extremos L3 alcanzados, indexados por `portKey`. No incluye el origen. */
  readonly reached: ReadonlyMap<string, PortRef>;
  readonly learned: readonly L2Learn[];
}

export interface L2 {
  /** Puerto de bridge activo al que pertenece la interfaz, si es esclava. */
  bridgePortOf(ref: PortRef): BridgePort | undefined;
  isSlave(ref: PortRef): boolean;
  flood(from: PortRef): Flood;
  /** Alcance en ambos sentidos. */
  mutual(a: PortRef, b: PortRef): boolean;
}

type Tag = number | null;
type Egress = 'tagged' | 'untagged' | null;

interface Walk {
  readonly sourceMac: Mac;
  readonly reached: Map<string, PortRef>;
  readonly learned: L2Learn[];
  readonly seen: Set<string>;
}

export function createL2(net: Network, links: LinkState): L2 {
  const devices = new Map(net.devices.map((d) => [d.id, d]));
  const slaves = new Map<string, BridgePort>();
  const portsByBridge = new Map<string, BridgePort[]>();
  const vlanSubs = new Map<string, VlanInterface[]>();

  for (const device of net.devices) {
    const ifaces = device.config.interfaces;
    for (const port of device.config.bridging.ports) {
      if (port.disabled) continue;
      const bridge = ifaces.find((i) => i.id === port.bridge);
      const member = ifaces.find((i) => i.id === port.iface);
      if (bridge?.kind !== 'bridge' || !member) continue;
      slaves.set(portKey(device.id, port.iface), port);
      const key = portKey(device.id, port.bridge);
      portsByBridge.set(key, [...(portsByBridge.get(key) ?? []), port]);
    }
    for (const iface of ifaces) {
      if (iface.kind !== 'vlan') continue;
      const key = portKey(device.id, iface.parent);
      vlanSubs.set(key, [...(vlanSubs.get(key) ?? []), iface]);
    }
  }

  const ifaceOf = (device: Device, id: ItemId): Interface | undefined =>
    device.config.interfaces.find((i) => i.id === id);
  const running = (device: Device, iface: Interface): boolean =>
    links.isRunning({ device: device.id, iface: iface.id });

  /** Membresía configurada de una interfaz (puerto o el propio bridge) en una VLAN. */
  const configured = (device: Device, bridge: ItemId, iface: ItemId, vlan: number): Egress => {
    for (const entry of device.config.bridging.vlans) {
      if (entry.disabled || entry.bridge !== bridge || !entry.vlanIds.includes(vlan)) continue;
      if (entry.tagged.includes(iface)) return 'tagged';
      if (entry.untagged.includes(iface)) return 'untagged';
    }
    return null;
  };

  const egressOf = (device: Device, port: BridgePort, vlan: number): Egress =>
    configured(device, port.bridge, port.iface, vlan) ?? (port.pvid === vlan ? 'untagged' : null);

  const visit = (w: Walk, phase: string, device: Device, iface: ItemId, tag: Tag): boolean => {
    const key = `${phase}|${device.id}|${iface}|${tag ?? '-'}`;
    if (w.seen.has(key)) return false;
    w.seen.add(key);
    return true;
  };

  const deliver = (w: Walk, device: Device, iface: Interface): void => {
    w.reached.set(portKey(device.id, iface.id), { device: device.id, iface: iface.id });
  };

  // ── Recorrido ─────────────────────────────────────────────────────────────

  function transmit(w: Walk, device: Device, iface: Interface, tag: Tag): void {
    if (!running(device, iface) || !visit(w, 'tx', device, iface.id, tag)) return;
    switch (iface.kind) {
      case 'ethernet':
        for (const peer of links.linkPeers({ device: device.id, iface: iface.id }))
          receiveAt(w, peer, tag);
        return;
      case 'wireless':
        for (const peer of links.wifiPeers({ device: device.id, iface: iface.id }))
          receiveAt(w, peer, tag);
        return;
      case 'vlan': {
        // QinQ fuera de alcance: una VLAN no reetiqueta tramas ya etiquetadas.
        if (tag !== null) return;
        const parent = ifaceOf(device, iface.parent);
        if (parent) transmit(w, device, parent, iface.vlanId);
        return;
      }
      case 'bridge':
        fromCpu(w, device, iface, tag);
        return;
      case 'loopback':
        return;
    }
  }

  function receiveAt(w: Walk, ref: PortRef, tag: Tag): void {
    const device = devices.get(ref.device);
    const iface = device && ifaceOf(device, ref.iface);
    if (device && iface) receive(w, device, iface, tag);
  }

  function receive(w: Walk, device: Device, iface: Interface, tag: Tag): void {
    if (!running(device, iface) || !visit(w, 'rx', device, iface.id, tag)) return;
    // Un punto de acceso reenvía entre sus clientes.
    if (iface.kind === 'wireless' && iface.mode === 'ap') {
      for (const peer of links.wifiPeers({ device: device.id, iface: iface.id }))
        receiveAt(w, peer, tag);
    }
    const port = slaves.get(portKey(device.id, iface.id));
    if (port) {
      bridgeIngress(w, device, port, tag);
      return;
    }
    if (tag === null) {
      deliver(w, device, iface);
      return;
    }
    for (const sub of vlanSubs.get(portKey(device.id, iface.id)) ?? []) {
      if (sub.vlanId === tag && !sub.disabled) receive(w, device, sub, null);
    }
  }

  function bridgeOf(device: Device, port: BridgePort): BridgeInterface | undefined {
    const bridge = ifaceOf(device, port.bridge);
    return bridge?.kind === 'bridge' && running(device, bridge) ? bridge : undefined;
  }

  function memberIfaces(
    device: Device,
    bridge: BridgeInterface,
  ): { port: BridgePort; iface: Interface }[] {
    const result: { port: BridgePort; iface: Interface }[] = [];
    for (const port of portsByBridge.get(portKey(device.id, bridge.id)) ?? []) {
      const iface = ifaceOf(device, port.iface);
      if (iface) result.push({ port, iface });
    }
    return result;
  }

  function bridgeIngress(w: Walk, device: Device, port: BridgePort, tag: Tag): void {
    const bridge = bridgeOf(device, port);
    if (!bridge) return;
    if (!bridge.vlanFiltering) {
      w.learned.push({
        device: device.id,
        bridge: bridge.id,
        port: port.iface,
        vlanId: null,
        mac: w.sourceMac,
      });
      for (const member of memberIfaces(device, bridge)) {
        if (member.port.iface !== port.iface) transmit(w, device, member.iface, tag);
      }
      toCpu(w, device, bridge, tag);
      return;
    }
    let vlan: number;
    if (tag === null) {
      if (port.frameTypes === 'tagged-only') return;
      vlan = port.pvid;
    } else {
      if (port.frameTypes === 'untagged-only') return;
      vlan = tag;
    }
    if (port.ingressFiltering && egressOf(device, port, vlan) === null) return;
    w.learned.push({
      device: device.id,
      bridge: bridge.id,
      port: port.iface,
      vlanId: vlan,
      mac: w.sourceMac,
    });
    for (const member of memberIfaces(device, bridge)) {
      if (member.port.iface === port.iface) continue;
      const egress = egressOf(device, member.port, vlan);
      if (egress) transmit(w, device, member.iface, egress === 'tagged' ? vlan : null);
    }
    toCpuFiltered(w, device, bridge, vlan);
  }

  /** Trama que sube a la CPU por un bridge sin filtrado de VLAN. */
  function toCpu(w: Walk, device: Device, bridge: BridgeInterface, tag: Tag): void {
    if (tag === null) {
      deliver(w, device, bridge);
      return;
    }
    for (const sub of vlanSubs.get(portKey(device.id, bridge.id)) ?? []) {
      if (sub.vlanId === tag && !sub.disabled) receive(w, device, sub, null);
    }
  }

  /** Con filtrado: la CPU recibe sin etiqueta su pvid y etiquetadas las VLAN donde es miembro tagged. */
  function toCpuFiltered(w: Walk, device: Device, bridge: BridgeInterface, vlan: number): void {
    if (vlan === bridge.pvid) deliver(w, device, bridge);
    if (configured(device, bridge.id, bridge.id, vlan) !== 'tagged') return;
    for (const sub of vlanSubs.get(portKey(device.id, bridge.id)) ?? []) {
      if (sub.vlanId === vlan && !sub.disabled) receive(w, device, sub, null);
    }
  }

  /** Trama que la CPU envía por el bridge (desde el bridge o una VLAN sobre él). */
  function fromCpu(w: Walk, device: Device, bridge: BridgeInterface, tag: Tag): void {
    const members = memberIfaces(device, bridge);
    if (!bridge.vlanFiltering) {
      for (const member of members) transmit(w, device, member.iface, tag);
      return;
    }
    let vlan: number;
    if (tag === null) {
      vlan = bridge.pvid;
    } else {
      if (configured(device, bridge.id, bridge.id, tag) !== 'tagged') return;
      vlan = tag;
    }
    for (const member of members) {
      const egress = egressOf(device, member.port, vlan);
      if (egress) transmit(w, device, member.iface, egress === 'tagged' ? vlan : null);
    }
  }

  // ── API ───────────────────────────────────────────────────────────────────

  const cache = new Map<string, Flood>();
  const empty: Flood = { reached: new Map(), learned: [] };

  function flood(from: PortRef): Flood {
    const key = portKey(from.device, from.iface);
    const cached = cache.get(key);
    if (cached) return cached;
    const device = devices.get(from.device);
    const iface = device && ifaceOf(device, from.iface);
    if (!device || !iface || slaves.has(key)) {
      cache.set(key, empty);
      return empty;
    }
    const w: Walk = { sourceMac: iface.mac, reached: new Map(), learned: [], seen: new Set() };
    transmit(w, device, iface, null);
    w.reached.delete(key);
    const result: Flood = { reached: w.reached, learned: w.learned };
    cache.set(key, result);
    return result;
  }

  return {
    bridgePortOf: (ref) => slaves.get(portKey(ref.device, ref.iface)),
    isSlave: (ref) => slaves.has(portKey(ref.device, ref.iface)),
    flood,
    mutual: (a, b) =>
      flood(a).reached.has(portKey(b.device, b.iface)) &&
      flood(b).reached.has(portKey(a.device, a.iface)),
  };
}
