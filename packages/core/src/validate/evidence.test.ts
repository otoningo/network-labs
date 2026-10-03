import { describe, expect, it } from 'vitest';
import { saveBackup } from '../engine/storage';
import { deviceId } from '../model/brand';
import type { DeviceConfig } from '../model/config';
import type { Network } from '../model/network';
import { ipv4, prefix } from '../net/ipv4';
import { deviceIn, net } from '../testing/builder';
import type { EvalContext } from './evaluate';
import { evidence } from './evidence';
import type { Predicate } from './predicates';

const R1 = deviceId('R1');
const PC1 = deviceId('PC1');
const LAP = deviceId('LAP');

const office = (): Network =>
  net()
    .cloud('ISP')
    .router('R1')
    .host('PC1')
    .host('LAP', 'sim-host-w')
    .link('ISP:eth0', 'R1:ether1')
    .link('R1:ether2', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('R1', 'ether1', '203.0.113.2/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .bridge('R1', 'bridge1', ['ether2', 'wlan1'])
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
    .dhcpClient('LAP', 'wlan0')
    .masquerade('R1', 'ether1')
    .dns('R1', ['1.1.1.1'], true)
    .build();

const ctx = (n: Network, startup: ReadonlyMap<string, DeviceConfig> = new Map()): EvalContext => ({
  net: n,
  startup: startup as EvalContext['startup'],
});

const of = (n: Network, p: Predicate, startup?: ReadonlyMap<string, DeviceConfig>) =>
  evidence(p, ctx(n, startup));

describe('evidence', () => {
  const n = office();

  it('direcciones y rutas', () => {
    expect(of(n, { kind: 'hasAddress', device: R1, iface: { name: 'bridge1' } })).toEqual([
      { kind: 'address', device: 'R1', iface: 'bridge1', addresses: ['192.168.88.1/24'] },
    ]);
    expect(of(n, { kind: 'routeActive', device: R1, dst: prefix('0.0.0.0/0') })).toEqual([
      { kind: 'route', device: 'R1', dst: '0.0.0.0/0', via: '203.0.113.1' },
    ]);
    expect(of(n, { kind: 'routeActive', device: R1, dst: prefix('10.0.0.0/8') })).toEqual([
      { kind: 'route', device: 'R1', dst: '10.0.0.0/8', via: null },
    ]);
    const connected = of(n, { kind: 'routeActive', device: R1, dst: prefix('192.168.88.0/24') });
    expect(connected).toEqual([
      { kind: 'route', device: 'R1', dst: '192.168.88.0/24', via: 'bridge1' },
    ]);
  });

  it('flujos: llega con NAT, puerto cerrado y sin destino', () => {
    const [web] = of(n, {
      kind: 'natSourceIs',
      from: PC1,
      to: { ip: ipv4('8.8.8.8') },
      protocol: 'icmp',
      expect: { ip: ipv4('203.0.113.2') },
    });
    expect(web).toMatchObject({
      kind: 'flow',
      outcome: 'ok',
      seenAs: '203.0.113.2',
      to: '8.8.8.8',
    });
    const [closed] = of(n, {
      kind: 'blocked',
      by: 'any',
      from: PC1,
      to: { device: R1 },
      protocol: 'tcp',
      port: 9999,
    });
    expect(closed).toMatchObject({ outcome: 'port-closed', at: 'R1', port: 9999, protocol: 'tcp' });
    const [none] = of(n, {
      kind: 'reachable',
      from: PC1,
      to: { device: deviceId('NADIE') },
      protocol: 'icmp',
    });
    expect(none).toMatchObject({ outcome: 'no-target', to: 'NADIE' });
  });

  it('un flujo cuya vuelta no regresa se reporta como sin respuesta', () => {
    const noNat = net()
      .cloud('ISP')
      .router('R1')
      .host('PC1')
      .link('ISP:eth0', 'R1:ether1')
      .link('R1:ether2', 'PC1:eth0')
      .address('ISP', 'eth0', '203.0.113.1/24')
      .internet('ISP')
      .address('R1', 'ether1', '203.0.113.2/24')
      .route('R1', '0.0.0.0/0', '203.0.113.1')
      .address('R1', 'ether2', '192.168.88.1/24')
      .address('PC1', 'eth0', '192.168.88.10/24')
      .route('PC1', '0.0.0.0/0', '192.168.88.1')
      .build();
    const [flow] = of(noNat, {
      kind: 'reachable',
      from: PC1,
      to: { ip: ipv4('8.8.8.8') },
      protocol: 'icmp',
    });
    expect(flow?.kind === 'flow' && flow.outcome).not.toBe('ok');
  });

  it('DHCP, wifi y DNS', () => {
    expect(of(n, { kind: 'leaseBound', server: R1, client: PC1 })[0]).toMatchObject({
      kind: 'lease',
      ip: expect.stringMatching(/^192\.168\.88\./),
    });
    expect(of(n, { kind: 'wifiAssociated', client: LAP, ap: R1 })).toEqual([
      { kind: 'wifi', client: 'LAP', ap: 'R1', ssid: 'Oficina' },
    ]);
    expect(of(n, { kind: 'resolves', from: PC1, name: 'example.com' })).toEqual([
      { kind: 'resolve', from: 'PC1', name: 'example.com', address: '93.184.216.34' },
    ]);
    expect(of(n, { kind: 'resolves', from: PC1, name: 'no-existe.test' })[0]).toMatchObject({
      address: null,
    });
  });

  it('archivos y comparación con una copia o con el arranque', () => {
    const r1 = saveBackup(deviceIn(n, 'R1'), 'antes', n.now);
    const saved: Network = { ...n, devices: n.devices.map((d) => (d.id === R1 ? r1 : d)) };
    expect(of(saved, { kind: 'fileExists', device: R1, type: 'backup' })).toEqual([
      { kind: 'file', device: 'R1', files: ['antes'] },
    ]);
    expect(of(saved, { kind: 'configMatches', device: R1, snapshot: { file: 'antes' } })).toEqual([
      { kind: 'config', device: 'R1', snapshot: 'antes', matches: true },
    ]);
    const startup = new Map([[R1 as string, deviceIn(n, 'R1').config]]);
    expect(
      of(n, { kind: 'configMatches', device: R1, snapshot: 'startup' }, startup)[0],
    ).toMatchObject({
      snapshot: null,
      matches: true,
    });
    expect(
      of(n, { kind: 'configMatches', device: deviceId('X'), snapshot: 'startup' })[0],
    ).toMatchObject({
      matches: false,
    });
  });

  it('conteos, ajustes, interfaces y vecinos; los compuestos se aplanan', () => {
    const p: Predicate = {
      kind: 'all',
      of: [
        {
          kind: 'exists',
          device: R1,
          coll: 'natRules',
          where: [{ path: ['action', 'kind'], match: { eq: 'masquerade' } }],
          count: { op: '>=', n: 1 },
        },
        {
          kind: 'not',
          of: {
            kind: 'setting',
            device: R1,
            key: 'system',
            path: ['identity'],
            match: { eq: 'x' },
          },
        },
        { kind: 'any', of: [{ kind: 'interfaceRunning', device: R1, iface: { name: 'ether2' } }] },
        { kind: 'neighborSeen', device: R1, peer: PC1 },
      ],
    };
    const [count, setting, iface, neighbor] = of(n, p);
    expect(count).toEqual({ kind: 'count', device: 'R1', coll: 'natRules', count: 1 });
    expect(setting).toEqual({
      kind: 'setting',
      device: 'R1',
      key: 'system',
      field: 'identity',
      value: 'R1',
    });
    expect(iface).toEqual({ kind: 'interface', device: 'R1', iface: 'ether2', running: true });
    expect(neighbor).toMatchObject({ kind: 'neighbor', device: 'R1', peer: 'PC1' });
  });

  it('valores de ajustes: direcciones, prefijos, listas y vacíos', () => {
    const withDns = net().router('R1').dns('R1', ['1.1.1.1', '8.8.8.8'], true).build();
    const value = (path: string[]) => {
      const [item] = of(withDns, {
        kind: 'setting',
        device: R1,
        key: 'dns',
        path,
        match: { exists: true },
      });
      return item?.kind === 'setting' ? item.value : undefined;
    };
    expect(value(['servers'])).toBe('1.1.1.1,8.8.8.8');
    expect(value(['allowRemoteRequests'])).toBe('true');
    expect(value(['no-existe'])).toBe('');
    expect(
      of(withDns, { kind: 'hasAddress', device: deviceId('X'), iface: { name: 'e' } })[0],
    ).toEqual({
      kind: 'address',
      device: 'X',
      iface: 'e',
      addresses: [],
    });
  });
});
