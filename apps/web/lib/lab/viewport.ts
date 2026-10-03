/**
 * Matemática del lienzo de topología: encuadre, zoom alrededor de un punto,
 * desplazamiento, pellizco y colocación del panel de detalle. Todo puro, sin
 * DOM: la pantalla es `mundo × k + (x, y)`.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Traslación (x, y) en píxeles de pantalla y escala k. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
/** Al encuadrar no se pasa de 1,5×: es el tamaño natural de la figura estática. */
export const FIT_MAX = 1.5;
/** Paso de los botones y de las teclas + y −. */
export const ZOOM_STEP = 1.25;
/** Desplazamiento de una flecha, en píxeles de pantalla (con Mayús, el triple). */
export const PAN_STEP = 40;
/** Píxeles de la figura que siempre quedan a la vista al desplazar. */
const KEEP_VISIBLE = 48;

export const clampScale = (k: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

export function boundsOfRects(rects: readonly Rect[]): Bounds | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Escala a la que la figura cabe entera en el marco, sin límites. */
export function rawFitScale(bounds: Bounds, size: Size, padding: number): number {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  return Math.min(availW / w, availH / h);
}

/** Encuadre: la figura centrada y tan grande como quepa, sin pasar de FIT_MAX. */
export function fitView(bounds: Bounds, size: Size, padding = 16): Viewport {
  const k = Math.min(FIT_MAX, Math.max(ZOOM_MIN, rawFitScale(bounds, size, padding)));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { k, x: size.width / 2 - cx * k, y: size.height / 2 - cy * k };
}

/** Zoom por un factor dejando quieto el punto de pantalla `at` (el puntero). */
export function zoomAt(view: Viewport, factor: number, at: Point): Viewport {
  const k = clampScale(view.k * factor);
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

export const panBy = (view: Viewport, dx: number, dy: number): Viewport => ({
  k: view.k,
  x: view.x + dx,
  y: view.y + dy,
});

export const toScreen = (view: Viewport, p: Point): Point => ({
  x: p.x * view.k + view.x,
  y: p.y * view.k + view.y,
});

export const toWorld = (view: Viewport, p: Point): Point => ({
  x: (p.x - view.x) / view.k,
  y: (p.y - view.y) / view.k,
});

/**
 * No deja que la figura se pierda de vista: al menos KEEP_VISIBLE píxeles de
 * ella quedan dentro del marco en cada eje.
 */
export function constrain(view: Viewport, bounds: Bounds, size: Size): Viewport {
  const left = bounds.minX * view.k + view.x;
  const right = bounds.maxX * view.k + view.x;
  const top = bounds.minY * view.k + view.y;
  const bottom = bounds.maxY * view.k + view.y;
  const keepX = Math.min(KEEP_VISIBLE, (right - left) / 2, size.width / 2);
  const keepY = Math.min(KEEP_VISIBLE, (bottom - top) / 2, size.height / 2);
  let dx = 0;
  let dy = 0;
  if (right < keepX) dx = keepX - right;
  else if (left > size.width - keepX) dx = size.width - keepX - left;
  if (bottom < keepY) dy = keepY - bottom;
  else if (top > size.height - keepY) dy = size.height - keepY - top;
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}

/**
 * Factor de zoom de un evento de rueda. El pellizco del trackpad llega como
 * rueda con Ctrl y deltas pequeños: se amplifica para que responda igual.
 * `deltaMode` 1 son líneas y 2 páginas; se pasan a píxeles aproximados.
 */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const sensitivity = ctrlKey ? 0.01 : 0.0015;
  // Un salto de rueda enorme no debe multiplicar el zoom de golpe.
  const clamped = Math.max(-300, Math.min(300, pixels));
  return Math.exp(-clamped * sensitivity);
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Pellizco con dos dedos: escala por la razón de distancias y sigue al punto medio. */
export function pinchView(
  view: Viewport,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
): Viewport {
  const d0 = distance(before[0], before[1]);
  const d1 = distance(after[0], after[1]);
  const m0 = midpoint(before[0], before[1]);
  const m1 = midpoint(after[0], after[1]);
  const moved = panBy(view, m1.x - m0.x, m1.y - m0.y);
  return d0 < 1 ? moved : zoomAt(moved, d1 / d0, m1);
}

/** ¿Cambió el marco lo bastante como para volver a encuadrar? */
export function significantResize(previous: Size | null, next: Size, threshold = 0.15): boolean {
  if (!previous || previous.width < 1 || previous.height < 1) return true;
  return (
    Math.abs(next.width - previous.width) / previous.width > threshold ||
    Math.abs(next.height - previous.height) / previous.height > threshold
  );
}

export type Side = 'right' | 'left' | 'below' | 'above';

export interface Placement {
  readonly left: number;
  readonly top: number;
  readonly side: Side;
}

/**
 * Coloca un panel junto a un rectángulo: a la derecha si cabe, si no a la
 * izquierda, debajo o encima; y siempre dentro del marco.
 */
export function placePopover(anchor: Rect, panel: Size, frame: Size, gap = 8): Placement {
  const fitsX = (left: number) => left >= 0 && left + panel.width <= frame.width;
  const fitsY = (top: number) => top >= 0 && top + panel.height <= frame.height;
  const clampX = (left: number) => Math.max(0, Math.min(left, frame.width - panel.width));
  const clampY = (top: number) => Math.max(0, Math.min(top, frame.height - panel.height));

  const right = anchor.x + anchor.width + gap;
  const left = anchor.x - gap - panel.width;
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap - panel.height;
  const alignedTop = clampY(anchor.y);
  const centredLeft = clampX(anchor.x + anchor.width / 2 - panel.width / 2);

  if (fitsX(right)) return { left: right, top: alignedTop, side: 'right' };
  if (fitsX(left)) return { left, top: alignedTop, side: 'left' };
  if (fitsY(below)) return { left: centredLeft, top: below, side: 'below' };
  if (fitsY(above)) return { left: centredLeft, top: above, side: 'above' };
  // Nada cabe del todo: el lado con más espacio, recortado al marco.
  const roomRight = frame.width - (anchor.x + anchor.width);
  return roomRight >= anchor.x
    ? { left: clampX(right), top: alignedTop, side: 'right' }
    : { left: clampX(left), top: alignedTop, side: 'left' };
}
