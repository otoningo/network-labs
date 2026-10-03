/**
 * La escena de la figura: el trazado de cada cable entre equipos ya colocados
 * y los rótulos de sus extremos, leídos de la red en vivo. La colocación de
 * los equipos se memoriza aparte (no cambia con los comandos); esto se rehace
 * tras cada comando y es barato.
 *
 * El texto mide lo mismo en pantalla a cualquier zoom, así que los rótulos se
 * colocan para la escala a la que la figura queda encuadrada en el marco.
 */
import type { Network } from '@nos/core';
import { portLabel } from './ports';
import {
  cableSegment,
  type LinkSketch,
  type NodeBox,
  nodeObstacles,
  type PortBlock,
  type PortRequest,
  parallelOffsets,
  placePortBlocks,
  roomAround,
  SAMPLE_ADDRESS,
  type Segment,
  sceneBounds,
  settleScale,
} from './topology';
import type { Bounds, Size } from './viewport';
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
  /** Escala para la que se colocaron los rótulos (la de encuadre). */
  readonly scale: number;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Rótulos previstos de cada cable (y asociación wifi) para decidir el reparto:
 * los de la red al cargar el lab y, en los puertos que arrancan sin dirección,
 * una de relleno, porque el estudiante se la pondrá.
 */
export function sketchLinks(net: Network): LinkSketch[] {
  return wiresOf(net).map((wire) => {
    const a = portLabel(net, wire.a);
    const b = portLabel(net, wire.b);
    const or = (addresses: readonly string[] | undefined) =>
      addresses && addresses.length > 0 ? addresses : [SAMPLE_ADDRESS];
    return {
      a: wire.a.device,
      aPort: a?.name ?? '',
      aAddresses: or(a?.addresses),
      b: wire.b.device,
      bPort: b?.name ?? '',
      bAddresses: or(b?.addresses),
    };
  });
}

export function buildScene(
  nodes: readonly NodeBox[],
  net: Network,
  frame: Size = { width: 0, height: 0 },
): Scene {
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
  const labels = wires.map((wire) => [portLabel(net, wire.a), portLabel(net, wire.b)] as const);

  const place = (s: number) => {
    const partial: Omit<SceneWire, 'blocks'>[] = [];
    const requests: PortRequest[] = [];
    wires.forEach((wire, i) => {
      const a = byId.get(wire.a.device);
      const b = byId.get(wire.b.device);
      const [la, lb] = labels[i] ?? [null, null];
      if (!a || !b) return;
      const segment = cableSegment(a, b, s, offsets.get(wire.id) ?? 0);
      partial.push({
        wire,
        segment,
        names: [la?.name ?? null, lb?.name ?? null],
        addresses: [la?.addresses ?? [], lb?.addresses ?? []],
      });
      if (la) {
        requests.push({
          key: `${wire.id}:a`,
          segment,
          name: la.name,
          addresses: la.addresses,
          room: roomAround(a, segment.from, s),
        });
      }
      if (lb) {
        requests.push({
          key: `${wire.id}:b`,
          segment: { from: segment.to, to: segment.from },
          name: lb.name,
          addresses: lb.addresses,
          room: roomAround(b, segment.to, s),
        });
      }
    });
    const { blocks } = placePortBlocks(
      requests,
      nodes.flatMap((n) => nodeObstacles(n, s)),
      s,
    );
    const sceneWires = partial.map(
      (w): SceneWire => ({
        ...w,
        blocks: [blocks.get(`${w.wire.id}:a`) ?? null, blocks.get(`${w.wire.id}:b`) ?? null],
      }),
    );
    return { wires: sceneWires, bounds: sceneBounds(nodes, blocks.values(), s) };
  };

  const { k, result } = settleScale(frame, place);
  return { ...result, scale: k };
}
