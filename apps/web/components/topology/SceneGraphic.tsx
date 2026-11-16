'use client';

import { memo } from 'react';
import type { SceneWire } from '@/lib/lab/scene';
import { fitText, ICON, type NodeBox, TEXT } from '@/lib/lab/topology';

/**
 * El equipo: su icono de topología de Cisco, tal cual (D-045). El icono no se
 * toca; lo activo se marca con un recuadro alrededor, en píxeles de pantalla.
 */
function Shape({
  node,
  ring,
  k,
}: {
  readonly node: NodeBox;
  /** Color del recuadro de selección; null si el equipo no está activo ni señalado. */
  readonly ring: string | null;
  readonly k: number;
}) {
  const { width: w, height: h } = node;
  const pad = 6 / k;
  return (
    <>
      {ring && (
        <rect
          x={-w / 2 - pad}
          y={-h / 2 - pad}
          width={w + pad * 2}
          height={h + pad * 2}
          rx={2 / k}
          fill="none"
          stroke={ring}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <image
        href={ICON[node.role]}
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
      />
    </>
  );
}

const DASH = {
  wired: { up: undefined, down: '4 4' },
  wireless: { up: '6 4', down: '2 4' },
} as const;

/** Tamaños en rem (respetan el zoom del navegador): 0.75rem y el paso de 13px. */
const SMALL = `${TEXT.small / 16}rem`;
const ID = `${TEXT.id / 16}rem`;

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
        const ring =
          node.id === active
            ? 'var(--color-ink)'
            : node.id === highlighted
              ? 'var(--color-control)'
              : null;
        // Alto del icono en pantalla: el texto va debajo, en píxeles.
        const boxH = node.height * k;
        const raw = identities.get(node.id) ?? null;
        const identity = raw ? fitText(raw, 112) : null;
        // Bajo el icono, como en un diagrama: el id con el nombre en vivo al lado y,
        // en la línea siguiente, la etiqueta.
        const base = boxH / 2;
        return (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <Shape node={node} ring={ring} k={k} />
            <g transform={inverse}>
              <text y={base + 15} textAnchor="middle" style={{ fontSize: SMALL }}>
                <tspan className="fill-ink font-semibold" style={{ fontSize: ID }}>
                  {fitText(node.id, 64, TEXT.id)}
                </tspan>
                {identity && <tspan className="fill-ink-muted">{` ${identity}`}</tspan>}
              </text>
              {node.label && (
                <text
                  y={base + 31}
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
