/**
 * Matemática del lienzo: encuadre, zoom alrededor del puntero, límites,
 * pellizco y colocación del panel de detalle.
 */
import { describe, expect, it } from 'vitest';
import {
  type Bounds,
  boundsOfRects,
  clampScale,
  constrain,
  FIT_MAX,
  fitView,
  panBy,
  pinchView,
  placePopover,
  significantResize,
  toScreen,
  toWorld,
  wheelFactor,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
} from './viewport';

const BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };

describe('fitView', () => {
  it('centra la figura y la ajusta al eje que más aprieta', () => {
    const view = fitView(BOUNDS, { width: 432, height: 1000 }, 16);
    expect(view.k).toBeCloseTo(1);
    const centre = toScreen(view, { x: 200, y: 100 });
    expect(centre.x).toBeCloseTo(216);
    expect(centre.y).toBeCloseTo(500);
  });

  it('no amplía más allá de FIT_MAX aunque sobre sitio', () => {
    expect(fitView(BOUNDS, { width: 4000, height: 4000 }).k).toBe(FIT_MAX);
  });

  it('no baja de ZOOM_MIN en un marco diminuto', () => {
    expect(fitView(BOUNDS, { width: 40, height: 40 }).k).toBe(ZOOM_MIN);
  });
});

describe('zoomAt', () => {
  it('deja quieto el punto bajo el puntero', () => {
    const view = { x: 30, y: -20, k: 1 };
    const at = { x: 150, y: 90 };
    const before = toWorld(view, at);
    const after = zoomAt(view, 1.7, at);
    expect(after.k).toBeCloseTo(1.7);
    const world = toWorld(after, at);
    expect(world.x).toBeCloseTo(before.x);
    expect(world.y).toBeCloseTo(before.y);
  });

  it('respeta los límites de zoom', () => {
    expect(zoomAt({ x: 0, y: 0, k: 2.5 }, 4, { x: 0, y: 0 }).k).toBe(ZOOM_MAX);
    expect(zoomAt({ x: 0, y: 0, k: 0.6 }, 0.1, { x: 0, y: 0 }).k).toBe(ZOOM_MIN);
    expect(clampScale(10)).toBe(ZOOM_MAX);
  });

  it('en el límite no desplaza la vista', () => {
    const view = { x: 10, y: 10, k: ZOOM_MAX };
    expect(zoomAt(view, 2, { x: 100, y: 100 })).toEqual(view);
  });
});

describe('constrain', () => {
  const size = { width: 300, height: 200 };
  it('no toca una vista razonable', () => {
    const view = { x: 0, y: 0, k: 1 };
    expect(constrain(view, BOUNDS, size)).toBe(view);
  });

  it('trae de vuelta una figura arrastrada fuera del marco', () => {
    const lost = panBy({ x: 0, y: 0, k: 1 }, -5000, 5000);
    const back = constrain(lost, BOUNDS, size);
    const right = BOUNDS.maxX * back.k + back.x;
    const top = BOUNDS.minY * back.k + back.y;
    expect(right).toBeGreaterThanOrEqual(48);
    expect(top).toBeLessThanOrEqual(size.height - 48);
  });
});

describe('wheelFactor', () => {
  it('rueda hacia arriba acerca y hacia abajo aleja', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
  });

  it('el pellizco del trackpad (Ctrl) responde más con deltas pequeños', () => {
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
  });

  it('pasa líneas a píxeles y limita los saltos enormes', () => {
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false));
    expect(wheelFactor(-100000, 0, false)).toBeCloseTo(wheelFactor(-300, 0, false));
  });
});

describe('pinchView', () => {
  it('separar los dedos acerca alrededor de su punto medio', () => {
    const view = { x: 0, y: 0, k: 1 };
    const next = pinchView(
      view,
      [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
      ],
      [
        { x: 80, y: 100 },
        { x: 120, y: 100 },
      ],
    );
    expect(next.k).toBeCloseTo(2);
    const world = toWorld(next, { x: 100, y: 100 });
    expect(world.x).toBeCloseTo(100);
  });

  it('mover los dos dedos juntos desplaza sin escalar', () => {
    const next = pinchView(
      { x: 0, y: 0, k: 1 },
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 5, y: 7 },
        { x: 15, y: 7 },
      ],
    );
    expect(next).toEqual({ x: 5, y: 7, k: 1 });
  });
});

describe('significantResize', () => {
  it('un marco sin medir o vacío siempre obliga a encuadrar', () => {
    expect(significantResize(null, { width: 10, height: 10 })).toBe(true);
    expect(significantResize({ width: 0, height: 0 }, { width: 300, height: 200 })).toBe(true);
  });

  it('cambios pequeños no; un 20% sí', () => {
    const prev = { width: 500, height: 300 };
    expect(significantResize(prev, { width: 520, height: 310 })).toBe(false);
    expect(significantResize(prev, { width: 600, height: 300 })).toBe(true);
  });
});

describe('placePopover', () => {
  const frame = { width: 600, height: 300 };
  const panel = { width: 200, height: 120 };

  it('prefiere la derecha', () => {
    const at = placePopover({ x: 50, y: 40, width: 100, height: 50 }, panel, frame);
    expect(at).toEqual({ left: 158, top: 40, side: 'right' });
  });

  it('se da la vuelta a la izquierda si no cabe', () => {
    const at = placePopover({ x: 380, y: 40, width: 100, height: 50 }, panel, frame);
    expect(at.side).toBe('left');
    expect(at.left).toBe(172);
  });

  it('baja dentro del marco si el equipo está pegado al borde inferior', () => {
    const at = placePopover({ x: 50, y: 260, width: 100, height: 30 }, panel, frame);
    expect(at.top + panel.height).toBeLessThanOrEqual(frame.height);
  });

  it('en un marco estrecho se pone debajo o encima', () => {
    const narrow = { width: 260, height: 400 };
    const below = placePopover({ x: 60, y: 20, width: 140, height: 50 }, panel, narrow);
    expect(below.side).toBe('below');
    expect(below.top).toBe(78);
    const above = placePopover({ x: 60, y: 300, width: 140, height: 50 }, panel, narrow);
    expect(above.side).toBe('above');
  });
});

describe('boundsOfRects', () => {
  it('une rectángulos y devuelve null si no hay', () => {
    expect(boundsOfRects([])).toBeNull();
    expect(
      boundsOfRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: -5, y: 20, width: 10, height: 5 },
      ]),
    ).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 25 });
  });
});
