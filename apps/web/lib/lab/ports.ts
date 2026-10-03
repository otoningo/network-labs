/**
 * Lo que la figura rotula en cada extremo de un cable: el nombre actual de la
 * interfaz (sigue a un renombrado) y sus direcciones IPv4, estáticas o por DHCP.
 */
import { type Device, formatPrefix, type ItemId, type Network, type PortRef } from '@nos/core';

export interface PortLabel {
  readonly name: string;
  readonly addresses: readonly string[];
}

/** Direcciones IPv4 vigentes de una interfaz: las estáticas activas y las concedidas por DHCP. */
export function addressesOf(device: Device, iface: ItemId): string[] {
  const { addressing } = device.config;
  const statics = addressing.addresses
    .filter((a) => a.iface === iface && !a.disabled)
    .map((a) => formatPrefix(a.address));
  const clients = new Set(
    addressing.dhcpClients.filter((c) => c.iface === iface && !c.disabled).map((c) => c.id),
  );
  const leased = device.oper.dhcpClients
    .filter((s) => clients.has(s.client) && s.status === 'bound' && s.address)
    .flatMap((s) => (s.address ? [formatPrefix(s.address)] : []));
  return [...new Set([...statics, ...leased])];
}

export function portLabel(net: Network, port: PortRef): PortLabel | null {
  const device = net.devices.find((d) => d.id === port.device);
  const iface = device?.config.interfaces.find((i) => i.id === port.iface);
  if (!device || !iface) return null;
  return { name: iface.name, addresses: addressesOf(device, port.iface) };
}
