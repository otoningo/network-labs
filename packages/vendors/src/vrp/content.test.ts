/**
 * Labs de content/labs/vrp: cargan como en la web, arrancan con todo
 * pendiente y la solución de referencia, tecleada como lo haría un alumno,
 * los cumple. También algunos errores típicos que no deben dar la tarea por buena.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateObjectives, type LabRuntime, loadLab, type Network } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

const LABS_DIR = join(import.meta.dirname, '../../../../content/labs/vrp');

function loadLabFile(file: string): LabRuntime {
  const parsed = parseLabYaml(readFileSync(join(LABS_DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const runtime = loadLab(parsed.value, {
    platforms: { vrp: VRP_PLATFORM },
    runStartup: vrpStartup,
  });
  if (!runtime.ok) throw new Error(`${file}: ${JSON.stringify(runtime.error)}`);
  return runtime.value;
}

const pendingOn = (runtime: LabRuntime, net: Network): string[] =>
  [...evaluateObjectives(runtime, net)].filter(([, done]) => !done).map(([id]) => id);

/** Teclea en varios equipos sobre la misma red, en orden. */
function solve(
  runtime: LabRuntime,
  steps: readonly (readonly [string, readonly string[]])[],
): Network {
  let net = runtime.net;
  for (const [device, lines] of steps) net = new VrpTerminal(net, device).script(lines).net;
  return net;
}

describe('labs de VRP', () => {
  it('hay cuatro labs en la ruta, en orden, y todos cargan con sus tareas pendientes', () => {
    const files = readdirSync(LABS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    expect(files).toHaveLength(4);
    files.forEach((file, index) => {
      const runtime = loadLabFile(file);
      expect(runtime.lab.path).toBe('vrp-desde-cero');
      expect(runtime.lab.order).toBe(index + 1);
      expect(pendingOn(runtime, runtime.net)).toEqual(runtime.lab.objectives.map((o) => o.id));
    });
  });

  it('lab 1: vistas, nombre, usuario y Telnet', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'system-view',
          'sysname R1-Oficina',
          'interface g0/0/1',
          'ip address 192.168.88.1 24',
          'quit',
          'aaa',
          'local-user soporte password irreversible-cipher Cl4ve-Segura',
          'local-user soporte privilege level 1',
          'quit',
          'undo telnet server enable',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 1: con nivel 15 el usuario existe pero no es de solo consulta', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'system-view',
          'aaa',
          'local-user soporte password irreversible-cipher X1-y2-z3',
          'local-user soporte privilege level 15',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toContain('user');
  });

  it('lab 2: descripción, dirección corregida y el puerto encendido', () => {
    const runtime = loadLabFile('02-interfaces-direcciones.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'system-view',
          'interface GigabitEthernet0/0/0',
          'description WAN',
          'ip address 203.0.113.2 24',
          'interface GigabitEthernet0/0/1',
          'ip address 192.168.88.1 255.255.255.0',
          'interface GigabitEthernet0/0/2',
          'undo shutdown',
          'ip address 192.168.89.1 24',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 2: dar la dirección sin encender el puerto no basta', () => {
    const runtime = loadLabFile('02-interfaces-direcciones.yaml');
    const net = solve(runtime, [
      ['R1', ['system-view', 'interface g0/0/2', 'ip address 192.168.89.1 24']],
    ]);
    expect(pendingOn(runtime, net)).toContain('admin');
  });

  it('lab 3: rutas en los dos sentidos y las rutas por defecto', () => {
    const runtime = loadLabFile('03-rutas-estaticas.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'system-view',
          'ip route-static 192.168.20.0 24 10.0.12.2',
          'ip route-static 0.0.0.0 0 10.0.12.2',
        ],
      ],
      [
        'R2',
        [
          'system-view',
          'ip route-static 192.168.10.0 255.255.255.0 10.0.12.1',
          'ip route-static 0.0.0.0 0.0.0.0 203.0.113.1',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 3: la ruta de ida sola no hace que las PC se vean', () => {
    const runtime = loadLabFile('03-rutas-estaticas.yaml');
    const net = solve(runtime, [
      ['R1', ['system-view', 'ip route-static 192.168.20.0 24 10.0.12.2']],
    ]);
    expect(pendingOn(runtime, net)).toContain('pcs');
  });

  it('lab 4: DHCP, NAT y DNS', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'system-view',
          'dhcp enable',
          'ip pool oficina',
          'network 192.168.88.0 mask 24',
          'gateway-list 192.168.88.1',
          'dns-list 192.168.88.1',
          'quit',
          'interface GigabitEthernet0/0/1',
          'dhcp select global',
          'quit',
          'acl number 2000',
          'rule permit source 192.168.88.0 0.0.0.255',
          'quit',
          'interface GigabitEthernet0/0/0',
          'nat outbound 2000',
          'quit',
          'dns resolve',
          'dns server 8.8.8.8',
          'dns proxy enable',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 4: sin dhcp enable, dhcp select global se rechaza con la voz de VRP', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    const t = new VrpTerminal(runtime.net, 'R1');
    t.script([
      'system-view',
      'ip pool oficina',
      'network 192.168.88.0 mask 24',
      'quit',
      'interface g0/0/1',
    ]);
    expect(t.run('dhcp select global')).toBe('Error: Please enable DHCP in the system view first.');
    expect(pendingOn(runtime, t.net)).toContain('dhcp');
  });
});
