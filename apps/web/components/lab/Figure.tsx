'use client';

import type { LabDevice } from '@nos/core';
import { deviceId } from '@nos/core';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';

const BOX_W = 132;
const BOX_H = 52;
const MARGIN = 40;

interface Placed {
  readonly spec: LabDevice;
  readonly x: number;
  readonly y: number;
}

/** Posición de cada equipo: la del YAML o, si falta, una fila ordenada. */
function place(devices: readonly LabDevice[]): Placed[] {
  return devices.map((spec, index) => ({
    spec,
    x: spec.position?.x ?? 120 + index * 220,
    y: spec.position?.y ?? 120,
  }));
}

/** Punto del borde de la caja en dirección a otro punto: los cables nacen del borde, no del centro. */
function edge(from: Placed, to: Placed): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : BOX_W / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : BOX_H / 2 / Math.abs(dy),
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/**
 * Figura estática de la topología, rotulada como en una guía de prácticas.
 * El lienzo interactivo llega en la fase 4; aquí ya se elige la consola.
 */
export function Figure() {
  const { locale, messages } = useI18n();
  const t = messages.lab;
  const topology = useLab((s) => s.runtime.lab.topology);
  const consoleDevices = useLab((s) => s.consoleDevices);
  const active = useLab((s) => s.activeDevice);
  const setActive = useLab((s) => s.setActiveDevice);

  const placed = place(topology.devices);
  const byId = new Map(placed.map((p) => [p.spec.id, p]));
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const minX = Math.min(...xs) - BOX_W / 2 - MARGIN;
  const minY = Math.min(...ys) - BOX_H / 2 - MARGIN;
  const width = Math.max(...xs) - Math.min(...xs) + BOX_W + MARGIN * 2;
  const height = Math.max(...ys) - Math.min(...ys) + BOX_H + MARGIN * 2;

  return (
    <figure className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pt-4">
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          width={width}
          height={height}
          className="h-auto max-h-full w-auto max-w-full"
          role="img"
          aria-labelledby="lab-figure-title"
        >
          <title id="lab-figure-title">{t.figureCaption}</title>
          {topology.links.map(([a, b]) => {
            const [devA = '', portA = ''] = a.split(':');
            const [devB = '', portB = ''] = b.split(':');
            const from = byId.get(devA);
            const to = byId.get(devB);
            if (!from || !to) return null;
            const start = edge(from, to);
            const end = edge(to, from);
            const label = (p: { x: number; y: number }, toward: { x: number; y: number }) => ({
              x: p.x + (toward.x - p.x) * 0.18,
              y: p.y + (toward.y - p.y) * 0.18 - 8,
            });
            const la = label(start, end);
            const lb = label(end, start);
            return (
              <g key={`${a}-${b}`}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="var(--color-rule-strong)"
                  strokeWidth={1.5}
                />
                <text x={la.x} y={la.y} textAnchor="middle" className="fill-ink-faint text-[11px]">
                  {portA}
                </text>
                <text x={lb.x} y={lb.y} textAnchor="middle" className="fill-ink-faint text-[11px]">
                  {portB}
                </text>
              </g>
            );
          })}
          {placed.map(({ spec, x, y }) => {
            const id = deviceId(spec.id);
            const hasConsole = consoleDevices.includes(id);
            const isActive = hasConsole && id === active;
            const body = (
              <>
                <rect
                  x={x - BOX_W / 2}
                  y={y - BOX_H / 2}
                  width={BOX_W}
                  height={BOX_H}
                  rx={2}
                  fill="var(--color-sheet)"
                  stroke={isActive ? 'var(--color-ink)' : 'var(--color-rule-strong)'}
                  strokeWidth={isActive ? 1.5 : 1}
                />
                <text
                  x={x}
                  y={y - 3}
                  textAnchor="middle"
                  className="fill-ink text-[13px] font-semibold"
                >
                  {spec.id}
                </text>
                {spec.label && (
                  <text x={x} y={y + 14} textAnchor="middle" className="fill-ink-faint text-[11px]">
                    {spec.label[locale]}
                  </text>
                )}
              </>
            );
            if (!hasConsole) return <g key={spec.id}>{body}</g>;
            return (
              // biome-ignore lint/a11y/useSemanticElements: un grupo SVG no puede ser <button>
              <g
                key={spec.id}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                aria-label={fill(t.consoleOf, { device: spec.id })}
                className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-ink"
                onClick={() => setActive(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActive(id);
                  }
                }}
              >
                {body}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption id="lab-figure-caption" className="px-5 pb-3 text-xs text-ink-faint">
        <span className="font-medium text-ink-muted">{t.figure}.</span> {t.figureCaption}
      </figcaption>
    </figure>
  );
}
