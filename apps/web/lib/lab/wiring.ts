/**
 * Qué cables y asociaciones dibuja la figura y en qué estado, leído de la red
 * en vivo. Un cable está activo si está conectado y sus dos interfaces están
 * habilitadas y operativas; una estación wifi asociada se une a su punto de
 * acceso, y una sin asociar se dibuja caída hacia el punto de acceso que
 * busca (mismo SSID) o hacia el único que haya.
 */
import type { Device, Interface, ItemId, Network, PortRef } from '@nos/core';
import { addressesOf } from './ports';

export type WireKind = 'wired' | 'wireless';
export type DownReason = 'cable' | 'disabled' | 'not-running' | 'not-associated';

export interface Wire {
  readonly id: string;
  readonly kind: WireKind;
  readonly a: PortRef;
  readonly b: PortRef;
  readonly up: boolean;
  /** Por qué está caído, y en qué puerto si es cosa de uno. */
  readonly reason: { readonly kind: DownReason; readonly port: PortRef | null } | null;
}

type Lookup = (ref: PortRef) => { device: Device; iface: Interface } | null;

function lookup(net: Network): Lookup {
  const devices = new Map(net.devices.map((d) => [d.id, d]));
  return (ref) => {
    const device = devices.get(ref.device);
    const iface = device?.config.interfaces.find((i) => i.id === ref.iface);
    return device && iface ? { device, iface } : null;
  };
}

export function isRunning(device: Device, iface: Interface): boolean {
  return device.oper.interfaces.find((o) => o.iface === iface.id)?.running ?? false;
}

function wired(net: Network, find: Lookup): Wire[] {
  return net.links.map((link) => {
    const base = { id: link.id, kind: 'wired' as const, a: link.a, b: link.b };
    if (!link.up) return { ...base, up: false, reason: { kind: 'cable', port: null } };
    for (const port of [link.a, link.b]) {
      const found = find(port);
      if (found?.iface.disabled) return { ...base, up: false, reason: { kind: 'disabled', port } };
    }
    for (const port of [link.a, link.b]) {
      const found = find(port);
      if (!found || !isRunning(found.device, found.iface)) {
        return { ...base, up: false, reason: { kind: 'not-running', port } };
      }
    }
    return { ...base, up: true, reason: null };
  });
}

function wireless(net: Network): Wire[] {
  const aps: { ref: PortRef; ssid: string }[] = [];
  for (const device of net.devices) {
    for (const iface of device.config.interfaces) {
      if (iface.kind === 'wireless' && iface.mode === 'ap') {
        aps.push({ ref: { device: device.id, iface: iface.id }, ssid: iface.ssid });
      }
    }
  }
  const wires: Wire[] = [];
  for (const device of net.devices) {
    for (const iface of device.config.interfaces) {
      if (iface.kind !== 'wireless' || iface.mode !== 'station') continue;
      const station: PortRef = { device: device.id, iface: iface.id };
      const id = `wifi:${device.id}:${iface.id}`;
      const ap = device.oper.interfaces.find((o) => o.iface === iface.id)?.wifiAp;
      if (ap) {
        wires.push({ id, kind: 'wireless', a: ap, b: station, up: true, reason: null });
        continue;
      }
      const wanted =
        aps.find((a) => a.ssid !== '' && a.ssid === iface.ssid) ??
        (aps.length === 1 ? aps[0] : undefined);
      if (!wanted) continue;
      wires.push({
        id,
        kind: 'wireless',
        a: wanted.ref,
        b: station,
        up: false,
        reason: { kind: iface.disabled ? 'disabled' : 'not-associated', port: station },
      });
    }
  }
  return wires;
}

/** Cables y asociaciones wifi en el orden de la red: primero los cables. */
export function wiresOf(net: Network): Wire[] {
  return [...wired(net, lookup(net)), ...wireless(net)];
}

export type IfaceState = 'running' | 'down' | 'disabled';

export interface IfaceSummary {
  readonly id: ItemId;
  readonly name: string;
  readonly kind: Interface['kind'];
  readonly state: IfaceState;
  readonly addresses: readonly string[];
}

/** Interfaces de un equipo para el panel de detalle: nombre, estado y direcciones. */
export function interfacesOf(device: Device): IfaceSummary[] {
  return device.config.interfaces.map((iface) => ({
    id: iface.id,
    name: iface.name,
    kind: iface.kind,
    state: iface.disabled ? 'disabled' : isRunning(device, iface) ? 'running' : 'down',
    addresses: addressesOf(device, iface.id),
  }));
}

/** Nombre del equipo en vivo, si difiere de su id en la topología. */
export function liveIdentity(device: Device | undefined, id: string): string | null {
  const identity = device?.config.system.identity;
  return identity && identity !== id ? identity : null;
}
