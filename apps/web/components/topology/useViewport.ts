'use client';

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type Bounds,
  constrain,
  fitView,
  PAN_STEP,
  type Point,
  panBy,
  pinchView,
  type Size,
  significantResize,
  type Viewport,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
} from '@/lib/lab/viewport';

/** Tamaño del elemento, al píxel; null hasta la primera medida. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (w: number, h: number) => {
      const width = Math.round(w);
      const height = Math.round(h);
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    // Primera medida ya, sin esperar al observador (que no avisa si la página no pinta).
    update(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function pointIn(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export interface ViewportControls {
  readonly view: Viewport | null;
  readonly panning: boolean;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Teclas del lienzo: + − flechas 0. Devuelve true si la tecla era suya. */
  onKeyDown(event: KeyboardEvent): boolean;
  readonly pointer: {
    onPointerDown(event: PointerEvent<HTMLElement>): void;
    onPointerMove(event: PointerEvent<HTMLElement>): void;
    onPointerUp(event: PointerEvent<HTMLElement>): void;
    onPointerCancel(event: PointerEvent<HTMLElement>): void;
  };
}

/**
 * Zoom y desplazamiento del lienzo. Encuadra al montar y, mientras el
 * estudiante no mueva la vista, cada vez que cambian el marco o la figura;
 * si ya la movió, solo cuando el marco cambia de tamaño de forma notable.
 */
export function useViewport(
  frameRef: RefObject<HTMLElement | null>,
  size: Size | null,
  bounds: Bounds | null,
  /** Cambia cuando cambia la colocación de los equipos: entonces se vuelve a encuadrar. */
  layout: unknown,
): ViewportControls {
  const [view, setView] = useState<Viewport | null>(null);
  const [panning, setPanning] = useState(false);
  const auto = useRef(true);
  const fittedAt = useRef<Size | null>(null);
  const fittedLayout = useRef<unknown>(null);
  const sizeRef = useRef(size);
  const boundsRef = useRef(bounds);
  sizeRef.current = size;
  boundsRef.current = bounds;

  useEffect(() => {
    if (!size || size.width < 1 || size.height < 1 || !bounds) return;
    const moved = fittedLayout.current !== layout;
    if (auto.current || moved || significantResize(fittedAt.current, size)) {
      auto.current = true;
      fittedAt.current = size;
      fittedLayout.current = layout;
      setView(fitView(bounds, size));
    }
  }, [size, bounds, layout]);

  /** Cambio manual de la vista: deja de encuadrar sola y no pierde la figura. */
  const update = useCallback((change: (view: Viewport) => Viewport) => {
    const s = sizeRef.current;
    const b = boundsRef.current;
    if (!s || !b) return;
    auto.current = false;
    setView((current) => (current ? constrain(change(current), b, s) : current));
  }, []);

  const centre = (): Point => ({
    x: (sizeRef.current?.width ?? 0) / 2,
    y: (sizeRef.current?.height ?? 0) / 2,
  });

  const fit = useCallback(() => {
    const s = sizeRef.current;
    const b = boundsRef.current;
    if (!s || !b) return;
    auto.current = true;
    fittedAt.current = s;
    setView(fitView(b, s));
  }, []);

  // La rueda se escucha a mano: React registra `wheel` como pasivo y no deja cancelarla.
  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = pointIn(element, event.clientX, event.clientY);
      const factor = wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey);
      update((v) => zoomAt(v, factor, at));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [frameRef, update]);

  // Punteros activos (ratón, lápiz o dedos), en coordenadas del marco.
  const pointers = useRef(new Map<number, Point>());

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // Los equipos y los controles son botones: ahí no empieza un arrastre.
    if (event.target instanceof Element && event.target.closest('button, [data-node]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Con la captura, el arrastre sigue aunque el puntero salga del marco.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Un puntero que ya no está activo no se puede capturar; el arrastre funciona igual dentro.
    }
    pointers.current.set(
      event.pointerId,
      pointIn(event.currentTarget, event.clientX, event.clientY),
    );
    setPanning(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const map = pointers.current;
    const previous = map.get(event.pointerId);
    if (!previous) return;
    const next = pointIn(event.currentTarget, event.clientX, event.clientY);
    if (map.size === 1) {
      update((v) => panBy(v, next.x - previous.x, next.y - previous.y));
    } else if (map.size === 2) {
      const other = [...map.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other) update((v) => pinchView(v, [previous, other], [next, other]));
    }
    map.set(event.pointerId, next);
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setPanning(false);
  };

  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const step = event.shiftKey ? PAN_STEP * 3 : PAN_STEP;
    switch (event.key) {
      case '+':
      case '=':
        update((v) => zoomAt(v, ZOOM_STEP, centre()));
        return true;
      case '-':
      case '_':
      case '−':
        update((v) => zoomAt(v, 1 / ZOOM_STEP, centre()));
        return true;
      case '0':
        fit();
        return true;
      case 'ArrowLeft':
        update((v) => panBy(v, step, 0));
        return true;
      case 'ArrowRight':
        update((v) => panBy(v, -step, 0));
        return true;
      case 'ArrowUp':
        update((v) => panBy(v, 0, step));
        return true;
      case 'ArrowDown':
        update((v) => panBy(v, 0, -step));
        return true;
      default:
        return false;
    }
  };

  return {
    view,
    panning,
    zoomIn: () => update((v) => zoomAt(v, ZOOM_STEP, centre())),
    zoomOut: () => update((v) => zoomAt(v, 1 / ZOOM_STEP, centre())),
    fit,
    onKeyDown,
    pointer: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  };
}
