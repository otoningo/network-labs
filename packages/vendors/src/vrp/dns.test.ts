import { deviceId, formatIpv4, type Network, resolveName } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/**
 * R1 con VRP: GE0/0/0 hacia Internet (con DNS emulado) y GE0/0/1 hacia PC1,
 * que usa a R1 como servidor DNS.
 */
function lab(): Network {
  return net()
    .cloud('ISP')
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .link('ISP:eth0', 'R1:GigabitEthernet0/0/0')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('R1', 'GigabitEthernet0/0/0', '203.0.113.2/24')
    .address('R1', 'GigabitEthernet0/0/1', '192.168.1.1/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .dns('PC1', ['192.168.1.1'])
    .build();
}

const term = () => new VrpTerminal(lab(), 'R1');
const servers = (t: VrpTerminal) => t.device.config.dns.servers.map(formatIpv4);

describe('dns server', () => {
  it('añade y quita servidores, sin repetirlos', () => {
    const t = term();
    t.ok('system-view');
    t.ok('dns server 8.8.8.8');
    t.ok('dns server 1.1.1.1');
    t.ok('dns server 8.8.8.8');
    expect(servers(t)).toEqual(['8.8.8.8', '1.1.1.1']);
    t.ok('undo dns server 8.8.8.8');
    expect(servers(t)).toEqual(['1.1.1.1']);
    expect(t.run('undo dns server 9.9.9.9')).toBe('Error: The DNS server does not exist.');
  });

  it('admite hasta seis servidores', () => {
    const t = term();
    t.ok('system-view');
    for (let i = 1; i <= 6; i++) t.ok(`dns server 10.0.0.${i}`);
    expect(t.run('dns server 10.0.0.7')).toBe(
      'Error: The number of DNS servers has reached the upper limit.',
    );
    expect(servers(t)).toHaveLength(6);
  });
});

describe('dns resolve', () => {
  it('se imprime cuando hay servidores y undo dns resolve los quita', () => {
    const t = term();
    t.ok('system-view');
    t.ok('dns resolve');
    expect(t.ok('display current-configuration')).not.toContain('dns resolve');
    t.ok('dns server 8.8.8.8');
    expect(t.ok('display current-configuration')).toContain(
      '#\n sysname Huawei\n#\n dns resolve\n dns server 8.8.8.8\n#',
    );
    t.ok('undo dns resolve');
    expect(servers(t)).toEqual([]);
    expect(t.ok('display current-configuration')).not.toContain('dns');
  });
});

describe('dns proxy enable', () => {
  it('deja que el router responda a la LAN', () => {
    const t = term();
    t.ok('system-view');
    t.ok('dns proxy enable');
    expect(t.device.config.dns.allowRemoteRequests).toBe(true);
    t.ok('dns server 8.8.8.8');
    // El bloque de DNS va antes que dhcp enable, como en VRP.
    t.ok('dhcp enable');
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain(
      '#\n dns resolve\n dns server 8.8.8.8\n dns proxy enable\n#\n dhcp enable\n#',
    );
    t.ok('undo dns proxy enable');
    expect(t.device.config.dns.allowRemoteRequests).toBe(false);
    expect(t.ok('display current-configuration')).not.toContain('proxy');
  });
});

describe('display dns server', () => {
  it('lista los servidores estáticos', () => {
    const t = term();
    t.script(['system-view', 'dns server 8.8.8.8', 'dns server 1.1.1.1', 'return']);
    expect(t.ok('display dns server')).toBe(
      [
        'Type:',
        'D:Dynamic    S:Static',
        '',
        'No.  Type  IP Address',
        '1    S     8.8.8.8',
        '2    S     1.1.1.1',
      ].join('\n'),
    );
  });
});

describe('extremo a extremo', () => {
  it('R1 hace ping por nombre cuando tiene servidor DNS', () => {
    const t = term();
    expect(t.run('ping -c 1 example.com')).toBe('Error: The host name is invalid or unreachable.');
    t.script(['system-view', 'dns resolve', 'dns server 8.8.8.8', 'return']);
    const out = t.ok('ping -c 2 example.com');
    expect(out).toContain('PING example.com: 56  data bytes');
    expect(out).toContain('Reply from 93.184.216.34');
    expect(out).toContain('2 packet(s) received');
  });

  it('PC1 resuelve a través de R1 solo con dns proxy enable', () => {
    const t = term();
    t.script(['system-view', 'dns server 8.8.8.8']);
    expect(resolveName(t.net, deviceId('PC1'), 'example.com').outcome).not.toBe('answered');
    t.ok('dns proxy enable');
    const answer = resolveName(t.net, deviceId('PC1'), 'example.com');
    expect(answer.outcome).toBe('answered');
    expect(answer.address === undefined ? '' : formatIpv4(answer.address)).toBe('93.184.216.34');
  });
});
