import { describe, expect, it } from 'vitest';
import { resolveName } from '../engine/runtime';
import { saveBackup } from '../engine/storage';
import { deviceId } from '../model/brand';
import type { DeviceConfig } from '../model/config';
import type { Network } from '../model/network';
import { ipv4, prefix, range } from '../net/ipv4';
import { applyOp } from '../ops/apply';
import { deviceIn, ifaceIn, type NetBuilder, net } from '../testing/builder';
import { deepEqual, type EvalContext, evaluate } from './evaluate';
import type { CountCmp, Predicate, WhereClause } from './predicates';

const R1 = deviceId('R1');
const PC1 = deviceId('PC1');
const PC2 = deviceId('PC2');
const ISP = deviceId('ISP');
const LAP = deviceId('LAP');

const base = (): NetBuilder =>
  net()
    .cloud('ISP')
    .router('R1')
    .host('PC1')
    .host('PC2')
    .host('LAP', 'sim-host-w')
    .link('ISP:eth0', 'R1:ether1')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('R1', 'ether1', '203.0.113.2/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .bridge('R1', 'bridge1', ['ether2', 'ether3', 'wlan1'])
    .address('R1', 'bridge1', '192.168.88.1/24')
    .wifi('R1', 'wlan1', 'ap', 'Oficina', 'clave-segura')
    .wifi('LAP', 'wlan0', 'station', 'Oficina', 'clave-segura')
    .dhcpServer('R1', {
      iface: 'bridge1',
      pool: '192.168.88.10-192.168.88.254',
      network: '192.168.88.0/24',
      gateway: '192.168.88.1',
      dns: ['192.168.88.1'],
    })
    .dhcpClient('PC1', 'eth0')
    .dhcpClient('PC2', 'eth0')
    .dhcpClient('LAP', 'wlan0');

function ctx(n: Network, startup: ReadonlyMap<string, DeviceConfig> = new Map()): EvalContext {
  return { net: n, startup: startup as EvalContext['startup'] };
}

const check = (n: Network, p: Predicate, startup?: ReadonlyMap<string, DeviceConfig>) =>
  evaluate(p, ctx(n, startup));

const internet: Predicate = {
  kind: 'reachable',
  from: PC1,
  to: { ip: ipv4('8.8.8.8') },
  protocol: 'icmp',
};
const natToWan: Predicate = {
  kind: 'natSourceIs',
  from: PC1,
  to: { ip: ipv4('8.8.8.8') },
  protocol: 'icmp',
  expect: { addressOf: { device: R1, iface: { name: 'ether1' } } },
};

describe('conectividad y NAT', () => {
  it('acepta cualquier camino válido hacia el mismo estado', () => {
    const masq = base().masquerade('R1', 'ether1').build();
    const srcNat = base()
      .nat('R1', 'srcnat', { kind: 'srcNat', to: range('203.0.113.2') })
      .build();
    const none = base().build();
    for (const n of [masq, srcNat]) {
      expect(check(n, internet)).toBe(true);
      expect(check(n, natToWan)).toBe(true);
    }
    expect(check(none, internet)).toBe(false);
    expect(check(none, natToWan)).toBe(false);
    expect(
      check(masq, {
        kind: 'natSourceIs',
        from: PC1,
        to: { ip: ipv4('8.8.8.8') },
        protocol: 'icmp',
        expect: { ip: ipv4('203.0.113.2') },
      }),
    ).toBe(true);
  });

  it('bloqueado por firewall no se cumple con una ruta rota', () => {
    const blockedByRule = base()
      .masquerade('R1', 'ether1')
      .filter('R1', 'forward', { kind: 'drop' }, () => ({
        srcAddress: { value: prefix('192.168.88.11/32'), negate: false },
      }))
      .build();
    const p: Predicate = {
      kind: 'blocked',
      from: PC2,
      to: { ip: ipv4('8.8.8.8') },
      protocol: 'icmp',
      by: 'firewall',
    };
    expect(check(blockedByRule, p)).toBe(true);
    expect(check(base().build(), p)).toBe(false);
    expect(check(base().build(), { ...p, by: 'any' })).toBe(true);
    expect(check(blockedByRule, { ...p, from: PC1 })).toBe(false);
  });

  it('acepta un dispositivo como destino', () => {
    const n = base().build();
    expect(check(n, { kind: 'reachable', from: PC1, to: { device: R1 }, protocol: 'icmp' })).toBe(
      true,
    );
    expect(
      check(n, {
        kind: 'reachable',
        from: PC1,
        to: { device: deviceId('NADIE') },
        protocol: 'icmp',
      }),
    ).toBe(false);
  });
});

describe('estado de configuración', () => {
  it('sobrevive a un cambio de nombre de interfaz si se fijó por id', () => {
    const n = base().build();
    const ether1 = ifaceIn(n, 'R1', 'ether1');
    const renamed = base()
      .op('R1', (h) => ({
        op: 'set',
        coll: 'interfaces',
        id: h.iface('ether1'),
        patch: { name: 'ether1-wan' },
      }))
      .build();
    const byId: Predicate = {
      kind: 'hasAddress',
      device: R1,
      iface: { id: ether1 },
      prefix: prefix('203.0.113.2/24'),
    };
    const byName: Predicate = {
      kind: 'hasAddress',
      device: R1,
      iface: { name: 'ether1' },
      prefix: prefix('203.0.113.2/24'),
    };
    expect(check(renamed, byId)).toBe(true);
    expect(check(renamed, byName)).toBe(false);
    expect(
      check(n, {
        kind: 'hasAddress',
        device: R1,
        iface: { name: 'bridge1' },
        within: prefix('192.168.88.0/24'),
      }),
    ).toBe(true);
    expect(check(n, { kind: 'hasAddress', device: R1, iface: { name: 'bridge1' } })).toBe(true);
    expect(
      check(n, {
        kind: 'hasAddress',
        device: PC1,
        iface: { name: 'eth0' },
        within: prefix('192.168.88.0/24'),
      }),
    ).toBe(true);
    expect(check(n, { kind: 'hasAddress', device: R1, iface: { name: 'nada' } })).toBe(false);
    expect(check(n, { kind: 'hasAddress', device: R1, iface: { name: 'ether4' } })).toBe(false);
  });

  it('una IP en un puerto esclavo no cuenta', () => {
    const n = base().address('R1', 'ether2', '10.0.0.1/24').build();
    expect(check(n, { kind: 'hasAddress', device: R1, iface: { name: 'ether2' } })).toBe(false);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'addresses',
        where: [{ path: ['address'], match: { prefix: prefix('10.0.0.1/24') } }],
        count: { op: '>=', n: 1 },
      }),
    ).toBe(false);
  });

  it('comprueba rutas activas por gateway o interfaz', () => {
    const n = base().route('R1', '10.20.0.0/16', 'ether1').build();
    expect(
      check(n, {
        kind: 'routeActive',
        device: R1,
        dst: prefix('0.0.0.0/0'),
        via: { ip: ipv4('203.0.113.1') },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'routeActive',
        device: R1,
        dst: prefix('0.0.0.0/0'),
        via: { ip: ipv4('203.0.113.9') },
      }),
    ).toBe(false);
    expect(
      check(n, {
        kind: 'routeActive',
        device: R1,
        dst: prefix('10.20.0.0/16'),
        via: { iface: { name: 'ether1' } },
      }),
    ).toBe(true);
    expect(check(n, { kind: 'routeActive', device: R1, dst: prefix('10.20.0.0/16') })).toBe(true);
    expect(check(n, { kind: 'routeActive', device: deviceId('X'), dst: prefix('0.0.0.0/0') })).toBe(
      false,
    );
  });

  it('busca ítems con condiciones y cuenta', () => {
    const n = base()
      .filter('R1', 'input', { kind: 'accept' }, () => ({
        connectionState: ['established', 'related'],
      }))
      .filter('R1', 'input', { kind: 'drop' }, (h) => ({
        inInterface: { value: h.iface('ether1'), negate: false },
      }))
      .op('R1', () => ({
        op: 'add',
        coll: 'filterRules',
        item: { chain: 'input', match: {}, action: { kind: 'drop' }, log: false, disabled: true },
      }))
      .build();
    const drops = (count: CountCmp, extra: readonly WhereClause[] = []) =>
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'filterRules',
        where: [
          { path: ['chain'], match: { eq: 'input' } },
          { path: ['action', 'kind'], match: { eq: 'drop' } },
          ...extra,
        ],
        count,
      });
    expect(drops({ op: '==', n: 1 })).toBe(true);
    expect(drops({ op: '>', n: 1 })).toBe(false);
    expect(drops({ op: '<', n: 2 })).toBe(true);
    expect(drops({ op: '<=', n: 0 })).toBe(false);
    expect(
      drops({ op: '>=', n: 1 }, [
        { path: ['match', 'inInterface', 'value'], match: { iface: { name: 'ether1' } } },
      ]),
    ).toBe(true);
    expect(drops({ op: '==', n: 2 }, [{ path: ['disabled'], match: { exists: true } }])).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'filterRules',
        where: [{ path: ['match', 'connectionState'], match: { includes: 'established' } }],
        count: { op: '==', n: 1 },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'bridgePorts',
        where: [{ path: ['iface'], match: { iface: { name: 'wlan1' } } }],
        count: { op: '==', n: 1 },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'routes',
        where: [{ path: ['gateway', 'ip'], match: { ip: ipv4('203.0.113.1') } }],
        count: { op: '==', n: 1 },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'routes',
        where: [{ path: ['dst'], match: { within: prefix('0.0.0.0/0') } }],
        count: { op: '==', n: 1 },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: R1,
        coll: 'pools',
        where: [{ path: ['ranges', '0', 'from'], match: { within: prefix('192.168.88.0/24') } }],
        count: { op: '==', n: 1 },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'exists',
        device: deviceId('X'),
        coll: 'routes',
        where: [],
        count: { op: '>=', n: 0 },
      }),
    ).toBe(false);
  });

  it('comprueba ajustes únicos', () => {
    const n = base()
      .op('R1', () => ({ op: 'setSingleton', key: 'system', patch: { identity: 'Oficina-GW' } }))
      .dns('R1', ['1.1.1.1', '9.9.9.9'], true)
      .build();
    expect(
      check(n, {
        kind: 'setting',
        device: R1,
        key: 'system',
        path: ['identity'],
        match: { eq: 'Oficina-GW' },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'setting',
        device: R1,
        key: 'dns',
        path: ['allowRemoteRequests'],
        match: { eq: true },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'setting',
        device: R1,
        key: 'dns',
        path: ['servers'],
        match: { includes: { ip: ipv4('9.9.9.9') } },
      }),
    ).toBe(true);
    expect(
      check(n, {
        kind: 'setting',
        device: R1,
        key: 'dns',
        path: ['servers'],
        match: { includes: { iface: { name: 'x' } } },
      }),
    ).toBe(false);
    expect(
      check(n, {
        kind: 'setting',
        device: R1,
        key: 'dns',
        path: ['allowRemoteRequests'],
        match: { includes: 1 },
      }),
    ).toBe(false);
    expect(
      check(n, {
        kind: 'setting',
        device: deviceId('X'),
        key: 'dns',
        path: ['servers'],
        match: { exists: true },
      }),
    ).toBe(false);
  });
});

describe('servicios', () => {
  it('leases, wifi, interfaces y vecinos', () => {
    const n = base()
      .router('R2')
      .link('R1:ether4', 'R2:ether1')
      .op('R1', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['mndp'], interfaceList: 'all' },
      }))
      .op('R2', () => ({
        op: 'setSingleton',
        key: 'discovery',
        patch: { protocols: ['mndp'], interfaceList: 'all' },
      }))
      .build();
    expect(
      check(n, { kind: 'leaseBound', server: R1, client: PC1, within: prefix('192.168.88.0/24') }),
    ).toBe(true);
    expect(
      check(n, { kind: 'leaseBound', server: R1, client: PC1, within: prefix('10.0.0.0/8') }),
    ).toBe(false);
    expect(check(n, { kind: 'leaseBound', server: R1, client: LAP })).toBe(true);
    expect(check(n, { kind: 'wifiAssociated', client: LAP, ap: R1, ssid: 'Oficina' })).toBe(true);
    expect(check(n, { kind: 'wifiAssociated', client: LAP, ap: R1, ssid: 'Otra' })).toBe(false);
    expect(check(n, { kind: 'wifiAssociated', client: LAP, ap: R1 })).toBe(true);
    expect(check(n, { kind: 'wifiAssociated', client: LAP, ap: deviceId('X') })).toBe(false);
    expect(check(n, { kind: 'interfaceRunning', device: R1, iface: { name: 'ether1' } })).toBe(
      true,
    );
    expect(check(n, { kind: 'interfaceRunning', device: R1, iface: { name: 'ether5' } })).toBe(
      false,
    );
    expect(check(n, { kind: 'neighborSeen', device: R1, peer: deviceId('R2') })).toBe(true);
    expect(check(n, { kind: 'neighborSeen', device: R1, peer: ISP })).toBe(false);
  });

  it('resolución DNS por un resolutor concreto', () => {
    const n = base().masquerade('R1', 'ether1').dns('R1', ['1.1.1.1'], true).build();
    const p: Predicate = {
      kind: 'resolves',
      from: PC1,
      name: 'example.com',
      to: ipv4('93.184.216.34'),
      via: R1,
    };
    expect(check(n, p)).toBe(true);
    expect(check(n, { ...p, to: ipv4('1.2.3.4') })).toBe(false);
    expect(check(n, { ...p, via: PC2 })).toBe(false);
    expect(check(base().build(), p)).toBe(false);
    expect(resolveName(n, PC1, 'example.com').outcome).toBe('answered');
  });

  it('archivos y comparación con la configuración de arranque', () => {
    const n = base().build();
    const r1 = deviceIn(n, 'R1');
    const startup = new Map([[R1 as string, r1.config]]);
    const withBackup: Network = {
      ...n,
      devices: n.devices.map((d) => (d.id === R1 ? saveBackup(d, 'oficina.backup', n.now) : d)),
    };
    expect(
      check(withBackup, { kind: 'fileExists', device: R1, type: 'backup', name: '*.backup' }),
    ).toBe(true);
    expect(
      check(withBackup, { kind: 'fileExists', device: R1, type: 'backup', name: 'oficina.backup' }),
    ).toBe(true);
    expect(check(withBackup, { kind: 'fileExists', device: R1, type: 'script' })).toBe(false);
    expect(
      check(withBackup, { kind: 'configMatches', device: R1, snapshot: 'startup' }, startup),
    ).toBe(true);
    expect(
      check(withBackup, {
        kind: 'configMatches',
        device: R1,
        snapshot: { file: 'oficina.backup' },
      }),
    ).toBe(true);

    const changed = applyOp(deviceIn(withBackup, 'R1'), {
      op: 'setSingleton',
      key: 'system',
      patch: { identity: 'otro' },
    });
    if (!changed.ok) throw new Error('no cambió');
    const after: Network = {
      ...withBackup,
      devices: withBackup.devices.map((d) => (d.id === R1 ? changed.value.device : d)),
    };
    expect(check(after, { kind: 'configMatches', device: R1, snapshot: 'startup' }, startup)).toBe(
      false,
    );
    expect(
      check(
        after,
        { kind: 'configMatches', device: R1, snapshot: 'startup', scope: ['addresses', 'routes'] },
        startup,
      ),
    ).toBe(true);
    expect(check(after, { kind: 'configMatches', device: R1, snapshot: { file: 'nada' } })).toBe(
      false,
    );
    expect(check(after, { kind: 'configMatches', device: R1, snapshot: 'startup' })).toBe(false);
    expect(
      check(after, { kind: 'configMatches', device: deviceId('X'), snapshot: 'startup' }),
    ).toBe(false);
  });

  it('combinadores', () => {
    const n = base().build();
    const yes: Predicate = { kind: 'interfaceRunning', device: R1, iface: { name: 'ether1' } };
    const no: Predicate = { kind: 'interfaceRunning', device: R1, iface: { name: 'ether5' } };
    expect(check(n, { kind: 'all', of: [yes, yes] })).toBe(true);
    expect(check(n, { kind: 'all', of: [yes, no] })).toBe(false);
    expect(check(n, { kind: 'any', of: [no, yes] })).toBe(true);
    expect(check(n, { kind: 'not', of: no })).toBe(true);
  });
});

describe('deepEqual', () => {
  it('ignora el orden de las claves', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual([1, 2], [1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
