import { describe, expect, it } from 'vitest';
import { converge } from '../engine/converge';
import { interfaceByName } from '../model/lookup';
import type { Device, Network } from '../model/network';
import { err, ok, type Result } from '../model/result';
import { formatPrefix, prefix, range } from '../net/ipv4';
import { applyOps, type Op } from '../ops/apply';
import { TEST_ROUTER_PLATFORM } from '../testing/platforms';
import fixture from './__fixtures__/demo-nat.yaml?raw';
import { evaluateObjectives, type LabEnvironment, loadLab, type StartupRunner } from './load';
import { type LabDefinition, type LabDevice, labJsonSchema } from './schema';
import { parseLabYaml } from './yaml';

/** Intérprete mínimo de pruebas: solo entiende lo que usa el lab de ejemplo. */
const tinyRunner: StartupRunner = (device, script) => {
  const ops: Op[] = [];
  for (const line of script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const m = /^\/ip address add address=(\S+) interface=(\S+)$/.exec(line);
    const iface = m?.[2] ? interfaceByName(device.config, m[2]) : undefined;
    if (!m?.[1] || !iface) return err(`no entiendo: ${line}`);
    ops.push({
      op: 'add',
      coll: 'addresses',
      item: { iface: iface.id, address: prefix(m[1]), disabled: false },
    });
  }
  const applied = applyOps(device, ops);
  return applied.ok ? ok(applied.value.device) : err(JSON.stringify(applied.error));
};

const env: LabEnvironment = {
  platforms: { routeros: TEST_ROUTER_PLATFORM },
  runStartup: tinyRunner,
};

function lab(): LabDefinition {
  const parsed = parseLabYaml(fixture);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** Variante del lab de ejemplo; se valida pasando por el mismo parser que un YAML. */
function variant(change: (lab: LabDefinition) => LabDefinition): Result<LabDefinition, string> {
  return parseLabYaml(JSON.stringify(change(lab())));
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`sin elemento ${index}`);
  return item;
}

const withDevices = (
  l: LabDefinition,
  devices: LabDefinition['topology']['devices'],
): LabDefinition => ({
  ...l,
  topology: { ...l.topology, devices },
});

const mapDevice = (
  l: LabDefinition,
  id: string,
  change: (d: LabDevice) => LabDevice,
): LabDefinition =>
  withDevices(
    l,
    l.topology.devices.map((d) => (d.id === id ? change(d) : d)),
  );

/** Aplica operaciones a un dispositivo de la red y reconverge, como haría un driver. */
function user(net: Network, id: string, make: (d: Device) => Op[]): Network {
  const device = net.devices.find((d) => d.id === id);
  if (!device) throw new Error(`no existe ${id}`);
  const applied = applyOps(device, make(device));
  if (!applied.ok) throw new Error(JSON.stringify(applied.error));
  return converge({
    ...net,
    devices: net.devices.map((d) => (d.id === id ? applied.value.device : d)),
  });
}

const iface = (d: Device, name: string) => {
  const found = interfaceByName(d.config, name);
  if (!found) throw new Error(`sin ${name}`);
  return found.id;
};

describe('formato YAML', () => {
  it('lee el lab de ejemplo con textos bilingües', () => {
    const def = lab();
    expect(def.title.en).toBe('Internet access with NAT');
    expect(def.topology.links).toHaveLength(2);
    expect(def.objectives.map((o) => o.id)).toEqual(['lan', 'wan', 'internet']);
  });

  it('da errores legibles', () => {
    const broken = parseLabYaml('id: [sin cerrar');
    expect(broken.ok).toBe(false);
    const invalid = parseLabYaml('id: x\nvendor: routeros\n');
    expect(!invalid.ok && invalid.error).toContain('title');
  });

  const cases: [string, (l: LabDefinition) => LabDefinition, string][] = [
    [
      'dispositivo repetido',
      (l) => withDevices(l, [...l.topology.devices, at(l.topology.devices, 1)]),
      'id repetido',
    ],
    [
      'enlace a dispositivo desconocido',
      (l) => ({
        ...l,
        topology: { ...l.topology, links: [...l.topology.links, ['NADA:ether1', 'R1:ether3']] },
      }),
      'dispositivo desconocido',
    ],
    [
      'host en un router',
      (l) => mapDevice(l, 'R1', (d) => ({ ...d, host: { ip: 'dhcp' } })),
      'host',
    ],
    [
      'internet sin configuración',
      (l) => mapDevice(l, 'ISP', (d) => ({ id: d.id, os: d.os, board: d.board })),
      'necesita la sección',
    ],
    [
      'dos equipos internet',
      (l) => withDevices(l, [...l.topology.devices, { ...at(l.topology.devices, 0), id: 'ISP2' }]),
      'solo puede haber un equipo',
    ],
    ['startup en un host', (l) => mapDevice(l, 'PC1', (d) => ({ ...d, startup: 'x' })), 'startup'],
    [
      'placa desconocida',
      (l) => mapDevice(l, 'R1', (d) => ({ ...d, board: 'rb-real' })),
      'placa desconocida',
    ],
    [
      'objetivo con dispositivo desconocido',
      (l) => ({
        ...l,
        objectives: [
          { ...at(l.objectives, 0), check: { neighborSeen: { device: 'R9', peer: 'R1' } } },
        ],
      }),
      'dispositivo desconocido: R9',
    ],
    [
      'objetivo repetido',
      (l) => ({ ...l, objectives: [...l.objectives, at(l.objectives, 0)] }),
      'objetivo repetido',
    ],
    [
      'flujo desde un desconocido',
      (l) => ({
        ...l,
        topology: {
          ...l.topology,
          flows: [
            ...l.topology.flows,
            { id: 'x', from: 'NADIE', to: '1.1.1.1', protocol: 'udp', bps: 1 },
          ],
        },
      }),
      'dispositivo desconocido',
    ],
    [
      'prefijo inválido',
      (l) => ({
        ...l,
        objectives: [
          {
            ...at(l.objectives, 1),
            check: { hasAddress: { device: 'R1', iface: 'ether1', within: '203.0.113.0' } },
          },
        ],
      }),
      'prefijo inválido',
    ],
  ];

  it.each(cases)('rechaza: %s', (_name, change, message) => {
    const result = variant(change);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });

  it('exporta un JSON Schema para los editores', () => {
    const schema = labJsonSchema() as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toContain('objectives');
  });
});

describe('carga y validación en vivo', () => {
  it('construye la red y evalúa los objetivos', () => {
    const loaded = loadLab(lab(), env);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const rt = loaded.value;
    expect(rt.net.devices.map((d) => d.id)).toEqual(['ISP', 'R1', 'PC1']);
    expect(rt.net.scenario.flows[0]).toMatchObject({
      id: 'web',
      dstPort: 443,
      replyBps: 2_000_000,
    });
    expect(Object.fromEntries(evaluateObjectives(rt))).toEqual({
      lan: true,
      wan: false,
      internet: false,
    });
  });

  it('dos soluciones distintas cumplen los mismos objetivos', () => {
    const loaded = loadLab(lab(), env);
    if (!loaded.ok) throw new Error('no cargó');
    const rt = loaded.value;

    // Camino A: cliente DHCP en la WAN y masquerade.
    const viaDhcp = user(rt.net, 'R1', (d) => [
      {
        op: 'add',
        coll: 'dhcpClients',
        item: {
          iface: iface(d, 'ether1'),
          addDefaultRoute: true,
          routeDistance: 1,
          usePeerDns: true,
          disabled: false,
        },
      },
      {
        op: 'add',
        coll: 'natRules',
        item: {
          chain: 'srcnat',
          match: { outInterface: { value: iface(d, 'ether1'), negate: false } },
          action: { kind: 'masquerade' },
          disabled: false,
        },
      },
    ]);
    expect(Object.fromEntries(evaluateObjectives(rt, viaDhcp))).toEqual({
      lan: true,
      wan: true,
      internet: true,
    });

    // Camino B: IP fija, ruta por defecto y src-nat explícito.
    const viaStatic = user(rt.net, 'R1', (d) => [
      {
        op: 'add',
        coll: 'addresses',
        item: { iface: iface(d, 'ether1'), address: prefix('203.0.113.50/24'), disabled: false },
      },
      {
        op: 'add',
        coll: 'routes',
        item: {
          dst: prefix('0.0.0.0/0'),
          gateway: { kind: 'ip', ip: prefix('203.0.113.1').ip },
          distance: 1,
          table: 'main',
          disabled: false,
        },
      },
      {
        op: 'add',
        coll: 'natRules',
        item: {
          chain: 'srcnat',
          match: {},
          action: { kind: 'srcNat', to: range('203.0.113.50') },
          disabled: false,
        },
      },
    ]);
    expect(Object.fromEntries(evaluateObjectives(rt, viaStatic))).toEqual({
      lan: true,
      wan: true,
      internet: true,
    });

    // Renombrar la WAN no rompe la validación.
    const renamed = user(viaDhcp, 'R1', (d) => [
      { op: 'set', coll: 'interfaces', id: iface(d, 'ether1'), patch: { name: 'ether1-wan' } },
    ]);
    expect(evaluateObjectives(rt, renamed).get('wan')).toBe(true);
    expect(evaluateObjectives(rt, renamed).get('internet')).toBe(true);
  });

  it('configura hosts con wifi, servicios y DHCP', () => {
    const def = lab();
    const wifiLab: LabDefinition = {
      ...def,
      topology: {
        ...def.topology,
        devices: [
          ...def.topology.devices,
          {
            id: 'LAP',
            os: 'host',
            board: 'sim-host-w',
            host: { ip: 'dhcp', wifi: { ssid: 'Oficina', passphrase: 'clave-segura' } },
          },
          {
            id: 'SRV',
            os: 'host',
            board: 'sim-host',
            host: { ip: '192.168.88.20/24', services: [{ name: 'http', port: 80 }] },
          },
        ],
      },
    };
    const loaded = loadLab(wifiLab, env);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const lap = loaded.value.net.devices.find((d) => d.id === 'LAP');
    expect(lap?.config.interfaces[0]).toMatchObject({
      mode: 'station',
      ssid: 'Oficina',
      disabled: false,
    });
    expect(lap?.config.addressing.dhcpClients).toHaveLength(1);
    const srv = loaded.value.net.devices.find((d) => d.id === 'SRV');
    expect(srv?.config.services.map((s) => s.port)).toEqual([80]);
    const isp = loaded.value.net.devices.find((d) => d.id === 'ISP');
    expect(isp?.config.dhcpServer.networks.map((n) => formatPrefix(n.prefix))).toEqual([
      '203.0.113.0/24',
    ]);
  });

  it.each([
    [
      'sin intérprete de arranque',
      { platforms: { routeros: TEST_ROUTER_PLATFORM } },
      'no-startup-runner',
    ],
    [
      'script que falla',
      { platforms: { routeros: TEST_ROUTER_PLATFORM }, runStartup: () => err('boom') },
      'startup-failed',
    ],
    ['plataforma ausente', { platforms: {}, runStartup: tinyRunner }, 'unknown-platform'],
  ] as const)('falla %s', (_name, environment, code) => {
    const loaded = loadLab(lab(), environment as LabEnvironment);
    expect(!loaded.ok && loaded.error.code).toBe(code);
  });

  it('valida puertos y nombres al cargar', () => {
    const def = lab();
    const withLinks = (links: [string, string][]): LabDefinition => ({
      ...def,
      topology: { ...def.topology, links },
    });
    const unknown = loadLab(withLinks([['R1:ether9', 'PC1:eth0']]), env);
    expect(!unknown.ok && unknown.error).toEqual({ code: 'unknown-port', port: 'R1:ether9' });
    const reused = loadLab(
      withLinks([
        ['R1:ether2', 'PC1:eth0'],
        ['R1:ether2', 'ISP:eth0'],
      ]),
      env,
    );
    expect(!reused.ok && reused.error.code).toBe('port-in-use');
    const flows = loadLab(
      {
        ...def,
        topology: {
          ...def.topology,
          flows: [{ id: 'x', from: 'PC1', to: 'nada.test', protocol: 'udp', bps: 1 }],
        },
      },
      env,
    );
    expect(!flows.ok && flows.error).toEqual({ code: 'unknown-host', name: 'nada.test' });
    const badBoard = loadLab(
      { ...def, topology: { ...def.topology, devices: [{ id: 'X', os: 'host', board: 'nada' }] } },
      env,
    );
    expect(!badBoard.ok && badBoard.error.code).toBe('unknown-board');
  });

  it('resuelve todas las formas de predicado', () => {
    const def = lab();
    const checks = [
      { routeActive: { device: 'R1', dst: '192.168.88.0/24', via: 'ether2' } },
      { routeActive: { device: 'R1', dst: '192.168.88.0/24' } },
      { not: { routeActive: { device: 'R1', dst: '0.0.0.0/0', via: '203.0.113.1' } } },
      { any: [{ blocked: { from: 'PC1', to: '8.8.8.8', by: 'any' } }] },
      { natSourceIs: { from: 'PC1', to: 'R1', protocol: 'icmp', expect: '192.168.88.10' } },
      { leaseBound: { server: 'ISP', client: 'R1', within: '203.0.113.0/24' } },
      { not: { wifiAssociated: { client: 'PC1', ap: 'R1', ssid: 'x' } } },
      { not: { resolves: { from: 'PC1', name: 'example.com', to: '93.184.216.34', via: 'R1' } } },
      { not: { fileExists: { device: 'R1', type: 'backup', name: 'x.backup' } } },
      { configMatches: { device: 'R1', snapshot: 'startup', scope: ['addresses'] } },
      { not: { configMatches: { device: 'R1', snapshot: { file: 'x' } } } },
      {
        exists: {
          device: 'R1',
          collection: 'addresses',
          where: { iface: { iface: 'ether2' }, address: { prefix: '192.168.88.1/24' } },
          count: 1,
        },
      },
      {
        exists: {
          device: 'PC1',
          collection: 'routes',
          where: { 'gateway.ip': { ip: '192.168.88.1' }, dst: { within: '0.0.0.0/0' } },
          count: '==1',
        },
      },
      { exists: { device: 'R1', collection: 'interfaces', where: { name: { exists: true } } } },
      {
        setting: {
          device: 'PC1',
          key: 'dns',
          field: 'servers',
          is: { includes: { ip: '1.1.1.1' } },
        },
      },
      { setting: { device: 'R1', key: 'system', field: 'identity', is: 'R1' } },
      { not: { setting: { device: 'R1', key: 'dns', field: 'servers', is: { includes: 53 } } } },
      {
        not: {
          exists: {
            device: 'R1',
            collection: 'bridgeVlans',
            where: { tagged: { includes: { iface: 'ether2' } } },
          },
        },
      },
      {
        not: {
          exists: {
            device: 'R1',
            collection: 'bridgeVlans',
            where: { vlanIds: { includes: '10' } },
          },
        },
      },
      { interfaceRunning: { device: 'R1', iface: 'ether2' } },
      { not: { neighborSeen: { device: 'R1', peer: 'PC1' } } },
    ];
    const custom: LabDefinition = {
      ...def,
      objectives: [
        {
          id: 'todo',
          text: def.objectives[0]?.text ?? { es: 'x', en: 'x' },
          hints: def.objectives[0]?.hints ?? [],
          check: { all: checks } as never,
        },
      ],
    };
    const reparsed = parseLabYaml(JSON.stringify(custom));
    if (!reparsed.ok) throw new Error(reparsed.error);
    const first = at(reparsed.value.objectives, 0).check;
    const parts = 'all' in first ? first.all : [];
    const loaded = loadLab(reparsed.value, env);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    // Con un cliente DHCP en la WAN se cumple todo; las direcciones siguen como al arrancar.
    const withDhcp = user(loaded.value.net, 'R1', (d) => [
      {
        op: 'add',
        coll: 'dhcpClients',
        item: {
          iface: iface(d, 'ether1'),
          addDefaultRoute: false,
          routeDistance: 1,
          usePeerDns: false,
          disabled: false,
        },
      },
    ]);
    const objectives = loaded.value.objectives[0]?.check;
    expect(parts).toHaveLength(checks.length);
    expect(objectives?.kind).toBe('all');
    const results =
      objectives?.kind === 'all'
        ? objectives.of.map((p, i) => [
            i,
            evaluateObjectives(
              { ...loaded.value, objectives: [{ id: 'x', check: p }] },
              withDhcp,
            ).get('x'),
          ])
        : [];
    expect(results.filter(([, pass]) => !pass)).toEqual([]);
    expect(evaluateObjectives({ ...loaded.value }).get('todo')).toBe(false);
  });
});
