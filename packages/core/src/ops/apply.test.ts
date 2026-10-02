import { describe, expect, it } from 'vitest';
import { BOARDS } from '../device/boards';
import { createDevice } from '../device/factory';
import type { PlatformSpec } from '../device/platform';
import { deviceId, type ItemId, itemId } from '../model/brand';
import type { ItemPatch, NewItem } from '../model/collections';
import { emptyConfig } from '../model/config';
import type { CoreError } from '../model/errors';
import { interfaceByName } from '../model/lookup';
import type { Device, Hardware } from '../model/network';
import { ipv4, prefix, range } from '../net/ipv4';
import { mac } from '../net/mac';
import { deepFreeze } from '../testing/freeze';
import { TEST_ROUTER_PLATFORM } from '../testing/platforms';
import { type ApplyPolicy, applyOp, applyOps, findItem, type Op, referrersOf } from './apply';

function board(name: string): Hardware {
  const hw = BOARDS[name];
  if (!hw) throw new Error(`placa desconocida ${name}`);
  return hw;
}

function freshRouter(): Device {
  const result = createDevice(deviceId('R1'), board('sim-r5w'), TEST_ROUTER_PLATFORM);
  if (!result.ok) throw new Error('no se pudo crear R1');
  return deepFreeze(result.value);
}

function ifc(device: Device, name: string): ItemId {
  const found = interfaceByName(device.config, name);
  if (!found) throw new Error(`no existe ${name}`);
  return found.id;
}

/** Aplica y exige éxito; devuelve el dispositivo y el id creado. */
function must(device: Device, op: Op, policy?: ApplyPolicy): { device: Device; id: ItemId } {
  const result = applyOp(device, op, policy);
  if (!result.ok) throw new Error(`falló ${op.op}: ${JSON.stringify(result.error)}`);
  return { device: deepFreeze(result.value.device), id: result.value.created ?? itemId(-1) };
}

function fails(device: Device, op: Op, policy?: ApplyPolicy): CoreError {
  const result = applyOp(device, op, policy);
  if (result.ok) throw new Error(`se esperaba error en ${op.op}`);
  return result.error;
}

const bridgeItem = (
  name: string,
  extra: Partial<{ pvid: number }> = {},
): NewItem<'interfaces'> => ({
  kind: 'bridge',
  name,
  mtu: 1500,
  mac: mac('02:00:00:00:00:10'),
  disabled: false,
  vlanFiltering: false,
  stp: 'rstp',
  pvid: extra.pvid ?? 1,
});

const vlanItem = (name: string, parent: ItemId, vlanId: number): NewItem<'interfaces'> => ({
  kind: 'vlan',
  name,
  mtu: 1500,
  mac: mac('02:00:00:00:00:20'),
  disabled: false,
  vlanId,
  parent,
});

function withBridge(): { device: Device; bridge: ItemId } {
  const { device, id } = must(freshRouter(), {
    op: 'add',
    coll: 'interfaces',
    item: bridgeItem('bridge1'),
  });
  return { device, bridge: id };
}

describe('fábrica de dispositivos', () => {
  it('crea una interfaz por puerto con nombres de la plataforma y MAC determinista', () => {
    const r1 = freshRouter();
    expect(r1.config.interfaces.map((i) => i.name)).toEqual([
      'ether1',
      'ether2',
      'ether3',
      'ether4',
      'ether5',
      'wlan1',
    ]);
    expect(r1.nextId).toBe(7);
    const wlan = interfaceByName(r1.config, 'wlan1');
    expect(wlan?.disabled).toBe(true);
    expect(freshRouter().config.interfaces[0]?.mac).toBe(r1.config.interfaces[0]?.mac);
  });

  it('aplica la configuración de fábrica de la plataforma', () => {
    const platform: PlatformSpec = {
      ...TEST_ROUTER_PLATFORM,
      factoryDefaults: () => [
        {
          op: 'add',
          coll: 'users',
          item: { name: 'admin', group: 'full', hasPassword: false, disabled: false },
        },
      ],
    };
    const result = createDevice(deviceId('R9'), board('sim-r5'), platform);
    expect(result.ok && result.value.config.system.users.map((u) => u.name)).toEqual(['admin']);
  });

  it('informa si la configuración de fábrica es inválida', () => {
    const platform: PlatformSpec = {
      ...TEST_ROUTER_PLATFORM,
      factoryDefaults: () => [
        {
          op: 'add',
          coll: 'services',
          item: { name: 'ssh', port: 0, allowedFrom: [], disabled: false },
        },
      ],
    };
    const result = createDevice(deviceId('R9'), board('sim-r5'), platform);
    expect(result.ok).toBe(false);
  });
});

describe('add', () => {
  it('asigna ids consecutivos y no muta el original', () => {
    const r1 = freshRouter();
    const a = must(r1, { op: 'add', coll: 'interfaces', item: bridgeItem('bridge1') });
    const b = must(a.device, { op: 'add', coll: 'interfaces', item: bridgeItem('bridge2') });
    expect(a.id).toBe(7);
    expect(b.id).toBe(8);
    expect(b.device.nextId).toBe(9);
    expect(r1.config.interfaces).toHaveLength(6);
  });

  it('no permite crear interfaces físicas', () => {
    const r1 = freshRouter();
    const error = fails(r1, {
      op: 'add',
      coll: 'interfaces',
      item: {
        kind: 'ethernet',
        name: 'ether9',
        mtu: 1500,
        mac: mac('02:00:00:00:00:99'),
        disabled: false,
        port: 9,
      },
    });
    expect(error).toMatchObject({
      code: 'invalid-value',
      field: 'kind',
      expected: 'creatable-kind',
    });
  });

  it('exige nombres únicos, MTU en rango y MAC válida', () => {
    const r1 = freshRouter();
    expect(fails(r1, { op: 'add', coll: 'interfaces', item: bridgeItem('ether1') })).toMatchObject({
      code: 'duplicate',
      field: 'name',
    });
    expect(fails(r1, { op: 'add', coll: 'interfaces', item: bridgeItem(' ') })).toMatchObject({
      code: 'missing-required',
      field: 'name',
    });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'interfaces',
        item: { ...bridgeItem('b'), mtu: 10 } as NewItem<'interfaces'>,
      }),
    ).toMatchObject({ code: 'out-of-range', field: 'mtu', min: 64 });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'interfaces',
        item: { ...bridgeItem('b'), mac: 'zz' } as unknown as NewItem<'interfaces'>,
      }),
    ).toMatchObject({ code: 'invalid-value', expected: 'mac' });
  });

  it('valida las VLAN', () => {
    const r1 = freshRouter();
    const ether1 = ifc(r1, 'ether1');
    expect(
      fails(r1, { op: 'add', coll: 'interfaces', item: vlanItem('v0', ether1, 0) }),
    ).toMatchObject({
      code: 'out-of-range',
      field: 'vlanId',
      max: 4094,
    });
    expect(
      fails(r1, { op: 'add', coll: 'interfaces', item: vlanItem('v', itemId(99), 10) }),
    ).toMatchObject({
      code: 'not-found',
      scope: 'interfaces',
      field: 'parent',
    });
    expect(
      fails(r1, { op: 'add', coll: 'interfaces', item: vlanItem('v', itemId(r1.nextId), 10) }),
    ).toMatchObject({ code: 'conflict', detail: 'self-reference' });
    const ok10 = must(r1, { op: 'add', coll: 'interfaces', item: vlanItem('vlan10', ether1, 10) });
    expect(
      fails(ok10.device, { op: 'add', coll: 'interfaces', item: vlanItem('otra', ether1, 10) }),
    ).toMatchObject({ code: 'duplicate', field: 'vlanId' });
    expect(
      fails(r1, { op: 'add', coll: 'interfaces', item: bridgeItem('b', { pvid: 5000 }) }),
    ).toMatchObject({
      code: 'out-of-range',
      field: 'pvid',
    });
  });

  it('valida los puertos de bridge', () => {
    const { device, bridge } = withBridge();
    const ether2 = ifc(device, 'ether2');
    const port = (b: ItemId, i: ItemId): Op => ({
      op: 'add',
      coll: 'bridgePorts',
      item: {
        bridge: b,
        iface: i,
        pvid: 1,
        frameTypes: 'all',
        ingressFiltering: true,
        disabled: false,
      },
    });
    const withPort = must(device, port(bridge, ether2));
    expect(fails(withPort.device, port(bridge, ether2))).toMatchObject({
      code: 'duplicate',
      field: 'iface',
    });
    expect(fails(device, port(ether2, ifc(device, 'ether3')))).toMatchObject({
      code: 'invalid-value',
      expected: 'bridge-interface',
    });
    const second = must(device, { op: 'add', coll: 'interfaces', item: bridgeItem('bridge2') });
    expect(fails(second.device, port(bridge, second.id))).toMatchObject({
      expected: 'non-bridge-interface',
    });
    expect(fails(device, port(bridge, bridge))).toMatchObject({
      code: 'conflict',
      detail: 'self-reference',
    });
    expect(fails(device, port(bridge, itemId(77)))).toMatchObject({
      code: 'not-found',
      field: 'iface',
    });
    expect(
      fails(device, {
        op: 'add',
        coll: 'bridgePorts',
        item: {
          bridge,
          iface: ether2,
          pvid: 0,
          frameTypes: 'all',
          ingressFiltering: true,
          disabled: false,
        },
      }),
    ).toMatchObject({ code: 'out-of-range', field: 'pvid' });
  });

  it('valida la tabla de VLAN del bridge', () => {
    const { device, bridge } = withBridge();
    const ether2 = ifc(device, 'ether2');
    const entry = (vlanIds: number[], tagged: ItemId[], untagged: ItemId[], b = bridge): Op => ({
      op: 'add',
      coll: 'bridgeVlans',
      item: { bridge: b, vlanIds, tagged, untagged, disabled: false },
    });
    expect(fails(device, entry([], [], []))).toMatchObject({
      code: 'missing-required',
      field: 'vlanIds',
    });
    expect(fails(device, entry([4095], [], []))).toMatchObject({ code: 'out-of-range' });
    expect(fails(device, entry([10], [ether2], [ether2]))).toMatchObject({
      detail: 'tagged-and-untagged',
    });
    expect(fails(device, entry([10], [], [], ether2))).toMatchObject({
      expected: 'bridge-interface',
    });
    expect(applyOp(device, entry([10, 20], [bridge, ether2], [])).ok).toBe(true);
  });

  it('valida direcciones y ARP estático', () => {
    const r1 = freshRouter();
    const ether2 = ifc(r1, 'ether2');
    const addr = (iface: ItemId, text: string): Op => ({
      op: 'add',
      coll: 'addresses',
      item: { iface, address: prefix(text), disabled: false },
    });
    const first = must(r1, addr(ether2, '192.168.88.1/24'));
    expect(fails(first.device, addr(ether2, '192.168.88.1/24'))).toMatchObject({
      code: 'duplicate',
      field: 'address',
    });
    expect(applyOp(first.device, addr(ifc(r1, 'ether3'), '192.168.88.1/24')).ok).toBe(true);
    expect(applyOp(first.device, addr(ether2, '192.168.88.1/25')).ok).toBe(true);
    expect(fails(r1, addr(itemId(42), '10.0.0.1/24'))).toMatchObject({
      code: 'not-found',
      scope: 'interfaces',
    });

    const arp = (m: string): Op => ({
      op: 'add',
      coll: 'staticArp',
      item: {
        iface: ether2,
        ip: ipv4('192.168.88.5'),
        mac: m as ReturnType<typeof mac>,
        disabled: false,
      },
    });
    expect(fails(r1, arp('nope'))).toMatchObject({ expected: 'mac' });
    const withArp = must(r1, arp('02:00:00:00:00:05'));
    expect(fails(withArp.device, arp('02:00:00:00:00:06'))).toMatchObject({
      code: 'duplicate',
      field: 'ip',
    });
  });

  it('valida clientes DHCP y rutas', () => {
    const r1 = freshRouter();
    const ether1 = ifc(r1, 'ether1');
    const client: Op = {
      op: 'add',
      coll: 'dhcpClients',
      item: {
        iface: ether1,
        addDefaultRoute: true,
        routeDistance: 1,
        usePeerDns: true,
        disabled: false,
      },
    };
    const withClient = must(r1, client);
    expect(fails(withClient.device, client)).toMatchObject({ code: 'duplicate', field: 'iface' });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'dhcpClients',
        item: {
          iface: ether1,
          addDefaultRoute: true,
          routeDistance: 300,
          usePeerDns: true,
          disabled: false,
        },
      }),
    ).toMatchObject({ code: 'out-of-range' });

    const route = (dst: string, distance = 1): Op => ({
      op: 'add',
      coll: 'routes',
      item: {
        dst: prefix(dst),
        gateway: { kind: 'ip', ip: ipv4('10.0.0.1') },
        distance,
        table: 'main',
        disabled: false,
      },
    });
    expect(fails(r1, route('192.168.5.1/24'))).toMatchObject({
      code: 'invalid-value',
      expected: 'network-address',
    });
    expect(fails(r1, route('0.0.0.0/0', 0))).toMatchObject({
      code: 'out-of-range',
      field: 'distance',
    });
    expect(applyOp(r1, route('0.0.0.0/0')).ok).toBe(true);
    expect(
      fails(r1, {
        op: 'add',
        coll: 'routes',
        item: {
          dst: prefix('10.9.0.0/16'),
          gateway: { kind: 'iface', iface: itemId(50) },
          distance: 1,
          table: 'main',
          disabled: false,
        },
      }),
    ).toMatchObject({ code: 'not-found', field: 'gateway' });
  });

  it('valida pools, servidores, redes y leases DHCP', () => {
    const r1 = freshRouter();
    const ether2 = ifc(r1, 'ether2');
    const pool = (name: string, ranges: string[], next?: ItemId): Op => ({
      op: 'add',
      coll: 'pools',
      item: {
        name,
        ranges: ranges.map(range),
        disabled: false,
        ...(next === undefined ? {} : { next }),
      },
    });
    expect(fails(r1, pool('', ['10.0.0.1-10.0.0.9']))).toMatchObject({
      code: 'missing-required',
      field: 'name',
    });
    expect(fails(r1, pool('p', []))).toMatchObject({ code: 'missing-required', field: 'ranges' });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'pools',
        item: {
          name: 'p',
          ranges: [{ from: ipv4('10.0.0.9'), to: ipv4('10.0.0.1') }],
          disabled: false,
        },
      }),
    ).toMatchObject({ code: 'invalid-value', expected: 'ip-range' });
    expect(fails(r1, pool('p', ['10.0.0.1-10.0.0.9'], itemId(r1.nextId)))).toMatchObject({
      detail: 'self-reference',
    });
    const withPool = must(r1, pool('lan', ['192.168.88.10-192.168.88.254']));

    const server = (name: string, leaseTimeS = 600): Op => ({
      op: 'add',
      coll: 'dhcpServers',
      item: {
        name,
        iface: ether2,
        pool: withPool.id,
        leaseTimeS,
        authoritative: true,
        disabled: false,
      },
    });
    const withServer = must(withPool.device, server('dhcp1'));
    expect(fails(withServer.device, server('dhcp2'))).toMatchObject({
      code: 'duplicate',
      field: 'iface',
    });
    expect(fails(withPool.device, server('dhcp1', 0))).toMatchObject({ code: 'out-of-range' });

    const network = (text: string): Op => ({
      op: 'add',
      coll: 'dhcpNetworks',
      item: { prefix: prefix(text), dnsServers: [], disabled: false },
    });
    expect(fails(r1, network('192.168.88.1/24'))).toMatchObject({ expected: 'network-address' });
    const withNet = must(r1, network('192.168.88.0/24'));
    expect(fails(withNet.device, network('192.168.88.0/24'))).toMatchObject({ code: 'duplicate' });

    const lease = (m: string): Op => ({
      op: 'add',
      coll: 'staticLeases',
      item: {
        server: 'all',
        mac: m as ReturnType<typeof mac>,
        ip: ipv4('192.168.88.50'),
        disabled: false,
      },
    });
    expect(fails(r1, lease('xx'))).toMatchObject({ expected: 'mac' });
    const withLease = must(r1, lease('02:00:00:00:00:50'));
    expect(fails(withLease.device, lease('02:00:00:00:00:50'))).toMatchObject({
      code: 'duplicate',
    });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'staticLeases',
        item: {
          server: itemId(80),
          mac: mac('02:00:00:00:00:51'),
          ip: ipv4('192.168.88.51'),
          disabled: false,
        },
      }),
    ).toMatchObject({ code: 'not-found', scope: 'dhcpServers' });
  });

  it('valida registros DNS estáticos', () => {
    const r1 = freshRouter();
    const record = (item: Partial<NewItem<'dnsStatic'>>): Op => ({
      op: 'add',
      coll: 'dnsStatic',
      item: {
        name: 'router.lan',
        type: 'A',
        ttlS: 86400,
        disabled: false,
        ...item,
      } as NewItem<'dnsStatic'>,
    });
    expect(fails(r1, record({}))).toMatchObject({ code: 'missing-required', field: 'address' });
    expect(fails(r1, record({ type: 'CNAME' }))).toMatchObject({
      code: 'missing-required',
      field: 'cname',
    });
    expect(fails(r1, record({ name: 'mal nombre', address: ipv4('1.1.1.1') }))).toMatchObject({
      expected: 'hostname',
    });
    expect(fails(r1, record({ address: ipv4('1.1.1.1'), ttlS: -1 }))).toMatchObject({
      code: 'out-of-range',
    });
    expect(applyOp(r1, record({ address: ipv4('192.168.88.1') })).ok).toBe(true);
    expect(applyOp(r1, record({ type: 'CNAME', cname: 'router.lan', name: 'gw.lan' })).ok).toBe(
      true,
    );
  });

  it('valida reglas de firewall y NAT', () => {
    const r1 = freshRouter();
    const filter = (item: Partial<NewItem<'filterRules'>>): Op => ({
      op: 'add',
      coll: 'filterRules',
      item: {
        chain: 'input',
        match: {},
        action: { kind: 'accept' },
        log: false,
        disabled: false,
        ...item,
      },
    });
    expect(fails(r1, filter({ chain: '' }))).toMatchObject({
      code: 'missing-required',
      field: 'chain',
    });
    expect(
      fails(r1, filter({ match: { dstPort: { value: [{ from: 22, to: 22 }], negate: false } } })),
    ).toMatchObject({
      detail: 'port-requires-tcp-udp',
    });
    expect(
      applyOp(
        r1,
        filter({
          match: {
            protocol: { value: 'tcp', negate: false },
            dstPort: { value: [{ from: 22, to: 22 }], negate: false },
          },
        }),
      ).ok,
    ).toBe(true);
    expect(fails(r1, filter({ action: { kind: 'jump', target: 'input' } }))).toMatchObject({
      expected: 'custom-chain',
    });
    expect(fails(r1, filter({ action: { kind: 'jump', target: '' } }))).toMatchObject({
      code: 'missing-required',
    });
    expect(
      fails(r1, filter({ match: { inInterface: { value: itemId(66), negate: false } } })),
    ).toMatchObject({ code: 'not-found', field: 'match.inInterface' });

    const nat = (item: Partial<NewItem<'natRules'>>): Op => ({
      op: 'add',
      coll: 'natRules',
      item: {
        chain: 'srcnat',
        match: {},
        action: { kind: 'masquerade' },
        disabled: false,
        ...item,
      },
    });
    expect(applyOp(r1, nat({})).ok).toBe(true);
    expect(fails(r1, nat({ chain: 'dstnat' }))).toMatchObject({ detail: 'action-chain-mismatch' });
    expect(
      fails(r1, nat({ action: { kind: 'redirect', toPorts: [{ from: 53, to: 53 }] } })),
    ).toMatchObject({
      detail: 'action-chain-mismatch',
    });
    expect(
      fails(
        r1,
        nat({
          chain: 'dstnat',
          action: { kind: 'dstNat', to: range('10.0.0.5'), toPorts: [{ from: 80, to: 80 }] },
        }),
      ),
    ).toMatchObject({ detail: 'port-requires-tcp-udp' });
    expect(
      applyOp(
        r1,
        nat({
          chain: 'dstnat',
          match: { protocol: { value: 'udp', negate: false } },
          action: { kind: 'dstNat', to: range('10.0.0.5'), toPorts: [{ from: 53, to: 53 }] },
        }),
      ).ok,
    ).toBe(true);
  });

  it('valida listas de interfaces y de direcciones, usuarios y servicios', () => {
    const r1 = freshRouter();
    const list = (name: string, include: string[] = []): Op => ({
      op: 'add',
      coll: 'interfaceLists',
      item: { name, include, disabled: false },
    });
    expect(fails(r1, list('all'))).toMatchObject({ detail: 'reserved-name' });
    expect(fails(r1, list(''))).toMatchObject({ code: 'missing-required' });
    expect(fails(r1, list('LAN', ['LAN']))).toMatchObject({ detail: 'self-reference' });
    expect(fails(r1, list('LAN', ['WAN']))).toMatchObject({ code: 'not-found', ref: 'WAN' });
    const lan = applyOp(r1, list('LAN', ['all']));
    if (!lan.ok) throw new Error('sin LAN');
    const member = (iface: ItemId): Op => ({
      op: 'add',
      coll: 'interfaceListMembers',
      item: { list: lan.value.created ?? itemId(0), iface, disabled: false },
    });
    const withMember = must(lan.value.device, member(ifc(r1, 'ether2')));
    expect(fails(withMember.device, member(ifc(r1, 'ether2')))).toMatchObject({
      code: 'duplicate',
    });
    expect(fails(lan.value.device, member(itemId(99)))).toMatchObject({
      code: 'not-found',
      field: 'iface',
    });

    const entry: Op = {
      op: 'add',
      coll: 'addressLists',
      item: { list: 'bloqueados', address: prefix('10.0.0.0/8'), disabled: false },
    };
    expect(fails(must(r1, entry).device, entry)).toMatchObject({ code: 'duplicate' });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'addressLists',
        item: { list: '', address: range('1.1.1.1-1.1.1.9'), disabled: false },
      }),
    ).toMatchObject({ code: 'missing-required' });

    const user: Op = {
      op: 'add',
      coll: 'users',
      item: { name: 'ana', group: 'read', hasPassword: true, disabled: false },
    };
    expect(fails(must(r1, user).device, user)).toMatchObject({ code: 'duplicate', field: 'name' });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'users',
        item: { name: '', group: 'read', hasPassword: true, disabled: false },
      }),
    ).toMatchObject({ code: 'missing-required' });
    expect(
      fails(r1, {
        op: 'add',
        coll: 'services',
        item: { name: 'ssh', port: 70000, allowedFrom: [], disabled: false },
      }),
    ).toMatchObject({ code: 'out-of-range', field: 'port' });
  });

  it('inserta antes de un ítem concreto', () => {
    const r1 = freshRouter();
    const rule = (comment: string, before?: ItemId): Op => ({
      op: 'add',
      coll: 'filterRules',
      item: {
        chain: 'forward',
        match: {},
        action: { kind: 'drop' },
        log: false,
        disabled: false,
        comment,
      },
      ...(before === undefined ? {} : { before }),
    });
    const a = must(r1, rule('a'));
    const b = must(a.device, rule('b', a.id));
    expect(b.device.config.firewall.filter.map((r) => r.comment)).toEqual(['b', 'a']);
    expect(fails(a.device, rule('c', itemId(500)))).toMatchObject({
      code: 'not-found',
      field: 'before',
    });
  });
});

describe('set', () => {
  it('modifica, quita campos opcionales y protege id y tipo', () => {
    const r1 = freshRouter();
    const ether1 = ifc(r1, 'ether1');
    const renamed = must(r1, {
      op: 'set',
      coll: 'interfaces',
      id: ether1,
      patch: { name: 'ether1-wan', comment: 'WAN' },
    });
    expect(interfaceByName(renamed.device.config, 'ether1-wan')?.comment).toBe('WAN');
    const cleared = must(renamed.device, {
      op: 'set',
      coll: 'interfaces',
      id: ether1,
      patch: {},
      unset: ['comment'],
    });
    expect(findItem(cleared.device.config, 'interfaces', ether1)).not.toHaveProperty('comment');
    expect(
      fails(r1, { op: 'set', coll: 'interfaces', id: ether1, patch: {}, unset: ['name'] }),
    ).toMatchObject({
      expected: 'optional-field',
    });
    const kindPatch = { kind: 'bridge' } as unknown as ItemPatch<'interfaces'>;
    expect(
      fails(r1, { op: 'set', coll: 'interfaces', id: ether1, patch: kindPatch }),
    ).toMatchObject({
      expected: 'mutable-field',
    });
    expect(fails(r1, { op: 'set', coll: 'interfaces', id: itemId(99), patch: {} })).toMatchObject({
      code: 'not-found',
    });
    expect(
      fails(r1, { op: 'set', coll: 'interfaces', id: ether1, patch: { name: 'ether2' } }),
    ).toMatchObject({
      code: 'duplicate',
    });
  });

  it('valida la configuración wifi', () => {
    const r1 = freshRouter();
    const wlan1 = ifc(r1, 'wlan1');
    const set = (patch: ItemPatch<'interfaces'>): Op => ({
      op: 'set',
      coll: 'interfaces',
      id: wlan1,
      patch,
    });
    expect(fails(r1, set({ ssid: 'x'.repeat(33) }))).toMatchObject({ expected: 'ssid' });
    expect(fails(r1, set({ channelMhz: 5180 }))).toMatchObject({ expected: 'wifi-channel' });
    expect(fails(r1, set({ security: { auth: ['wpa2-psk'], passphrase: 'corta' } }))).toMatchObject(
      {
        expected: 'passphrase',
      },
    );
    const done = must(
      r1,
      set({
        ssid: 'Oficina',
        channelMhz: 2437,
        disabled: false,
        security: { auth: ['wpa2-psk'], passphrase: 'clave-larga-1' },
      }),
    );
    expect(interfaceByName(done.device.config, 'wlan1')).toMatchObject({
      ssid: 'Oficina',
      disabled: false,
    });
    expect(applyOp(done.device, set({ band: '5ghz', channelMhz: 5180 })).ok).toBe(true);
  });

  it('permite editar un ítem huérfano sin tocar su referencia rota', () => {
    const { device, bridge } = withBridge();
    const withAddr = must(device, {
      op: 'add',
      coll: 'addresses',
      item: { iface: bridge, address: prefix('10.0.0.1/24'), disabled: false },
    });
    const orphaned = must(
      withAddr.device,
      { op: 'remove', coll: 'interfaces', id: bridge },
      { danglingRefs: 'orphan' },
    );
    const edited = applyOp(orphaned.device, {
      op: 'set',
      coll: 'addresses',
      id: withAddr.id,
      patch: { comment: 'x' },
    });
    expect(edited.ok).toBe(true);
    const repointed = applyOp(orphaned.device, {
      op: 'set',
      coll: 'addresses',
      id: withAddr.id,
      patch: { iface: itemId(123) },
    });
    expect(repointed.ok).toBe(false);
  });
});

describe('remove', () => {
  it('no borra interfaces físicas', () => {
    const r1 = freshRouter();
    expect(fails(r1, { op: 'remove', coll: 'interfaces', id: ifc(r1, 'ether1') })).toMatchObject({
      code: 'not-removable',
    });
    expect(fails(r1, { op: 'remove', coll: 'interfaces', id: itemId(404) })).toMatchObject({
      code: 'not-found',
    });
  });

  it('respeta la política de referencias colgantes', () => {
    const { device, bridge } = withBridge();
    const withPort = must(device, {
      op: 'add',
      coll: 'bridgePorts',
      item: {
        bridge,
        iface: ifc(device, 'ether2'),
        pvid: 1,
        frameTypes: 'all',
        ingressFiltering: true,
        disabled: false,
      },
    });
    expect(referrersOf(withPort.device.config, 'interfaces', bridge)).toEqual([
      { coll: 'bridgePorts', id: withPort.id },
    ]);
    expect(fails(withPort.device, { op: 'remove', coll: 'interfaces', id: bridge })).toMatchObject({
      code: 'in-use',
      usedBy: [{ coll: 'bridgePorts', id: withPort.id }],
    });
    const orphan = must(
      withPort.device,
      { op: 'remove', coll: 'interfaces', id: bridge },
      { danglingRefs: 'orphan' },
    );
    expect(orphan.device.config.bridging.ports).toHaveLength(1);
    expect(interfaceByName(orphan.device.config, 'bridge1')).toBeUndefined();
  });
});

describe('move', () => {
  it('reordena reglas', () => {
    let device = freshRouter();
    const ids: ItemId[] = [];
    for (const comment of ['a', 'b', 'c']) {
      const step = must(device, {
        op: 'add',
        coll: 'filterRules',
        item: {
          chain: 'forward',
          match: {},
          action: { kind: 'accept' },
          log: false,
          disabled: false,
          comment,
        },
      });
      device = step.device;
      ids.push(step.id);
    }
    const [a, b, c] = ids as [ItemId, ItemId, ItemId];
    const order = (d: Device) => d.config.firewall.filter.map((r) => r.comment).join('');
    expect(order(must(device, { op: 'move', coll: 'filterRules', id: c, before: a }).device)).toBe(
      'cab',
    );
    expect(
      order(must(device, { op: 'move', coll: 'filterRules', id: a, before: null }).device),
    ).toBe('bca');
    expect(order(must(device, { op: 'move', coll: 'filterRules', id: b, before: b }).device)).toBe(
      'abc',
    );
    expect(
      fails(device, { op: 'move', coll: 'filterRules', id: itemId(1000), before: null }),
    ).toMatchObject({
      code: 'not-found',
    });
    expect(
      fails(device, { op: 'move', coll: 'filterRules', id: a, before: itemId(1000) }),
    ).toMatchObject({
      code: 'not-found',
      field: 'before',
    });
  });
});

describe('ajustes únicos', () => {
  it('valida identidad, DNS y descubrimiento', () => {
    const r1 = freshRouter();
    expect(
      must(r1, { op: 'setSingleton', key: 'system', patch: { identity: 'Oficina' } }).device.config
        .system.identity,
    ).toBe('Oficina');
    expect(fails(r1, { op: 'setSingleton', key: 'system', patch: { identity: '' } })).toMatchObject(
      {
        code: 'missing-required',
        field: 'identity',
      },
    );
    expect(
      fails(r1, { op: 'setSingleton', key: 'system', patch: { timezone: ' ' } }),
    ).toMatchObject({
      field: 'timezone',
    });
    const dns = must(r1, {
      op: 'setSingleton',
      key: 'dns',
      patch: { servers: [ipv4('1.1.1.1')], allowRemoteRequests: true },
    });
    expect(dns.device.config.dns.allowRemoteRequests).toBe(true);
    expect(fails(r1, { op: 'setSingleton', key: 'dns', patch: { cacheSizeKiB: 1 } })).toMatchObject(
      {
        code: 'out-of-range',
      },
    );
    expect(
      fails(r1, { op: 'setSingleton', key: 'discovery', patch: { interfaceList: 'LAN' } }),
    ).toMatchObject({
      code: 'not-found',
    });
    expect(
      applyOp(r1, {
        op: 'setSingleton',
        key: 'discovery',
        patch: { interfaceList: 'all', protocols: ['lldp'] },
      }).ok,
    ).toBe(true);
  });
});

describe('restore y lotes', () => {
  it('restaura una configuración y mantiene los ids por delante', () => {
    const { device } = withBridge();
    const restored = must(device, { op: 'restore', config: emptyConfig('vacío') });
    expect(restored.device.config.interfaces).toHaveLength(0);
    expect(restored.device.nextId).toBe(device.nextId);
    const bigger = { ...emptyConfig('x'), interfaces: [{ ...bridgeItem('b'), id: itemId(50) }] };
    expect(must(device, { op: 'restore', config: bigger as never }).device.nextId).toBe(51);
  });

  it('aplica lotes de forma atómica e informa la posición del fallo', () => {
    const r1 = freshRouter();
    const result = applyOps(r1, [
      { op: 'add', coll: 'interfaces', item: bridgeItem('bridge1') },
      { op: 'add', coll: 'interfaces', item: bridgeItem('bridge1') },
    ]);
    expect(result).toMatchObject({ ok: false, error: { index: 1, error: { code: 'duplicate' } } });
    expect(r1.config.interfaces).toHaveLength(6);
    const good = applyOps(r1, [
      { op: 'add', coll: 'interfaces', item: bridgeItem('bridge1') },
      { op: 'add', coll: 'interfaces', item: bridgeItem('bridge2') },
    ]);
    expect(good.ok && good.value.created).toEqual([7, 8]);
  });
});
