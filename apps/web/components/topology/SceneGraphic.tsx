'use client';

import { memo } from 'react';
import type { SceneWire } from '@/lib/lab/scene';
import { fitText, type NodeBox, TEXT } from '@/lib/lab/topology';

/** Router: caja con una muesca arriba, como la ranura de un chasis. */
function routerPath(w: number, h: number): string {
  const l = -w / 2;
  const t = -h / 2;
  return `M ${l} ${t} H -10 V ${t + 4} H 10 V ${t} H ${-l} V ${-t} H ${l} Z`;
}

/** Nube de Internet compuesta de arcos, centrada en su caja de 128×60. */
const CLOUD =
  'M -54 29 H 50 A 20 20 0 0 0 52 -7 A 26 26 0 0 0 8 -21 A 30 30 0 0 0 -40 -11 A 22 22 0 0 0 -54 29 Z';

/** Ondas de un equipo inalámbrico: dos arcos y un punto, dentro de la caja. */
function wavesPath(cx: number, cy: number): string {
  const arc = (r: number) => {
    const d = r * Math.SQRT1_2;
    return `M ${cx - d} ${cy - d} A ${r} ${r} 0 0 1 ${cx + d} ${cy - d}`;
  };
  return `${arc(4)} ${arc(8)}`;
}

function Shape({
  node,
  stroke,
  strokeWidth,
  k,
}: {
  readonly node: NodeBox;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly k: number;
}) {
  const common = {
    fill: 'var(--color-sheet)',
    stroke,
    strokeWidth,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const { width: w, height: h } = node;
  // 2px de pantalla a cualquier zoom, como todas las esquinas de la interfaz.
  const rx = 2 / k;
  switch (node.role) {
    case 'router':
      return <path d={routerPath(w, h)} {...common} />;
    case 'cloud':
      return <path d={CLOUD} {...common} />;
    case 'host':
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={rx} {...common} />;
    case 'wireless-host':
      return (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={rx} {...common} />
          <path
            d={wavesPath(w / 2 - 14, 4)}
            fill="none"
            stroke="var(--color-ink-faint)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={w / 2 - 14} cy={4} r={1.2} fill="var(--color-ink-faint)" />
        </>
      );
  }
}

const DASH = {
  wired: { up: undefined, down: '4 4' },
  wireless: { up: '6 4', down: '2 4' },
} as const;

/** Tamaños en rem (respetan el zoom del navegador): 0.75rem y el paso de 13px. */
const SMALL = `${TEXT.small / 16}rem`;
const ID = `${TEXT.id / 16}rem`;

/** Alto de forma en pantalla por debajo del cual el nombre en vivo no cabe bajo el id. */
const TWO_LINES = 38;

/**
 * Lo que se dibuja en el lienzo. Formas y cables en unidades de mundo; el
 * texto se contraescala (scale 1/k) para medir siempre lo mismo en pantalla.
 * Es memo: desplazar no lo vuelve a pintar; el zoom sí, por el texto.
 */
export const SceneGraphic = memo(function SceneGraphic({
  nodes,
  identities,
  wires,
  active,
  highlighted,
  k,
}: {
  readonly nodes: readonly NodeBox[];
  /** Nombre en vivo de cada equipo, si difiere de su id. */
  readonly identities: ReadonlyMap<string, string | null>;
  readonly wires: readonly SceneWire[];
  readonly active: string | null;
  readonly highlighted: string | null;
  /** Escala actual del lienzo. */
  readonly k: number;
}) {
  const inverse = `scale(${1 / k})`;
  return (
    <>
      {wires.map(({ wire, segment, blocks }) => (
        <g key={wire.id}>
          <line
            x1={segment.from.x}
            y1={segment.from.y}
            x2={segment.to.x}
            y2={segment.to.y}
            stroke={wire.up ? 'var(--color-control)' : 'var(--color-rule-strong)'}
            strokeWidth={1.5}
            strokeDasharray={DASH[wire.kind][wire.up ? 'up' : 'down']}
            vectorEffect="non-scaling-stroke"
          />
          {blocks.map((block, end) =>
            block ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: los dos extremos de un cable son fijos (a, b)
              <g key={end}>
                {block.lines.map((line) => (
                  <text
                    key={`${line.tone}:${line.text}`}
                    transform={`translate(${line.ax} ${line.ay}) ${inverse}`}
                    x={line.dx}
                    y={line.dy}
                    textAnchor={line.anchor}
                    className={line.tone === 'port' ? 'fill-ink-muted' : 'fill-ink-faint'}
                    style={{ fontSize: SMALL }}
                  >
                    {line.text}
                  </text>
                ))}
              </g>
            ) : null,
          )}
        </g>
      ))}
      {nodes.map((node) => {
        const isActive = node.id === active;
        const stroke = isActive
          ? 'var(--color-ink)'
          : node.id === highlighted
            ? 'var(--color-control)'
            : 'var(--color-rule-strong)';
        // Medidas de la forma en pantalla: el texto se coloca en píxeles.
        const boxW = node.width * k;
        const boxH = node.height * k;
        const raw = identities.get(node.id) ?? null;
        const identity = raw && boxH >= TWO_LINES ? fitText(raw, boxW - 12) : null;
        const shift = node.role === 'cloud' ? 3 * k : 0;
        return (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <Shape node={node} stroke={stroke} strokeWidth={isActive ? 1.5 : 1} k={k} />
            <g transform={inverse}>
              <text
                y={(identity ? -4 : 4.5) + shift}
                textAnchor="middle"
                className="fill-ink font-semibold"
                style={{ fontSize: ID }}
              >
                {fitText(node.id, boxW - 8, TEXT.id)}
              </text>
              {identity && (
                <text
                  y={14 + shift}
                  textAnchor="middle"
                  className="fill-ink-muted"
                  style={{ fontSize: SMALL }}
                >
                  {identity}
                </text>
              )}
              {node.label && (
                <text
                  y={boxH / 2 + 15}
                  textAnchor="middle"
                  className="fill-ink-faint"
                  style={{ fontSize: SMALL }}
                >
                  {node.label}
                </text>
              )}
            </g>
          </g>
        );
      })}
    </>
  );
});
