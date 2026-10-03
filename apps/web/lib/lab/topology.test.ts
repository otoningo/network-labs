/**
 * Geometría de la figura: papeles, colocación, bordes de los cables, rótulos
 * sin solapes y el reparto que mantiene el texto legible en marcos pequeños.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOARDS, type LabDefinition } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { buildScene } from './scene';
import { createLabStore } from './store';
import {
  arrangeFor,
  edgePoint,
  fitText,
  type LinkSketch,
  layoutNodes,
  NATURAL,
  type NodeSpec,
  nodeRect,
  overlaps,
  parallelOffsets,
  placePortBlocks,
  portBlock,
  roleOf,
  SHAPE,
} from './topology';
import { type Rect, rawFitScale } from './viewport';

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
  }));

const sketchesOf = (lab: LabDefinition): LinkSketch[] =>
  lab.topology.links.map(([a, b]) => {
    const [aDevice = '', aPort = ''] = a.split(':');
    const [bDevice = '', bPort = ''] = b.split(':');
    return { a: aDevice, aPort, b: bDevice, bPort };
  });

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
    expect(clashes(nodes.map(nodeRect))).toBe(0);
  });
});

describe('edgePoint', () => {
  const [node] = layoutNodes([{ id: 'R1', role: 'router', position: { x: 0, y: 0 } }]);
  if (!node) throw new Error('sin nodo');

  it('sale por el lado de la caja hacia un equipo a la derecha', () => {
    expect(edgePoint(node, { x: 500, y: 0 })).toEqual({ x: 66, y: 0 });
  });

  it('sale por debajo de la etiqueta hacia un equipo de abajo', () => {
    const p = edgePoint(node, { x: 0, y: 500 });
    expect(p.y).toBe(node.height / 2 + 20);
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
  it('cable horizontal: nombre encima, direcciones debajo, alejándose del equipo', () => {
    const block = portBlock({ x: 100, y: 50 }, { x: 400, y: 50 }, 'ether2', ['10.0.0.1/24']);
    const [name, address] = block.lines;
    expect(name?.anchor).toBe('start');
    expect(name?.y).toBeLessThan(50);
    expect(address?.y).toBeGreaterThan(50);
    expect(block.rect.x).toBeGreaterThan(100);
  });

  it('la variante escalonada invierte el reparto', () => {
    const block = portBlock({ x: 400, y: 50 }, { x: 100, y: 50 }, 'eth0', ['10.0.0.2/24'], true);
    const [name, address] = block.lines;
    expect(name?.anchor).toBe('end');
    expect(name?.y).toBeGreaterThan(50);
    expect(address?.y).toBeLessThan(50);
  });

  it('cable vertical: el bloque a un lado, debajo del arranque', () => {
    const block = portBlock({ x: 100, y: 50 }, { x: 100, y: 300 }, 'ether2', ['10.0.0.1/24']);
    expect(block.rect.x).toBeGreaterThan(100);
    expect(block.rect.y).toBeGreaterThan(50);
  });
});

describe('placePortBlocks', () => {
  it('escalona los dos extremos de un cable corto para que no se pisen', () => {
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
    const long = ['255.255.255.255/32'];
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
      [],
    );
    expect(collisions).toBe(1);
  });
});

describe('arrangeFor', () => {
  it('con sitio de sobra deja el YAML tal cual', () => {
    const lab = labFile('03-rutas-estaticas.yaml');
    expect(arrangeFor(specsOf(lab), sketchesOf(lab), { width: 1600, height: 900 })).toEqual(
      NATURAL,
    );
  });

  it('en un panel bajo acerca las filas para que el texto no baje de 11px', () => {
    const lab = labFile('03-rutas-estaticas.yaml');
    const frame = { width: 880, height: 248 };
    const specs = specsOf(lab);
    const chosen = arrangeFor(specs, sketchesOf(lab), frame);
    expect(chosen.sy).toBeLessThan(1);
    expect(chosen.transpose).toBe(false);
    const natural = buildScene(layoutNodes(specs), createLabStore(lab).getState().net);
    const tight = buildScene(layoutNodes(specs, chosen), createLabStore(lab).getState().net);
    if (!natural.bounds || !tight.bounds) throw new Error('sin límites');
    expect(rawFitScale(tight.bounds, frame, 16)).toBeGreaterThan(
      rawFitScale(natural.bounds, frame, 16),
    );
  });

  it('en la pestaña del móvil traspone una figura apaisada', () => {
    const lab = labFile('03-rutas-estaticas.yaml');
    const chosen = arrangeFor(specsOf(lab), sketchesOf(lab), { width: 343, height: 560 });
    expect(chosen.transpose).toBe(true);
  });

  it('nunca junta los equipos hasta pisarse', () => {
    for (const name of ['04-bridge-vlans.yaml', '12-oficina-final.yaml']) {
      const lab = labFile(name);
      const specs = specsOf(lab);
      const chosen = arrangeFor(specs, sketchesOf(lab), { width: 700, height: 200 });
      expect(clashes(layoutNodes(specs, chosen).map(nodeRect))).toBe(0);
    }
  });
});

describe('buildScene', () => {
  it('dibuja los cables del lab con los rótulos de la red en vivo y sin solapes', () => {
    for (const name of [
      '01-acceso-inicial.yaml',
      '03-rutas-estaticas.yaml',
      '07-firewall-filter.yaml',
    ]) {
      const lab = labFile(name);
      const net = createLabStore(lab).getState().net;
      const nodes = layoutNodes(specsOf(lab));
      const scene = buildScene(nodes, net);
      expect(scene.wires.length).toBeGreaterThanOrEqual(lab.topology.links.length);
      const rects = [
        ...nodes.map(nodeRect),
        ...scene.wires.flatMap((w) => w.blocks.flatMap((b) => (b ? b.boxes : []))),
      ];
      expect(clashes(rects), name).toBe(0);
    }
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
