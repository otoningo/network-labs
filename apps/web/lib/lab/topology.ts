/**
 * Geometría de la figura de topología, en unidades de mundo (1 unidad = 1px a
 * zoom 1): dónde va cada equipo, de qué punto de su borde nace cada cable y
 * dónde se rotulan los puertos sin pisarse. Puro: no sabe de React ni del DOM.
 */
import type { HardwarePort, OsId } from '@nos/core';
import {
  type Bounds,
  boundsOfRects,
  type Point,
  type Rect,
  rawFitScale,
  type Size,
} from './viewport';

export type Role = 'router' | 'host' | 'wireless-host' | 'cloud';

/** Papel del equipo en el dibujo: lo dicen su sistema y sus puertos, no su nombre. */
export function roleOf(os: OsId, ports: readonly HardwarePort[]): Role {
  if (os === 'internet') return 'cloud';
  if (os === 'host') {
    const wireless = ports.length > 0 && ports.every((p) => p.kind === 'wireless');
    return wireless ? 'wireless-host' : 'host';
  }
  return 'router';
}

/** Tamaño de la forma de cada papel. */
export const SHAPE: Readonly<Record<Role, Size>> = {
  router: { width: 132, height: 48 },
  host: { width: 116, height: 44 },
  'wireless-host': { width: 116, height: 44 },
  cloud: { width: 128, height: 60 },
};

/** Alto reservado bajo la forma para la etiqueta del equipo. */
export const FOOTER = 20;
/** Tamaños de letra en unidades de mundo. */
export const TEXT = { id: 13, small: 11, line: 14 } as const;

/** Ancho aproximado de un texto en Geist: lo justo para evitar solapes, sin medir el DOM. */
export function textWidth(text: string, size: number = TEXT.small): number {
  return text.length * size * 0.6;
}

/** Recorta un texto para que quepa en un ancho, con puntos suspensivos. */
export function fitText(text: string, width: number, size: number = TEXT.small): string {
  const max = Math.max(1, Math.floor(width / (size * 0.6)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

export interface NodeSpec {
  readonly id: string;
  readonly role: Role;
  readonly position?: Point | undefined;
}

export interface NodeBox {
  readonly id: string;
  readonly role: Role;
  /** Centro de la forma. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const ROW_GAP = 220;
const ROW_STEP = 160;

/**
 * Cómo se reparte la figura en el marco: traspuesta o no, y cuánto se
 * acercan los equipos entre sí en cada eje (1 = posiciones del YAML). Las
 * formas y el texto no se encogen: se encoge la distancia entre equipos.
 */
export interface Arrangement {
  readonly transpose: boolean;
  readonly sx: number;
  readonly sy: number;
}

export const NATURAL: Arrangement = { transpose: false, sx: 1, sy: 1 };

/**
 * Posición de cada equipo: la del YAML (traspuesta y apretada según
 * `arrangement`) o, si falta, una fila aparte: la nube encima del resto y los
 * demás debajo.
 */
export function layoutNodes(
  specs: readonly NodeSpec[],
  arrangement: Arrangement = NATURAL,
): NodeBox[] {
  const placed = specs.filter((s) => s.position);
  const xs = placed.map((s) => s.position?.x ?? 0);
  const ys = placed.map((s) => s.position?.y ?? 0);
  const left = placed.length > 0 ? Math.min(...xs) : 120;
  const top = placed.length > 0 ? Math.min(...ys) : 120;
  const bottom = placed.length > 0 ? Math.max(...ys) : 120 - ROW_STEP;
  let above = 0;
  let below = 0;
  const points = specs.map((spec): Point => {
    let point = spec.position;
    if (!point) {
      if (spec.role === 'cloud' && placed.length > 0) {
        point = { x: left + above * ROW_GAP, y: top - ROW_STEP };
        above += 1;
      } else {
        point = { x: left + below * ROW_GAP, y: bottom + ROW_STEP };
        below += 1;
      }
    }
    return arrangement.transpose ? { x: point.y, y: point.x } : point;
  });
  const cx = (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2;
  const cy = (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2;
  return specs.map((spec, i) => {
    const point = points[i] ?? { x: cx, y: cy };
    const { width, height } = SHAPE[spec.role];
    return {
      id: spec.id,
      role: spec.role,
      x: cx + (point.x - cx) * arrangement.sx,
      y: cy + (point.y - cy) * arrangement.sy,
      width,
      height,
    };
  });
}

/** Rectángulo que ocupa el equipo, etiqueta incluida. */
export function nodeRect(node: NodeBox): Rect {
  return {
    x: node.x - node.width / 2,
    y: node.y - node.height / 2,
    width: node.width,
    height: node.height + FOOTER,
  };
}

/** Lo que un equipo no comparte con otro: su rectángulo con margen para la etiqueta. */
function nodeExtent(node: NodeBox): Rect {
  const r = nodeRect(node);
  return { x: r.x - 12, y: r.y, width: r.width + 24, height: r.height };
}

/** Un cable de la topología, por nombre de puerto, para estimar sus rótulos. */
export interface LinkSketch {
  readonly a: string;
  readonly aPort: string;
  readonly b: string;
  readonly bPort: string;
}

/** Dirección de relleno para reservar sitio: la mayoría de las del lab miden esto o menos. */
const SAMPLE_ADDRESS = '192.168.100.1/24';
/** Factores de reparto por eje: por debajo de 1 acercan; por encima separan (al trasponer, para los rótulos). */
const SPREADS = [1, 0.9, 0.8, 0.7, 0.6, 1.2, 1.4, 1.6] as const;

interface Trial {
  readonly arrangement: Arrangement;
  readonly scale: number;
  readonly crowded: boolean;
  readonly collisions: number;
}

function trial(
  specs: readonly NodeSpec[],
  links: readonly LinkSketch[],
  arrangement: Arrangement,
  frame: Size,
): Trial | null {
  const nodes = layoutNodes(specs, arrangement);
  const extents = nodes.map(nodeExtent);
  const crowded = extents.some((a, i) => extents.some((b, j) => j > i && overlaps(a, b, 16)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const requests: PortRequest[] = [];
  for (const [i, link] of links.entries()) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) continue;
    const segment = cableSegment(a, b);
    requests.push({ key: `${i}:a`, segment, name: link.aPort, addresses: [SAMPLE_ADDRESS] });
    requests.push({
      key: `${i}:b`,
      segment: { from: segment.to, to: segment.from },
      name: link.bPort,
      addresses: [SAMPLE_ADDRESS],
    });
  }
  const { blocks, collisions } = placePortBlocks(requests, nodes.map(nodeRect));
  const bounds = sceneBounds(nodes, blocks.values());
  return bounds
    ? { arrangement, scale: rawFitScale(bounds, frame, 16), crowded, collisions }
    : null;
}

const distortion = (a: Arrangement): number => Math.abs(1 - a.sx) + Math.abs(1 - a.sy);

/**
 * Elige cómo repartir la figura en el marco para que el texto no baje de su
 * tamaño (escala 1) si se puede evitar: acerca o separa los equipos en cada
 * eje y, en marcos estrechos y altos (la pestaña del móvil), prueba a
 * trasponerla. Entre las que se leen igual, la menos deformada.
 */
export function arrangeFor(
  specs: readonly NodeSpec[],
  links: readonly LinkSketch[],
  frame: Size,
): Arrangement {
  if (frame.width < 1 || frame.height < 1) return NATURAL;
  const portrait = frame.width < 640 && frame.height > frame.width;
  // La disposición del YAML siempre vale; las demás, solo si no pisan más que ella.
  const natural = trial(specs, links, NATURAL, frame);
  if (!natural) return NATURAL;
  let best: Trial = natural;
  const readable = (t: Trial) => Math.min(t.scale, 1);
  for (const transpose of portrait ? [false, true] : [false]) {
    for (const sx of SPREADS) {
      for (const sy of SPREADS) {
        const t = trial(specs, links, { transpose, sx, sy }, frame);
        // Trasponer exige rótulos limpios; apretar, no pisar más que el YAML.
        const allowed = transpose ? 0 : natural.collisions;
        if (!t || t.crowded || t.collisions > allowed) continue;
        // Trasponer solo compensa si se lee claramente mejor.
        const margin = t.arrangement.transpose && !best.arrangement.transpose ? 0.05 : 0.01;
        const gain = readable(t) - readable(best);
        const lessDistorted = distortion(t.arrangement) < distortion(best.arrangement);
        if (
          gain > margin ||
          (Math.abs(gain) <= 0.01 &&
            lessDistorted &&
            t.arrangement.transpose === best.arrangement.transpose)
        ) {
          best = t;
        }
      }
    }
  }
  return best.arrangement;
}

/**
 * Punto donde el rayo que sale del centro del equipo hacia `toward` cruza el
 * borde de su rectángulo (etiqueta incluida): los cables nacen del borde.
 */
export function edgePoint(node: NodeBox, toward: Point): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const r = nodeRect(node);
  const tx = dx > 0 ? (r.x + r.width - node.x) / dx : dx < 0 ? (r.x - node.x) / dx : Infinity;
  const ty = dy > 0 ? (r.y + r.height - node.y) / dy : dy < 0 ? (r.y - node.y) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: node.x + dx * t, y: node.y + dy * t };
}

export interface Segment {
  readonly from: Point;
  readonly to: Point;
}

/**
 * Tramo de un cable entre dos equipos. Los cables paralelos entre el mismo
 * par se separan `offset` unidades en perpendicular.
 */
export function cableSegment(a: NodeBox, b: NodeBox, offset = 0): Segment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * offset;
  const py = (dx / len) * offset;
  const shiftedA = { ...a, x: a.x + px, y: a.y + py };
  const shiftedB = { ...b, x: b.x + px, y: b.y + py };
  return { from: edgePoint(shiftedA, shiftedB), to: edgePoint(shiftedB, shiftedA) };
}

/** Desplazamientos perpendiculares para n cables entre el mismo par de equipos. */
export function parallelOffsets(count: number, gap = 14): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);
}

export interface LabelLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'end';
  readonly tone: 'port' | 'address';
}

export interface PortBlock {
  readonly lines: readonly LabelLine[];
  /** Caja de cada línea: los choques se miden línea a línea. */
  readonly boxes: readonly Rect[];
  /** Caja de todo el bloque, para los límites de la figura. */
  readonly rect: Rect;
}

/**
 * Rótulo de un extremo de cable: el nombre del puerto y sus direcciones,
 * junto al punto `at` y apartado de la línea que va hacia `toward`.
 * - Cable casi horizontal: el nombre encima y las direcciones debajo.
 * - Cable inclinado: todo el bloque del lado contrario a la pendiente.
 * - Cable casi vertical: el bloque a un lado, del que se aleja la línea.
 * La variante `alternate` lo pone al revés (direcciones encima o el bloque al
 * otro lado): así los dos extremos de un cable corto se escalonan.
 */
export function portBlock(
  at: Point,
  toward: Point,
  name: string,
  addresses: readonly string[],
  alternate = false,
): PortBlock {
  const dx = toward.x - at.x;
  const dy = toward.y - at.y;
  const texts = [name, ...addresses];
  const width = Math.max(...texts.map((t) => textWidth(t)));
  const count = texts.length;
  const ascent = 9;
  const descent = 3;
  let x: number;
  let anchor: 'start' | 'end';
  let baselines: number[];

  if (Math.abs(dx) >= Math.abs(dy)) {
    const rightward = dx >= 0;
    x = at.x + (rightward ? 8 : -8);
    anchor = rightward ? 'start' : 'end';
    const slope = Math.abs(dy / (dx || 1));
    if (slope < 0.15 && !alternate) {
      baselines = [at.y - 7, ...addresses.map((_, i) => at.y + 16 + i * TEXT.line)];
    } else if (slope < 0.15) {
      // Escalonado: las direcciones encima (la última pegada a la línea), el nombre debajo.
      baselines = [
        at.y + 16,
        ...addresses.map((_, i) => at.y - 7 - (addresses.length - 1 - i) * TEXT.line),
      ];
    } else if (dy > 0 !== alternate) {
      // La línea baja al alejarse: el bloque encima del arranque no la cruza.
      const last = at.y - 6;
      baselines = texts.map((_, i) => last - (count - 1 - i) * TEXT.line);
    } else {
      const first = at.y + 14;
      baselines = texts.map((_, i) => first + i * TEXT.line);
    }
  } else {
    // La línea se va hacia un lado; el texto al otro.
    const toLeft = dx > 0 !== alternate;
    x = at.x + (toLeft ? -8 : 8);
    anchor = toLeft ? 'end' : 'start';
    if (dy > 0) {
      baselines = texts.map((_, i) => at.y + 14 + i * TEXT.line);
    } else {
      const last = at.y - 6;
      baselines = texts.map((_, i) => last - (count - 1 - i) * TEXT.line);
    }
  }

  const lines: LabelLine[] = texts.map((text, i) => ({
    text,
    x,
    y: baselines[i] ?? at.y,
    anchor,
    tone: i === 0 ? 'port' : 'address',
  }));
  const boxes = lines.map((line): Rect => {
    const w = textWidth(line.text);
    return {
      x: anchor === 'start' ? x : x - w,
      y: line.y - ascent,
      width: w,
      height: ascent + descent,
    };
  });
  const top = Math.min(...baselines) - ascent;
  const bottom = Math.max(...baselines) + descent;
  return {
    lines,
    boxes,
    rect: { x: anchor === 'start' ? x : x - width, y: top, width, height: bottom - top },
  };
}

export const overlaps = (a: Rect, b: Rect, gap = 2): boolean =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

export interface PortRequest {
  readonly key: string;
  readonly segment: Segment;
  readonly name: string;
  readonly addresses: readonly string[];
}

const SLIDE_STEP = 10;

/**
 * Rotula todos los extremos de cable. Si un rótulo pisa un equipo u otro
 * rótulo, prueba su variante escalonada y, si tampoco cabe, se desliza a lo
 * largo de su cable hasta encontrar hueco (sin pasar de la mitad del cable).
 * Si no lo encuentra se queda en el primer sitio y cuenta como choque.
 */
export function placePortBlocks(
  requests: readonly PortRequest[],
  obstacles: readonly Rect[],
): { blocks: Map<string, PortBlock>; collisions: number } {
  const placed = new Map<string, PortBlock>();
  const taken: Rect[] = [...obstacles];
  let collisions = 0;
  for (const req of requests) {
    const { from, to } = req.segment;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const ux = len > 0 ? (to.x - from.x) / len : 0;
    const uy = len > 0 ? (to.y - from.y) / len : 0;
    const first = portBlock(from, to, req.name, req.addresses);
    let chosen: PortBlock | null = null;
    for (let s = 0; !chosen && s * SLIDE_STEP <= Math.max(0, len / 2 - 16); s++) {
      const at = { x: from.x + ux * s * SLIDE_STEP, y: from.y + uy * s * SLIDE_STEP };
      for (const alternate of [false, true]) {
        const block = portBlock(at, to, req.name, req.addresses, alternate);
        if (!block.boxes.some((box) => taken.some((r) => overlaps(box, r)))) {
          chosen = block;
          break;
        }
      }
    }
    if (!chosen) collisions += 1;
    placed.set(req.key, chosen ?? first);
    taken.push(...(chosen ?? first).boxes);
  }
  return { blocks: placed, collisions };
}

export function sceneBounds(nodes: readonly NodeBox[], labels: Iterable<PortBlock>): Bounds | null {
  return boundsOfRects([...nodes.map(nodeRect), ...[...labels].map((b) => b.rect)]);
}
