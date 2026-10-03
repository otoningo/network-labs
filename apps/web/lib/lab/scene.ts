/**
 * La escena de la figura: el trazado de cada cable entre equipos ya colocados
 * y los rótulos de sus extremos, leídos de la red en vivo. La colocación de
 * los equipos se memoriza aparte (no cambia con los comandos); esto se rehace
 * tras cada comando y es barato.
 */
import type { Network } from '@nos/core';
import { portLabel } from './ports';
import {
  cableSegment,
  type NodeBox,
  nodeRect,
  type PortBlock,
  type PortRequest,
  parallelOffsets,
  placePortBlocks,
  type Segment,
  sceneBounds,
} from './topology';
import type { Bounds } from './viewport';
import { type Wire, wiresOf } from './wiring';

export interface SceneWire {
  readonly wire: Wire;
  readonly segment: Segment;
  /** Nombre actual de la interfaz en cada extremo (a, b); null si ya no existe. */
  readonly names: readonly [string | null, string | null];
  readonly addresses: readonly [readonly string[], readonly string[]];
  readonly blocks: readonly [PortBlock | null, PortBlock | null];
}

export interface Scene {
  readonly wires: readonly SceneWire[];
  readonly bounds: Bounds | null;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildScene(nodes: readonly NodeBox[], net: Network): Scene {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wires = wiresOf(net).filter((w) => byId.has(w.a.device) && byId.has(w.b.device));

  // Cables paralelos entre el mismo par de equipos: se separan en perpendicular.
  const groups = new Map<string, Wire[]>();
  for (const wire of wires) {
    const key = pairKey(wire.a.device, wire.b.device);
    groups.set(key, [...(groups.get(key) ?? []), wire]);
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    const steps = parallelOffsets(group.length);
    group.forEach((wire, i) => {
      // El desplazamiento se mide siempre en el mismo sentido del par.
      const flipped = wire.a.device > wire.b.device;
      const step = steps[i] ?? 0;
      offsets.set(wire.id, flipped ? -step : step);
    });
  }

  const partial: Omit<SceneWire, 'blocks'>[] = [];
  const requests: PortRequest[] = [];
  for (const wire of wires) {
    const a = byId.get(wire.a.device);
    const b = byId.get(wire.b.device);
    if (!a || !b) continue;
    const segment = cableSegment(a, b, offsets.get(wire.id) ?? 0);
    const la = portLabel(net, wire.a);
    const lb = portLabel(net, wire.b);
    partial.push({
      wire,
      segment,
      names: [la?.name ?? null, lb?.name ?? null],
      addresses: [la?.addresses ?? [], lb?.addresses ?? []],
    });
    if (la) requests.push({ key: `${wire.id}:a`, segment, name: la.name, addresses: la.addresses });
    if (lb) {
      requests.push({
        key: `${wire.id}:b`,
        segment: { from: segment.to, to: segment.from },
        name: lb.name,
        addresses: lb.addresses,
      });
    }
  }

  const { blocks } = placePortBlocks(requests, nodes.map(nodeRect));
  const sceneWires = partial.map(
    (w): SceneWire => ({
      ...w,
      blocks: [blocks.get(`${w.wire.id}:a`) ?? null, blocks.get(`${w.wire.id}:b`) ?? null],
    }),
  );
  return { wires: sceneWires, bounds: sceneBounds(nodes, blocks.values()) };
}
