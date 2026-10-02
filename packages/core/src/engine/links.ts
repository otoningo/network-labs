/**
 * Estado físico de las interfaces: qué cables están conectados por ambos lados,
 * qué estaciones wifi se asocian a qué punto de acceso, y qué interfaces lógicas
 * (bridge, VLAN, loopback) quedan operativas como consecuencia.
 */
import type { Interface, WirelessInterface } from '../model/config';
import { portKey } from '../model/lookup';
import type { Device, Network, PortRef } from '../model/network';

export interface Association {
  readonly ap: PortRef;
  readonly station: PortRef;
}

export interface LinkState {
  isRunning(ref: PortRef): boolean;
  isLinkUp(ref: PortRef): boolean;
  /** Extremos al otro lado de los cables conectados a este puerto. */
  linkPeers(ref: PortRef): readonly PortRef[];
  /** Punto de acceso → estaciones asociadas; estación → su punto de acceso. */
  wifiPeers(ref: PortRef): readonly PortRef[];
  readonly associations: readonly Association[];
}

function securityMatches(ap: WirelessInterface, station: WirelessInterface): boolean {
  const common = ap.security.auth.filter((a) => station.security.auth.includes(a));
  if (common.includes('open')) return true;
  if (common.length === 0) return false;
  const pass = ap.security.passphrase;
  return pass !== undefined && pass === station.security.passphrase;
}

function apServes(ap: WirelessInterface, station: WirelessInterface): boolean {
  return (
    ap.mode === 'ap' &&
    !ap.disabled &&
    ap.ssid !== '' &&
    ap.band === station.band &&
    ap.ssid === station.ssid &&
    securityMatches(ap, station)
  );
}

export function computeLinkState(net: Network): LinkState {
  const devices = new Map(net.devices.map((d) => [d.id, d]));
  const ifaceOf = (ref: PortRef): Interface | undefined =>
    devices.get(ref.device)?.config.interfaces.find((i) => i.id === ref.iface);

  const peers = new Map<string, PortRef[]>();
  const addPeer = (from: PortRef, to: PortRef): void => {
    const key = portKey(from.device, from.iface);
    peers.set(key, [...(peers.get(key) ?? []), to]);
  };
  for (const link of net.links) {
    if (!link.up) continue;
    const a = ifaceOf(link.a);
    const b = ifaceOf(link.b);
    if (a?.kind !== 'ethernet' || b?.kind !== 'ethernet' || a.disabled || b.disabled) continue;
    addPeer(link.a, link.b);
    addPeer(link.b, link.a);
  }

  // Asociaciones wifi: cada estación se une al primer punto de acceso compatible.
  const aps: { ref: PortRef; iface: WirelessInterface }[] = [];
  for (const device of net.devices) {
    for (const iface of device.config.interfaces) {
      if (iface.kind === 'wireless' && iface.mode === 'ap') {
        aps.push({ ref: { device: device.id, iface: iface.id }, iface });
      }
    }
  }
  const associations: Association[] = [];
  const wifi = new Map<string, PortRef[]>();
  for (const device of net.devices) {
    for (const iface of device.config.interfaces) {
      if (
        iface.kind !== 'wireless' ||
        iface.mode !== 'station' ||
        iface.disabled ||
        iface.ssid === ''
      ) {
        continue;
      }
      const station = { device: device.id, iface: iface.id };
      const ap = aps.find(
        (candidate) => candidate.ref.device !== device.id && apServes(candidate.iface, iface),
      );
      if (!ap) continue;
      associations.push({ ap: ap.ref, station });
      const apKey = portKey(ap.ref.device, ap.ref.iface);
      wifi.set(apKey, [...(wifi.get(apKey) ?? []), station]);
      wifi.set(portKey(device.id, iface.id), [ap.ref]);
    }
  }

  const running = new Map<string, boolean>();
  const resolve = (device: Device, iface: Interface, depth: number): boolean => {
    const key = portKey(device.id, iface.id);
    const known = running.get(key);
    if (known !== undefined) return known;
    let value: boolean;
    if (iface.disabled || depth > 8) {
      value = false;
    } else {
      switch (iface.kind) {
        case 'ethernet':
          value = peers.has(key);
          break;
        case 'wireless':
          value = iface.mode === 'ap' ? iface.ssid !== '' : wifi.has(key);
          break;
        case 'bridge':
        case 'loopback':
          value = true;
          break;
        case 'vlan': {
          const parent = device.config.interfaces.find((i) => i.id === iface.parent);
          value = parent !== undefined && resolve(device, parent, depth + 1);
          break;
        }
      }
    }
    running.set(key, value);
    return value;
  };
  for (const device of net.devices) {
    for (const iface of device.config.interfaces) resolve(device, iface, 0);
  }

  return {
    isRunning: (ref) => running.get(portKey(ref.device, ref.iface)) ?? false,
    isLinkUp: (ref) => running.get(portKey(ref.device, ref.iface)) ?? false,
    linkPeers: (ref) => peers.get(portKey(ref.device, ref.iface)) ?? [],
    wifiPeers: (ref) => wifi.get(portKey(ref.device, ref.iface)) ?? [],
    associations,
  };
}
