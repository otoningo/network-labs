/**
 * Labs de content/labs/ios: cargan como en la web, arrancan con todo
 * pendiente y la solución de referencia, tecleada como lo haría un alumno
 * (con abreviaturas), los cumple. También algunos errores típicos que no deben
 * dar la tarea por buena.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateObjectives, type LabRuntime, loadLab, type Network } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { iosStartup } from './driver';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

const LABS_DIR = join(import.meta.dirname, '../../../../content/labs/ios');

function loadLabFile(file: string): LabRuntime {
  const parsed = parseLabYaml(readFileSync(join(LABS_DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const runtime = loadLab(parsed.value, {
    platforms: { ios: IOS_PLATFORM },
    runStartup: iosStartup,
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
  for (const [device, lines] of steps) net = new IosTerminal(net, device).script(lines).net;
  return net;
}

/** Solución del lab 1, de la que los errores típicos quitan una línea. */
const LAB1 = [
  'enable',
  'conf t',
  'hostname R1-Oficina',
  'int g0/1',
  'ip add 192.168.1.1 255.255.255.0',
  'no shut',
  'exit',
  'username admin privilege 15 secret Cl4ve-Segura',
  'ip domain-name oficina.local',
  'crypto key generate rsa modulus 1024',
  'line vty 0 4',
  'login local',
  'transport input ssh',
  'end',
  'copy run start',
  '',
];

/** Solución del lab 4, de la que los errores típicos quitan una línea. */
const LAB4 = [
  'en',
  'conf t',
  'ip dhcp excluded-address 192.168.1.1 192.168.1.127',
  'ip dhcp pool OFICINA',
  'network 192.168.1.0 255.255.255.0',
  'default-router 192.168.1.1',
  'dns-server 192.168.1.1',
  'exit',
  'access-list 1 permit 192.168.1.0 0.0.0.255',
  'int g0/1',
  'ip nat inside',
  'int g0/0',
  'ip nat outside',
  'exit',
  'ip nat inside source list 1 int g0/0 overload',
  'ip name-server 8.8.8.8',
  'ip dns server',
];

const without = (lines: readonly string[], gone: string) => lines.filter((l) => l !== gone);

describe('labs de IOS', () => {
  it('hay cuatro labs en la ruta, en orden, y todos cargan con sus tareas pendientes', () => {
    const files = readdirSync(LABS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    expect(files).toHaveLength(4);
    files.forEach((file, index) => {
      const runtime = loadLabFile(file);
      expect(runtime.lab.path).toBe('ios-desde-cero');
      expect(runtime.lab.order).toBe(index + 1);
      expect(runtime.lab.vendor).toBe('ios');
      expect(pendingOn(runtime, runtime.net)).toEqual(runtime.lab.objectives.map((o) => o.id));
    });
  });

  it('lab 1: modos, nombre, usuario, SSH y guardar', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    expect(pendingOn(runtime, solve(runtime, [['R1', LAB1]]))).toEqual([]);
  });

  it('lab 1: sin no shutdown la PC no llega, y sin claves RSA no hay SSH', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    const shut = solve(runtime, [['R1', without(LAB1, 'no shut')]]);
    expect(pendingOn(runtime, shut)).toEqual(expect.arrayContaining(['lan', 'ssh']));
    const noKeys = solve(runtime, [['R1', without(LAB1, 'crypto key generate rsa modulus 1024')]]);
    expect(pendingOn(runtime, noKeys)).toEqual(['ssh']);
  });

  it('lab 1: guardar antes de terminar no cuenta, y Telnet abierto tampoco', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    const early = solve(runtime, [['R1', ['enable', 'write memory', ...LAB1.slice(1, -2)]]]);
    expect(pendingOn(runtime, early)).toEqual(['save']);
    const telnet = solve(runtime, [['R1', without(LAB1, 'transport input ssh')]]);
    expect(pendingOn(runtime, telnet)).toEqual(['ssh']);
  });

  it('lab 1: un usuario con privilegio 1 no es administrador', () => {
    const runtime = loadLabFile('01-acceso-inicial.yaml');
    const net = solve(runtime, [['R1', LAB1.map((l) => l.replace('privilege 15 ', ''))]]);
    expect(pendingOn(runtime, net)).toContain('user');
  });

  it('lab 2: descripción, dirección corregida y los puertos encendidos', () => {
    const runtime = loadLabFile('02-interfaces-direcciones.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'en',
          'configure terminal',
          'interface GigabitEthernet0/0',
          'description WAN',
          'ip address 203.0.113.2 255.255.255.0',
          'no shutdown',
          'interface GigabitEthernet 0/1',
          'ip address 192.168.1.1 255.255.255.0',
          'int gi0/2',
          'ip add 192.168.2.1 255.255.255.0',
          'no sh',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 2: dar las direcciones sin encender los puertos no basta', () => {
    const runtime = loadLabFile('02-interfaces-direcciones.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'en',
          'conf t',
          'int g0/0',
          'description WAN',
          'ip address 203.0.113.2 255.255.255.0',
          'int g0/2',
          'ip address 192.168.2.1 255.255.255.0',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual(expect.arrayContaining(['wan', 'admin']));
  });

  it('lab 3: rutas en los dos sentidos y las rutas por defecto', () => {
    const runtime = loadLabFile('03-rutas-estaticas.yaml');
    const net = solve(runtime, [
      [
        'R1',
        [
          'en',
          'conf t',
          'ip route 192.168.20.0 255.255.255.0 10.0.12.2',
          'ip route 0.0.0.0 0.0.0.0 10.0.12.2',
        ],
      ],
      [
        'R2',
        [
          'enable',
          'conf t',
          'ip route 192.168.10.0 255.255.255.0 10.0.12.1',
          'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
        ],
      ],
    ]);
    expect(pendingOn(runtime, net)).toEqual([]);
  });

  it('lab 3: la ruta de ida sola no hace que las PC se vean', () => {
    const runtime = loadLabFile('03-rutas-estaticas.yaml');
    const net = solve(runtime, [
      ['R1', ['en', 'conf t', 'ip route 192.168.20.0 255.255.255.0 10.0.12.2']],
    ]);
    expect(pendingOn(runtime, net)).toContain('pcs');
  });

  it('lab 4: DHCP, NAT y DNS', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    expect(pendingOn(runtime, solve(runtime, [['R1', LAB4]]))).toEqual([]);
  });

  it('lab 4: sin ip nat inside en la LAN no hay NAT', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    const net = solve(runtime, [['R1', without(LAB4, 'ip nat inside')]]);
    expect(pendingOn(runtime, net)).toEqual(['nat']);
  });

  it('lab 4: sin excluir la mitad baja la PC recibe una dirección que no vale', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    const net = solve(runtime, [
      ['R1', without(LAB4, 'ip dhcp excluded-address 192.168.1.1 192.168.1.127')],
    ]);
    expect(pendingOn(runtime, net)).toEqual(['dhcp']);
  });

  it('lab 4: sin ip dns server la PC no resuelve', () => {
    const runtime = loadLabFile('04-oficina.yaml');
    const net = solve(runtime, [['R1', without(LAB4, 'ip dns server')]]);
    expect(pendingOn(runtime, net)).toEqual(['dns']);
  });
});
