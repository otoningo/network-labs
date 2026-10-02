import type { DeviceId, ItemId } from './brand';
import type { DeviceConfig, Interface } from './config';
import type { Device, Network, PortRef } from './network';
import type { InterfaceOper } from './oper';

export function getDevice(net: Network, id: DeviceId): Device | undefined {
  return net.devices.find((d) => d.id === id);
}

export function replaceDevice(net: Network, device: Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === device.id ? device : d)) };
}

export function findInterface(config: DeviceConfig, id: ItemId): Interface | undefined {
  return config.interfaces.find((i) => i.id === id);
}

export function interfaceByName(config: DeviceConfig, name: string): Interface | undefined {
  return config.interfaces.find((i) => i.name === name);
}

export function interfaceAt(net: Network, ref: PortRef): Interface | undefined {
  const device = getDevice(net, ref.device);
  return device ? findInterface(device.config, ref.iface) : undefined;
}

export function interfaceOper(device: Device, iface: ItemId): InterfaceOper | undefined {
  return device.oper.interfaces.find((i) => i.iface === iface);
}

export const portKey = (device: DeviceId, iface: ItemId): string => `${device}#${iface}`;
