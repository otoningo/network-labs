/**
 * "Compara sintaxis" (D-044): la misma tarea en RouterOS, VRP, VyOS e IOS.
 * Las líneas de RouterOS y VRP se ejecutan en el motor sobre una oficina
 * mínima (proveedor, router y una PC) y la tarea se comprueba por el estado
 * de la red, igual que en un lab. VyOS e IOS no tienen simulador: son citas.
 *
 * En los cuatro sistemas el primer puerto va al proveedor y el segundo a la
 * LAN: ether1/ether2, GigabitEthernet0/0/0 y 0/0/1, eth0/eth1, Gi0/0 y Gi0/1.
 */
import { type LabDefinition, LabSchema } from '@nos/core';
import type { QuotedLine } from '@/components/ui/ConsoleQuote';

export type CompareTaskId =
  | 'hostname'
  | 'address'
  | 'route'
  | 'dhcp'
  | 'nat'
  | 'dns'
  | 'user'
  | 'telnet';

/** Sistemas con simulador: sus líneas se ejecutan y se comprueban. */
export type SimulatedOs = 'routeros' | 'vrp';
/** Sistemas que solo se citan. */
export type QuotedOs = 'vyos' | 'ios';
export type CompareOs = SimulatedOs | QuotedOs;

export const COMPARE_OS: readonly CompareOs[] = ['routeros', 'vrp', 'vyos', 'ios'];

/** Nombres de los dos puertos del router en cada sistema simulado. */
export const PORTS: Readonly<Record<SimulatedOs, { readonly wan: string; readonly lan: string }>> =
  {
    routeros: { wan: 'ether1', lan: 'ether2' },
    vrp: { wan: 'GigabitEthernet0/0/0', lan: 'GigabitEthernet0/0/1' },
  };

export interface CompareTask {
  readonly id: CompareTaskId;
  /** La PC de la LAN: con dirección fija o pidiéndola por DHCP. */
  readonly pc: 'static' | 'dhcp';
  /** Configuración que ya tiene el router antes de la tarea, por sistema. */
  readonly setup: Readonly<Record<SimulatedOs, readonly string[]>>;
  /** Lo que se escribe, en orden, desde la vista inicial de cada sistema. */
  readonly simulated: Readonly<Record<SimulatedOs, readonly string[]>>;
  /** Vacío cuando el sistema no tiene equivalente; la página muestra entonces su nota. */
  readonly quoted: Readonly<Record<QuotedOs, readonly QuotedLine[]>>;
  /** Comprobación de la tarea; recibe los nombres de los puertos de cada sistema. */
  readonly check: (ports: { readonly wan: string; readonly lan: string }) => unknown;
}

// ── Configuración previa ────────────────────────────────────────────────────

const ROS_LAN = '/ip address add address=192.168.88.1/24 interface=ether2';
const ROS_WAN = '/ip address add address=203.0.113.2/24 interface=ether1';
const ROS_ROUTE = '/ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1';
const ROS_NAT = '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade';

const VRP_LAN = [
  'interface GigabitEthernet0/0/1',
  ' ip address 192.168.88.1 255.255.255.0',
  'quit',
];
const VRP_WAN = ['interface GigabitEthernet0/0/0', ' ip address 203.0.113.2 255.255.255.0', 'quit'];
const VRP_ROUTE = ['ip route-static 0.0.0.0 0.0.0.0 203.0.113.1'];
const VRP_NAT = [
  'acl number 2000',
  ' rule 5 permit source 192.168.88.0 0.0.0.255',
  'quit',
  'interface GigabitEthernet0/0/0',
  ' nat outbound 2000',
  'quit',
];

// ── Citas de VyOS e IOS ─────────────────────────────────────────────────────

const vy = (command: string): QuotedLine => ({ prompt: 'vyos@R1# ', command });
const vyCommit: readonly QuotedLine[] = [vy('commit'), vy('save')];
const ios = (mode: string, command: string): QuotedLine => ({ prompt: `R1${mode}# `, command });
const conf = (command: string) => ios('(config)', command);
const confIf = (command: string) => ios('(config-if)', command);

export const COMPARE_TASKS: readonly CompareTask[] = [
  {
    id: 'hostname',
    pc: 'static',
    setup: { routeros: [], vrp: [] },
    simulated: {
      routeros: ['/system identity set name=R1'],
      vrp: ['system-view', 'sysname R1'],
    },
    quoted: {
      vyos: [{ prompt: 'vyos@vyos# ', command: 'set system host-name R1' }, ...vyCommit],
      ios: [
        { prompt: 'Router# ', command: 'configure terminal' },
        { prompt: 'Router(config)# ', command: 'hostname R1' },
      ],
    },
    check: () => ({ setting: { device: 'R1', key: 'system', field: 'identity', is: 'R1' } }),
  },
  {
    id: 'address',
    pc: 'static',
    setup: { routeros: [], vrp: [] },
    simulated: {
      routeros: [ROS_LAN],
      vrp: ['system-view', 'interface GigabitEthernet0/0/1', 'ip address 192.168.88.1 24'],
    },
    quoted: {
      vyos: [vy('set interfaces ethernet eth1 address 192.168.88.1/24'), ...vyCommit],
      ios: [
        conf('interface GigabitEthernet0/1'),
        confIf('ip address 192.168.88.1 255.255.255.0'),
        confIf('no shutdown'),
      ],
    },
    check: () => ({ reachable: { from: 'PC1', to: '192.168.88.1' } }),
  },
  {
    id: 'route',
    pc: 'static',
    setup: { routeros: [ROS_LAN, ROS_WAN], vrp: [...VRP_LAN, ...VRP_WAN] },
    simulated: {
      routeros: [ROS_ROUTE],
      vrp: ['system-view', 'ip route-static 0.0.0.0 0 203.0.113.1'],
    },
    quoted: {
      vyos: [vy('set protocols static route 0.0.0.0/0 next-hop 203.0.113.1'), ...vyCommit],
      ios: [conf('ip route 0.0.0.0 0.0.0.0 203.0.113.1')],
    },
    check: () => ({ reachable: { from: 'R1', to: '93.184.216.34' } }),
  },
  {
    id: 'dhcp',
    pc: 'dhcp',
    setup: { routeros: [ROS_LAN], vrp: VRP_LAN },
    simulated: {
      routeros: [
        '/ip pool add name=lan ranges=192.168.88.10-192.168.88.254',
        '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
        '/ip dhcp-server add name=lan interface=ether2 address-pool=lan',
      ],
      vrp: [
        'system-view',
        'dhcp enable',
        'ip pool lan',
        'network 192.168.88.0 mask 24',
        'gateway-list 192.168.88.1',
        'dns-list 192.168.88.1',
        'quit',
        'interface GigabitEthernet0/0/1',
        'dhcp select global',
      ],
    },
    quoted: {
      vyos: [
        vy('set service dhcp-server shared-network-name LAN subnet 192.168.88.0/24 subnet-id 1'),
        vy(
          'set service dhcp-server shared-network-name LAN subnet 192.168.88.0/24 option default-router 192.168.88.1',
        ),
        vy(
          'set service dhcp-server shared-network-name LAN subnet 192.168.88.0/24 option name-server 192.168.88.1',
        ),
        vy(
          'set service dhcp-server shared-network-name LAN subnet 192.168.88.0/24 range 0 start 192.168.88.10',
        ),
        vy(
          'set service dhcp-server shared-network-name LAN subnet 192.168.88.0/24 range 0 stop 192.168.88.254',
        ),
        ...vyCommit,
      ],
      ios: [
        conf('ip dhcp excluded-address 192.168.88.1'),
        conf('ip dhcp pool LAN'),
        ios('(dhcp-config)', 'network 192.168.88.0 255.255.255.0'),
        ios('(dhcp-config)', 'default-router 192.168.88.1'),
        ios('(dhcp-config)', 'dns-server 192.168.88.1'),
      ],
    },
    check: () => ({ leaseBound: { server: 'R1', client: 'PC1', within: '192.168.88.0/24' } }),
  },
  {
    id: 'nat',
    pc: 'static',
    setup: { routeros: [ROS_LAN, ROS_WAN, ROS_ROUTE], vrp: [...VRP_LAN, ...VRP_WAN, ...VRP_ROUTE] },
    simulated: {
      routeros: [ROS_NAT],
      vrp: [
        'system-view',
        'acl number 2000',
        'rule permit source 192.168.88.0 0.0.0.255',
        'quit',
        'interface GigabitEthernet0/0/0',
        'nat outbound 2000',
      ],
    },
    quoted: {
      vyos: [
        vy('set nat source rule 100 outbound-interface name eth0'),
        vy('set nat source rule 100 source address 192.168.88.0/24'),
        vy('set nat source rule 100 translation address masquerade'),
        ...vyCommit,
      ],
      ios: [
        conf('interface GigabitEthernet0/0'),
        confIf('ip nat outside'),
        confIf('interface GigabitEthernet0/1'),
        confIf('ip nat inside'),
        confIf('exit'),
        conf('access-list 1 permit 192.168.88.0 0.0.0.255'),
        conf('ip nat inside source list 1 interface GigabitEthernet0/0 overload'),
      ],
    },
    check: ({ wan }) => ({
      natSourceIs: {
        from: 'PC1',
        to: '93.184.216.34',
        protocol: 'tcp',
        port: 443,
        expect: { addressOf: `R1:${wan}` },
      },
    }),
  },
  {
    id: 'dns',
    pc: 'static',
    setup: {
      routeros: [ROS_LAN, ROS_WAN, ROS_ROUTE, ROS_NAT],
      vrp: [...VRP_LAN, ...VRP_WAN, ...VRP_ROUTE, ...VRP_NAT],
    },
    simulated: {
      routeros: ['/ip dns set servers=1.1.1.1 allow-remote-requests=yes'],
      vrp: ['system-view', 'dns resolve', 'dns server 1.1.1.1', 'dns proxy enable'],
    },
    quoted: {
      vyos: [
        vy('set service dns forwarding listen-address 192.168.88.1'),
        vy('set service dns forwarding allow-from 192.168.88.0/24'),
        vy('set service dns forwarding name-server 1.1.1.1'),
        ...vyCommit,
      ],
      ios: [conf('ip dns server'), conf('ip name-server 1.1.1.1'), conf('ip domain lookup')],
    },
    check: () => ({ resolves: { from: 'PC1', name: 'example.com', via: 'R1' } }),
  },
  {
    id: 'user',
    pc: 'static',
    setup: { routeros: [], vrp: [] },
    simulated: {
      routeros: ['/user add name=soporte group=full password=Cl4ve-Segura'],
      vrp: [
        'system-view',
        'aaa',
        'local-user soporte password irreversible-cipher Cl4ve-Segura',
        'local-user soporte privilege level 15',
        'local-user soporte service-type ssh',
      ],
    },
    quoted: {
      vyos: [
        vy('set system login user soporte authentication plaintext-password Cl4ve-Segura'),
        ...vyCommit,
      ],
      ios: [conf('username soporte privilege 15 secret Cl4ve-Segura')],
    },
    check: () => ({
      exists: { device: 'R1', collection: 'users', where: { name: 'soporte', hasPassword: true } },
    }),
  },
  {
    id: 'telnet',
    pc: 'static',
    setup: { routeros: [ROS_LAN], vrp: VRP_LAN },
    simulated: {
      routeros: ['/ip service disable telnet'],
      vrp: ['system-view', 'undo telnet server enable'],
    },
    quoted: {
      // VyOS no trae servidor Telnet: no hay nada que apagar (la página lo explica).
      vyos: [],
      ios: [conf('line vty 0 4'), ios('(config-line)', 'transport input ssh')],
    },
    check: () => ({
      all: [
        { reachable: { from: 'PC1', to: '192.168.88.1' } },
        { blocked: { from: 'PC1', to: '192.168.88.1', protocol: 'tcp', port: 23, by: 'any' } },
      ],
    }),
  },
];

/**
 * La oficina mínima de una tarea en un sistema simulado: el proveedor (que
 * resuelve example.com), el router con la configuración previa y la PC de la
 * LAN, fija o por DHCP. Pasa por el esquema de labs como cualquier lab.
 */
export function compareLab(task: CompareTask, os: SimulatedOs): LabDefinition {
  const ports = PORTS[os];
  return LabSchema.parse({
    id: `compare-${task.id}-${os}`,
    vendor: os,
    title: { es: 'Compara sintaxis', en: 'Compare syntax' },
    summary: { es: 'Oficina mínima.', en: 'Minimal office.' },
    difficulty: 'beginner',
    minutes: 5,
    topology: {
      devices: [
        {
          id: 'ISP',
          os: 'internet',
          board: 'sim-cloud',
          internet: { address: '203.0.113.1/24', dns: { 'example.com': '93.184.216.34' } },
        },
        {
          id: 'R1',
          os,
          board: 'sim-r5',
          ...(task.setup[os].length > 0 ? { startup: task.setup[os].join('\n') } : {}),
        },
        {
          id: 'PC1',
          os: 'host',
          board: 'sim-host',
          host:
            task.pc === 'dhcp'
              ? { ip: 'dhcp' }
              : { ip: '192.168.88.10/24', gateway: '192.168.88.1', dns: ['192.168.88.1'] },
        },
      ],
      links: [
        ['ISP:eth0', `R1:${ports.wan}`],
        [`R1:${ports.lan}`, 'PC1:eth0'],
      ],
    },
    objectives: [
      {
        id: task.id,
        text: { es: task.id, en: task.id },
        check: task.check(ports),
        hints: [{ es: '-', en: '-' }],
      },
    ],
    explanation: { es: '-', en: '-' },
  });
}
