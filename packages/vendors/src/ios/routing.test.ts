import { deviceId, type EvalContext, evaluate, ipv4, type Network, prefix } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/**
 * Dos routers IOS unidos por Gi0/0 (10.0.12.0/30), cada uno con su PC en Gi0/1.
 * Las interfaces se encienden con el constructor: aquí solo se prueban las rutas.
 */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .router('R2', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .link('R1:GigabitEthernet0/0', 'R2:GigabitEthernet0/0')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .link('R2:GigabitEthernet0/1', 'PC2:eth0')
    .enable('R1', 'GigabitEthernet0/0')
    .enable('R1', 'GigabitEthernet0/1')
    .enable('R2', 'GigabitEthernet0/0')
    .enable('R2', 'GigabitEthernet0/1')
    .address('R1', 'GigabitEthernet0/0', '10.0.12.1/30')
    .address('R1', 'GigabitEthernet0/1', '192.168.10.1/24')
    .address('R2', 'GigabitEthernet0/0', '10.0.12.2/30')
    .address('R2', 'GigabitEthernet0/1', '192.168.20.1/24')
    .address('PC1', 'eth0', '192.168.10.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.10.1')
    .address('PC2', 'eth0', '192.168.20.10/24')
    .route('PC2', '0.0.0.0/0', '192.168.20.1')
    .build();
}

const config = (network: Network, id: string) =>
  new IosTerminal(network, id).script(['en', 'conf t']);
const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });
const pcsSeeEachOther = (network: Network) =>
  evaluate(
    { kind: 'reachable', from: deviceId('PC1'), to: { device: deviceId('PC2') }, protocol: 'icmp' },
    ctxOf(network),
  );
const routes = (t: IosTerminal) =>
  t.device.config.routing.static.map((r) => ({ distance: r.distance, gateway: r.gateway.kind }));

describe('ip route', () => {
  it('con siguiente salto en los dos sentidos, las PC se ven', () => {
    const r1 = config(lab(), 'R1');
    r1.ok('ip route 192.168.20.0 255.255.255.0 10.0.12.2');
    expect(pcsSeeEachOther(r1.net)).toBe(false);
    const r2 = config(r1.net, 'R2');
    r2.ok('ip route 192.168.10.0 255.255.255.0 10.0.12.1');
    expect(pcsSeeEachOther(r2.net)).toBe(true);
  });

  it('distancia 1 por defecto, otra si se escribe, e interfaz de salida', () => {
    const t = config(lab(), 'R1');
    t.ok('ip route 172.16.0.0 255.255.0.0 10.0.12.2');
    t.ok('ip route 172.16.0.0 255.255.0.0 10.0.12.2 200');
    expect(routes(t)).toEqual([{ distance: 200, gateway: 'ip' }]);
    t.ok('ip route 10.9.0.0 255.255.0.0 g0/0');
    t.ok('ip route 10.8.0.0 255.255.0.0 GigabitEthernet0/0 10.0.12.2');
    t.ok('ip route 10.7.0.0 255.255.0.0 Null0');
    expect(routes(t).map((r) => r.gateway)).toEqual(['ip', 'iface', 'ip-iface', 'blackhole']);
    const run = t.ok('do show running-config | include ip route');
    expect(run.split('\n')).toEqual([
      'ip route 10.7.0.0 255.255.0.0 Null0',
      'ip route 10.8.0.0 255.255.0.0 GigabitEthernet0/0 10.0.12.2',
      'ip route 10.9.0.0 255.255.0.0 GigabitEthernet0/0',
      'ip route 172.16.0.0 255.255.0.0 10.0.12.2 200',
    ]);
  });

  it('rechaza bits de host en el destino y el propio router como siguiente salto', () => {
    const t = config(lab(), 'R1');
    expect(t.run('ip route 192.168.20.1 255.255.255.0 10.0.12.2')).toBe(
      '%Inconsistent address and mask',
    );
    expect(t.run('ip route 192.168.20.0 255.255.255.0 10.0.12.1')).toBe(
      "%Invalid next hop address (it's this router)",
    );
    expect(t.run('ip route 192.168.20.0 255.255.255.0')).toBe('% Incomplete command.');
  });

  it('no ip route borra la ruta y avisa si no existe', () => {
    const t = config(lab(), 'R1');
    t.ok('ip route 0.0.0.0 0.0.0.0 10.0.12.2');
    expect(t.run('no ip route 0.0.0.0 0.0.0.0 10.0.12.9')).toBe('%No matching route to delete');
    t.ok('no ip route 0.0.0.0 0.0.0.0');
    expect(routes(t)).toEqual([]);
  });

  it('la ruta por defecto queda activa por el vecino', () => {
    const t = config(lab(), 'R1');
    t.ok('ip route 0.0.0.0 0.0.0.0 10.0.12.2');
    expect(
      evaluate(
        {
          kind: 'routeActive',
          device: deviceId('R1'),
          dst: prefix('0.0.0.0/0'),
          via: { ip: ipv4('10.0.12.2') },
        },
        ctxOf(t.net),
      ),
    ).toBe(true);
  });
});

describe('show ip route', () => {
  it('sin ruta por defecto: Gateway of last resort is not set y las C/L agrupadas', () => {
    const t = config(lab(), 'R1');
    const out = t.ok('do show ip route');
    expect(out).toContain('Codes: L - local, C - connected, S - static');
    expect(out).toContain('Gateway of last resort is not set');
    expect(out).toContain(
      [
        '      10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks',
        'C        10.0.12.0/30 is directly connected, GigabitEthernet0/0',
        'L        10.0.12.1/32 is directly connected, GigabitEthernet0/0',
        '      192.168.10.0/24 is variably subnetted, 2 subnets, 2 masks',
        'C        192.168.10.0/24 is directly connected, GigabitEthernet0/1',
        'L        192.168.10.1/32 is directly connected, GigabitEthernet0/1',
      ].join('\n'),
    );
  });

  it('las estáticas salen con [distancia/métrica] y la por defecto con S*', () => {
    const t = config(lab(), 'R1');
    t.ok('ip route 0.0.0.0 0.0.0.0 10.0.12.2');
    t.ok('ip route 192.168.20.0 255.255.255.0 10.0.12.2');
    const out = t.ok('do sh ip route');
    expect(out).toContain('Gateway of last resort is 10.0.12.2 to network 0.0.0.0');
    expect(out).toContain('S*    0.0.0.0/0 [1/0] via 10.0.12.2');
    expect(out).toContain('S     192.168.20.0/24 [1/0] via 10.0.12.2');
    expect(t.ok('do show ip route static').split('\n')).toEqual([
      'S*    0.0.0.0/0 [1/0] via 10.0.12.2',
      'S     192.168.20.0/24 [1/0] via 10.0.12.2',
    ]);
  });

  it('una ruta con siguiente salto inalcanzable no aparece en la tabla', () => {
    const t = config(lab(), 'R1');
    t.ok('ip route 172.16.0.0 255.255.0.0 10.99.0.1');
    expect(t.ok('do show ip route')).not.toContain('172.16.0.0');
  });
});

describe('ping y traceroute', () => {
  it('ping con !!!!! y su tasa de éxito, o ..... si no hay camino', () => {
    const r1 = config(lab(), 'R1');
    r1.ok('end');
    const fail = r1.ok('ping 192.168.20.10');
    expect(fail).toContain(
      'Sending 5, 100-byte ICMP Echos to 192.168.20.10, timeout is 2 seconds:',
    );
    expect(fail).toContain('\n.....\nSuccess rate is 0 percent (0/5)');
    r1.script(['conf t', 'ip route 192.168.20.0 255.255.255.0 10.0.12.2', 'end']);
    const r2 = config(r1.net, 'R2');
    r2.script(['ip route 192.168.10.0 255.255.255.0 10.0.12.1']);
    const back = new IosTerminal(r2.net, 'R1');
    back.ok('enable');
    const okPing = back.ok('ping 192.168.20.10 repeat 3 source g0/1');
    expect(okPing).toContain('Packet sent with a source address of 192.168.10.1');
    expect(okPing).toMatch(
      /\n!!!\nSuccess rate is 100 percent \(3\/3\), round-trip min\/avg\/max = /,
    );
    expect(back.run('ping 192.168.20.10 source 1.2.3.4')).toBe(
      '% Invalid source address- IP address not on any of our up interfaces',
    );
    expect(back.run('ping noexiste')).toBe(
      '% Unrecognized host or address, or protocol not running.',
    );
    const tr = back.ok('traceroute 192.168.20.10');
    expect(tr).toContain('Tracing the route to 192.168.20.10');
    expect(tr).toContain('  1 10.0.12.2 ');
  });
});
