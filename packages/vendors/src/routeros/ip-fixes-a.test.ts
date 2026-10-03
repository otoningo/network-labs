/**
 * Menús de /ip y Torch tras los arreglos de la batería de labs: check-gateway,
 * /ip pool used, borrar leases dinámicos, listas temporales, reset-counters-all,
 * connection-nat-state, hw-offload, el orden de print en NAT, dst-nat solo de
 * puerto, los filtros de Torch y el comentario del usuario de fábrica.
 */
import { deviceId, formatIpv4, ipv4, type Network, ping, tick, trace } from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

/** R1 con el ISP en ether1 (DHCP) y tres PCs en DHCP en ether2-4. */
function topology(options: { flows?: boolean } = {}): Network {
  const builder = net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .host('PC3')
    .cloud('ISP')
    .link('R1:ether1', 'ISP:eth0')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .link('R1:ether4', 'PC3:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .dhcpServer('ISP', {
      iface: 'eth0',
      pool: '203.0.113.10-203.0.113.20',
      network: '203.0.113.0/24',
      gateway: '203.0.113.1',
      dns: ['1.1.1.1'],
    })
    .dhcpClient('PC1', 'eth0')
    .dhcpClient('PC2', 'eth0')
    .dhcpClient('PC3', 'eth0');
  if (options.flows) {
    builder
      .flow({
        id: 'descarga',
        from: 'PC1',
        to: '93.184.216.34',
        protocol: 'tcp',
        dstPort: 443,
        bps: 200_000,
        replyBps: 8_000_000,
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
  }
  return builder.build();
}

const LAN = (ranges: string): readonly string[] => [
  '/interface bridge add name=bridge1',
  '/interface bridge port add bridge=bridge1 interface=ether2',
  '/interface bridge port add bridge=bridge1 interface=ether3',
  '/interface bridge port add bridge=bridge1 interface=ether4',
  '/ip address add address=192.168.88.1/24 interface=bridge1',
  `/ip pool add name=pool-lan ranges=${ranges}`,
  '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
  '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
  '/ip dhcp-client add interface=ether1',
  '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
];

const office = (ranges = '192.168.88.10-192.168.88.254', flows = false) =>
  new Terminal(topology({ flows }), 'R1').script(LAN(ranges));

const macOf = (t: Terminal, id: string) =>
  deviceIn(t.net, id).config.interfaces.find((i) => i.name === 'eth0')?.mac ?? '';

const wanIp = (t: Terminal): string => {
  const address = t.device.oper.dhcpClients[0]?.address;
  return address ? formatIpv4(address.ip) : '';
};

/** Bloque `N` de un print detail, en una sola línea. */
const block = (output: string, n: number): string =>
  output
    .split('\n\n')
    .map((b) => b.trim().replace(/\n\s+/g, ' '))
    .find((b) => b.startsWith(`${n} `)) ?? '';

// ── /ip route check-gateway ─────────────────────────────────────────────────

describe('/ip route check-gateway', () => {
  it('se muestra en detalle, se exporta y desactiva la ruta si el gateway no responde', () => {
    const t = office();
    t.ok('/ip route add dst-address=10.9.0.0/16 gateway=192.168.88.200 check-gateway=ping');
    t.ok('/ip route add dst-address=10.9.0.0/16 gateway=192.168.88.1 distance=2');
    const detail = t.ok('/ip route print detail where dst-address=10.9.0.0/16');
    expect(detail).toContain('check-gateway=ping');
    // Nadie tiene 192.168.88.200: la ruta queda inactiva y manda la de respaldo.
    expect(t.ok('/ip route print where dst-address=10.9.0.0/16')).toMatch(
      /^0 Is 10\.9\.0\.0\/16\s+192\.168\.88\.200/m,
    );
    expect(t.ok('/ip route export')).toContain(
      'add check-gateway=ping dst-address=10.9.0.0/16 gateway=192.168.88.200',
    );
    // none o unset la quitan.
    t.ok('/ip route set 0 check-gateway=none');
    expect(t.device.config.routing.static[0]?.checkGateway).toBeUndefined();
    t.ok('/ip route set 0 check-gateway=arp');
    expect(t.device.config.routing.static[0]?.checkGateway).toBe('arp');
    t.ok('/ip route unset 0 check-gateway');
    expect(t.device.config.routing.static[0]?.checkGateway).toBeUndefined();
    expect(t.ok('/ip route print detail')).not.toContain('check-gateway');
  });

  it('un gateway que responde deja la ruta activa', () => {
    const t = office();
    t.ok('/ip route add dst-address=10.9.0.0/16 gateway=192.168.88.254 check-gateway=ping');
    expect(t.ok('/ip route print where dst-address=10.9.0.0/16')).toMatch(/^0 As /m);
  });
});

// ── DHCP: pool agotado, /ip pool used, leases ───────────────────────────────

describe('DHCP: pool used, aviso de pool vacío y borrado de leases', () => {
  it('/ip pool used lista lo entregado con el pool, la MAC y el servidor', () => {
    const t = office('192.168.88.100-192.168.88.101');
    expect(t.ok('/ip pool used print').split('\n')).toEqual([
      'Columns: POOL, ADDRESS, OWNER, INFO',
      '# POOL      ADDRESS         OWNER              INFO',
      `0 pool-lan  192.168.88.101  ${macOf(t, 'PC1')}  dhcp1`,
      `1 pool-lan  192.168.88.100  ${macOf(t, 'PC2')}  dhcp1`,
    ]);
  });

  it('el aviso de pool vacío aparece una sola vez aunque se sigan cambiando cosas', () => {
    const t = office('192.168.88.100-192.168.88.101');
    t.ok('/system identity set name=Oficina');
    t.ok('/ip dns set servers=1.1.1.1');
    const warnings = t
      .ok('/log print')
      .split('\n')
      .filter((l) => l.includes('is empty'));
    expect(warnings).toEqual([
      ' 09:00:00 dhcp,warning dhcp1 failed to give out IP address: pool <pool-lan> is empty',
    ]);
  });

  it('borrar un lease dinámico lo libera y el cliente vuelve a pedir', () => {
    const t = office();
    t.ok(`/ip dhcp-server lease add address=192.168.88.50 mac-address=${macOf(t, 'PC3')}`);
    const before = t.device.oper.dhcpLeases.length;
    const assigned = () =>
      t
        .ok('/log print')
        .split('\n')
        .filter((l) => l.includes(`assigned 192.168.88.254 for ${macOf(t, 'PC1')}`)).length;
    expect(assigned()).toBe(1);
    t.ok('/ip dhcp-server lease print');
    t.ok('/ip dhcp-server lease remove [find host-name=PC1]');
    // El lease se libera y el cliente lo vuelve a pedir: queda una segunda asignación en el log.
    expect(assigned()).toBe(2);
    expect(t.device.oper.dhcpLeases).toHaveLength(before);
    expect(deviceIn(t.net, 'PC1').oper.dhcpClients[0]?.status).toBe('bound');
    // Un lease estático se borra de la configuración, como siempre.
    t.ok('/ip dhcp-server lease remove [find address=192.168.88.50]');
    expect(t.device.config.dhcpServer.staticLeases).toEqual([]);
    expect(t.device.oper.dhcpLeases.some((l) => formatIpv4(l.ip) === '192.168.88.50')).toBe(false);
  });

  it('sin dns-server la red entrega los DNS del router', () => {
    const t = new Terminal(topology(), 'R1').script(
      LAN('192.168.88.10-192.168.88.254').map((line) =>
        line.startsWith('/ip dhcp-server network')
          ? '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1'
          : line,
      ),
    );
    t.ok('/ip dns set servers=9.9.9.9');
    expect(deviceIn(t.net, 'PC1').oper.dhcpClients[0]?.dns.map(formatIpv4)).toEqual([
      '9.9.9.9',
      '1.1.1.1',
    ]);
  });
});

// ── /ip firewall address-list con timeout ───────────────────────────────────

describe('/ip firewall address-list con timeout', () => {
  it('la entrada temporal sale como dinámica, cuenta hacia atrás y no se exporta', () => {
    const t = office().script([
      '/ip firewall address-list add list=castigo address=192.168.88.253 timeout=1m',
      '/ip firewall address-list add list=fija address=192.168.88.100',
    ]);
    expect(t.ok('/ip firewall address-list print').split('\n')).toEqual([
      'Flags: D - DYNAMIC',
      'Columns: LIST, ADDRESS, CREATION-TIME, TIMEOUT',
      '#   LIST     ADDRESS         CREATION-TIME        TIMEOUT',
      '0 D castigo  192.168.88.253  2026-01-05 09:00:00  1m',
      '1   fija     192.168.88.100  2026-01-05 09:00:00',
    ]);
    expect(t.ok('/ip firewall address-list export')).not.toContain('castigo');
    t.net = tick(t.net, 20);
    expect(t.ok('/ip firewall address-list print')).toMatch(
      /castigo\s+192\.168\.88\.253\s.*\s40s$/m,
    );
    // Cambiar otra cosa no reinicia el plazo; cambiar el timeout sí.
    t.ok('/ip firewall address-list set 0 comment=prueba');
    expect(t.ok('/ip firewall address-list print')).toMatch(/\s40s$/m);
    t.ok('/ip firewall address-list set 0 timeout=5m');
    expect(t.ok('/ip firewall address-list print')).toMatch(/\s5m$/m);
    t.net = tick(t.net, 299);
    expect(t.ok('/ip firewall address-list print')).toContain('castigo');
    t.net = tick(t.net, 1);
    expect(t.ok('/ip firewall address-list print')).not.toContain('castigo');
    expect(t.ok('/ip firewall address-list print')).toContain('fija');
  });
});

// ── /ip firewall filter y nat ───────────────────────────────────────────────

describe('/ip firewall: contadores, connection-nat-state y hw-offload', () => {
  it('reset-counters-all en nat solo toca las reglas de nat', () => {
    const t = office().script(['/ip firewall filter add chain=forward action=accept']);
    t.net = ping(t.net, deviceId('PC1'), ipv4('8.8.8.8'), { count: 2 }).net;
    const counted = (coll: 'filter' | 'nat') => {
      const ids = new Set(t.device.config.firewall[coll].map((r) => r.id));
      return t.device.oper.ruleCounters.filter((c) => ids.has(c.rule) && c.packets > 0).length;
    };
    expect([counted('filter'), counted('nat')]).toEqual([1, 1]);
    const before = t.ok('/ip firewall filter print stats');
    t.ok('/ip firewall nat reset-counters-all');
    expect([counted('filter'), counted('nat')]).toEqual([1, 0]);
    expect(t.ok('/ip firewall filter print stats')).toBe(before);
    t.ok('/ip firewall filter reset-counters-all');
    expect(counted('filter')).toBe(0);
  });

  it('connection-nat-state=!dstnat deja pasar solo los port forward desde la WAN', () => {
    const t = office().script([
      '/ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=8080 action=dst-nat to-addresses=192.168.88.254 to-ports=8291',
      '/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface=ether1',
    ]);
    const rule = t.device.config.firewall.filter[0];
    expect(rule?.match.connectionNatState).toEqual({ value: ['dstnat'], negate: true });
    expect(block(t.ok('/ip firewall filter print'), 0)).toContain('connection-nat-state=!dstnat');
    expect(t.ok('/ip firewall filter export')).toContain('connection-nat-state=!dstnat');
    const fromWan = (dst: string, port: number) =>
      trace(t.net, {
        from: deviceId('ISP'),
        src: ipv4('198.51.100.7'),
        dst: ipv4(dst),
        protocol: 'tcp',
        dstPort: port,
      });
    // El port forward llega al PC (aunque nadie escuche en 8291, el filtro no lo para).
    expect(fromWan(wanIp(t), 8080).forward.end).toMatchObject({ kind: 'port-closed' });
    t.ok('/ip firewall filter set 0 connection-nat-state=dstnat');
    expect(fromWan(wanIp(t), 8080).forward.end).toMatchObject({
      kind: 'filtered',
      chain: 'forward',
    });
    t.ok('/ip firewall filter unset 0 connection-nat-state');
    expect(t.device.config.firewall.filter[0]?.match.connectionNatState).toBeUndefined();
  });

  it('hw-offload se guarda, se muestra tras la acción y se exporta', () => {
    const t = office();
    t.ok(
      '/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes',
    );
    expect(t.device.config.firewall.filter[0]?.hwOffload).toBe(true);
    expect(block(t.ok('/ip firewall filter print'), 0)).toMatch(
      /chain=forward action=fasttrack-connection hw-offload=yes connection-state=established,related/,
    );
    const exported = t.ok('/ip firewall filter export');
    expect(exported.replace(/ \\\n\s+/g, ' ')).toContain(
      'add action=fasttrack-connection chain=forward connection-state=established,related hw-offload=yes',
    );
    // Sin hw-offload no aparece ni en print ni en export.
    t.ok('/ip firewall filter add chain=forward action=accept');
    expect(block(t.ok('/ip firewall filter print'), 1)).not.toContain('hw-offload');
  });
});

describe('/ip firewall nat: orden de print y dst-nat solo de puerto', () => {
  it('to-addresses y to-ports van justo después de action', () => {
    const t = office().script([
      '/ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=8080 action=dst-nat to-addresses=192.168.88.254 to-ports=80',
    ]);
    expect(block(t.ok('/ip firewall nat print'), 1)).toBe(
      '1  chain=dstnat action=dst-nat to-addresses=192.168.88.254 to-ports=80 protocol=tcp dst-port=8080 in-interface=ether1',
    );
  });

  it('dst-nat con solo to-ports traduce el puerto hacia el propio router', () => {
    const t = office();
    t.ok(
      '/ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=2222 action=dst-nat to-ports=22',
    );
    const action = t.device.config.firewall.nat[1]?.action;
    expect(action).toEqual({ kind: 'dstNat', toPorts: [{ from: 22, to: 22 }] });
    expect(t.ok('/ip firewall nat export')).toContain('to-ports=22');
    const result = trace(t.net, {
      from: deviceId('ISP'),
      src: ipv4('198.51.100.7'),
      dst: ipv4(wanIp(t)),
      protocol: 'tcp',
      dstPort: 2222,
    });
    expect(result.ok).toBe(true);
    expect(result.delivered?.dstPort).toBe(22);
    expect(result.delivered && formatIpv4(result.delivered.dst)).toBe(wanIp(t));
    // Sin to-addresses ni to-ports sigue siendo un error.
    expect(
      t.run('/ip firewall nat add chain=dstnat protocol=tcp dst-port=2223 action=dst-nat'),
    ).toBe('missing value(s) of argument(s) to-addresses');
  });
});

// ── Torch ───────────────────────────────────────────────────────────────────

describe('/tool torch con valores en los clasificadores', () => {
  const busy = () => office('192.168.88.10-192.168.88.254', true);

  it('dst-address, port e ip-protocol filtran además de desglosar', () => {
    const t = busy();
    const dst = t.ok('/tool torch interface=bridge1 dst-address=1.1.1.1/32 duration=1s');
    expect(dst).toContain('1.1.1.1');
    expect(dst).not.toContain('93.184.216.34');
    const port = t.ok('/tool torch interface=bridge1 port=443 duration=1s');
    expect(port.split('\n')[0]).toBe('Columns: SRC-PORT, DST-PORT, TX, RX, TX-PACKETS, RX-PACKETS');
    expect(port).toContain('443');
    expect(port).not.toMatch(/\s53\s/);
    const https = t.ok('/tool torch interface=bridge1 port=https duration=1s');
    expect(https).toBe(port);
    const udp = t.ok('/tool torch interface=bridge1 ip-protocol=udp duration=1s').split('\n');
    expect(udp.slice(2)).toEqual([
      expect.stringMatching(/^udp\s+4\.0kbps\s+2\.0kbps/),
      expect.stringMatching(/^\s+4\.0kbps\s+2\.0kbps/),
    ]);
    // any = todo; un protocolo desconocido no coincide con nada.
    expect(t.ok('/tool torch interface=bridge1 ip-protocol=any duration=1s')).toContain('tcp');
    expect(
      t.ok('/tool torch interface=bridge1 ip-protocol=gre duration=1s').split('\n').at(-1),
    ).toMatch(/^\s+0bps\s+0bps\s+0\s+0$/);
  });
});

// ── Usuario de fábrica ──────────────────────────────────────────────────────

describe('/user de fábrica', () => {
  it('admin lleva el comentario system default user', () => {
    const t = new Terminal(topology(), 'R1');
    expect(t.device.config.system.users[0]?.comment).toBe('system default user');
    expect(t.ok('/user print detail')).toContain(';;; system default user');
  });
});
