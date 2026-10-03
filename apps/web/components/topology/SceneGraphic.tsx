'use client';

import { memo } from 'react';
import type { SceneWire } from '@/lib/lab/scene';
import { FOOTER, type NodeBox, TEXT } from '@/lib/lab/topology';

export interface NodeMeta {
  /** Nombre en vivo, recortado para caber en la forma; null si coincide con el id. */
  readonly identity: string | null;
  /** Etiqueta del equipo en el idioma de la interfaz, recortada. */
  readonly label: string | null;
}

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
}: {
  readonly node: NodeBox;
  readonly stroke: string;
  readonly strokeWidth: number;
}) {
  const common = {
    fill: 'var(--color-sheet)',
    stroke,
    strokeWidth,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const { width: w, height: h } = node;
  switch (node.role) {
    case 'router':
      return <path d={routerPath(w, h)} {...common} />;
    case 'cloud':
      return <path d={CLOUD} {...common} />;
    case 'host':
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} {...common} />;
    case 'wireless-host':
      return (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} {...common} />
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

/**
 * Lo que se dibuja en el lienzo, en unidades de mundo. Es memo: el zoom y el
 * desplazamiento solo cambian la transformación del grupo que lo contiene.
 */
export const SceneGraphic = memo(function SceneGraphic({
  nodes,
  meta,
  wires,
  active,
  highlighted,
}: {
  readonly nodes: readonly NodeBox[];
  readonly meta: ReadonlyMap<string, NodeMeta>;
  readonly wires: readonly SceneWire[];
  readonly active: string | null;
  readonly highlighted: string | null;
}) {
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
                    x={line.x}
                    y={line.y}
                    textAnchor={line.anchor}
                    className={`text-[11px] ${line.tone === 'port' ? 'fill-ink-muted' : 'fill-ink-faint'}`}
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
        const info = meta.get(node.id);
        const isActive = node.id === active;
        const stroke = isActive
          ? 'var(--color-ink)'
          : node.id === highlighted
            ? 'var(--color-control)'
            : 'var(--color-rule-strong)';
        const identity = info?.identity ?? null;
        const shift = node.role === 'cloud' ? 4 : 0;
        return (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <Shape node={node} stroke={stroke} strokeWidth={isActive ? 1.5 : 1} />
            <text
              y={(identity ? -3 : 4.5) + shift}
              textAnchor="middle"
              className="fill-ink font-semibold"
              style={{ fontSize: TEXT.id }}
            >
              {node.id}
            </text>
            {identity && (
              <text y={13 + shift} textAnchor="middle" className="fill-ink-muted text-[11px]">
                {identity}
              </text>
            )}
            {info?.label && (
              <text
                y={node.height / 2 + FOOTER - 6}
                textAnchor="middle"
                className="fill-ink-faint text-[11px]"
              >
                {info.label}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
});
