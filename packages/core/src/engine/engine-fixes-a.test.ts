/**
 * Comportamientos del motor añadidos con la batería de labs: comprobación de
 * gateway, aviso de pool agotado, DNS por defecto del servidor DHCP, listas de
 * direcciones temporales, estado NAT de la conexión, Torch tras el NAT y con
 * filtros, dst-nat solo de puerto y matchers sobre puertos esclavos.
 */
import { describe, expect, it } from 'vitest';
import type { PlatformSpec } from '../device/platform';
import { deviceId, type ItemId, simTime } from '../model/brand';
import type { Network } from '../model/network';
import { formatIpv4, ipv4, prefix, range } from '../net/ipv4';
import { applyOp, type Op } from '../ops/apply';
import { deviceIn, ifaceIn, net } from '../testing/builder';
import { TEST_ROUTER_PLATFORM } from '../testing/platforms';
import { converge } from './converge';
import { tick, torch } from './runtime';
import { trace } from './trace';

const R1 = deviceId('R1');
const ISP = deviceId('ISP');
const ATTACKER = ipv4('198.51.100.7');

/** Aplica una operación a un equipo y recalcula la red. */
function edit(n: Network, id: string, op: Op): Network {
  const device = deviceIn(n, id);
  const result = applyOp(device, op);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return converge({
    ...n,
    devices: n.devices.map((d) => (d.id === device.id ? result.value.device : d)),
  });
}

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
    .masquerade('R1', 'ether1')
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

const PC1_IP = '192.168.88.10';
const PC2_IP = '192.168.88.11';

// ── Comprobación de gateway ─────────────────────────────────────────────────

describe('check-gateway', () => {
  /** R1 y R2 unidos por dos enlaces; la ruta principal va por 10.0.12.2. */
  const routers = (opts: { r2Primary?: boolean; check?: 'ping' | 'arp' } = {}) => {
    const b = net()
      .router('R1')
      .router('R2')
      .link('R1:ether1', 'R2:ether1')
      .link('R1:ether3', 'R2:ether3')
      .address('R1', 'ether1', '10.0.12.1/30')
      .address('R1', 'ether3', '10.0.21.1/30')
      .address('R2', 'ether3', '10.0.21.2/30');
    if (opts.r2Primary ?? true) b.address('R2', 'ether1', '10.0.12.2/30');
    return b
      .add('R1', 'routes', () => ({
        dst: prefix('0.0.0.0/0'),
        gateway: { kind: 'ip', ip: ipv4('10.0.12.2') },
        distance: 1,
        table: 'main',
        disabled: false,
        ...(opts.check === undefined ? {} : { checkGateway: opts.check }),
      }))
      .route('R1', '0.0.0.0/0', '10.0.21.2', 2)
      .build();
  };
  const defaults = (n: Network) =>
    deviceIn(n, 'R1')
      .oper.rib.filter((r) => r.origin === 'static')
      .map((r) => [r.gateway === undefined ? '' : formatIpv4(r.gateway), r.reachable, r.active]);

  it('con el gateway vivo la ruta principal sigue activa', () => {
    expect(defaults(routers({ check: 'ping' }))).toEqual([
      ['10.0.12.2', true, true],
      ['10.0.21.2', true, false],
    ]);
  });

  it('si nadie tiene la IP del gateway la ruta cae y entra la de respaldo', () => {
    expect(defaults(routers({ r2Primary: false, check: 'ping' }))).toEqual([
      ['10.0.12.2', false, false],
      ['10.0.21.2', true, true],
    ]);
    // check-gateway=arp se comporta igual: lo que cuenta es que el vecino responda.
    expect(defaults(routers({ r2Primary: false, check: 'arp' }))[1]).toEqual([
      '10.0.21.2',
      true,
      true,
    ]);
  });

  it('sin comprobación basta con que el enlace esté arriba', () => {
    expect(defaults(routers({ r2Primary: false }))).toEqual([
      ['10.0.12.2', true, true],
      ['10.0.21.2', true, false],
    ]);
  });

  it('también vale para un gateway ip%interfaz', () => {
    const n = net()
      .router('R1')
      .router('R2')
      .link('R1:ether1', 'R2:ether1')
      .address('R1', 'ether1', '10.0.12.1/30')
      .add('R1', 'routes', (h) => ({
        dst: prefix('10.9.0.0/16'),
        gateway: { kind: 'ip-iface', ip: ipv4('10.0.12.2'), iface: h.iface('ether1') },
        distance: 1,
        table: 'main',
        disabled: false,
        checkGateway: 'ping',
      }))
      .build();
    expect(deviceIn(n, 'R1').oper.rib.find((r) => r.origin === 'static')?.active).toBe(false);
    const fixed = edit(n, 'R2', {
      op: 'add',
      coll: 'addresses',
      item: { iface: ifaceIn(n, 'R2', 'ether1'), address: prefix('10.0.12.2/30'), disabled: false },
    });
    expect(deviceIn(fixed, 'R1').oper.rib.find((r) => r.origin === 'static')?.active).toBe(true);
  });
});

// ── DHCP: pool agotado y DNS por defecto ────────────────────────────────────

describe('DHCP con el pool agotado', () => {
  const tiny = () =>
    net()
      .router('R1')
      .host('PC1')
      .host('PC2')
      .host('PC3')
      .link('R1:ether2', 'PC1:eth0')
      .link('R1:ether3', 'PC2:eth0')
      .link('R1:ether4', 'PC3:eth0')
      .bridge('R1', 'bridge1', ['ether2', 'ether3', 'ether4'])
      .address('R1', 'bridge1', '192.168.88.1/24')
      .dhcpServer('R1', {
        iface: 'bridge1',
        pool: '192.168.88.10-192.168.88.11',
        network: '192.168.88.0/24',
        name: 'dhcp1',
      })
      .dhcpClient('PC1', 'eth0')
      .dhcpClient('PC2', 'eth0')
      .dhcpClient('PC3', 'eth0')
      .build();
  const emptyEvents = (n: Network) =>
    deviceIn(n, 'R1').oper.log.filter((l) => l.event.kind === 'dhcp-pool-empty');

  it('el cliente sin dirección queda buscando y el servidor lo registra una sola vez', () => {
    const n = tiny();
    const r1 = deviceIn(n, 'R1');
    const status = deviceIn(n, 'PC3').oper.dhcpClients[0];
    expect(status?.status).toBe('searching');
    expect(status?.exhausted).toEqual({ device: R1, iface: ifaceIn(n, 'R1', 'bridge1') });
    expect(emptyEvents(n).map((l) => l.event)).toEqual([
      {
        kind: 'dhcp-pool-empty',
        server: r1.config.dhcpServer.servers[0]?.id,
        pool: r1.config.dhcpServer.pools[0]?.id,
      },
    ]);
    // Recalcular no repite el aviso.
    expect(emptyEvents(converge(converge(n)))).toHaveLength(1);
  });

  it('al ampliar el pool el cliente obtiene dirección; si se vuelve a agotar, avisa de nuevo', () => {
    const n = tiny();
    const pool = deviceIn(n, 'R1').config.dhcpServer.pools[0]?.id ?? (0 as ItemId);
    const wide = edit(n, 'R1', {
      op: 'set',
      coll: 'pools',
      id: pool,
      patch: { ranges: [range('192.168.88.10-192.168.88.20')] },
    });
    expect(deviceIn(wide, 'PC3').oper.dhcpClients[0]?.status).toBe('bound');
    expect(deviceIn(wide, 'PC3').oper.dhcpClients[0]?.exhausted).toBeUndefined();
    expect(emptyEvents(wide)).toHaveLength(1);
    const narrow = edit(wide, 'R1', {
      op: 'set',
      coll: 'pools',
      id: pool,
      patch: { ranges: [range('192.168.88.10-192.168.88.10')] },
    });
    // PC1 conserva su dirección; PC2 y PC3 se quedan fuera y cada uno deja su aviso.
    expect(emptyEvents(narrow)).toHaveLength(3);
  });

  it('un servidor solo de leases estáticos no avisa de pool vacío', () => {
    const n = tiny();
    const server = deviceIn(n, 'R1').config.dhcpServer.servers[0]?.id ?? (0 as ItemId);
    const fixed = edit(n, 'R1', {
      op: 'set',
      coll: 'dhcpServers',
      id: server,
      patch: { pool: 'static-only' },
    });
    expect(emptyEvents(fixed)).toHaveLength(1);
    expect(deviceIn(fixed, 'PC1').oper.dhcpClients[0]?.exhausted).toBeUndefined();
  });
});

describe('DNS que entrega el servidor DHCP', () => {
  const FALLBACK: PlatformSpec = {
    ...TEST_ROUTER_PLATFORM,
    traits: { ...TEST_ROUTER_PLATFORM.traits, dhcpDnsFallback: true },
  };
  /** ISP da 1.1.1.1 a R1 por DHCP; R1 reparte en la LAN con una red sin DNS. */
  const lan = (platform: PlatformSpec, network = true) => {
    const b = net()
      .cloud('ISP')
      .router('R1', 'sim-r5w', platform)
      .host('PC1')
      .link('ISP:eth0', 'R1:ether1')
      .link('R1:ether2', 'PC1:eth0')
      .address('ISP', 'eth0', '203.0.113.1/24')
      .dhcpServer('ISP', {
        iface: 'eth0',
        pool: '203.0.113.10-203.0.113.20',
        network: '203.0.113.0/24',
        gateway: '203.0.113.1',
        dns: ['1.1.1.1'],
      })
      .dhcpClient('R1', 'ether1')
      .dns('R1', ['9.9.9.9'])
      .address('R1', 'ether2', '192.168.88.1/24')
      .add('R1', 'pools', () => ({
        name: 'lan',
        ranges: [range('192.168.88.10-192.168.88.20')],
        disabled: false,
      }))
      .add('R1', 'dhcpServers', (h) => ({
        name: 'dhcp1',
        iface: h.iface('ether2'),
        pool: h.find('pools', (p) => p.name === 'lan'),
        leaseTimeS: 600,
        authoritative: true,
        disabled: false,
      }));
    if (network) {
      b.add('R1', 'dhcpNetworks', () => ({
        prefix: prefix('192.168.88.0/24'),
        gateway: ipv4('192.168.88.1'),
        dnsServers: [],
        disabled: false,
      }));
    }
    return b.dhcpClient('PC1', 'eth0').build();
  };
  const dnsOf = (n: Network) => deviceIn(n, 'PC1').oper.dhcpClients[0]?.dns.map(formatIpv4);

  it('con el rasgo, una red sin DNS entrega los del router (estáticos y dinámicos)', () => {
    const n = lan(FALLBACK);
    expect(dnsOf(n)).toEqual(['9.9.9.9', '1.1.1.1']);
    // Es estable: no depende de una convergencia anterior.
    expect(dnsOf(converge(n))).toEqual(['9.9.9.9', '1.1.1.1']);
  });

  it('sin el rasgo, o sin red DHCP, el cliente se queda sin DNS', () => {
    expect(dnsOf(lan(TEST_ROUTER_PLATFORM))).toEqual([]);
    expect(dnsOf(lan(FALLBACK, false))).toEqual([]);
  });

  it('si la red define DNS, se entregan esos', () => {
    const n = lan(FALLBACK);
    const id = deviceIn(n, 'R1').config.dhcpServer.networks[0]?.id ?? (0 as ItemId);
    const set = edit(n, 'R1', {
      op: 'set',
      coll: 'dhcpNetworks',
      id,
      patch: { dnsServers: [ipv4('192.168.88.1')] },
    });
    expect(dnsOf(set)).toEqual(['192.168.88.1']);
  });
});

// ── Listas de direcciones temporales ────────────────────────────────────────

describe('address-list con timeout', () => {
  const lists = () =>
    office()
      .add('R1', 'addressLists', () => ({
        list: 'castigo',
        address: prefix(`${PC2_IP}/32`),
        timeoutS: 60,
        createdAt: simTime(0),
        disabled: false,
      }))
      .add('R1', 'addressLists', () => ({
        list: 'fija',
        address: prefix(`${PC1_IP}/32`),
        createdAt: simTime(0),
        disabled: false,
      }))
      .add('R1', 'addressLists', () => ({
        list: 'sin-fecha',
        address: prefix('10.0.0.1/32'),
        timeoutS: 5,
        disabled: false,
      }))
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        srcAddressList: { value: 'castigo', negate: false },
      }))
      .build();
  const names = (n: Network) => deviceIn(n, 'R1').config.firewall.addressLists.map((e) => e.list);
  const pc2 = (n: Network) =>
    trace(n, { from: deviceId('PC2'), dst: ipv4('8.8.8.8'), protocol: 'icmp' });

  it('la entrada sigue mientras no vence el plazo y desaparece al vencer', () => {
    const n = lists();
    expect(pc2(n).ok).toBe(false);
    const before = tick(n, 59);
    expect(names(before)).toEqual(['castigo', 'fija', 'sin-fecha']);
    expect(pc2(before).ok).toBe(false);
    const after = tick(before, 1);
    // Sin fecha de creación no se sabe cuándo vence: se conserva.
    expect(names(after)).toEqual(['fija', 'sin-fecha']);
    expect(pc2(after).ok).toBe(true);
  });
});

// ── Estado NAT de la conexión ───────────────────────────────────────────────

describe('connection-nat-state', () => {
  /** La regla de defconf: en forward, lo nuevo desde la WAN solo pasa si es un port forward. */
  const defconf = () =>
    office()
      .route('ISP', '192.168.88.0/24', '203.0.113.2')
      .service('PC1', 'http', 80)
      .nat(
        'R1',
        'dstnat',
        { kind: 'dstNat', to: range(PC1_IP), toPorts: [{ from: 80, to: 80 }] },
        (h) => ({
          inInterface: { value: h.iface('ether1'), negate: false },
          protocol: { value: 'tcp', negate: false },
          dstPort: { value: [{ from: 8080, to: 8080 }], negate: false },
        }),
      )
      .filter(
        'R1',
        'forward',
        { kind: 'drop' },
        (h) => ({
          inInterface: { value: h.iface('ether1'), negate: false },
          connectionState: ['new'],
          connectionNatState: { value: ['dstnat'], negate: true },
        }),
        { comment: 'not-dstnat' },
      );
  const fromIsp = (n: Network, dst: string, port: number) =>
    trace(n, { from: ISP, src: ATTACKER, dst: ipv4(dst), protocol: 'tcp', dstPort: port });

  it('deja pasar el port forward y bloquea lo demás que llega de la WAN', () => {
    const n = defconf().build();
    const ruleId = deviceIn(n, 'R1').config.firewall.filter[0]?.id;
    expect(fromIsp(n, '203.0.113.2', 8080).ok).toBe(true);
    expect(fromIsp(n, PC1_IP, 80).forward.end).toEqual({
      kind: 'filtered',
      device: R1,
      chain: 'forward',
      action: 'drop',
      rule: ruleId,
    });
    // La LAN sigue saliendo y las respuestas vuelven.
    expect(trace(n, { from: deviceId('PC1'), dst: ipv4('8.8.8.8'), protocol: 'icmp' }).ok).toBe(
      true,
    );
  });

  it('en la vuelta la conexión conserva el srcnat de la ida', () => {
    const n = office()
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        connectionState: ['established'],
        connectionNatState: { value: ['srcnat'], negate: false },
      }))
      .build();
    const result = trace(n, { from: deviceId('PC1'), dst: ipv4('8.8.8.8'), protocol: 'icmp' });
    // La ida pasa (el srcnat se aplica después del filtro); la respuesta coincide y se descarta.
    expect(result.forward.end.kind).toBe('delivered');
    expect(result.reply?.end).toMatchObject({ kind: 'filtered', device: R1, chain: 'forward' });
  });
});

// ── dst-nat solo de puerto ──────────────────────────────────────────────────

describe('dst-nat sin to-addresses', () => {
  it('traduce el puerto y conserva la dirección de destino', () => {
    const n = office()
      .service('R1', 'ssh', 22)
      .nat('R1', 'dstnat', { kind: 'dstNat', toPorts: [{ from: 22, to: 22 }] }, (h) => ({
        inInterface: { value: h.iface('ether1'), negate: false },
        protocol: { value: 'tcp', negate: false },
        dstPort: { value: [{ from: 2222, to: 2222 }], negate: false },
      }))
      .build();
    const result = trace(n, {
      from: ISP,
      src: ATTACKER,
      dst: ipv4('203.0.113.2'),
      protocol: 'tcp',
      dstPort: 2222,
    });
    expect(result.ok).toBe(true);
    expect(result.forward.end).toMatchObject({ kind: 'delivered', device: R1 });
    expect(result.delivered && formatIpv4(result.delivered.dst)).toBe('203.0.113.2');
    expect(result.delivered?.dstPort).toBe(22);
    const back = result.reply?.hops.find((h) => h.device === R1)?.sent;
    expect(back?.srcPort).toBe(2222);
  });
});

// ── Torch ───────────────────────────────────────────────────────────────────

describe('Torch tras el NAT y con filtros', () => {
  const busy = () =>
    office()
      .flow({
        id: 'descarga',
        from: 'PC1',
        to: '93.184.216.34',
        protocol: 'tcp',
        dstPort: 443,
        bps: 200_000,
        replyBps: 5_000_000,
      })
      .flow({
        id: 'dns',
        from: 'PC2',
        to: '1.1.1.1',
        protocol: 'udp',
        dstPort: 53,
        bps: 2_000,
        replyBps: 4_000,
      });
  const flows = (entries: readonly { flow: string }[]) => entries.map((e) => e.flow);

  it('en la WAN se ve la IP pública; en la LAN, la del PC', () => {
    const n = busy().build();
    const wan = torch(n, R1, ifaceIn(n, 'R1', 'ether1'));
    expect(wan.map((e) => formatIpv4(e.src))).toEqual(['203.0.113.2', '203.0.113.2']);
    const lan = torch(n, R1, ifaceIn(n, 'R1', 'bridge1'));
    expect(lan.map((e) => formatIpv4(e.src))).toEqual([PC1_IP, PC2_IP]);
  });

  it('lo que descarta el firewall no sale por la interfaz', () => {
    const n = busy()
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        srcAddress: { value: prefix(`${PC1_IP}/32`), negate: false },
      }))
      .build();
    expect(torch(n, R1, ifaceIn(n, 'R1', 'ether1'))).toEqual([
      expect.objectContaining({ flow: 'dns', txBps: 2_000, rxBps: 4_000 }),
    ]);
    // En la LAN sí se recibe, aunque luego se descarte.
    expect(torch(n, R1, ifaceIn(n, 'R1', 'bridge1'))).toContainEqual(
      expect.objectContaining({ flow: 'descarga', txBps: 0, rxBps: 200_000 }),
    );
  });

  it('los clasificadores filtran por dirección, puerto y protocolo', () => {
    const n = busy().build();
    const lan = ifaceIn(n, 'R1', 'bridge1');
    expect(flows(torch(n, R1, lan, { srcAddress: prefix(`${PC1_IP}/32`) }))).toEqual(['descarga']);
    expect(flows(torch(n, R1, lan, { srcAddress: prefix('0.0.0.0/0') }))).toEqual([
      'descarga',
      'dns',
    ]);
    expect(flows(torch(n, R1, lan, { dstAddress: prefix('1.1.1.0/24') }))).toEqual(['dns']);
    expect(flows(torch(n, R1, lan, { port: 443 }))).toEqual(['descarga']);
    expect(flows(torch(n, R1, lan, { protocol: 'udp' }))).toEqual(['dns']);
    expect(flows(torch(n, R1, lan, { protocol: 'icmp' }))).toEqual([]);
  });
});

// ── Matchers sobre puertos esclavos ─────────────────────────────────────────

describe('reglas con un puerto esclavo del bridge', () => {
  it('filtro y NAT sobre un puerto del bridge quedan inválidos; sobre el bridge, no', () => {
    const n = office()
      .filter('R1', 'forward', { kind: 'drop' }, (h) => ({
        inInterface: { value: h.iface('ether2'), negate: false },
      }))
      .filter('R1', 'forward', { kind: 'drop' }, (h) => ({
        inInterface: { value: h.iface('bridge1'), negate: false },
      }))
      .nat('R1', 'srcnat', { kind: 'masquerade' }, (h) => ({
        outInterface: { value: h.iface('ether3'), negate: true },
      }))
      .build();
    const r1 = deviceIn(n, 'R1');
    const [slave, master] = r1.config.firewall.filter;
    const nat = r1.config.firewall.nat.at(-1);
    const invalid = r1.oper.invalid.filter((i) => i.reason === 'slave-port');
    expect(invalid).toEqual([
      { coll: 'filterRules', id: slave?.id, reason: 'slave-port' },
      { coll: 'natRules', id: nat?.id, reason: 'slave-port' },
    ]);
    expect(invalid.some((i) => i.id === master?.id)).toBe(false);
  });
});
