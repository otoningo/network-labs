import { describe, expect, it } from 'vitest';
import type { Network } from '../model/network';
import { formatIpv4, ipv4, prefix, range } from '../net/ipv4';
import { deviceIn, ifaceIn, net } from '../testing/builder';
import { sourceAddressFor, trace } from './trace';

/**
 * Oficina típica: ISP (emulación de Internet) ── ether1 R1 bridge1(ether2, ether3) ── PC1, PC2.
 * Sin NAT ni firewall: cada prueba añade lo que necesita.
 */
const office = () =>
  net()
    .cloud('ISP')
    .router('R1')
    .host('PC1')
    .host('PC2')
    .link('ISP:eth0', 'R1:ether1')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('R1', 'ether1', '203.0.113.2/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
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

const icmp = (n: Network, from: string, to: string) =>
  trace(n, { from: from as never, dst: ipv4(to), protocol: 'icmp' });
const tcp = (n: Network, from: string, to: string, port: number) =>
  trace(n, { from: from as never, dst: ipv4(to), protocol: 'tcp', dstPort: port });

describe('conectividad básica', () => {
  it('un host alcanza su gateway y a su vecino', () => {
    const n = office().build();
    const toGw = icmp(n, 'PC1', '192.168.88.1');
    expect(toGw.ok).toBe(true);
    expect(toGw.forward.hops.map((h) => h.device)).toEqual(['PC1', 'R1']);
    expect(toGw.forward.hops[1]?.filters[0]?.chain).toBe('input');
    expect(icmp(n, 'PC1', '192.168.88.11').ok).toBe(true);
  });

  it('sin NAT el paquete llega a Internet pero la respuesta no vuelve', () => {
    const result = icmp(office().build(), 'PC1', '8.8.8.8');
    expect(result.forward.end).toEqual({ kind: 'delivered', device: 'ISP', emulated: true });
    expect(result.reply?.end).toEqual({ kind: 'no-route', device: 'ISP' });
    expect(result.ok).toBe(false);
  });

  it('con masquerade la conexión se establece y la vuelta se des-traduce', () => {
    const n = office().masquerade('R1', 'ether1').build();
    const result = icmp(n, 'PC1', '8.8.8.8');
    expect(result.ok).toBe(true);
    expect(result.delivered && formatIpv4(result.delivered.src)).toBe('203.0.113.2');
    const back = result.reply?.hops.find((h) => h.device === 'R1');
    expect(back?.nat[0]).toMatchObject({ chain: 'srcnat', reverse: true });
    expect(back?.sent && formatIpv4(back.sent.dst)).toBe('192.168.88.10');
  });

  it('informa la causa cuando falla', () => {
    const noDefault = office().masquerade('R1', 'ether1').build();
    const withoutRoute: Network = {
      ...noDefault,
      devices: noDefault.devices.map((d) =>
        d.id === 'R1'
          ? { ...d, oper: { ...d.oper, rib: d.oper.rib.filter((r) => r.dst.len !== 0) } }
          : d,
      ),
    };
    expect(icmp(withoutRoute, 'PC1', '8.8.8.8').forward.end).toEqual({
      kind: 'no-route',
      device: 'R1',
    });

    const n = office()
      .route('R1', '172.16.0.0/12', 'blackhole')
      .route('R1', '10.50.0.0/16', '192.168.88.99')
      .route('R1', '10.9.0.0/16', '192.168.88.10')
      .build();
    expect(icmp(n, 'PC1', '172.16.5.5').forward.end).toEqual({ kind: 'blackhole', device: 'R1' });
    expect(icmp(n, 'PC1', '10.50.0.1').forward.end).toMatchObject({
      kind: 'arp-failed',
      device: 'R1',
    });
    expect(icmp(n, 'PC2', '10.9.0.5').forward.end).toEqual({
      kind: 'not-forwarding',
      device: 'PC1',
    });
    expect(
      trace(n, { from: 'PC1' as never, dst: ipv4('8.8.8.8'), protocol: 'icmp', ttl: 1 }).forward
        .end,
    ).toEqual({
      kind: 'ttl-exceeded',
      device: 'R1',
    });
    expect(icmp(n, 'NADIE', '8.8.8.8').forward.end.kind).toBe('no-route');
  });

  it('un host sin dirección no tiene origen ni ruta', () => {
    const n = net().host('PC1').host('PC9').build();
    expect(icmp(n, 'PC1', '8.8.8.8').forward.end).toEqual({ kind: 'no-route', device: 'PC1' });
    const local = net().router('R1').address('R1', 'ether1', '10.0.0.1/24').build();
    expect(icmp(local, 'R1', '10.0.0.1').ok).toBe(true);
  });

  it('elige la dirección de origen según la ruta', () => {
    const n = office().build();
    expect(formatIpv4(sourceAddressFor(n, 'R1' as never, ipv4('8.8.8.8')) ?? (0 as never))).toBe(
      '203.0.113.2',
    );
    expect(sourceAddressFor(n, 'NADIE' as never, ipv4('8.8.8.8'))).toBeUndefined();
  });
});

describe('servicios del router', () => {
  it('responde solo en puertos con servicio y desde orígenes permitidos', () => {
    const n = office().service('R1', 'ssh', 22, ['192.168.88.10/32']).build();
    expect(tcp(n, 'PC1', '192.168.88.1', 22).ok).toBe(true);
    expect(tcp(n, 'PC2', '192.168.88.1', 22).forward.end).toEqual({
      kind: 'port-closed',
      device: 'R1',
    });
    expect(tcp(n, 'PC1', '192.168.88.1', 23).forward.end.kind).toBe('port-closed');
  });

  it('el DNS del router atiende solo con peticiones remotas permitidas', () => {
    const udp53 = (n: Network) =>
      trace(n, { from: 'PC1' as never, dst: ipv4('192.168.88.1'), protocol: 'udp', dstPort: 53 });
    expect(udp53(office().build()).forward.end.kind).toBe('port-closed');
    expect(udp53(office().dns('R1', ['1.1.1.1'], true).build()).ok).toBe(true);
  });

  it('Internet emulado solo atiende sus puertos', () => {
    const n = office().masquerade('R1', 'ether1').build();
    expect(tcp(n, 'PC1', '93.184.216.34', 443).ok).toBe(true);
    expect(tcp(n, 'PC1', '93.184.216.34', 25).forward.end.kind).toBe('port-closed');
  });
});

describe('firewall', () => {
  it('filtra en forward con la regla que decidió', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        srcAddress: { value: prefix('192.168.88.11/32'), negate: false },
      }))
      .build();
    const pc2 = icmp(n, 'PC2', '8.8.8.8');
    const rule = deviceIn(n, 'R1').config.firewall.filter[0]?.id;
    expect(pc2.forward.end).toEqual({
      kind: 'filtered',
      device: 'R1',
      chain: 'forward',
      action: 'drop',
      rule,
    });
    expect(icmp(n, 'PC1', '8.8.8.8').ok).toBe(true);
  });

  it('protege el router y deja pasar respuestas establecidas', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .filter('R1', 'input', { kind: 'accept' }, () => ({
        connectionState: ['established', 'related'],
      }))
      .filter('R1', 'input', { kind: 'drop' }, (h) => ({
        inInterface: { value: h.iface('ether1'), negate: false },
      }))
      .build();
    expect(icmp(n, 'ISP', '203.0.113.2').forward.end).toMatchObject({
      kind: 'filtered',
      chain: 'input',
    });
    expect(icmp(n, 'R1', '8.8.8.8').ok).toBe(true);
    expect(icmp(n, 'PC1', '192.168.88.1').ok).toBe(true);
  });

  it('respeta listas, negaciones, saltos y reject', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .add('R1', 'interfaceLists', (h) => ({
        name: 'WAN',
        members: [h.iface('ether1')],
        include: [],
        disabled: false,
      }))
      .add('R1', 'addressLists', () => ({
        list: 'vip',
        address: range('192.168.88.10-192.168.88.10'),
        disabled: false,
      }))
      .filter('R1', 'forward', { kind: 'jump', target: 'salida' }, () => ({
        outInterfaceList: { value: 'WAN', negate: false },
      }))
      .filter('R1', 'salida', { kind: 'passthrough' }, () => ({}), { log: true })
      .filter('R1', 'salida', { kind: 'return' }, () => ({
        srcAddressList: { value: 'vip', negate: false },
      }))
      .filter('R1', 'salida', { kind: 'reject', with: 'icmp-admin-prohibited' }, () => ({
        dstAddress: { value: prefix('1.1.1.1/32'), negate: true },
      }))
      .build();
    expect(icmp(n, 'PC1', '9.9.9.9').ok).toBe(true);
    expect(icmp(n, 'PC2', '1.1.1.1').ok).toBe(true);
    const rejected = icmp(n, 'PC2', '9.9.9.9');
    expect(rejected.forward.end).toMatchObject({ kind: 'filtered', action: 'reject' });
    const verdict = rejected.forward.hops.find((h) => h.device === 'R1')?.filters[0];
    expect(verdict?.logged).toHaveLength(1);
    expect(verdict?.matched).toHaveLength(3);
  });

  it('coincide por protocolo numérico y puertos', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        protocol: { value: 6, negate: false },
        dstPort: { value: [{ from: 80, to: 80 }], negate: false },
      }))
      .build();
    expect(tcp(n, 'PC1', '93.184.216.34', 80).ok).toBe(false);
    expect(tcp(n, 'PC1', '93.184.216.34', 443).ok).toBe(true);
  });
});

describe('NAT', () => {
  it('redirige un puerto público a un servidor interno', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .service('PC1', 'http', 80)
      .nat(
        'R1',
        'dstnat',
        { kind: 'dstNat', to: range('192.168.88.10'), toPorts: [{ from: 80, to: 80 }] },
        (h) => ({
          inInterface: { value: h.iface('ether1'), negate: false },
          protocol: { value: 'tcp', negate: false },
          dstPort: { value: [{ from: 8080, to: 8080 }], negate: false },
        }),
      )
      .build();
    const result = trace(n, {
      from: 'ISP' as never,
      src: ipv4('198.51.100.7'),
      dst: ipv4('203.0.113.2'),
      protocol: 'tcp',
      dstPort: 8080,
    });
    expect(result.ok).toBe(true);
    expect(result.forward.end).toMatchObject({ kind: 'delivered', device: 'PC1' });
    expect(result.delivered?.dstPort).toBe(80);
    const back = result.reply?.hops.find((h) => h.device === 'R1')?.sent;
    expect(back && formatIpv4(back.src)).toBe('203.0.113.2');
    expect(back?.srcPort).toBe(8080);
  });

  it('redirect lleva el tráfico al propio router', () => {
    const n = office()
      .masquerade('R1', 'ether1')
      .dns('R1', ['1.1.1.1'], true)
      .nat('R1', 'dstnat', { kind: 'redirect', toPorts: [{ from: 53, to: 53 }] }, () => ({
        protocol: { value: 'udp', negate: false },
        dstPort: { value: [{ from: 53, to: 53 }], negate: false },
      }))
      .build();
    const result = trace(n, {
      from: 'PC1' as never,
      dst: ipv4('8.8.8.8'),
      protocol: 'udp',
      dstPort: 53,
    });
    expect(result.ok).toBe(true);
    expect(result.forward.end).toMatchObject({ kind: 'delivered', device: 'R1' });
  });

  it('src-nat y netmap traducen como se configuran', () => {
    const fixed = office()
      .address('R1', 'ether1', '203.0.113.9/24')
      .nat('R1', 'srcnat', { kind: 'srcNat', to: range('203.0.113.9') })
      .build();
    expect(
      icmp(fixed, 'PC1', '8.8.8.8').delivered &&
        formatIpv4(icmp(fixed, 'PC1', '8.8.8.8').delivered?.src ?? (0 as never)),
    ).toBe('203.0.113.9');
    const mapped = office()
      .nat('R1', 'srcnat', { kind: 'netmap', to: prefix('203.0.113.0/24') })
      .build();
    const delivered = icmp(mapped, 'PC1', '8.8.8.8').delivered;
    expect(delivered && formatIpv4(delivered.src)).toBe('203.0.113.10');
  });

  it('una regla accept en srcnat evita la traducción', () => {
    const n = office().nat('R1', 'srcnat', { kind: 'accept' }).masquerade('R1', 'ether1').build();
    expect(icmp(n, 'PC1', '8.8.8.8').ok).toBe(false);
  });

  it('masquerade sin dirección en la salida no traduce', () => {
    const n = office().masquerade('R1', 'ether4').build();
    expect(icmp(n, 'PC1', '8.8.8.8').ok).toBe(false);
  });
});

describe('VLANs enrutadas', () => {
  it('enruta entre VLANs y registra el puerto físico del bridge', () => {
    const n = net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .bridge('R1', 'bridge1', [], { vlanFiltering: true })
      .bridgePort('R1', 'bridge1', 'ether2', { pvid: 10 })
      .bridgePort('R1', 'bridge1', 'ether3', { pvid: 20 })
      .bridgeVlan('R1', 'bridge1', [10, 20], ['bridge1'])
      .vlan('R1', 'vlan10', 'bridge1', 10)
      .vlan('R1', 'vlan20', 'bridge1', 20)
      .address('R1', 'vlan10', '10.0.10.1/24')
      .address('R1', 'vlan20', '10.0.20.1/24')
      .address('PC1', 'eth0', '10.0.10.5/24')
      .route('PC1', '0.0.0.0/0', '10.0.10.1')
      .address('PC2', 'eth0', '10.0.20.5/24')
      .route('PC2', '0.0.0.0/0', '10.0.20.1')
      .build();
    const result = icmp(n, 'PC1', '10.0.20.5');
    expect(result.ok).toBe(true);
    const hop = result.forward.hops.find((h) => h.device === 'R1');
    expect(hop?.inIface).toBe(ifaceIn(n, 'R1', 'vlan10'));
    expect(hop?.inPort).toBe(ifaceIn(n, 'R1', 'ether2'));
    expect(hop?.outPort).toBe(ifaceIn(n, 'R1', 'ether3'));
  });
});
