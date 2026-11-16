import { type Device, formatIpv4, formatPrefix, formatRange, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/** R1 con IOS y PC1 como cliente DHCP en Gi0/1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .dhcpClient('PC1', 'eth0')
    .build();
}

/** La interfaz de la LAN encendida, con su dirección, y la configuración global abierta. */
const LAN = [
  'enable',
  'configure terminal',
  'interface GigabitEthernet0/1',
  'ip address 192.168.1.1 255.255.255.0',
  'no shutdown',
  'exit',
];

const POOL = [
  'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
  'ip dhcp pool LAN',
  'network 192.168.1.0 255.255.255.0',
  'default-router 192.168.1.1',
  'dns-server 8.8.8.8 1.1.1.1',
];

const term = () => new IosTerminal(lab(), 'R1');

function pc(network: Network): Device {
  const found = network.devices.find((d) => d.id === 'PC1');
  if (!found) throw new Error('falta PC1');
  return found;
}

const lease = (network: Network) => pc(network).oper.dhcpClients[0];

describe('pool DHCP', () => {
  it('la PC recibe la primera dirección libre tras las excluidas, con gateway y DNS', () => {
    const t = term().script([...LAN, ...POOL]);
    const status = lease(t.net);
    expect(status?.status).toBe('bound');
    expect(status?.address && formatPrefix(status.address)).toBe('192.168.1.11/24');
    expect(status?.gateway && formatIpv4(status.gateway)).toBe('192.168.1.1');
    expect(status?.dns.map(formatIpv4)).toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('sin excluir nada, el router no se reparte su propia dirección', () => {
    const t = term().script([...LAN, 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0']);
    const pool = t.device.config.dhcpServer.pools[0];
    expect(pool?.ranges.map(formatRange)).toEqual(['192.168.1.2-192.168.1.254']);
    const address = lease(t.net)?.address;
    expect(address && formatPrefix(address)).toBe('192.168.1.2/24');
  });

  it('el servidor sale solo en la interfaz cuya red cubre el pool', () => {
    const t = term().script([...LAN, 'ip dhcp pool OTRA', 'network 10.0.0.0 255.0.0.0']);
    expect(t.device.config.dhcpServer.servers).toEqual([]);
    expect(lease(t.net)?.status).toBe('searching');
    t.script(['ip dhcp pool LAN', 'network 192.168.1.0 /24']);
    expect(t.device.config.dhcpServer.servers.map((s) => s.name)).toEqual(['GigabitEthernet0/1']);
    expect(lease(t.net)?.status).toBe('bound');
  });

  it('con la interfaz apagada no hay lease', () => {
    const t = term().script([
      'enable',
      'conf t',
      'int g0/1',
      'ip address 192.168.1.1 255.255.255.0',
      ...POOL,
    ]);
    expect(lease(t.net)?.status).not.toBe('bound');
    t.script(['int g0/1', 'no shut']);
    expect(lease(t.net)?.status).toBe('bound');
  });

  it('no service dhcp apaga el servidor y service dhcp lo vuelve a encender', () => {
    const t = term().script([...LAN, ...POOL]);
    t.ok('no service dhcp');
    expect(t.device.config.dhcp.serverEnabled).toBe(false);
    expect(lease(t.net)?.status).toBe('searching');
    expect(t.ok('do show running-config')).toContain('\nno service dhcp\n');
    t.ok('service dhcp');
    expect(lease(t.net)?.status).toBe('bound');
  });

  it('lease, domain-name y la configuración del pool', () => {
    const t = term().script([...LAN, ...POOL, 'domain-name lab.local', 'lease 7']);
    expect(t.device.config.dhcpServer.servers[0]?.leaseTimeS).toBe(7 * 86_400);
    expect(t.device.config.dhcpServer.networks[0]?.domain).toBe('lab.local');
    const run = t.ok('do show run');
    expect(run).toContain('!\nip dhcp excluded-address 192.168.1.1 192.168.1.10\n!');
    expect(run).toContain(
      [
        'ip dhcp pool LAN',
        ' network 192.168.1.0 255.255.255.0',
        ' default-router 192.168.1.1',
        ' dns-server 8.8.8.8 1.1.1.1',
        ' domain-name lab.local',
        ' lease 7',
      ].join('\n'),
    );
    t.ok('lease infinite');
    expect(t.ok('do sh run | include lease')).toBe(' lease infinite');
    t.ok('no lease');
    expect(t.device.config.dhcpServer.servers[0]?.leaseTimeS).toBe(86_400);
  });

  it('no ip dhcp pool borra el pool, su red y su servidor', () => {
    const t = term().script([...LAN, ...POOL, 'exit']);
    expect(t.run('no ip dhcp pool NADA')).toBe('%Pool NADA not found');
    t.ok('no ip dhcp pool LAN');
    const cfg = t.device.config.dhcpServer;
    expect([cfg.pools.length, cfg.networks.length, cfg.servers.length]).toEqual([0, 0, 0]);
  });

  it('dos pools no pueden cubrir la misma red', () => {
    const t = term().script([...LAN, ...POOL, 'ip dhcp pool OTRO']);
    expect(t.run('network 192.168.1.0 255.255.255.128')).toBe(
      '% 192.168.1.0/25 overlaps with pool LAN',
    );
  });

  it('no ip dhcp excluded-address devuelve las direcciones al pool', () => {
    const t = term().script([...LAN, ...POOL, 'exit']);
    expect(t.run('no ip dhcp excluded-address 192.168.1.1 192.168.1.9')).toBe(
      '% Range not found in the excluded address list',
    );
    t.ok('no ip dhcp excluded-address 192.168.1.1 192.168.1.10');
    expect(t.device.config.dhcpServer.pools[0]?.ranges.map(formatRange)).toEqual([
      '192.168.1.2-192.168.1.254',
    ]);
  });
});

describe('show ip dhcp', () => {
  it('binding muestra el lease de la PC y pool sus cuentas', () => {
    const t = term().script([...LAN, ...POOL, 'end']);
    const binding = t.ok('show ip dhcp binding');
    expect(binding).toContain('Bindings from all pools not associated with VRF:');
    expect(binding).toMatch(
      /\n192\.168\.1\.11 +01[0-9a-f]{2}\.[0-9a-f.]+ +\w{3} \d{2} \d{4} \d{2}:\d{2} [AP]M +Automatic/,
    );
    const pool = t.ok('show ip dhcp pool');
    expect(pool).toContain('Pool LAN :');
    expect(pool).toContain(' Total addresses                : 254');
    expect(pool).toContain(' Leased addresses               : 1');
    expect(pool).toContain(' 192.168.1.12         192.168.1.1      - 192.168.1.254    1');
  });
});
