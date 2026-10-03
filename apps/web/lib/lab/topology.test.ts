/**
 * Geometría de la figura: papeles, colocación, bordes de los cables, rótulos
 * sin solapes y el reparto que mantiene el texto legible en marcos pequeños.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARDS, type LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { buildScene, sketchLinks } from './scene';
import { createLabStore } from './store';
import {
  arrangeFor,
  edgePoint,
  fitText,
  type LinkSketch,
  layoutNodes,
  NATURAL,
  type NodeSpec,
  nodeObstacles,
  nodeRect,
  overlaps,
  parallelOffsets,
  placePortBlocks,
  portBlock,
  roleOf,
  SHAPE,
  segmentHitsRect,
} from './topology';
import { type Point, type Rect, rawFitScale, ZOOM_MIN } from './viewport';

const labFile = (name: string): LabDefinition => {
  const file = join(import.meta.dirname, '../../../../content/labs/routeros', name);
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const specsOf = (lab: LabDefinition): NodeSpec[] =>
  lab.topology.devices.map((d) => ({
    id: d.id,
    role: roleOf(d.os, BOARDS[d.board]?.ports ?? []),
    position: d.position,
    label: d.label?.es ?? null,
  }));

const sketchesOf = (lab: LabDefinition): LinkSketch[] =>
  sketchLinks(createLabStore(lab).getState().runtime.net);

/** Pares de rectángulos que se pisan. */
function clashes(rects: readonly Rect[]): number {
  let count = 0;
  rects.forEach((a, i) => {
    rects.forEach((b, j) => {
      if (j > i && overlaps(a, b, 0)) count += 1;
    });
  });
  return count;
}

describe('roleOf', () => {
  it('distingue router, equipo, equipo inalámbrico e Internet', () => {
    expect(roleOf('routeros', BOARDS['sim-r5w']?.ports ?? [])).toBe('router');
    expect(roleOf('host', BOARDS['sim-host']?.ports ?? [])).toBe('host');
    expect(roleOf('host', BOARDS['sim-host-w']?.ports ?? [])).toBe('wireless-host');
    expect(roleOf('internet', BOARDS['sim-cloud']?.ports ?? [])).toBe('cloud');
  });
});

describe('layoutNodes', () => {
  const specs: NodeSpec[] = [
    { id: 'R1', role: 'router', position: { x: 200, y: 120 } },
    { id: 'PC1', role: 'host', position: { x: 560, y: 120 } },
  ];

  it('usa las posiciones del YAML tal cual', () => {
    const [r1, pc1] = layoutNodes(specs);
    expect(r1).toMatchObject({ x: 200, y: 120, width: SHAPE.router.width });
    expect(pc1).toMatchObject({ x: 560, y: 120 });
  });

  it('traspone y aprieta alrededor del centro sin cambiar el tamaño de las formas', () => {
    const [r1, pc1] = layoutNodes(specs, { transpose: true, sx: 1, sy: 0.5 });
    expect(r1?.x).toBe(pc1?.x);
    expect(Math.abs((pc1?.y ?? 0) - (r1?.y ?? 0))).toBe(180);
    expect(r1?.width).toBe(SHAPE.router.width);
  });

  it('coloca los equipos sin posición en una fila aparte, la nube encima', () => {
    const nodes = layoutNodes([
      ...specs,
      { id: 'ISP', role: 'cloud' },
      { id: 'PC2', role: 'host' },
    ]);
    const isp = nodes.find((n) => n.id === 'ISP');
    const pc2 = nodes.find((n) => n.id === 'PC2');
    expect(isp?.y).toBeLessThan(120);
    expect(pc2?.y).toBeGreaterThan(120);
    expect(clashes(nodes.map((n) => nodeRect(n)))).toBe(0);
  });
});

describe('edgePoint', () => {
  const [node] = layoutNodes([{ id: 'R1', role: 'router', position: { x: 0, y: 0 } }]);
  if (!node) throw new Error('sin nodo');

  it('sale por el lado de la caja hacia un equipo a la derecha', () => {
    expect(edgePoint(node, { x: 500, y: 0 })).toEqual({ x: 66, y: 0 });
  });

  it('sale por debajo de la forma (y de su etiqueta, si tiene) hacia un equipo de abajo', () => {
    expect(edgePoint(node, { x: 0, y: 500 }).y).toBe(node.height / 2 + 4);
    const [labelled] = layoutNodes([
      { id: 'R1', role: 'router', position: { x: 0, y: 0 }, label: 'Router' },
    ]);
    if (!labelled) throw new Error('sin nodo');
    expect(edgePoint(labelled, { x: 0, y: 500 }, 2).y).toBe(labelled.height / 2 + 40);
  });

  it('en diagonal toca el borde, no lo atraviesa', () => {
    const p = edgePoint(node, { x: 300, y: 300 });
    const r = nodeRect(node);
    const onX = Math.abs(p.x - (r.x + r.width)) < 1e-9;
    const onY = Math.abs(p.y - (r.y + r.height)) < 1e-9;
    expect(onX || onY).toBe(true);
  });
});

describe('portBlock', () => {
  it('cable horizontal: nombre y direcciones juntos encima, alejándose del equipo', () => {
    const block = portBlock({ x: 100, y: 50 }, { x: 400, y: 50 }, 'ether2', ['10.0.0.1/24']);
    const [name, address] = block.lines;
    expect(name?.anchor).toBe('start');
    expect(name?.dy).toBeLessThan(address?.dy ?? 0);
    expect(address?.dy).toBeLessThan(0);
    expect(block.rect.x).toBeGreaterThan(100);
  });

  it('la variante pone el bloque entero debajo, con el nombre arriba', () => {
    const block = portBlock({ x: 400, y: 50 }, { x: 100, y: 50 }, 'eth0', ['10.0.0.2/24'], true);
    const [name, address] = block.lines;
    expect(name?.anchor).toBe('end');
    expect(name?.dy).toBeGreaterThan(0);
    expect(address?.dy).toBeGreaterThan(name?.dy ?? 0);
  });

  it('cable vertical: el bloque a un lado, debajo del arranque', () => {
    const block = portBlock({ x: 100, y: 50 }, { x: 100, y: 300 }, 'ether2', ['10.0.0.1/24']);
    expect(block.rect.x).toBeGreaterThan(100);
    expect(block.rect.y).toBeGreaterThan(50);
  });

  it('el texto ocupa en el mundo lo que mide en pantalla a la escala de colocación', () => {
    const at = { x: 0, y: 0 };
    const toward = { x: 500, y: 0 };
    const near = portBlock(at, toward, 'ether2', ['10.0.0.1/24'], false, 1);
    const far = portBlock(at, toward, 'ether2', ['10.0.0.1/24'], false, 2);
    expect(far.rect.width).toBeCloseTo(near.rect.width * 2);
    expect(far.lines[0]?.dy).toBe(near.lines[0]?.dy);
  });
});

describe('placePortBlocks', () => {
  it('reparte los dos extremos de un cable corto a lados opuestos sin pisarse', () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 190, y: 0 } };
    const { blocks, collisions } = placePortBlocks(
      [
        { key: 'a', segment, name: 'ether3', addresses: ['203.0.113.2/30'] },
        {
          key: 'b',
          segment: { from: segment.to, to: segment.from },
          name: 'eth0',
          addresses: ['203.0.113.1/30'],
        },
      ],
      [],
    );
    expect(collisions).toBe(0);
    const rects = [...blocks.values()].flatMap((b) => b.boxes);
    expect(clashes(rects)).toBe(0);
  });

  it('cuenta el choque si no hay sitio en ninguna variante', () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 40, y: 0 } };
    const long = ['255.255.255.255/32', '255.255.255.254/32'];
    const { collisions } = placePortBlocks(
      [
        { key: 'a', segment, name: 'ether1', addresses: long },
        {
          key: 'b',
          segment: { from: segment.to, to: segment.from },
          name: 'ether1',
          addresses: long,
        },
      ],
      [{ x: -400, y: -400, width: 800, height: 395 }],
    );
    expect(collisions).toBeGreaterThan(0);
  });
});

/** Marcos de las verificaciones: escritorio por defecto, escritorio amplio y la pestaña del móvil. */
const FRAMES = {
  desktop: { width: 880, height: 248 },
  wide: { width: 1039, height: 290 },
  phone: { width: 343, height: 600 },
} as const;

/** Escena tal como se pinta: reparto elegido para el marco y rótulos colocados a la escala de encuadre. */
function sceneFor(name: string, frame: { width: number; height: number }) {
  const lab = labFile(name);
  const specs = specsOf(lab);
  const nodes = layoutNodes(specs, arrangeFor(specs, sketchesOf(lab), frame));
  const scene = buildScene(nodes, createLabStore(lab).getState().net, frame);
  return { nodes, scene };
}

/** Lado del cable en el que cae un punto: signo del producto vectorial. */
const sideOf = (from: Point, to: Point, p: Point): number =>
  Math.sign((to.x - from.x) * (p.y - from.y) - (to.y - from.y) * (p.x - from.x));

describe('arrangeFor', () => {
  it('con sitio de sobra deja el YAML tal cual', () => {
    const lab = labFile('03-rutas-estaticas.yaml');
    expect(arrangeFor(specsOf(lab), sketchesOf(lab), { width: 1600, height: 900 })).toEqual(
      NATURAL,
    );
  });

  it('en un panel bajo acerca las filas: la figura sale más grande', () => {
    const lab = labFile('03-rutas-estaticas.yaml');
    const specs = specsOf(lab);
    const chosen = arrangeFor(specs, sketchesOf(lab), FRAMES.desktop);
    expect(chosen.sy).toBeLessThan(1);
    expect(chosen.transpose).toBe(false);
    const net = createLabStore(lab).getState().net;
    const natural = buildScene(layoutNodes(specs), net, FRAMES.desktop);
    const tight = buildScene(layoutNodes(specs, chosen), net, FRAMES.desktop);
    expect(tight.scale).toBeGreaterThan(natural.scale);
  });

  it('en la pestaña del móvil traspone una figura apaisada', () => {
    for (const name of ['01-acceso-inicial.yaml', '03-rutas-estaticas.yaml']) {
      const lab = labFile(name);
      expect(arrangeFor(specsOf(lab), sketchesOf(lab), FRAMES.phone).transpose, name).toBe(true);
    }
  });

  it('elige una figura que cabe entera en el marco cuando cabe sin pisar texto', () => {
    for (const name of CHECKED) {
      for (const [frameName, frame] of Object.entries(FRAMES)) {
        // El lab 12 (cuatro equipos en fila con etiquetas largas) no cabe a 12px
        // en 343px sin pisar texto: ahí la figura se desplaza en vez de amontonarse.
        if (name === '12-oficina-final.yaml' && frameName === 'phone') continue;
        const { scene } = sceneFor(name, frame);
        if (!scene.bounds) throw new Error('sin límites');
        expect(rawFitScale(scene.bounds, frame, 16), `${name} ${frameName}`).toBeGreaterThanOrEqual(
          ZOOM_MIN - 0.01,
        );
      }
    }
  });

  it('nunca junta los equipos hasta pisarse', () => {
    for (const name of ['04-bridge-vlans.yaml', '12-oficina-final.yaml']) {
      const lab = labFile(name);
      const specs = specsOf(lab);
      const chosen = arrangeFor(specs, sketchesOf(lab), { width: 700, height: 200 });
      expect(clashes(layoutNodes(specs, chosen).map((n) => nodeRect(n)))).toBe(0);
    }
  });
});

const CHECKED = [
  '01-acceso-inicial.yaml',
  '03-rutas-estaticas.yaml',
  '04-bridge-vlans.yaml',
  '12-oficina-final.yaml',
] as const;

describe('buildScene', () => {
  it('cada extremo lleva su nombre y sus direcciones del mismo lado del cable', () => {
    for (const name of CHECKED) {
      for (const [frameName, frame] of Object.entries(FRAMES)) {
        const { scene } = sceneFor(name, frame);
        for (const { segment, blocks } of scene.wires) {
          blocks.forEach((block, end) => {
            if (!block) return;
            const [from, to] = end === 0 ? [segment.from, segment.to] : [segment.to, segment.from];
            const sides = new Set(
              block.boxes.map((b) =>
                sideOf(from, to, { x: b.x + b.width / 2, y: b.y + b.height / 2 }),
              ),
            );
            expect(sides.size, `${name} ${frameName}`).toBe(1);
            // Y el nombre va primero: arriba del todo del bloque.
            const dys = block.lines.map((l) => l.dy);
            expect(dys[0], `${name} ${frameName}`).toBe(Math.min(...dys));
          });
        }
      }
    }
  });

  it('a la escala de encuadre ningún rótulo pisa un equipo ni otro rótulo', () => {
    for (const name of CHECKED) {
      for (const [frameName, frame] of Object.entries(FRAMES)) {
        const { nodes, scene } = sceneFor(name, frame);
        const s = 1 / scene.scale;
        const rects = [
          ...nodes.flatMap((n) => nodeObstacles(n, s)),
          ...scene.wires.flatMap((w) => w.blocks.flatMap((b) => (b ? b.boxes : []))),
        ];
        expect(clashes(rects), `${name} ${frameName}`).toBe(0);
        const crossed = scene.wires
          .flatMap((w) => w.blocks.flatMap((b) => (b ? b.boxes : [])))
          .filter((box) => scene.wires.some((w) => segmentHitsRect(w.segment, box)));
        expect(crossed, `${name} ${frameName}: cable sobre un rótulo`).toEqual([]);
      }
    }
  });

  it('dibuja todos los cables del lab', () => {
    const lab = labFile('07-firewall-filter.yaml');
    const scene = buildScene(layoutNodes(specsOf(lab)), createLabStore(lab).getState().net);
    expect(scene.wires.length).toBeGreaterThanOrEqual(lab.topology.links.length);
  });

  it('el portátil sin asociar se dibuja caído hacia el router y se levanta al encender la radio', () => {
    const lab = labFile('08-wireless-basico.yaml');
    const store = createLabStore(lab);
    const wifi = () =>
      buildScene(layoutNodes(specsOf(lab)), store.getState().net).wires.find(
        (w) => w.wire.kind === 'wireless',
      );
    expect(wifi()?.wire).toMatchObject({ up: false, reason: { kind: 'not-associated' } });
    expect(wifi()?.names).toEqual(['wifi1', 'wlan0']);
    store
      .getState()
      .run(
        '/interface wifi set wifi1 configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=Bienvenidos2026 disabled=no',
      );
    expect(wifi()?.wire.up).toBe(true);
  });

  it('un puerto deshabilitado tira el cable y lo dice', () => {
    const lab = labFile('01-acceso-inicial.yaml');
    const store = createLabStore(lab);
    store.getState().run('/interface disable ether2');
    const [wire] = buildScene(layoutNodes(specsOf(lab)), store.getState().net).wires;
    expect(wire?.wire).toMatchObject({ up: false, reason: { kind: 'disabled' } });
  });
});

describe('segmentHitsRect', () => {
  const box = { x: 10, y: 10, width: 20, height: 10 };
  it('detecta un tramo que cruza, uno que acaba dentro y uno que pasa de largo', () => {
    expect(segmentHitsRect({ from: { x: 0, y: 15 }, to: { x: 50, y: 15 } }, box)).toBe(true);
    expect(segmentHitsRect({ from: { x: 0, y: 0 }, to: { x: 15, y: 12 } }, box)).toBe(true);
    expect(segmentHitsRect({ from: { x: 0, y: 0 }, to: { x: 50, y: 5 } }, box)).toBe(false);
    expect(segmentHitsRect({ from: { x: 40, y: 0 }, to: { x: 40, y: 50 } }, box)).toBe(false);
  });
});

describe('ayudas', () => {
  it('fitText recorta con puntos suspensivos', () => {
    expect(fitText('R1-Oficina', 200)).toBe('R1-Oficina');
    expect(fitText('R1-Oficina-Central-Madrid', 66)).toMatch(/…$/);
  });

  it('parallelOffsets reparte los cables simétricamente', () => {
    expect(parallelOffsets(1)).toEqual([0]);
    expect(parallelOffsets(2)).toEqual([-7, 7]);
  });
});
