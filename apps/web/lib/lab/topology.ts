/**
 * Geometría de la figura de topología. Las formas y las posiciones viven en
 * unidades de mundo y escalan con el zoom; el texto no: se dibuja siempre al
 * mismo tamaño de pantalla. Por eso todo lo que mide texto recibe `s` = 1/k:
 * cuánto mundo ocupa un píxel de pantalla a la escala k para la que se coloca.
 * Puro: no sabe de React ni del DOM.
 */
import type { HardwarePort, OsId } from '@nos/core';
import {
  type Bounds,
  boundsOfRects,
  FIT_MAX,
  type Point,
  type Rect,
  rawFitScale,
  type Size,
  ZOOM_MIN,
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

/** Tamaño de la forma de cada papel, en unidades de mundo. */
export const SHAPE: Readonly<Record<Role, Size>> = {
  router: { width: 132, height: 48 },
  host: { width: 116, height: 44 },
  'wireless-host': { width: 116, height: 44 },
  cloud: { width: 128, height: 60 },
};

/**
 * Texto de la figura, en píxeles de pantalla (no escala con el zoom): rótulos,
 * etiquetas y nombre en vivo a 0.75rem; el id del equipo a 13px en 600.
 */
export const TEXT = { id: 13, small: 12, line: 16, ascent: 9, descent: 3 } as const;
/** Alto bajo la forma para la etiqueta del equipo, en píxeles de pantalla. */
export const FOOTER = 20;
/** Separación del rótulo respecto del cable, en píxeles de pantalla. */
const GAP = 8;
/** Ancho máximo de la etiqueta de un equipo, en píxeles de pantalla. */
const LABEL_MAX = 168;

/** Ancho aproximado de un texto en Geist, en píxeles: lo justo para evitar solapes sin medir el DOM. */
export function textWidth(text: string, size: number = TEXT.small): number {
  return text.length * size * 0.6;
}

/** Recorta un texto para que quepa en un ancho en píxeles, con puntos suspensivos. */
export function fitText(text: string, width: number, size: number = TEXT.small): string {
  const max = Math.max(1, Math.floor(width / (size * 0.6)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

export interface NodeSpec {
  readonly id: string;
  readonly role: Role;
  readonly position?: Point | undefined;
  /** Etiqueta del equipo en el idioma de la interfaz. */
  readonly label?: string | null | undefined;
}

export interface NodeBox {
  readonly id: string;
  readonly role: Role;
  /** Centro de la forma. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Etiqueta ya recortada, que va bajo la forma; null si no tiene. */
  readonly label: string | null;
}

const ROW_GAP = 220;
const ROW_STEP = 160;

/**
 * Cómo se reparte la figura en el marco: traspuesta o no, y cuánto se
 * acercan o separan los equipos en cada eje (1 = posiciones del YAML).
 */
export interface Arrangement {
  readonly transpose: boolean;
  readonly sx: number;
  readonly sy: number;
}

export const NATURAL: Arrangement = { transpose: false, sx: 1, sy: 1 };

/**
 * Posición de cada equipo: la del YAML (traspuesta y repartida según
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
      label: spec.label ? fitText(spec.label, LABEL_MAX) : null,
    };
  });
}

/** Rectángulo de la forma con su pie de etiqueta: de su borde nacen los cables. */
export function nodeRect(node: NodeBox, s = 1): Rect {
  return {
    x: node.x - node.width / 2,
    y: node.y - node.height / 2,
    width: node.width,
    height: node.height + (node.label ? FOOTER : 4) * s,
  };
}

/**
 * Lo que ocupa el equipo para los rótulos: la forma y, debajo, su etiqueta con
 * su propio ancho (más ancha que la forma a escalas pequeñas, sin tapar sus lados).
 */
export function nodeObstacles(node: NodeBox, s = 1): Rect[] {
  const shape = {
    x: node.x - node.width / 2,
    y: node.y - node.height / 2,
    width: node.width,
    height: node.height,
  };
  if (!node.label) return [shape];
  const w = (textWidth(node.label) + GAP) * s;
  const top = node.y + node.height / 2;
  return [shape, { x: node.x - w / 2, y: top, width: w, height: FOOTER * s }];
}

/** Lo que el equipo no comparte con otro equipo: la forma y su etiqueta a lo ancho. */
export function nodeExtent(node: NodeBox, s = 1): Rect {
  const r = nodeRect(node, s);
  const label = node.label ? (textWidth(node.label) + GAP) * s : 0;
  const width = Math.max(r.width, label);
  return { x: node.x - width / 2, y: r.y, width, height: r.height };
}

/**
 * Punto donde el rayo que sale del centro del equipo hacia `toward` cruza el
 * borde de su rectángulo (pie incluido): los cables nacen del borde.
 */
export function edgePoint(node: NodeBox, toward: Point, s = 1): Point {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const r = nodeRect(node, s);
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
export function cableSegment(a: NodeBox, b: NodeBox, s = 1, offset = 0): Segment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * offset;
  const py = (dx / len) * offset;
  const shiftedA = { ...a, x: a.x + px, y: a.y + py };
  const shiftedB = { ...b, x: b.x + px, y: b.y + py };
  return { from: edgePoint(shiftedA, shiftedB, s), to: edgePoint(shiftedB, shiftedA, s) };
}

/** Desplazamientos perpendiculares para n cables entre el mismo par de equipos. */
export function parallelOffsets(count: number, gap = 14): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);
}

/**
 * Una línea de rótulo: anclada a un punto del mundo (ax, ay) y desplazada
 * (dx, dy) en píxeles de pantalla, que no escalan con el zoom.
 */
export interface LabelLine {
  readonly text: string;
  readonly ax: number;
  readonly ay: number;
  readonly dx: number;
  readonly dy: number;
  readonly anchor: 'start' | 'end';
  readonly tone: 'port' | 'address';
}

export interface PortBlock {
  readonly lines: readonly LabelLine[];
  /** Caja de cada línea en el mundo, a la escala de colocación: los choques se miden línea a línea. */
  readonly boxes: readonly Rect[];
  /** Caja de todo el bloque, para los límites de la figura. */
  readonly rect: Rect;
}

/**
 * Rótulo de un extremo de cable: el nombre del puerto con sus direcciones
 * debajo, siempre juntos y del mismo lado del cable, para que nadie lea el
 * puerto de un equipo con la dirección del otro.
 * - Cable casi horizontal: el bloque encima (o, en la variante, debajo).
 * - Cable inclinado: del lado contrario a la pendiente (la variante, al otro).
 * - Cable casi vertical: a un lado, del que se aleja la línea (la variante, al otro).
 *
 * Con `lift` (cable casi horizontal y corto), el bloque se sube (o baja, en la
 * variante) `lift.by` unidades hasta el borde de su propio equipo. Hacia
 * dentro se alinea con el arranque del cable y queda sobre su equipo; hacia
 * fuera arranca en el cable y queda sobre el hueco. Siempre del mismo lado.
 */
export function portBlock(
  at: Point,
  toward: Point,
  name: string,
  addresses: readonly string[],
  alternate = false,
  s = 1,
  lift: { readonly by: number; readonly inward: boolean } | null = null,
): PortBlock {
  const dx = toward.x - at.x;
  const dy = toward.y - at.y;
  const texts = [name, ...addresses];
  const count = texts.length;
  let offsetX: number;
  let anchor: 'start' | 'end';
  let above: boolean;
  let origin = at;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const rightward = dx >= 0;
    offsetX = rightward ? GAP : -GAP;
    anchor = rightward ? 'start' : 'end';
    const flat = Math.abs(dy / (dx || 1)) < 0.15;
    // Si la línea baja al alejarse, el bloque encima del arranque no la cruza.
    above = flat ? !alternate : dy > 0 !== alternate;
    if (lift !== null) {
      // Anclado al borde del equipo en el mundo: al hacer zoom sigue pegado a él.
      origin = { x: at.x, y: at.y + (above ? -lift.by : lift.by) };
      if (lift.inward) {
        offsetX = 0;
        anchor = rightward ? 'end' : 'start';
      }
    }
  } else {
    const toLeft = dx > 0 !== alternate;
    offsetX = toLeft ? -GAP : GAP;
    anchor = toLeft ? 'end' : 'start';
    above = dy < 0;
  }
  // Líneas de base en píxeles: el bloque entero de un lado, el nombre arriba.
  const baselines = above
    ? texts.map((_, i) => -6 - (count - 1 - i) * TEXT.line)
    : texts.map((_, i) => 16 + i * TEXT.line);

  const lines = texts.map(
    (text, i): LabelLine => ({
      text,
      ax: origin.x,
      ay: origin.y,
      dx: offsetX,
      dy: baselines[i] ?? 0,
      anchor,
      tone: i === 0 ? 'port' : 'address',
    }),
  );
  const boxes = lines.map((line): Rect => {
    const w = textWidth(line.text) * s;
    const x = origin.x + line.dx * s;
    return {
      x: anchor === 'start' ? x : x - w,
      y: origin.y + (line.dy - TEXT.ascent) * s,
      width: w,
      height: (TEXT.ascent + TEXT.descent) * s,
    };
  });
  const rect = boundsOfRects(boxes);
  return {
    lines,
    boxes,
    rect: rect
      ? { x: rect.minX, y: rect.minY, width: rect.maxX - rect.minX, height: rect.maxY - rect.minY }
      : { x: origin.x, y: origin.y, width: 0, height: 0 },
  };
}

export const overlaps = (a: Rect, b: Rect, gap = 2): boolean =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** ¿Atraviesa el tramo el rectángulo? Recorte de Liang–Barsky. */
export function segmentHitsRect(segment: Segment, rect: Rect): boolean {
  const { from, to } = segment;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, from.x - rect.x],
    [dx, rect.x + rect.width - from.x],
    [-dy, from.y - rect.y],
    [dy, rect.y + rect.height - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

export interface PortRequest {
  readonly key: string;
  readonly segment: Segment;
  readonly name: string;
  readonly addresses: readonly string[];
  /** Distancia del arranque a los bordes de arriba y de abajo de su equipo (pie incluido). */
  readonly room?: { readonly above: number; readonly below: number } | undefined;
}

/** Hueco por encima y por debajo de su equipo desde el arranque de un cable. */
export function roomAround(node: NodeBox, from: Point, s = 1): { above: number; below: number } {
  const top = node.y - node.height / 2;
  const bottom = node.y + node.height / 2 + (node.label ? FOOTER * s : 0);
  return { above: from.y - top, below: bottom - from.y };
}

/** Paso al deslizar un rótulo por su cable, en píxeles de pantalla. */
const SLIDE_STEP = 10;

/**
 * Rotula todos los extremos de cable a la escala 1/s. Si un rótulo pisa un
 * equipo u otro rótulo, prueba el otro lado del cable y, si tampoco cabe, se
 * desliza a lo largo del cable hasta encontrar hueco (sin pasar de la mitad).
 * Si el cable es demasiado corto, prueba encima o debajo de su propio equipo.
 * Si nada cabe se queda en el primer sitio y cuenta como choque.
 *
 * Se coloca de uno en uno, así que el orden importa: se prueba el dado, el de
 * cables más cortos primero (los que menos sitio tienen) y el inverso, y se
 * queda el que menos choques deja.
 */
export function placePortBlocks(
  requests: readonly PortRequest[],
  obstacles: readonly Rect[],
  s = 1,
): { blocks: Map<string, PortBlock>; collisions: number } {
  const length = (r: PortRequest) =>
    Math.hypot(r.segment.to.x - r.segment.from.x, r.segment.to.y - r.segment.from.y);
  const orders = [
    requests,
    [...requests].sort((a, b) => length(a) - length(b)),
    [...requests].reverse(),
  ];
  let best: { blocks: Map<string, PortBlock>; collisions: number } | null = null;
  for (const order of orders) {
    const result = placeInOrder(order, obstacles, s);
    if (!best || result.collisions < best.collisions) best = result;
    if (best.collisions === 0) break;
  }
  return best ?? { blocks: new Map(), collisions: 0 };
}

function placeInOrder(
  requests: readonly PortRequest[],
  obstacles: readonly Rect[],
  s: number,
): { blocks: Map<string, PortBlock>; collisions: number } {
  const placed = new Map<string, PortBlock>();
  const taken: Rect[] = [...obstacles];
  const cables = requests.map((r) => r.segment);
  let collisions = 0;
  for (const req of requests) {
    const { from, to } = req.segment;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const ux = len > 0 ? (to.x - from.x) / len : 0;
    const uy = len > 0 ? (to.y - from.y) / len : 0;
    const first = portBlock(from, to, req.name, req.addresses, false, s);
    const step = SLIDE_STEP * s;
    // Cabe si no pisa equipos ni otros rótulos y ningún cable le pasa por encima.
    const fits = (block: PortBlock) =>
      !block.boxes.some(
        (box) =>
          taken.some((r) => overlaps(box, r)) ||
          cables.some((cable) => segmentHitsRect(cable, box)),
      );
    let chosen: PortBlock | null = null;
    // En un cable inclinado, el otro lado del arranque queda bajo la propia línea:
    // solo los cables casi horizontales o casi verticales admiten la variante.
    const straight = Math.min(Math.abs(ux), Math.abs(uy)) < 0.15;
    for (let i = 0; !chosen && i * step <= Math.max(0, len / 2 - 16 * s); i++) {
      const at = { x: from.x + ux * i * step, y: from.y + uy * i * step };
      for (const alternate of straight ? [false, true] : [false]) {
        const block = portBlock(at, to, req.name, req.addresses, alternate, s);
        if (fits(block)) {
          chosen = block;
          break;
        }
      }
    }
    const { room } = req;
    if (!chosen && room && Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
      // Sobre (o bajo) su propio equipo y, si no, sobre (o bajo) el hueco del cable.
      const options = [true, false].flatMap((inward) =>
        [false, true].map((alternate) => ({ inward, alternate })),
      );
      for (const { inward, alternate } of options) {
        // Hacia qué lado iría el bloque: sube o baja justo hasta el borde de su equipo.
        const probe = portBlock(from, to, req.name, req.addresses, alternate, s);
        const up = (probe.lines[0]?.dy ?? 0) < 0;
        const by = up ? room.above : room.below;
        const over = portBlock(from, to, req.name, req.addresses, alternate, s, { by, inward });
        if (fits(over)) {
          chosen = over;
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

export function sceneBounds(
  nodes: readonly NodeBox[],
  labels: Iterable<PortBlock>,
  s = 1,
): Bounds | null {
  return boundsOfRects([...nodes.map((n) => nodeExtent(n, s)), ...[...labels].map((b) => b.rect)]);
}

/** Escala de encuadre como la de `fitView`: la figura entera, entre ZOOM_MIN y FIT_MAX. */
export function fitScale(bounds: Bounds, frame: Size): number {
  return Math.min(FIT_MAX, Math.max(ZOOM_MIN, rawFitScale(bounds, frame, 16)));
}

/**
 * El texto mide lo mismo en pantalla a cualquier zoom, así que su sitio en el
 * mundo depende de la escala, y la escala de encuadre depende de dónde cae el
 * texto. Se resuelve por aproximaciones: colocar a una escala, encuadrar,
 * volver a colocar a la nueva escala… hasta que se estabiliza.
 */
export function settleScale<T extends { readonly bounds: Bounds | null }>(
  frame: Size,
  compute: (s: number) => T,
): { k: number; result: T } {
  let k = 1;
  let result = compute(1);
  if (frame.width < 1 || frame.height < 1) return { k, result };
  for (let i = 0; i < 4; i++) {
    const next = result.bounds ? fitScale(result.bounds, frame) : 1;
    if (Math.abs(next - k) < 0.01) break;
    k = next;
    result = compute(1 / k);
  }
  return { k, result };
}

/**
 * Un cable de la topología con sus rótulos previstos: el reparto se decide
 * con ellos antes de que el estudiante teclee nada y no cambia con cada comando.
 */
export interface LinkSketch {
  readonly a: string;
  readonly aPort: string;
  readonly aAddresses: readonly string[];
  readonly b: string;
  readonly bPort: string;
  readonly bAddresses: readonly string[];
}

/** Dirección de relleno para un puerto que arranca sin ninguna: la mayoría de las del lab miden esto o menos. */
export const SAMPLE_ADDRESS = '192.168.100.1/24';
/** Factores de reparto por eje: por debajo de 1 acercan; por encima separan. */
const SPREADS = [1, 0.85, 0.7, 0.6, 1.25, 1.5] as const;

interface Trial {
  readonly arrangement: Arrangement;
  /**
   * Escala a la que la figura cabe entera en el marco, sin límites: por
   * debajo de ZOOM_MIN, al encuadrar se sale del marco y hay que desplazarla.
   */
  readonly scale: number;
  readonly crowded: boolean;
  readonly collisions: number;
}

function trial(
  specs: readonly NodeSpec[],
  links: readonly LinkSketch[],
  arrangement: Arrangement,
  frame: Size,
): Trial {
  const nodes = layoutNodes(specs, arrangement);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const place = (s: number) => {
    const requests: PortRequest[] = [];
    for (const [i, link] of links.entries()) {
      const a = byId.get(link.a);
      const b = byId.get(link.b);
      if (!a || !b) continue;
      const segment = cableSegment(a, b, s);
      requests.push({
        key: `${i}:a`,
        segment,
        name: link.aPort,
        addresses: link.aAddresses,
        room: roomAround(a, segment.from, s),
      });
      requests.push({
        key: `${i}:b`,
        segment: { from: segment.to, to: segment.from },
        name: link.bPort,
        addresses: link.bAddresses,
        room: roomAround(b, segment.to, s),
      });
    }
    const placed = placePortBlocks(
      requests,
      nodes.flatMap((n) => nodeObstacles(n, s)),
      s,
    );
    return { ...placed, bounds: sceneBounds(nodes, placed.blocks.values(), s), s };
  };
  const { result } = settleScale(frame, place);
  const scale = result.bounds ? rawFitScale(result.bounds, frame, 16) : 1;
  // Dos equipos se pisan si la forma o la etiqueta de uno toca la del otro.
  const parts = nodes.map((n) => nodeObstacles(n, result.s));
  const crowded = parts.some((a, i) =>
    parts.some((b, j) => j > i && a.some((ra) => b.some((rb) => overlaps(ra, rb, 12)))),
  );
  return {
    arrangement,
    scale,
    crowded,
    collisions: result.collisions,
  };
}

const distortion = (a: Arrangement): number => Math.abs(1 - a.sx) + Math.abs(1 - a.sy);

/**
 * ¿Es `t` mejor que `best`? Primero que no se pise texto: ni las etiquetas de
 * los equipos ni los rótulos de puerto. Luego, más grande (la que cabe en el
 * marco gana a la que no); luego la menos deformada. Un texto pisado es peor
 * que tener que desplazar la figura.
 */
function better(t: Trial, best: Trial): boolean {
  if (t.crowded !== best.crowded) return !t.crowded;
  if (t.collisions !== best.collisions) return t.collisions < best.collisions;
  // Trasponer solo compensa si se ve claramente más grande.
  const margin = t.arrangement.transpose !== best.arrangement.transpose ? 0.05 : 0.01;
  const gain = Math.min(t.scale, 1) - Math.min(best.scale, 1);
  if (Math.abs(gain) > margin) return gain > 0;
  if (t.arrangement.transpose !== best.arrangement.transpose) return !t.arrangement.transpose;
  return distortion(t.arrangement) < distortion(best.arrangement);
}

/**
 * Elige cómo repartir la figura en el marco: acerca o separa los equipos en
 * cada eje y, en marcos estrechos y altos (la pestaña del móvil), prueba a
 * trasponerla. Gana la que no pisa texto, luego la que se ve más grande
 * (hasta escala 1) y luego la menos deformada.
 */
export function arrangeFor(
  specs: readonly NodeSpec[],
  links: readonly LinkSketch[],
  frame: Size,
): Arrangement {
  if (frame.width < 1 || frame.height < 1) return NATURAL;
  const portrait = frame.width < 640 && frame.height > frame.width;
  let best = trial(specs, links, NATURAL, frame);
  for (const transpose of portrait ? [false, true] : [false]) {
    for (const sx of SPREADS) {
      for (const sy of SPREADS) {
        if (!transpose && sx === 1 && sy === 1) continue;
        const t = trial(specs, links, { transpose, sx, sy }, frame);
        if (better(t, best)) best = t;
      }
    }
  }
  return best.arrangement;
}
