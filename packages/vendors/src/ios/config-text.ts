/**
 * `show running-config` y `show startup-config`: la configuración en el
 * formato de IOS, armada con los bloques que aporta cada área y separada con
 * `!`. Se genera siempre desde el modelo neutral, nunca desde lo tecleado.
 */
import type { Device, Interface } from '@nos/core';
import { listedInterfaces } from './area';
import { AREAS } from './commands';

function interfaceBlock(device: Device, iface: Interface): string[] {
  const lines = AREAS.flatMap((a) => a.interfaceLines?.(device, iface) ?? []);
  return [
    `interface ${iface.name}`,
    ...[...lines].sort((a, b) => a.order - b.order).map((l) => l.line),
  ];
}

/** El cuerpo de la configuración, del primer `!` al `end`. */
export function configBody(device: Device): string {
  const blocks = AREAS.flatMap((a) => a.blocks?.(device) ?? []).filter((b) => b.lines.length > 0);
  const before = blocks.filter((b) => b.order < 100).sort((a, b) => a.order - b.order);
  const after = blocks.filter((b) => b.order >= 100).sort((a, b) => a.order - b.order);
  const sections: string[][] = [
    ...before.map((b) => [...b.lines]),
    ...listedInterfaces(device).map((i) => interfaceBlock(device, i)),
    ...after.map((b) => [...b.lines]),
  ];
  return ['!', ...sections.flatMap((lines) => [...lines, '!']), 'end'].join('\n');
}

export function runningConfig(device: Device): string {
  const body = configBody(device);
  return [
    'Building configuration...',
    '',
    `Current configuration : ${body.length + 1} bytes`,
    body,
  ].join('\n');
}

/** Lo guardado con `write memory`, leído como si fuera el equipo (null si no hay nada). */
export function startupConfig(device: Device, saved: Device['config'] | undefined): string {
  if (!saved) return 'startup-config is not present';
  const body = configBody({ ...device, config: saved });
  return [`Using ${body.length + 1} out of 262136 bytes`, body].join('\n');
}
