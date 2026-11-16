import { deviceId, type EvalContext, evaluate, formatIpv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/** R1 hacia un ISP que resuelve example.com, y PC1 que pregunta los nombres a R1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .cloud('ISP')
    .link('R1:GigabitEthernet0/0', 'ISP:eth0')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .enable('R1', 'GigabitEthernet0/0')
    .enable('R1', 'GigabitEthernet0/1')
    .address('R1', 'GigabitEthernet0/0', '203.0.113.2/24')
    .address('R1', 'GigabitEthernet0/1', '192.168.1.1/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .dns('PC1', ['192.168.1.1'])
    .build();
}

const term = () => new IosTerminal(lab(), 'R1').script(['enable', 'configure terminal']);
const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });
const pcResolves = (network: Network) =>
  evaluate(
    { kind: 'resolves', from: deviceId('PC1'), name: 'example.com', via: deviceId('R1') },
    ctxOf(network),
  );

describe('DNS del router', () => {
  it('ip name-server da al router a quién preguntar y ping resuelve el nombre', () => {
    const t = term();
    t.ok('end');
    expect(t.run('ping example.com')).toBe(
      '% Unrecognized host or address, or protocol not running.',
    );
    t.script(['conf t', 'ip name-server 8.8.8.8', 'end']);
    expect(t.device.config.dns.servers.map(formatIpv4)).toEqual(['8.8.8.8']);
    const out = t.ok('ping example.com');
    expect(out).toContain('Translating "example.com"...domain server (8.8.8.8) [OK]');
    expect(out).toContain('ICMP Echos to 93.184.216.34');
  });

  it('ip dns server hace al router el DNS de la LAN', () => {
    const t = term();
    t.ok('ip name-server 8.8.8.8');
    expect(pcResolves(t.net)).toBe(false);
    t.ok('ip dns server');
    expect(pcResolves(t.net)).toBe(true);
    const run = t.ok('do show running-config');
    expect(run).toContain('\nip name-server 8.8.8.8\n');
    expect(run).toContain('\nip dns server\n');
    t.ok('no ip dns server');
    expect(pcResolves(t.net)).toBe(false);
  });

  it('varios servidores en una línea, y no ip name-server los quita', () => {
    const t = term();
    t.ok('ip name-server 8.8.8.8 1.1.1.1');
    t.ok('ip name-server 8.8.8.8');
    expect(t.device.config.dns.servers.map(formatIpv4)).toEqual(['8.8.8.8', '1.1.1.1']);
    t.ok('no ip name-server 8.8.8.8');
    expect(t.device.config.dns.servers.map(formatIpv4)).toEqual(['1.1.1.1']);
    t.ok('no ip name-server');
    expect(t.device.config.dns.servers).toEqual([]);
  });

  it('ip host, el dominio y show hosts', () => {
    const t = term();
    t.script(['ip host servidor 192.168.1.50', 'ip domain-name lab.local', 'end']);
    const pinged = t.ok('ping servidor repeat 1');
    expect(pinged).toContain('ICMP Echos to 192.168.1.50');
    // Un nombre de `ip host` no se pregunta al DNS: no sale la línea Translating.
    expect(pinged).not.toContain('Translating');
    const hosts = t.ok('show hosts');
    expect(hosts).toContain('Default domain is lab.local');
    expect(hosts).toContain('servidor                  None  (perm, OK) 0   IP     192.168.1.50');
    expect(t.ok('sh run | i ip (host|domain)').split('\n')).toEqual([
      'ip domain name lab.local',
      'ip host servidor 192.168.1.50',
    ]);
  });
});
