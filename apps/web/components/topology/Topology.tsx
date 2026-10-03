'use client';

import { BOARDS, deviceId } from '@nos/core';
import { CornersOut, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import { buildScene, sketchLinks } from '@/lib/lab/scene';
import { arrangeFor, layoutNodes, type NodeBox, type NodeSpec, roleOf } from '@/lib/lab/topology';
import { type Rect, ZOOM_MAX, ZOOM_MIN } from '@/lib/lab/viewport';
import { interfacesOf, liveIdentity } from '@/lib/lab/wiring';
import { INSPECTOR_ID, Inspector } from './Inspector';
import { SceneGraphic } from './SceneGraphic';
import { Summary } from './Summary';
import { useElementSize, useViewport } from './useViewport';

const KEYS_ID = 'topology-keys';

/**
 * Figura de la topología como lienzo interactivo: zoom con la rueda, el
 * pellizco o las teclas, desplazamiento arrastrando y detalle de cada equipo
 * al pasar o enfocar. Sigue siendo la "Fig. 1" del cuaderno, con su pie.
 */
export function Topology() {
  const { locale, messages } = useI18n();
  const t = messages.topology;
  const lab = messages.lab;
  const devices = useLab((s) => s.runtime.lab.topology.devices);
  // La red al cargar el lab: con ella se prevén los rótulos para el reparto.
  const initialNet = useLab((s) => s.runtime.net);
  const net = useLab((s) => s.net);
  const consoleDevices = useLab((s) => s.consoleDevices);
  const active = useLab((s) => s.activeDevice);
  const setActive = useLab((s) => s.setActiveDevice);

  const frameRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(frameRef);

  // La colocación solo depende de la topología, del idioma (las etiquetas) y del marco.
  const specs = useMemo<NodeSpec[]>(
    () =>
      devices.map((d) => ({
        id: d.id,
        role: roleOf(d.os, BOARDS[d.board]?.ports ?? []),
        position: d.position,
        label: d.label?.[locale] ?? null,
      })),
    [devices, locale],
  );
  const sketches = useMemo(() => sketchLinks(initialNet), [initialNet]);
  // El reparto se decide con el marco redondeado a 40px: no tiembla al arrastrar el separador.
  const qw = size ? Math.round(size.width / 40) * 40 : 0;
  const qh = size ? Math.round(size.height / 40) * 40 : 0;
  const arrangement = useMemo(
    () => arrangeFor(specs, sketches, { width: qw, height: qh }),
    [specs, sketches, qw, qh],
  );
  const nodes = useMemo(() => layoutNodes(specs, arrangement), [specs, arrangement]);
  // Los rótulos siguen a la red (se rehacen tras cada comando) y se colocan para
  // la escala de encuadre, porque el texto mide lo mismo en pantalla a cualquier zoom.
  const scene = useMemo(
    () => buildScene(nodes, net, { width: qw, height: qh }),
    [nodes, net, qw, qh],
  );

  const identities = useMemo(
    () =>
      new Map(
        nodes.map((node) => [
          node.id,
          liveIdentity(
            net.devices.find((d) => d.id === node.id),
            node.id,
          ),
        ]),
      ),
    [nodes, net.devices],
  );

  const { view, panning, zoomIn, zoomOut, fit, onKeyDown, pointer } = useViewport(
    frameRef,
    size,
    scene.bounds,
    nodes,
  );

  // Detalle: el equipo bajo el puntero o, si no, el enfocado. Esc lo oculta.
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const candidate = hovered ?? focused;
  const shown = panning || candidate === dismissed ? null : candidate;

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && shown) {
      event.preventDefault();
      setDismissed(shown);
      return;
    }
    if (onKeyDown(event)) event.preventDefault();
  };

  const screenRect = (node: NodeBox): Rect | null =>
    view
      ? {
          x: (node.x - node.width / 2) * view.k + view.x,
          y: (node.y - node.height / 2) * view.k + view.y,
          width: node.width * view.k,
          height: node.height * view.k,
        }
      : null;

  const shownNode = shown ? nodes.find((n) => n.id === shown) : undefined;
  const shownDevice = shown ? net.devices.find((d) => d.id === shown) : undefined;
  const shownRect = shownNode ? screenRect(shownNode) : null;

  return (
    // Rejilla: el lienzo arriba; abajo el pie de figura y, en la esquina, los controles de zoom.
    // El pie va primero en el DOM (un figcaption debe ser el primer o el último hijo).
    <figure className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto]">
      <figcaption
        id="lab-figure-caption"
        className="col-start-1 row-start-2 self-center px-5 pt-2 pb-3 text-xs text-ink-faint"
      >
        <span className="font-medium text-ink-muted">{lab.figure}.</span> {lab.figureCaption}.{' '}
        {lab.figureNote}
      </figcaption>
      {/* biome-ignore lint/a11y/useSemanticElements: un lienzo con zoom no es un fieldset */}
      <div
        ref={frameRef}
        role="group"
        aria-label={t.canvas}
        aria-describedby={KEYS_ID}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: el lienzo recibe las teclas de zoom y desplazamiento
        tabIndex={0}
        onKeyDown={handleKey}
        {...pointer}
        className={`relative col-span-2 row-start-1 min-h-0 touch-none overflow-hidden select-none focus-visible:outline-offset-[-2px] ${
          panning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <p id={KEYS_ID} className="sr-only">
          {t.keys}
        </p>
        {view && (
          <svg className="absolute inset-0 size-full" role="img" aria-labelledby="lab-figure-title">
            <title id="lab-figure-title">{`${lab.figure}. ${lab.figureCaption}`}</title>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <SceneGraphic
                nodes={nodes}
                identities={identities}
                wires={scene.wires}
                active={active}
                highlighted={shown}
                k={view.k}
              />
            </g>
          </svg>
        )}

        {view &&
          nodes.map((node) => {
            const rect = screenRect(node);
            if (!rect) return null;
            const id = deviceId(node.id);
            const hasConsole = consoleDevices.includes(id);
            const style = {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            };
            const events = {
              onPointerEnter: (e: { pointerType: string }) => {
                if (e.pointerType === 'mouse') {
                  setHovered(node.id);
                  setDismissed(null);
                }
              },
              onPointerLeave: () => setHovered((h) => (h === node.id ? null : h)),
              onFocus: () => {
                setFocused(node.id);
                setDismissed(null);
              },
              onBlur: () => setFocused((f) => (f === node.id ? null : f)),
            };
            const described = shown === node.id ? INSPECTOR_ID : undefined;
            if (hasConsole) {
              return (
                <button
                  key={node.id}
                  type="button"
                  data-node
                  aria-pressed={id === active}
                  aria-label={fill(lab.consoleOf, { device: node.id })}
                  aria-describedby={described}
                  onClick={() => setActive(id)}
                  {...events}
                  style={style}
                  className="absolute cursor-pointer rounded-sm"
                />
              );
            }
            const spec = specs.find((s) => s.id === node.id);
            return (
              <span
                key={node.id}
                data-node
                role="img"
                aria-label={`${node.id}, ${spec ? t.roles[spec.role] : ''}`}
                aria-describedby={described}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: se enfoca para mostrar su detalle con el teclado
                tabIndex={0}
                {...events}
                style={style}
                className="absolute rounded-sm"
              />
            );
          })}

        {shown && shownNode && shownRect && size && (
          <Inspector
            device={shown}
            role={shownNode.role}
            identity={liveIdentity(shownDevice, shown)}
            interfaces={shownDevice ? interfacesOf(shownDevice) : []}
            anchor={shownRect}
            frame={size}
          />
        )}
      </div>

      <fieldset className="col-start-2 row-start-2 m-0 mr-3 mb-2 flex min-w-0 divide-x divide-rule self-end rounded-sm border border-rule p-0">
        <legend className="sr-only">{t.controls}</legend>
        <ControlButton label={t.zoomIn} onClick={zoomIn} disabled={!view || view.k >= ZOOM_MAX}>
          <MagnifyingGlassPlus size={16} aria-hidden />
        </ControlButton>
        <ControlButton label={t.zoomOut} onClick={zoomOut} disabled={!view || view.k <= ZOOM_MIN}>
          <MagnifyingGlassMinus size={16} aria-hidden />
        </ControlButton>
        <ControlButton label={t.fit} onClick={fit} disabled={!view}>
          <CornersOut size={16} aria-hidden />
        </ControlButton>
      </fieldset>

      <Summary
        devices={specs.map((s) => ({
          id: s.id,
          role: s.role,
          label: devices.find((d) => d.id === s.id)?.label?.[locale] ?? null,
          active: s.id === active,
        }))}
        wires={scene.wires}
        net={net}
      />
    </figure>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center text-ink-faint hover:bg-rule hover:text-ink disabled:text-rule-strong disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
