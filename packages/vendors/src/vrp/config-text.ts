/**
 * `display current-configuration` y `display this`: la configuración en el
 * formato de VRP, armada con los bloques que aporta cada área y separada con
 * `#`. Se genera siempre desde el modelo neutral, nunca desde lo tecleado.
 */
import type { Device, Interface } from '@nos/core';
import { AREAS } from './commands';
import type { View } from './session';

function interfaceBlock(device: Device, iface: Interface): string[] {
  return [
    `interface ${iface.name}`,
    ...AREAS.flatMap((a) => a.interfaceLines?.(device, iface) ?? []),
  ];
}

/** Interfaces que VRP lista en la configuración: las físicas, en orden. */
const listedInterfaces = (device: Device): Interface[] =>
  device.config.interfaces.filter(
    (i) => i.kind === 'ethernet' || i.kind === 'vlan' || i.kind === 'loopback',
  );

export function currentConfiguration(device: Device): string {
  const blocks = AREAS.flatMap((a) => a.blocks?.(device) ?? []).filter((b) => b.lines.length > 0);
  const before = blocks.filter((b) => b.order < 100).sort((a, b) => a.order - b.order);
  const after = blocks.filter((b) => b.order >= 100).sort((a, b) => a.order - b.order);
  const sections: string[][] = [
    ...before.map((b) => [...b.lines]),
    ...listedInterfaces(device).map((i) => interfaceBlock(device, i)),
    // NULL0 aparece siempre, vacía.
    ['interface NULL0'],
    ...after.map((b) => [...b.lines]),
  ];
  return [...sections.flatMap((lines) => ['#', ...lines]), '#', 'return'].join('\n');
}

/** `display this`: el bloque de la vista actual. */
export function displayThis(device: Device, view: View): string {
  if (view.kind === 'interface') {
    const iface = device.config.interfaces.find((i) => i.id === view.iface);
    return iface ? ['#', ...interfaceBlock(device, iface), '#', 'return'].join('\n') : '';
  }
  if (view.kind === 'system') return currentConfiguration(device);
  for (const area of AREAS) {
    const lines = area.viewBlock?.(device, view);
    if (lines) return ['#', ...lines, '#', 'return'].join('\n');
  }
  return ['#', 'return'].join('\n');
}
