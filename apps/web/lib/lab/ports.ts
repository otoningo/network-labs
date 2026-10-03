/**
 * Lo que la figura rotula en cada extremo de un cable: el nombre actual de la
 * interfaz (sigue a un renombrado) y sus direcciones IPv4, estáticas o por DHCP.
 */
import { formatPrefix, type Network, type PortRef } from '@nos/core';

export interface PortLabel {
  readonly name: string;
  readonly addresses: readonly string[];
}

export function portLabel(net: Network, port: PortRef): PortLabel | null {
  const device = net.devices.find((d) => d.id === port.device);
  const iface = device?.config.interfaces.find((i) => i.id === port.iface);
  if (!device || !iface) return null;
  const { addressing } = device.config;
  const statics = addressing.addresses
    .filter((a) => a.iface === port.iface && !a.disabled)
    .map((a) => formatPrefix(a.address));
  const clients = new Set(
    addressing.dhcpClients.filter((c) => c.iface === port.iface && !c.disabled).map((c) => c.id),
  );
  const leased = device.oper.dhcpClients
    .filter((s) => clients.has(s.client) && s.status === 'bound' && s.address)
    .flatMap((s) => (s.address ? [formatPrefix(s.address)] : []));
  return { name: iface.name, addresses: [...new Set([...statics, ...leased])] };
}
