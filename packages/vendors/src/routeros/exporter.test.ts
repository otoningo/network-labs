import { type Network, parsePortSet, prefix } from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { type ExportOptions, renderExport } from './exporter';
import { ROUTEROS_PLATFORM } from './platform';
import type { MenuCtx } from './schema';
import { DEFAULT_CLOCK_BASE } from './session';
import { MENUS } from './tree';

const ctxOf = (n: Network): MenuCtx => ({
  net: n,
  device: deviceIn(n, 'R1'),
  platform: ROUTEROS_PLATFORM,
  user: 'admin',
  clockBase: DEFAULT_CLOCK_BASE,
});

const exportOf = (n: Network, options: Partial<ExportOptions> = {}): string =>
  renderExport(MENUS, ctxOf(n), {
    scope: '',
    verbose: false,
    showSensitive: false,
    header: false,
    ...options,
  });

const text = (...lines: string[]): string => lines.join('\n');

const router = () => net().router('R1', 'sim-r5w', ROUTEROS_PLATFORM);

/** Router de oficina: WAN en ether1 renombrada, LAN en bridge1, wifi, firewall y NAT. */
const office = () =>
  router()
    .op('R1', (h) => ({
      op: 'set',
      coll: 'interfaces',
      id: h.iface('ether1'),
      patch: { name: 'ether1-wan' },
    }))
    .bridge('R1', 'bridge1', ['ether2', 'ether3'])
    .address('R1', 'bridge1', '192.168.88.1/24')
    .address('R1', 'ether1-wan', '203.0.113.2/30')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .filter(
      'R1',
      'input',
      { kind: 'accept' },
      () => ({ connectionState: ['established', 'related'] }),
      { comment: 'defconf: accept established,related' },
    )
    .filter('R1', 'input', { kind: 'drop' }, (h) => ({
      inInterface: { value: h.iface('ether1-wan'), negate: false },
    }))
    .masquerade('R1', 'ether1-wan')
    .dns('R1', ['1.1.1.1'], true)
    .wifi('R1', 'wifi1', 'ap', 'Lab', 'secret123')
    .op('R1', (h) => ({
      op: 'set',
      coll: 'services',
      id: h.find('services', (s) => s.name === 'telnet'),
      patch: { disabled: true },
    }))
    .op('R1', () => ({ op: 'setSingleton', key: 'system', patch: { identity: 'R1' } }))
    .build();

describe('export completo', () => {
  it('ordena los menús por dependencias y omite los valores de fábrica', () => {
    expect(exportOf(office())).toBe(
      text(
        '/interface bridge',
        'add name=bridge1',
        '/interface ethernet',
        'set [ find default-name=ether1 ] name=ether1-wan',
        '/interface wifi',
        'set [ find default-name=wifi1 ] configuration.ssid=Lab disabled=no',
        '/interface bridge port',
        'add bridge=bridge1 interface=ether2',
        'add bridge=bridge1 interface=ether3',
        '/ip address',
        'add address=192.168.88.1/24 interface=bridge1',
        'add address=203.0.113.2/30 interface=ether1-wan',
        '/ip dns',
        'set allow-remote-requests=yes servers=1.1.1.1',
        '/ip firewall filter',
        'add action=accept chain=input comment="defconf: accept established,related" \\',
        '    connection-state=established,related',
        'add action=drop chain=input in-interface=ether1-wan',
        '/ip firewall nat',
        'add action=masquerade chain=srcnat out-interface=ether1-wan',
        '/ip route',
        'add dst-address=0.0.0.0/0 gateway=203.0.113.1',
        '/ip service',
        'set telnet disabled=yes',
        '/system identity',
        'set name=R1',
      ),
    );
  });

  it('la cabecera lleva la fecha simulada y el modelo', () => {
    const lines = exportOf(router().at(3600).build(), { scope: 'ip/firewall', header: true });
    expect(lines).toBe(
      text('# 2026-01-05 10:00:00 by RouterOS 7 (simulated)', '# model = sim-r5w'),
    );
  });

  it('no exporta filas dinámicas ni listas incorporadas', () => {
    const n = router()
      .router('R2', 'sim-r5w', ROUTEROS_PLATFORM)
      .link('R1:ether1', 'R2:ether1')
      .address('R2', 'ether1', '10.0.0.1/24')
      .dhcpServer('R2', {
        iface: 'ether1',
        pool: '10.0.0.5-10.0.0.5',
        network: '10.0.0.0/24',
        gateway: '10.0.0.1',
      })
      .dhcpClient('R1', 'ether1')
      .build();
    expect(exportOf(n, { scope: 'ip' })).toBe(text('/ip dhcp-client', 'add interface=ether1'));
    expect(exportOf(n, { scope: 'interface/list' })).toBe('');
  });
});

describe('alcance y verbose', () => {
  it('el alcance incluye el menú y sus submenús, no los que solo comparten prefijo', () => {
    const n = office();
    expect(exportOf(n, { scope: 'ip/firewall' })).toBe(
      text(
        '/ip firewall filter',
        'add action=accept chain=input comment="defconf: accept established,related" \\',
        '    connection-state=established,related',
        'add action=drop chain=input in-interface=ether1-wan',
        '/ip firewall nat',
        'add action=masquerade chain=srcnat out-interface=ether1-wan',
      ),
    );
    expect(exportOf(n, { scope: 'interface/bridge/port' })).toBe(
      text(
        '/interface bridge port',
        'add bridge=bridge1 interface=ether2',
        'add bridge=bridge1 interface=ether3',
      ),
    );
    expect(exportOf(n, { scope: 'ip/dns' })).toBe(
      text('/ip dns', 'set allow-remote-requests=yes servers=1.1.1.1'),
    );
  });

  it('verbose incluye también los valores por defecto', () => {
    const n = router().bridge('R1', 'bridge1', ['ether2']).build();
    expect(exportOf(n, { scope: 'interface/bridge', verbose: true })).toBe(
      text(
        '/interface bridge',
        'add disabled=no mtu=1500 name=bridge1 protocol-mode=rstp pvid=1 \\',
        '    vlan-filtering=no',
        '/interface bridge port',
        'add bridge=bridge1 disabled=no frame-types=admit-all ingress-filtering=yes \\',
        '    interface=ether2 pvid=1',
      ),
    );
  });

  it('DHCP: omite lease-time y authoritative de fábrica salvo en verbose', () => {
    const n = router()
      .bridge('R1', 'bridge1', [])
      .dhcpServer('R1', {
        iface: 'bridge1',
        pool: '192.168.88.10-192.168.88.254',
        network: '192.168.88.0/24',
        gateway: '192.168.88.1',
        dns: ['192.168.88.1'],
        leaseTimeS: 1800,
        name: 'dhcp1',
      })
      .build();
    expect(exportOf(n, { scope: 'ip' })).toBe(
      text(
        '/ip pool',
        'add name=dhcp1-pool ranges=192.168.88.10-192.168.88.254',
        '/ip dhcp-server',
        'add address-pool=dhcp1-pool interface=bridge1 name=dhcp1',
        '/ip dhcp-server network',
        'add address=192.168.88.0/24 dns-server=192.168.88.1 gateway=192.168.88.1',
      ),
    );
    expect(exportOf(n, { scope: 'ip/dhcp-server', verbose: true })).toContain(
      'add address-pool=dhcp1-pool authoritative=yes disabled=no interface=bridge1 \\\n' +
        '    lease-time=30m name=dhcp1',
    );
  });
});

describe('estilos set', () => {
  it('servicios: set <nombre> con lo que difiere del valor de fábrica de cada uno', () => {
    const n = router()
      .op('R1', (h) => [
        {
          op: 'set',
          coll: 'services',
          id: h.find('services', (s) => s.name === 'telnet'),
          patch: { disabled: true },
        },
        {
          op: 'set',
          coll: 'services',
          id: h.find('services', (s) => s.name === 'ssh'),
          patch: { port: 2222 },
        },
        {
          op: 'set',
          coll: 'services',
          id: h.find('services', (s) => s.name === 'https'),
          patch: { disabled: false },
        },
      ])
      .build();
    expect(exportOf(n, { scope: 'ip/service' })).toBe(
      text(
        '/ip service',
        'set telnet disabled=yes',
        'set ssh port=2222',
        'set www-ssl disabled=no',
      ),
    );
  });

  it('wifi: la contraseña solo sale con show-sensitive', () => {
    const n = router().wifi('R1', 'wifi1', 'ap', 'Lab', 'secret123').build();
    const hidden = exportOf(n, { scope: 'interface/wifi' });
    expect(hidden).toBe(
      text('/interface wifi', 'set [ find default-name=wifi1 ] configuration.ssid=Lab disabled=no'),
    );
    expect(hidden).not.toContain('secret123');
    expect(exportOf(n, { scope: 'interface/wifi', showSensitive: true })).toBe(
      text(
        '/interface wifi',
        'set [ find default-name=wifi1 ] configuration.ssid=Lab disabled=no \\',
        '    security.passphrase=secret123',
      ),
    );
  });

  it('menús únicos: solo si algo cambió', () => {
    expect(exportOf(router().build(), { scope: 'system' })).toBe('');
    expect(exportOf(router().build(), { scope: 'ip/dns' })).toBe('');
    const n = router()
      .op('R1', () => ({ op: 'setSingleton', key: 'system', patch: { identity: 'core router' } }))
      .build();
    expect(exportOf(n, { scope: 'system' })).toBe(
      text('/system identity', 'set name="core router"'),
    );
  });
});

describe('líneas largas', () => {
  it('parte entre argumentos con " \\" sin cortar valores entre comillas', () => {
    const n = router()
      .add('R1', 'filterRules', (h) => ({
        chain: 'forward',
        match: {
          srcAddress: { value: prefix('192.168.50.0/24'), negate: false },
          dstAddress: { value: prefix('192.168.88.0/24'), negate: false },
          protocol: { value: 'tcp', negate: false },
          dstPort: { value: parsePortSet('22,80,443,8291') ?? [], negate: false },
          inInterface: { value: h.iface('ether2'), negate: false },
        },
        action: { kind: 'drop' },
        log: true,
        logPrefix: 'GUEST-BLOCK',
        disabled: false,
        comment: 'block guest network from reaching the management subnet',
      }))
      .build();
    const exported = exportOf(n, { scope: 'ip/firewall/filter' });
    expect(exported).toBe(
      text(
        '/ip firewall filter',
        'add action=drop chain=forward \\',
        '    comment="block guest network from reaching the management subnet" \\',
        '    dst-address=192.168.88.0/24 dst-port=22,80,443,8291 in-interface=ether2 \\',
        '    log=yes log-prefix=GUEST-BLOCK protocol=tcp src-address=192.168.50.0/24',
      ),
    );
    for (const line of exported.split('\n')) expect(line.length).toBeLessThanOrEqual(79);
  });
});
