import { deviceId, type EvalContext, evaluate, ipv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/**
 * R1 con IOS: PC1 en Gi0/1 (192.168.1.10/24, puerta .1) y Gi0/0 hacia un ISP
 * en 203.0.113.2/24, con ruta por defecto. Interfaces, direcciones y ruta las
 * pone el constructor: aquí solo se prueban las ACL y el NAT.
 */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .cloud('ISP')
    .link('R1:GigabitEthernet0/0', 'ISP:eth0')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP')
    .enable('R1', 'GigabitEthernet0/0')
    .enable('R1', 'GigabitEthernet0/1')
    .address('R1', 'GigabitEthernet0/0', '203.0.113.2/24')
    .address('R1', 'GigabitEthernet0/1', '192.168.1.1/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

const term = () => new IosTerminal(lab(), 'R1').script(['enable', 'configure terminal']);
const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });

const natToInternet = (network: Network) =>
  evaluate(
    {
      kind: 'natSourceIs',
      from: deviceId('PC1'),
      to: { ip: ipv4('93.184.216.34') },
      protocol: 'tcp',
      port: 443,
      expect: { addressOf: { device: deviceId('R1'), iface: { name: 'GigabitEthernet0/0' } } },
    },
    ctxOf(network),
  );

const PAT = [
  'access-list 1 permit 192.168.1.0 0.0.0.255',
  'interface g0/1',
  'ip nat inside',
  'interface g0/0',
  'ip nat outside',
  'exit',
  'ip nat inside source list 1 interface GigabitEthernet0/0 overload',
];

describe('access-list estándar', () => {
  it('guarda permit y deny con su secuencia y los muestra como IOS', () => {
    const t = term();
    t.ok('access-list 1 permit 192.168.1.0 0.0.0.255');
    t.ok('access-list 1 deny host 192.168.1.66');
    t.ok('access-list 1 permit 10.1.1.1');
    t.ok('access-list 1 permit any');
    // La misma línea dos veces no se duplica.
    t.ok('access-list 1 permit any');
    expect(t.ok('do show access-lists')).toBe(
      [
        'Standard IP access list 1',
        '    10 permit 192.168.1.0, wildcard bits 0.0.0.255',
        '    20 deny 192.168.1.66',
        '    30 permit 10.1.1.1',
        '    40 permit any',
      ].join('\n'),
    );
    expect(t.ok('do sh run | i access-list').split('\n')).toEqual([
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'access-list 1 deny 192.168.1.66',
      'access-list 1 permit 10.1.1.1',
      'access-list 1 permit any',
    ]);
    t.ok('no access-list 1');
    expect(t.ok('do show access-lists')).toBe('');
  });

  it('una ACL extendida o un comodín con huecos no se aceptan', () => {
    const t = term();
    expect(t.run('access-list 100 permit ip any any')).toContain(
      "% Invalid input detected at '^' marker.",
    );
    expect(t.run('access-list 1 permit 10.0.0.0 0.255.0.255')).toContain('^');
  });
});

describe('NAT con sobrecarga (PAT)', () => {
  it('la PC sale con la IP de la WAN', () => {
    const t = term();
    expect(natToInternet(t.net)).toBe(false);
    t.script(PAT);
    expect(natToInternet(t.net)).toBe(true);
    const run = t.ok('do show running-config');
    expect(run).toContain(
      'interface GigabitEthernet0/0\n ip address 203.0.113.2 255.255.255.0\n ip nat outside\n',
    );
    expect(run).toContain(
      'interface GigabitEthernet0/1\n ip address 192.168.1.1 255.255.255.0\n ip nat inside\n',
    );
    expect(run).toContain('\nip nat inside source list 1 interface GigabitEthernet0/0 overload\n');
  });

  it('sin ip nat inside en la LAN no se traduce nada', () => {
    const t = term();
    t.script(PAT.filter((l) => l !== 'ip nat inside'));
    expect(natToInternet(t.net)).toBe(false);
  });

  it('sin ip nat outside en la WAN tampoco', () => {
    const t = term();
    t.script(PAT.filter((l) => l !== 'ip nat outside'));
    expect(natToInternet(t.net)).toBe(false);
  });

  it('una ACL que no cubre la LAN deja a la PC sin traducir', () => {
    const t = term();
    t.script(['access-list 1 permit 10.0.0.0 0.255.255.255', ...PAT.slice(1)]);
    expect(natToInternet(t.net)).toBe(false);
  });

  it('inside y outside se excluyen en la misma interfaz', () => {
    const t = term();
    t.script(['int g0/1', 'ip nat inside', 'ip nat outside']);
    expect(t.ok('do sh run | include ip nat')).toBe(' ip nat outside');
    t.ok('no ip nat outside');
    expect(t.ok('do sh run | include ip nat')).toBe('');
  });

  it('no ip nat inside source list quita la traducción', () => {
    const t = term();
    t.script(PAT);
    t.ok('no ip nat inside source list 1 interface g0/0 overload');
    expect(natToInternet(t.net)).toBe(false);
    expect(t.run('no ip nat inside source list 1 interface g0/0 overload')).toBe(
      '%Dynamic mapping not found',
    );
  });

  it('show ip nat translations sale con las columnas de IOS; el tráfico del propio router no se traduce', () => {
    const t = term();
    t.script([...PAT, 'end']);
    expect(t.ok('ping 8.8.8.8')).toContain('Success rate is 100 percent');
    expect(t.ok('show ip nat translations')).toBe(
      'Pro Inside global         Inside local          Outside local         Outside global',
    );
  });
});
