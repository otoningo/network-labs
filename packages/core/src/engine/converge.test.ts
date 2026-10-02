import { describe, expect, it } from 'vitest';
import type { Network } from '../model/network';
import { formatIpv4, formatPrefix, ipv4 } from '../net/ipv4';
import { deviceIn, ifaceIn, net } from '../testing/builder';
import { deepFreeze } from '../testing/freeze';
import { converge } from './converge';
import { lookupRoute } from './routing';

const oper = (n: Network, id: string) => deviceIn(n, id).oper;
const running = (n: Network, id: string, iface: string) =>
  oper(n, id).interfaces.find((i) => i.iface === ifaceIn(n, id, iface))?.running;
const arpIps = (n: Network, id: string) =>
  oper(n, id)
    .arp.map((a) => formatIpv4(a.ip))
    .sort();
const activeRoutes = (n: Network, id: string) =>
  oper(n, id)
    .rib.filter((r) => r.active)
    .map(
      (r) =>
        `${formatPrefix(r.dst)} ${r.origin}${r.gateway === undefined ? '' : ` via ${formatIpv4(r.gateway)}`}`,
    );
const leaseOf = (n: Network, id: string) => {
  const status = oper(n, id).dhcpClients[0];
  return status?.address ? formatPrefix(status.address) : status?.status;
};

describe('estado de enlaces', () => {
  it('levanta solo los puertos cableados y habilitados en ambos extremos', () => {
    const n = net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .router('R2')
      .link('R1:ether1', 'PC1:eth0')
      .link('R1:ether2', 'PC2:eth0', false)
      .link('R1:ether3', 'R2:ether1')
      .enable('R2', 'ether1', true)
      .build();
    expect(running(n, 'R1', 'ether1')).toBe(true);
    expect(running(n, 'PC1', 'eth0')).toBe(true);
    expect(running(n, 'R1', 'ether2')).toBe(false);
    expect(running(n, 'R1', 'ether3')).toBe(false);
    expect(running(n, 'R1', 'ether4')).toBe(false);
  });

  it('las VLAN dependen de su interfaz padre y los bridges siempre están arriba', () => {
    const n = net()
      .router('R1')
      .host('PC1')
      .link('R1:ether1', 'PC1:eth0')
      .vlan('R1', 'vlan10', 'ether1', 10)
      .vlan('R1', 'vlan20', 'ether2', 20)
      .bridge('R1', 'loopback0', [])
      .build();
    expect(running(n, 'R1', 'vlan10')).toBe(true);
    expect(running(n, 'R1', 'vlan20')).toBe(false);
    expect(running(n, 'R1', 'loopback0')).toBe(true);
  });
});

describe('tabla de rutas', () => {
  const base = () =>
    net()
      .router('R1')
      .router('ISP')
      .link('R1:ether1', 'ISP:ether1')
      .address('R1', 'ether1', '203.0.113.2/30')
      .address('ISP', 'ether1', '203.0.113.1/30')
      .address('R1', 'ether5', '10.99.0.1/24');

  it('instala conectadas activas solo en interfaces operativas', () => {
    const n = base().build();
    const rib = oper(n, 'R1').rib;
    expect(rib.find((r) => formatPrefix(r.dst) === '203.0.113.0/30')).toMatchObject({
      active: true,
      distance: 0,
    });
    expect(rib.find((r) => formatPrefix(r.dst) === '10.99.0.0/24')).toMatchObject({
      active: false,
      reachable: false,
    });
  });

  it('resuelve el gateway contra conectadas y elige por distancia', () => {
    const n = base()
      .route('R1', '0.0.0.0/0', '198.51.100.1', 1)
      .route('R1', '0.0.0.0/0', '203.0.113.1', 5)
      .route('R1', '172.16.0.0/12', 'blackhole')
      .route('R1', '192.0.2.0/24', 'ether1')
      .op('R1', () => ({
        op: 'add',
        coll: 'routes',
        item: {
          dst: { ip: ipv4('198.18.0.0'), len: 15 },
          gateway: { kind: 'ip', ip: ipv4('203.0.113.1') },
          distance: 1,
          table: 'main',
          disabled: true,
        },
      }))
      .build();
    const rib = oper(n, 'R1').rib;
    const defaults = rib.filter((r) => r.dst.len === 0);
    expect(defaults.map((r) => [r.reachable, r.active])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(activeRoutes(n, 'R1')).toEqual(
      expect.arrayContaining([
        '0.0.0.0/0 static via 203.0.113.1',
        '172.16.0.0/12 static',
        '192.0.2.0/24 static',
      ]),
    );
    expect(rib.some((r) => formatPrefix(r.dst) === '198.18.0.0/15')).toBe(false);
    expect(lookupRoute(rib, ipv4('172.20.1.1'))?.blackhole).toBe(true);
    expect(lookupRoute(rib, ipv4('203.0.113.1'))?.origin).toBe('connected');
    expect(lookupRoute(rib, ipv4('8.8.8.8'))?.gateway).toBe(ipv4('203.0.113.1'));
  });
});

describe('bridge sin filtrado de VLAN', () => {
  const lan = () =>
    net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .bridge('R1', 'bridge1', ['ether2', 'ether3'])
      .address('R1', 'bridge1', '192.168.88.1/24')
      .address('PC1', 'eth0', '192.168.88.10/24')
      .address('PC2', 'eth0', '192.168.88.11/24');

  it('une los puertos en un mismo dominio de difusión', () => {
    const n = lan().build();
    expect(arpIps(n, 'R1')).toEqual(['192.168.88.10', '192.168.88.11']);
    expect(arpIps(n, 'PC1')).toEqual(['192.168.88.1', '192.168.88.11']);
    const hosts = oper(n, 'R1').bridgeHosts.filter((h) => !h.local);
    const pc1Mac = deviceIn(n, 'PC1').config.interfaces[0]?.mac;
    expect(hosts.find((h) => h.mac === pc1Mac)?.port).toBe(ifaceIn(n, 'R1', 'ether2'));
    expect(oper(n, 'R1').bridgeHosts.filter((h) => h.local)).toHaveLength(2);
  });

  it('marca como inválida una IP puesta en un puerto esclavo', () => {
    const n = lan().address('R1', 'ether2', '10.0.0.1/24').build();
    expect(oper(n, 'R1').invalid).toEqual([
      expect.objectContaining({ coll: 'addresses', reason: 'slave-port' }),
    ]);
    expect(activeRoutes(n, 'R1').some((r) => r.startsWith('10.0.0.0/24'))).toBe(false);
  });

  it('transporta tramas etiquetadas de forma transparente', () => {
    const n = net()
      .router('R1')
      .router('SW')
      .router('R2')
      .link('R1:ether1', 'SW:ether1')
      .link('SW:ether2', 'R2:ether1')
      .bridge('SW', 'bridge1', ['ether1', 'ether2'])
      .vlan('R1', 'vlan10', 'ether1', 10)
      .vlan('R2', 'vlan10', 'ether1', 10)
      .address('R1', 'vlan10', '10.10.0.1/24')
      .address('R2', 'vlan10', '10.10.0.2/24')
      .address('R2', 'ether1', '10.10.0.3/24')
      .build();
    expect(arpIps(n, 'R1')).toEqual(['10.10.0.2']);
  });
});

describe('bridge con filtrado de VLAN', () => {
  const routerOnAStick = (bridgeTagged: boolean) =>
    net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .bridge('R1', 'bridge1', [], { vlanFiltering: true })
      .bridgePort('R1', 'bridge1', 'ether2', { pvid: 10 })
      .bridgePort('R1', 'bridge1', 'ether3', { pvid: 20 })
      .bridgeVlan('R1', 'bridge1', [10, 20], bridgeTagged ? ['bridge1'] : [])
      .vlan('R1', 'vlan10', 'bridge1', 10)
      .vlan('R1', 'vlan20', 'bridge1', 20)
      .address('R1', 'vlan10', '10.0.10.1/24')
      .address('R1', 'vlan20', '10.0.20.1/24')
      .address('PC1', 'eth0', '10.0.10.5/24')
      .address('PC2', 'eth0', '10.0.20.5/24');

  it('aísla las VLAN y deja a la CPU en ambas', () => {
    const n = routerOnAStick(true).build();
    expect(arpIps(n, 'R1')).toEqual(['10.0.10.5', '10.0.20.5']);
    expect(arpIps(n, 'PC1')).toEqual(['10.0.10.1']);
    const flood = oper(n, 'R1').vlanMembership;
    expect(flood.find((m) => m.vlanId === 10)).toMatchObject({
      tagged: [ifaceIn(n, 'R1', 'bridge1')],
      untagged: [ifaceIn(n, 'R1', 'ether2')],
      dynamic: false,
    });
    expect(flood.find((m) => m.vlanId === 1)).toMatchObject({
      dynamic: true,
      untagged: [ifaceIn(n, 'R1', 'bridge1')],
    });
    const pc1Mac = deviceIn(n, 'PC1').config.interfaces[0]?.mac;
    expect(oper(n, 'R1').bridgeHosts.find((h) => h.mac === pc1Mac)?.vlanId).toBe(10);
  });

  it('sin el bridge como miembro etiquetado la CPU no ve las VLAN', () => {
    const n = routerOnAStick(false).build();
    expect(arpIps(n, 'R1')).toEqual([]);
  });

  it('lleva VLANs por un troncal hasta otro switch', () => {
    const n = net()
      .router('R1')
      .router('SW')
      .host('PC1')
      .link('R1:ether1', 'SW:ether1')
      .link('SW:ether2', 'PC1:eth0')
      .vlan('R1', 'vlan10', 'ether1', 10)
      .address('R1', 'vlan10', '10.0.10.1/24')
      .bridge('SW', 'bridge1', [], { vlanFiltering: true })
      .bridgePort('SW', 'bridge1', 'ether1', { frameTypes: 'tagged-only' })
      .bridgePort('SW', 'bridge1', 'ether2', { pvid: 10, frameTypes: 'untagged-only' })
      .bridgeVlan('SW', 'bridge1', [10], ['ether1'])
      .address('PC1', 'eth0', '10.0.10.5/24')
      .build();
    expect(arpIps(n, 'R1')).toEqual(['10.0.10.5']);
    expect(arpIps(n, 'PC1')).toEqual(['10.0.10.1']);
  });

  it('el filtrado de ingreso descarta VLANs no permitidas', () => {
    const n = net()
      .router('R1')
      .router('SW')
      .host('PC1')
      .link('R1:ether1', 'SW:ether1')
      .link('SW:ether2', 'PC1:eth0')
      .vlan('R1', 'vlan30', 'ether1', 30)
      .address('R1', 'vlan30', '10.0.30.1/24')
      .bridge('SW', 'bridge1', [], { vlanFiltering: true })
      .bridgePort('SW', 'bridge1', 'ether1')
      .bridgePort('SW', 'bridge1', 'ether2', { pvid: 30 })
      .address('PC1', 'eth0', '10.0.30.5/24')
      .build();
    expect(arpIps(n, 'R1')).toEqual([]);
  });

  it('con un pvid mal puesto el alcance deja de ser mutuo', () => {
    const n = net()
      .router('SW')
      .host('PC1')
      .host('PC2')
      .link('SW:ether2', 'PC1:eth0')
      .link('SW:ether3', 'PC2:eth0')
      .bridge('SW', 'bridge1', [], { vlanFiltering: true })
      .bridgePort('SW', 'bridge1', 'ether2', { pvid: 10, ingressFiltering: false })
      .bridgePort('SW', 'bridge1', 'ether3', { pvid: 20, ingressFiltering: false })
      .bridgeVlan('SW', 'bridge1', [10], [], ['ether3'])
      .address('PC1', 'eth0', '10.0.0.1/24')
      .address('PC2', 'eth0', '10.0.0.2/24')
      .build();
    expect(arpIps(n, 'PC1')).toEqual([]);
  });
});

describe('DHCP', () => {
  const office = (allocation: 'lowest' | 'highest' = 'lowest') =>
    net()
      .router('R1', 'sim-r5w', {
        os: 'routeros',
        traits: { forwards: true, poolAllocation: allocation },
        defaultMtu: 1500,
        interfaceName: (p) => (p.kind === 'ethernet' ? `ether${p.index}` : `wlan${p.index}`),
        defaultIdentity: (id) => id,
      })
      .host('PC1')
      .host('PC2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .bridge('R1', 'bridge1', ['ether2', 'ether3'])
      .address('R1', 'bridge1', '192.168.88.1/24')
      .dhcpServer('R1', {
        iface: 'bridge1',
        pool: '192.168.88.10-192.168.88.254',
        network: '192.168.88.0/24',
        gateway: '192.168.88.1',
        dns: ['192.168.88.1'],
      })
      .dhcpClient('PC1', 'eth0')
      .dhcpClient('PC2', 'eth0');

  it('reparte direcciones en orden y entrega gateway y DNS', () => {
    const n = office().build();
    expect(leaseOf(n, 'PC1')).toBe('192.168.88.10/24');
    expect(leaseOf(n, 'PC2')).toBe('192.168.88.11/24');
    expect(activeRoutes(n, 'PC1')).toEqual([
      '192.168.88.0/24 connected',
      '0.0.0.0/0 dhcp via 192.168.88.1',
    ]);
    expect(oper(n, 'PC1').dynamicDnsServers.map(formatIpv4)).toEqual(['192.168.88.1']);
    expect(oper(n, 'R1').dhcpLeases.map((l) => l.hostName)).toEqual(['PC1', 'PC2']);
    expect(arpIps(n, 'R1')).toEqual(['192.168.88.10', '192.168.88.11']);
    expect(oper(n, 'R1').log.filter((l) => l.event.kind === 'dhcp-assigned')).toHaveLength(2);
  });

  it('respeta el orden de asignación de la plataforma', () => {
    const n = office('highest').build();
    expect(leaseOf(n, 'PC1')).toBe('192.168.88.254/24');
    expect(leaseOf(n, 'PC2')).toBe('192.168.88.253/24');
  });

  it('mantiene los leases entre convergencias aunque cambie el orden', () => {
    const first = office().build();
    const reordered: Network = { ...first, devices: [...first.devices].reverse() };
    const second = converge(reordered);
    expect(leaseOf(second, 'PC1')).toBe('192.168.88.10/24');
    expect(leaseOf(second, 'PC2')).toBe('192.168.88.11/24');
    expect(oper(second, 'R1').log.filter((l) => l.event.kind === 'dhcp-assigned')).toHaveLength(2);
  });

  it('salta IPs estáticas, honra leases estáticos y se queda sin direcciones', () => {
    const builder = office();
    const pc2Mac = builder.raw().devices.find((d) => d.id === 'PC2')?.config.interfaces[0]?.mac;
    if (!pc2Mac) throw new Error('sin MAC');
    const n = builder
      .host('PC3')
      .address('PC3', 'eth0', '192.168.88.10/24')
      .add('R1', 'staticLeases', () => ({
        server: 'all',
        mac: pc2Mac,
        ip: ipv4('192.168.88.50'),
        disabled: false,
      }))
      .build();
    expect(leaseOf(n, 'PC1')).toBe('192.168.88.11/24');
    expect(leaseOf(n, 'PC2')).toBe('192.168.88.50/24');
    expect(oper(n, 'R1').dhcpLeases.find((l) => !l.dynamic)?.hostName).toBe('PC2');

    const tiny = net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .bridge('R1', 'bridge1', ['ether2', 'ether3'])
      .address('R1', 'bridge1', '10.0.0.1/24')
      .dhcpServer('R1', { iface: 'bridge1', pool: '10.0.0.100', network: '10.0.0.0/24' })
      .dhcpClient('PC1', 'eth0')
      .dhcpClient('PC2', 'eth0')
      .build();
    expect(leaseOf(tiny, 'PC1')).toBe('10.0.0.100/24');
    expect(leaseOf(tiny, 'PC2')).toBe('searching');
  });

  it('no sirve a clientes sin alcance ni en puertos esclavos', () => {
    const n = net()
      .router('R1')
      .host('PC1')
      .link('R1:ether2', 'PC1:eth0')
      .bridge('R1', 'bridge1', ['ether2'])
      .address('R1', 'bridge1', '10.0.0.1/24')
      .dhcpServer('R1', { iface: 'ether2', pool: '10.0.0.10-10.0.0.20', network: '10.0.0.0/24' })
      .dhcpClient('PC1', 'eth0')
      .build();
    expect(leaseOf(n, 'PC1')).toBe('searching');
    expect(oper(n, 'R1').invalid).toEqual([
      expect.objectContaining({ coll: 'dhcpServers', reason: 'slave-port' }),
    ]);
  });

  it('renueva el lease cuando vence', () => {
    const first = office().build();
    const expires = oper(first, 'R1').dhcpLeases[0]?.expiresAt ?? 0;
    const later = converge({ ...first, now: (expires + 5) as Network['now'] });
    expect(oper(later, 'R1').dhcpLeases[0]?.expiresAt).toBe(expires + 5 + 600);
    expect(oper(later, 'R1').dhcpLeases[0]?.boundAt).toBe(0);
  });

  it('el DHCP de un router como cliente instala ruta y DNS', () => {
    const n = net()
      .router('R1')
      .cloud('ISP')
      .link('R1:ether1', 'ISP:eth0')
      .address('ISP', 'eth0', '203.0.113.1/24')
      .dhcpServer('ISP', {
        iface: 'eth0',
        pool: '203.0.113.10-203.0.113.20',
        network: '203.0.113.0/24',
        gateway: '203.0.113.1',
        dns: ['1.1.1.1'],
      })
      .dhcpClient('R1', 'ether1', { distance: 7 })
      .build();
    expect(oper(n, 'R1').dynamicAddresses.map((a) => formatPrefix(a.address))).toEqual([
      '203.0.113.10/24',
    ]);
    expect(oper(n, 'R1').rib.find((r) => r.origin === 'dhcp')).toMatchObject({
      distance: 7,
      active: true,
    });
  });
});

describe('vecinos', () => {
  it('se descubren cuando ambos hablan un protocolo común', () => {
    const n = net()
      .router('R1')
      .router('R2')
      .router('R3')
      .link('R1:ether1', 'R2:ether1')
      .link('R1:ether2', 'R3:ether1')
      .address('R2', 'ether1', '10.0.0.2/30')
      .op('R1', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['mndp', 'lldp'], interfaceList: 'all' },
      }))
      .op('R2', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['lldp'], interfaceList: 'all' },
      }))
      .op('R2', () => ({ op: 'setSingleton', key: 'system', patch: { identity: 'Sucursal' } }))
      .build();
    expect(oper(n, 'R1').neighbors).toEqual([
      expect.objectContaining({
        peer: 'R2',
        identity: 'Sucursal',
        peerIface: 'ether1',
        protocol: 'lldp',
        address: ipv4('10.0.0.2'),
      }),
    ]);
    expect(oper(n, 'R2').neighbors).toHaveLength(1);
    expect(oper(n, 'R3').neighbors).toHaveLength(0);
  });

  it('respeta la lista de interfaces de descubrimiento', () => {
    const n = net()
      .router('R1')
      .router('R2')
      .link('R1:ether1', 'R2:ether1')
      .interfaceList('R1', 'LAN', ['ether2'])
      .op('R1', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['lldp'], interfaceList: 'LAN' },
      }))
      .op('R2', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['lldp'], interfaceList: 'all' },
      }))
      .build();
    expect(oper(n, 'R1').neighbors).toHaveLength(0);
  });
});

describe('wifi', () => {
  const wlan = (pass: string | undefined, clientPass: string | undefined) =>
    net()
      .router('R1')
      .host('LAP', 'sim-host-w')
      .wifi('R1', 'wlan1', 'ap', 'Oficina', pass)
      .wifi('LAP', 'wlan0', 'station', 'Oficina', clientPass);

  it('asocia estaciones con SSID y clave correctos', () => {
    const n = wlan('clave-segura', 'clave-segura').build();
    expect(running(n, 'LAP', 'wlan0')).toBe(true);
    expect(oper(n, 'R1').wifiRegistrations).toEqual([
      expect.objectContaining({
        iface: ifaceIn(n, 'R1', 'wlan1'),
        client: { device: 'LAP', iface: ifaceIn(n, 'LAP', 'wlan0') },
      }),
    ]);
    const signal = oper(n, 'R1').wifiRegistrations[0]?.signalDbm ?? 0;
    expect(signal).toBeLessThan(-41);
    expect(oper(n, 'LAP').interfaces[0]?.wifiAp?.device).toBe('R1');
  });

  it('rechaza claves incorrectas y acepta redes abiertas', () => {
    expect(running(wlan('clave-segura', 'otra-clave').build(), 'LAP', 'wlan0')).toBe(false);
    expect(running(wlan(undefined, undefined).build(), 'LAP', 'wlan0')).toBe(true);
    expect(running(wlan(undefined, 'clave-segura').build(), 'LAP', 'wlan0')).toBe(false);
  });

  it('el wifi puenteado con la LAN recibe DHCP', () => {
    const n = wlan('clave-segura', 'clave-segura')
      .bridge('R1', 'bridge1', ['ether2', 'wlan1'])
      .address('R1', 'bridge1', '192.168.88.1/24')
      .dhcpServer('R1', {
        iface: 'bridge1',
        pool: '192.168.88.10-192.168.88.20',
        network: '192.168.88.0/24',
        gateway: '192.168.88.1',
      })
      .dhcpClient('LAP', 'wlan0')
      .build();
    expect(leaseOf(n, 'LAP')).toBe('192.168.88.10/24');
  });
});

describe('propiedades de converge', () => {
  const office = () =>
    net()
      .router('R1')
      .host('PC1')
      .host('LAP', 'sim-host-w')
      .router('R2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether1', 'R2:ether1')
      .bridge('R1', 'bridge1', ['ether2', 'wlan1'])
      .wifi('R1', 'wlan1', 'ap', 'Oficina', 'clave-segura')
      .wifi('LAP', 'wlan0', 'station', 'Oficina', 'clave-segura')
      .address('R1', 'bridge1', '192.168.88.1/24')
      .address('R1', 'ether1', '10.0.0.1/30')
      .address('R2', 'ether1', '10.0.0.2/30')
      .dhcpServer('R1', {
        iface: 'bridge1',
        pool: '192.168.88.10-192.168.88.20',
        network: '192.168.88.0/24',
        gateway: '192.168.88.1',
      })
      .dhcpClient('PC1', 'eth0')
      .dhcpClient('LAP', 'wlan0')
      .op('R1', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['lldp'], interfaceList: 'all' },
      }))
      .op('R2', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['lldp'], interfaceList: 'all' },
      }));

  it('es idempotente y no muta su entrada', () => {
    const raw = deepFreeze(office().raw());
    const once = converge(raw);
    expect(converge(once)).toEqual(once);
  });

  it('conserva los contadores de ejecución', () => {
    const n = office().build();
    const r1 = deviceIn(n, 'R1');
    const withCounters: Network = {
      ...n,
      devices: n.devices.map((d) =>
        d.id === 'R1'
          ? {
              ...r1,
              oper: {
                ...r1.oper,
                interfaces: r1.oper.interfaces.map((i) => ({
                  ...i,
                  rx: { packets: 3, bytes: 900 },
                })),
              },
            }
          : d,
      ),
    };
    expect(oper(converge(withCounters), 'R1').interfaces[0]?.rx).toEqual({
      packets: 3,
      bytes: 900,
    });
  });

  it('marca referencias colgantes como inválidas', () => {
    const n = net()
      .router('R1')
      .bridge('R1', 'bridge1', ['ether2'])
      .op('R1', (h) => ({ op: 'remove', coll: 'interfaces', id: h.iface('bridge1') }), {
        danglingRefs: 'orphan',
      })
      .build();
    expect(oper(n, 'R1').invalid).toEqual([
      expect.objectContaining({ coll: 'bridgePorts', reason: 'dangling-ref' }),
    ]);
  });
});
