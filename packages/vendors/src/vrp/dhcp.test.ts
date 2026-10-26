import { type Device, formatIpv4, formatPrefix, formatRange, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { DHCP_AREA } from './commands/dhcp';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/** R1 con VRP y PC1 como cliente DHCP en GE0/0/1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .dhcpClient('PC1', 'eth0')
    .build();
}

const term = () => new VrpTerminal(lab(), 'R1');

/** La oficina completa: dirección, servicio, pool con todo y servidor en la interfaz. */
const OFFICE = [
  'system-view',
  'interface GigabitEthernet0/0/1',
  'ip address 192.168.1.1 24',
  'quit',
  'dhcp enable',
  'ip pool oficina',
  'network 192.168.1.0 mask 255.255.255.0',
  'gateway-list 192.168.1.1',
  'dns-list 8.8.8.8 1.1.1.1',
  'excluded-ip-address 192.168.1.2 192.168.1.10',
  'quit',
  'interface GigabitEthernet0/0/1',
  'dhcp select global',
];

const pools = (t: VrpTerminal) => t.device.config.dhcpServer.pools;
const ranges = (t: VrpTerminal, name: string) =>
  pools(t)
    .find((p) => p.name === name)
    ?.ranges.map(formatRange);
const servers = (t: VrpTerminal) => t.device.config.dhcpServer.servers;

function pc(network: Network): Device {
  const found = network.devices.find((d) => d.id === 'PC1');
  if (!found) throw new Error('falta PC1');
  return found;
}

describe('dhcp enable', () => {
  it('enciende y apaga el servicio DHCP del equipo', () => {
    const t = term();
    t.ok('system-view');
    expect(t.device.config.dhcp.serverEnabled).toBe(false);
    expect(t.ok('dhcp enable')).toBe(
      'Info: The operation may take a few seconds. Please wait for a moment.done.',
    );
    expect(t.device.config.dhcp.serverEnabled).toBe(true);
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain('#\n sysname Huawei\n#\n dhcp enable\n#');
    expect(cfg.indexOf(' dhcp enable')).toBeLessThan(cfg.indexOf('interface GigabitEthernet0/0/0'));
    t.ok('undo dhcp enable');
    expect(t.device.config.dhcp.serverEnabled).toBe(false);
    expect(t.ok('display current-configuration')).not.toContain('dhcp enable');
  });
});

describe('ip pool', () => {
  it('crea el pool, entra en su vista y vuelve a entrar sin crearlo de nuevo', () => {
    const t = term();
    t.ok('system-view');
    expect(t.ok('ip pool oficina')).toBe("Info: It's successful to create an IP address pool.");
    expect(t.prompt).toBe('[Huawei-ip-pool-oficina]');
    expect(pools(t).map((p) => p.name)).toEqual(['oficina']);
    t.ok('quit');
    expect(t.prompt).toBe('[Huawei]');
    expect(t.ok('ip pool oficina')).toBe('');
    expect(pools(t)).toHaveLength(1);
    expect(t.ok('display this')).toBe('#\nip pool oficina\n#\nreturn');
  });

  it('traduce red, gateway, DNS y excluidas a un pool y una red DHCP', () => {
    const t = term();
    t.script(OFFICE.slice(0, 10));
    expect(ranges(t, 'oficina')).toEqual(['192.168.1.11-192.168.1.254']);
    const network = t.device.config.dhcpServer.networks[0];
    expect(network && formatPrefix(network.prefix)).toBe('192.168.1.0/24');
    expect(network?.gateway === undefined ? '' : formatIpv4(network.gateway)).toBe('192.168.1.1');
    expect(network?.dnsServers.map(formatIpv4)).toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('display this y la configuración imprimen el pool en el orden de VRP', () => {
    const t = term();
    t.script([
      ...OFFICE.slice(0, 10),
      'lease day 3 hour 4 minute 5',
      'excluded-ip-address 192.168.1.200',
    ]);
    const block = [
      'ip pool oficina',
      ' gateway-list 192.168.1.1',
      ' network 192.168.1.0 mask 255.255.255.0',
      ' excluded-ip-address 192.168.1.2 192.168.1.10',
      ' excluded-ip-address 192.168.1.200',
      ' lease day 3 hour 4 minute 5',
      ' dns-list 8.8.8.8 1.1.1.1',
    ].join('\n');
    expect(t.ok('display this')).toBe(`#\n${block}\n#\nreturn`);
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain(`#\n dhcp enable\n#\n${block}\n#`);
    expect(cfg.indexOf('ip pool oficina')).toBeLessThan(
      cfg.indexOf('interface GigabitEthernet0/0/0'),
    );
  });

  it('el lease admite solo días, días y horas, y vuelve al de fábrica con undo', () => {
    const t = term();
    t.script(['system-view', 'ip pool oficina', 'lease day 2']);
    expect(t.ok('display this')).toContain(' lease day 2 hour 0 minute 0');
    t.ok('lease day 0 hour 12');
    expect(t.ok('display this')).toContain(' lease day 0 hour 12 minute 0');
    t.ok('undo lease');
    expect(t.ok('display this')).not.toContain('lease');
    // Un día exacto es el valor de fábrica: no se imprime.
    t.ok('lease day 1');
    expect(t.ok('display this')).not.toContain('lease');
    expect(t.run('lease day 0')).toContain("Error: Wrong parameter found at '^' position.");
    expect(t.run('lease day 1000')).toContain('Wrong parameter');
  });

  it('acepta gateway y DNS antes de la red y los pasa a la red DHCP al configurarla', () => {
    const t = term();
    t.script([
      'system-view',
      'ip pool oficina',
      'gateway-list 192.168.1.1',
      'dns-list 8.8.8.8',
      'lease day 2',
    ]);
    expect(t.device.config.dhcpServer.networks).toHaveLength(0);
    expect(t.ok('display this')).toContain(' gateway-list 192.168.1.1');
    expect(t.ok('display this')).toContain(' dns-list 8.8.8.8');
    t.ok('network 192.168.1.0 mask 24');
    const network = t.device.config.dhcpServer.networks[0];
    expect(network?.gateway === undefined ? '' : formatIpv4(network.gateway)).toBe('192.168.1.1');
    expect(network?.dnsServers.map(formatIpv4)).toEqual(['8.8.8.8']);
    expect(ranges(t, 'oficina')).toEqual(['192.168.1.2-192.168.1.254']);
    expect(t.ok('display this')).toContain(' lease day 2 hour 0 minute 0');
  });

  it('las formas undo deshacen cada ajuste', () => {
    const t = term();
    t.script(OFFICE.slice(0, 10));
    t.ok('undo excluded-ip-address 192.168.1.5');
    expect(ranges(t, 'oficina')).toEqual(['192.168.1.5', '192.168.1.11-192.168.1.254']);
    expect(t.ok('display this')).toContain(
      ' excluded-ip-address 192.168.1.2 192.168.1.4\n excluded-ip-address 192.168.1.6 192.168.1.10',
    );
    t.ok('undo excluded-ip-address 192.168.1.2 192.168.1.10');
    expect(ranges(t, 'oficina')).toEqual(['192.168.1.2-192.168.1.254']);
    t.ok('undo dns-list 1.1.1.1');
    expect(t.device.config.dhcpServer.networks[0]?.dnsServers.map(formatIpv4)).toEqual(['8.8.8.8']);
    t.ok('undo dns-list all');
    expect(t.device.config.dhcpServer.networks[0]?.dnsServers).toEqual([]);
    expect(t.run('undo gateway-list 192.168.1.99')).toBe('Error: The gateway does not exist.');
    t.ok('undo gateway-list');
    expect(t.device.config.dhcpServer.networks[0]?.gateway).toBeUndefined();
    // Sin gateway, la .1 vuelve al pool.
    expect(ranges(t, 'oficina')).toEqual(['192.168.1.1-192.168.1.254']);
    t.ok('undo network');
    expect(t.device.config.dhcpServer.networks).toHaveLength(0);
    expect(t.ok('display this')).toBe('#\nip pool oficina\n#\nreturn');
  });

  it('rechaza excluir sin red o fuera de ella y dos pools en el mismo segmento', () => {
    const t = term();
    t.script(['system-view', 'ip pool oficina']);
    expect(t.run('excluded-ip-address 192.168.1.2')).toBe(
      'Error: Configure the network segment of the IP address pool first.',
    );
    t.ok('network 192.168.1.0 mask 24');
    expect(t.run('excluded-ip-address 10.0.0.1')).toBe(
      'Error: The IP address is not in the network segment of the pool.',
    );
    expect(t.run('excluded-ip-address 192.168.1.20 192.168.1.10')).toContain('Wrong parameter');
    t.script(['quit', 'ip pool otro']);
    expect(t.run('network 192.168.1.128 mask 25')).toBe(
      'Error: The network segment overlaps that of another IP address pool.',
    );
    t.ok('network 192.168.2.0 mask 24');
    expect(t.device.config.dhcpServer.networks).toHaveLength(2);
  });

  it('excluir toda la red deja el pool sin direcciones que repartir', () => {
    const t = term();
    t.script([
      'system-view',
      'ip pool mini',
      'network 10.0.0.0 mask 30',
      'gateway-list 10.0.0.1',
      'excluded-ip-address 10.0.0.2',
    ]);
    expect(t.ok('display this')).toContain(' excluded-ip-address 10.0.0.2');
    t.ok('undo excluded-ip-address 10.0.0.2');
    expect(ranges(t, 'mini')).toEqual(['10.0.0.2']);
  });

  it('undo ip pool borra el pool y su red', () => {
    const t = term();
    t.script(['system-view', 'ip pool oficina', 'network 192.168.1.0 mask 24', 'quit']);
    expect(t.run('undo ip pool nada')).toBe('Error: The IP address pool does not exist.');
    t.ok('undo ip pool oficina');
    expect(pools(t)).toHaveLength(0);
    expect(t.device.config.dhcpServer.networks).toHaveLength(0);
  });
});

describe('dhcp select global', () => {
  it('pide dhcp enable antes', () => {
    const t = term();
    t.script(['system-view', 'interface GigabitEthernet0/0/1']);
    expect(t.run('dhcp select global')).toBe('Error: Please enable DHCP in the system view first.');
    expect(servers(t)).toHaveLength(0);
  });

  it('crea el servidor en la interfaz, enlazado con el pool de su red', () => {
    const t = term();
    t.script([...OFFICE.slice(0, 10), 'lease day 3', 'quit']);
    t.script(OFFICE.slice(11));
    const server = servers(t)[0];
    expect(server?.iface).toBe(
      t.device.config.interfaces.find((i) => i.name === 'GigabitEthernet0/0/1')?.id,
    );
    expect(server?.pool).toBe(pools(t)[0]?.id);
    expect(server?.leaseTimeS).toBe(3 * 86_400);
    expect(t.ok('display this')).toContain(
      'interface GigabitEthernet0/0/1\n ip address 192.168.1.1 255.255.255.0\n dhcp select global',
    );
    // Repetirlo no crea otro servidor.
    t.ok('dhcp select global');
    expect(servers(t)).toHaveLength(1);
    t.ok('undo dhcp select global');
    expect(servers(t)).toHaveLength(0);
    expect(t.ok('display this')).not.toContain('dhcp select');
  });

  it('sin pool que cubra la interfaz queda static-only y se enlaza cuando aparece', () => {
    const t = term();
    t.script([
      'system-view',
      'dhcp enable',
      'interface GigabitEthernet0/0/1',
      'ip address 192.168.1.1 24',
      'dhcp select global',
    ]);
    expect(servers(t)[0]?.pool).toBe('static-only');
    expect(servers(t)[0]?.leaseTimeS).toBe(86_400);
    t.script(['quit', 'ip pool oficina', 'lease day 5']);
    expect(servers(t)[0]?.pool).toBe('static-only');
    t.ok('network 192.168.1.0 mask 24');
    expect(servers(t)[0]?.pool).toBe(pools(t)[0]?.id);
    expect(servers(t)[0]?.leaseTimeS).toBe(5 * 86_400);
    t.ok('undo lease');
    expect(servers(t)[0]?.leaseTimeS).toBe(86_400);
    // Si la interfaz cambia de red, el servidor se queda sin pool.
    t.script(['quit', 'interface GigabitEthernet0/0/1', 'ip address 10.1.1.1 24']);
    expect(servers(t)[0]?.pool).toBe('static-only');
  });

  it('la reconciliación no devuelve nada cuando el modelo ya está al día', () => {
    const t = term();
    t.script(OFFICE);
    expect(DHCP_AREA.reconcile?.(t.device)).toEqual([]);
  });
});

describe('display ip pool', () => {
  it('lista los pools y detalla uno con lease, DNS y cuentas', () => {
    const t = term();
    t.script([...OFFICE, 'return']);
    const list = t.ok('display ip pool');
    expect(list).toContain('  Pool-name      : oficina');
    expect(list).toContain('  Gateway-0      : 192.168.1.1');
    expect(list).toContain('  Mask           : 255.255.255.0');
    expect(list).toContain('    Total       :254');
    expect(list).toMatch(/Used {8}:1 +Idle {8}:243/);
    expect(list).toContain('Disable    :10');
    const detail = t.ok('display ip pool name oficina');
    expect(detail).toContain('  Lease          : 1 Days 0 Hours 0 Minutes');
    expect(detail).toContain('  DNS-server0    : 8.8.8.8');
    expect(detail).toContain('  DNS-server1    : 1.1.1.1');
    expect(detail).toMatch(/192\.168\.1\.1 +192\.168\.1\.254 +254 +1 +243\(0\) +0 +10/);
    expect(t.run('display ip pool name nada')).toBe('Error: The IP address pool does not exist.');
  });
});

describe('extremo a extremo', () => {
  it('PC1 recibe una dirección del pool, el gateway y el DNS', () => {
    const t = term();
    t.script(OFFICE);
    const status = pc(t.net).oper.dhcpClients[0];
    expect(status?.status).toBe('bound');
    const ip = status?.address === undefined ? '' : formatPrefix(status.address);
    expect(ip).toBe('192.168.1.11/24');
    expect(status?.gateway === undefined ? '' : formatIpv4(status.gateway)).toBe('192.168.1.1');
    expect(status?.dns.map(formatIpv4)).toEqual(['8.8.8.8', '1.1.1.1']);
    // El router llega a la PC por la dirección que le dio.
    t.ok('return');
    expect(t.ok('ping -c 1 192.168.1.11')).toContain('1 packet(s) received');
  });

  it('nunca entrega el gateway ni una dirección excluida', () => {
    const t = term();
    // Sin la dirección en la interfaz el gateway solo se salta por ser gateway.
    t.script([
      'system-view',
      'dhcp enable',
      'interface GigabitEthernet0/0/1',
      'ip address 192.168.1.254 24',
      'quit',
      'ip pool oficina',
      'gateway-list 192.168.1.1',
      'network 192.168.1.0 mask 24',
      'excluded-ip-address 192.168.1.2 192.168.1.3',
      'quit',
      'interface GigabitEthernet0/0/1',
      'dhcp select global',
    ]);
    const status = pc(t.net).oper.dhcpClients[0];
    expect(status?.address === undefined ? '' : formatPrefix(status.address)).toBe(
      '192.168.1.4/24',
    );
  });

  it('sin dhcp enable PC1 no recibe nada', () => {
    const t = term();
    t.script([...OFFICE.slice(0, 4), ...OFFICE.slice(5, 11), 'interface GigabitEthernet0/0/1']);
    expect(t.run('dhcp select global')).toContain('Please enable DHCP');
    expect(pc(t.net).oper.dhcpClients[0]?.status).toBe('searching');
    // Apagar el servicio con el servidor ya creado también deja a la PC sin dirección.
    t.script(['quit', 'dhcp enable', 'interface GigabitEthernet0/0/1', 'dhcp select global']);
    expect(pc(t.net).oper.dhcpClients[0]?.status).toBe('bound');
    t.script(['quit', 'undo dhcp enable']);
    expect(pc(t.net).oper.dhcpClients[0]?.status).toBe('searching');
  });

  it('no deja borrar un pool con direcciones repartidas', () => {
    const t = term();
    t.script([...OFFICE, 'quit']);
    expect(t.run('undo ip pool oficina')).toBe(
      'Error: The IP address pool is in use and cannot be deleted.',
    );
    t.script(['interface GigabitEthernet0/0/1', 'undo dhcp select global', 'quit']);
    t.ok('undo ip pool oficina');
    expect(pools(t)).toHaveLength(0);
  });

  it('borrar el pool deja la interfaz con dhcp select global, sin pool', () => {
    const base = lab();
    // PC1 desconectada: el servidor existe pero no ha repartido nada.
    const t = new VrpTerminal({ ...base, links: [] }, 'R1');
    t.script([...OFFICE, 'quit', 'undo ip pool oficina']);
    expect(servers(t)[0]?.pool).toBe('static-only');
    expect(t.ok('display current-configuration')).toContain(' dhcp select global');
  });
});

describe('arranque de labs', () => {
  it('la configuración impresa se vuelve a cargar idéntica', () => {
    const t = term();
    t.script([...OFFICE, 'quit', 'ip pool oficina', 'lease day 2 hour 6', 'return']);
    const printed = t.ok('display current-configuration');
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(device, printed);
    if (!ran.ok) throw new Error(ran.error);
    const again = new VrpTerminal(
      { ...t.net, devices: t.net.devices.map((d) => (d.id === 'R1' ? ran.value : d)) },
      'R1',
    );
    expect(again.ok('display current-configuration')).toBe(printed);
    expect(DHCP_AREA.reconcile?.(ran.value)).toEqual([]);
  });

  it('el pool se reconstruye desde un script con el orden de la configuración', () => {
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(
      device,
      [
        '#',
        ' dhcp enable',
        '#',
        'ip pool oficina',
        ' gateway-list 192.168.1.1',
        ' network 192.168.1.0 mask 255.255.255.0',
        ' excluded-ip-address 192.168.1.2 192.168.1.10',
        ' lease day 2 hour 0 minute 0',
        ' dns-list 8.8.8.8',
        'quit',
        '#',
        'interface GigabitEthernet0/0/1',
        ' ip address 192.168.1.1 255.255.255.0',
        ' dhcp select global',
        '#',
        'return',
      ].join('\n'),
    );
    if (!ran.ok) throw new Error(ran.error);
    const r1 = ran.value;
    expect(r1.config.dhcp.serverEnabled).toBe(true);
    expect(r1.config.dhcpServer.pools[0]?.ranges.map(formatRange)).toEqual([
      '192.168.1.11-192.168.1.254',
    ]);
    expect(r1.config.dhcpServer.servers[0]?.pool).toBe(r1.config.dhcpServer.pools[0]?.id);
    expect(r1.config.dhcpServer.servers[0]?.leaseTimeS).toBe(2 * 86_400);
  });
});
