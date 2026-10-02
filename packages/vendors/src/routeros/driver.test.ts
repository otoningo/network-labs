import { formatIpv4, formatPrefix, ipv4, loadLab, type Network, trace } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { routerosStartup } from './driver';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

/** R1 con su plataforma real, una PC en ether2 y otra en ether3. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .cloud('ISP')
    .link('R1:ether1', 'ISP:eth0')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
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
    .build();
}

const term = () => new Terminal(lab(), 'R1');

const addresses = (t: Terminal) =>
  t.device.config.addressing.addresses.map((a) => formatPrefix(a.address));

describe('navegación y prompt', () => {
  it('muestra el prompt de v7 y entra y sale de menús', () => {
    const t = term();
    expect(t.prompt).toBe('[admin@MikroTik] > ');
    t.ok('/ip address');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/address> ');
    t.ok('..');
    expect(t.prompt).toBe('[admin@MikroTik] /ip> ');
    t.ok('firewall filter');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/firewall/filter> ');
    t.ok('/');
    expect(t.prompt).toBe('[admin@MikroTik] > ');
    t.ok('/ip/dns');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/dns> ');
  });

  it('acepta ruta completa, contexto, forma con barras y abreviaturas', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip address');
    t.ok('add address=10.0.1.1/24 interface=ether3');
    t.ok('/ip/address/add address=10.0.2.1/24 interface=ether4');
    t.ok('/ip addr add addr=10.0.3.1/255.255.255.0 int=ether5');
    expect(addresses(t)).toEqual(['10.0.0.1/24', '10.0.1.1/24', '10.0.2.1/24', '10.0.3.1/24']);
  });

  it('ejecuta varios comandos en una línea', () => {
    const t = term();
    t.ok('/system identity set name=Oficina; /ip address add address=10.9.0.1/24 interface=ether2');
    expect(t.device.config.system.identity).toBe('Oficina');
    expect(t.prompt).toBe('[admin@Oficina] > ');
    expect(addresses(t)).toEqual(['10.9.0.1/24']);
  });
});

describe('errores con la voz de RouterOS', () => {
  it.each([
    ['/ip adress print', 'bad command name adress (line 1 column 5)'],
    [
      '/ip address add address=10.0.0.1/24 interface=ether2 color=red',
      'expected end of command (line 1 column 54)',
    ],
    [
      '/ip address add address=10.0.0.1/24 interface=ether9',
      'input does not match any value of interface',
    ],
    [
      '/ip address add address=10.0.0.300/24 interface=ether2',
      'invalid value for argument address',
    ],
    ['/ip address add address=10.0.0.1/24', 'missing value(s) of argument(s) interface'],
    [
      '/interface vlan add name=v interface=ether1 vlan-id=5000',
      'value of vlan-id out of range (1..4094)',
    ],
    ['/ip address set 7 comment=x', 'no such item'],
  ])('%s', (line, message) => {
    const t = term();
    expect(t.run(line)).toBe(message);
    expect(t.last?.ok).toBe(false);
  });

  it('rechaza duplicados con el mensaje del equipo', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    expect(t.run('/ip address add address=10.0.0.1/24 interface=ether2')).toBe(
      'failure: already have such address',
    );
    t.ok('/interface bridge add name=br');
    t.ok('/interface bridge port add bridge=br interface=ether2');
    expect(t.run('/interface bridge port add bridge=br interface=ether2')).toBe(
      'failure: device already added as bridge port',
    );
  });
});

describe('ítems: números, nombres, find', () => {
  it('usa los números del último print', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip address add address=10.0.1.1/24 interface=ether3');
    const printed = t.ok('/ip address print');
    expect(printed).toContain('10.0.0.1/24');
    t.ok('/ip address set 1 comment=LAN2');
    t.ok('/ip address disable 0');
    expect(t.device.config.addressing.addresses.map((a) => [a.disabled, a.comment])).toEqual([
      [true, undefined],
      [false, 'LAN2'],
    ]);
    t.ok('/ip address remove 0');
    expect(addresses(t)).toEqual(['10.0.1.1/24']);
  });

  it('acepta nombres, ids internos y [find]', () => {
    const t = term();
    t.ok('/interface set ether1 name=ether1-wan comment=WAN');
    expect(t.device.config.interfaces[0]?.name).toBe('ether1-wan');
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip address add address=10.0.1.1/24 interface=ether3');
    t.ok('/ip address set [find interface=ether3] comment=tres');
    t.ok('/ip address disable [find where address~"10.0.0"]');
    const list = t.device.config.addressing.addresses;
    expect(list.map((a) => a.comment)).toEqual([undefined, 'tres']);
    expect(list.map((a) => a.disabled)).toEqual([true, false]);
    const id = list[1]?.id ?? 0;
    t.ok(`/ip address remove *${id.toString(16).toUpperCase()}`);
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
    expect(t.ok('/ip address print count-only')).toBe('1');
  });

  it('filtra print con where', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip address add address=10.0.1.1/24 interface=ether3');
    const out = t.ok('/ip address print where interface=ether3');
    expect(out).toContain('10.0.1.1/24');
    expect(out).not.toContain('10.0.0.1/24');
  });

  it('no deja editar filas dinámicas', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip route print');
    expect(t.run('/ip route remove [find dynamic]')).toBe('failure: can not change dynamic');
  });
});

describe('safe mode y undo', () => {
  it('Ctrl+X toma safe mode y Ctrl+D deshace los cambios', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    expect(t.key('ctrl-x')).toBe('[Safe Mode taken]');
    expect(t.prompt).toBe('[admin@MikroTik] <SAFE> ');
    t.ok('/ip address remove 0');
    t.ok('/ip address');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/address<SAFE> ');
    t.key('ctrl-d');
    expect(t.last?.closed).toBe(true);
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
  });

  it('soltar safe mode conserva los cambios', () => {
    const t = term();
    t.key('ctrl-x');
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    expect(t.key('ctrl-x')).toBe('[Safe Mode released]');
    t.ok('/quit');
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
  });

  it('undo y redo', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/ip address add address=10.0.1.1/24 interface=ether3');
    t.ok('/undo');
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
    t.ok('/redo');
    expect(addresses(t)).toEqual(['10.0.0.1/24', '10.0.1.1/24']);
    t.ok('/undo');
    t.ok('/undo');
    expect(t.run('/undo')).toBe('failure: nothing to undo');
  });

  it('registra los cambios en el log', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    t.ok('/system identity set name=GW');
    const log = t.ok('/log print');
    expect(log).toContain('address added by admin');
    expect(log).toContain('system identity changed by admin');
  });
});

describe('red de oficina por la CLI', () => {
  const office = () =>
    term().script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2',
      '/interface bridge port add bridge=bridge1 interface=ether3',
      '/ip address add address=192.168.88.1/24 interface=bridge1',
      '/ip pool add name=lan ranges=192.168.88.10-192.168.88.254',
      '/ip dhcp-server add interface=bridge1 address-pool=lan',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
      '/ip dhcp-client add interface=ether1',
    ]);

  it('el DHCP reparte desde la dirección más alta del pool', () => {
    const t = office();
    const pc1 = t.net.devices.find((d) => d.id === 'PC1');
    expect(pc1?.oper.dhcpClients[0]?.address && formatPrefix(pc1.oper.dhcpClients[0].address)).toBe(
      '192.168.88.254/24',
    );
    expect(t.device.config.dhcpServer.servers[0]?.name).toBe('dhcp1');
    expect(t.ok('/ip dhcp-server lease print')).toContain('192.168.88.254');
  });

  it('sin NAT no hay Internet; con masquerade sí', () => {
    const t = office();
    const reach = () =>
      trace(t.net, { from: 'PC1' as never, dst: ipv4('8.8.8.8'), protocol: 'icmp' }).ok;
    expect(reach()).toBe(false);
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    expect(reach()).toBe(true);
    expect(t.ok('/ip firewall nat print')).toContain('action=masquerade');
  });

  it('firewall con place-before y move', () => {
    const t = office();
    t.ok('/ip firewall filter add chain=input action=drop in-interface=ether1 comment=drop-wan');
    t.ok('/ip firewall filter print');
    t.ok(
      '/ip firewall filter add chain=input action=accept connection-state=established,related place-before=0',
    );
    expect(t.device.config.firewall.filter.map((r) => r.action.kind)).toEqual(['accept', 'drop']);
    t.ok('/ip firewall filter print');
    t.ok('/ip firewall filter move 0 destination=2');
    expect(t.device.config.firewall.filter.map((r) => r.action.kind)).toEqual(['drop', 'accept']);
    expect(t.run('/ip firewall filter add chain=input dst-port=22 action=drop')).toContain(
      'failure:',
    );
  });

  it('rutas estáticas con flags y blackhole', () => {
    const t = office();
    t.ok('/ip route add dst-address=10.50.0.0/16 gateway=192.168.88.200 distance=3');
    t.ok('/ip route add dst-address=172.16.0.0/12 blackhole');
    const routes = t.device.config.routing.static;
    expect(routes.map((r) => r.gateway.kind)).toEqual(['ip', 'blackhole']);
    const out = t.ok('/ip route print');
    expect(out).toContain('10.50.0.0/16');
    expect(out).toContain('DAc');
  });

  it('VLANs con filtrado en el bridge', () => {
    const t = term().script([
      '/interface bridge add name=br vlan-filtering=yes',
      '/interface bridge port add bridge=br interface=ether2 pvid=10',
      '/interface bridge port add bridge=br interface=ether3 pvid=20',
      '/interface bridge vlan add bridge=br vlan-ids=10,20 tagged=br',
      '/interface vlan add name=vlan10 vlan-id=10 interface=br',
      '/interface vlan add name=vlan20 vlan-id=20 interface=br',
      '/ip address add address=10.0.10.1/24 interface=vlan10',
      '/ip address add address=10.0.20.1/24 interface=vlan20',
    ]);
    const bridge = t.device.config.interfaces.find((i) => i.name === 'br');
    expect(bridge?.kind === 'bridge' && bridge.vlanFiltering).toBe(true);
    expect(t.device.config.bridging.vlans[0]?.vlanIds).toEqual([10, 20]);
    expect(t.ok('/interface bridge vlan print')).toContain('10,20');
  });

  it('DNS: servidores, estáticos y :resolve', () => {
    const t = office().script([
      '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
      '/ip dns set servers=1.1.1.1 allow-remote-requests=yes',
      '/ip dns static add name=router.lan address=192.168.88.1',
    ]);
    expect(t.ok(':resolve example.com')).toBe('93.184.216.34');
    expect(t.ok(':resolve router.lan')).toBe('192.168.88.1');
    expect(t.ok('/ip dns cache print')).toContain('example.com');
    t.ok('/ip dns cache flush');
    expect(t.device.oper.dnsCache).toEqual([]);
    expect(t.run(':resolve nada.test')).toBe('failure: dns name does not exist');
  });

  it('ping con count muestra tabla y resumen', () => {
    const t = office();
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    const out = t.ok('/ping 8.8.8.8 count=2');
    expect(out.split('\n')[0]).toContain('SEQ HOST');
    expect(out).toContain('sent=2 received=2 packet-loss=0%');
    expect(t.ok('/ping 10.99.99.99 count=1')).toContain('packet-loss=100%');
  });

  it('ping continuo es una vista en vivo', () => {
    const t = office();
    t.ok('/ping 192.168.88.254');
    const live = t.last?.live;
    expect(live?.mode).toBe('append');
    expect(live?.frame(t.net, 0)).toContain('192.168.88.254');
    expect(live?.stop?.(t.net, 3)).toContain('sent=3');
  });
});

describe('backup, export e import', () => {
  it('guarda y restaura un backup con confirmación', () => {
    const t = term();
    t.ok('/ip address add address=10.0.0.1/24 interface=ether2');
    expect(t.ok('/system backup save name=antes')).toBe('Configuration backup saved');
    expect(t.ok('/file print')).toContain('antes.backup');
    t.ok('/ip address remove 0');
    expect(t.ok('/system backup load name=antes.backup')).toBe('Restore and reboot? [y/N]:');
    expect(t.prompt).toBe('');
    t.ok('y');
    expect(t.last?.closed).toBe(true);
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
  });

  it('responder no a la confirmación no hace nada', () => {
    const t = term();
    t.ok('/system reset-configuration');
    t.ok('n');
    expect(t.last?.closed).toBeUndefined();
    expect(t.prompt).toBe('[admin@MikroTik] > ');
  });

  it('export e import reconstruyen la misma configuración', () => {
    const t = term().script([
      '/system identity set name=Oficina',
      '/interface set ether1 name=ether1-wan',
      '/interface bridge add name=bridge1 comment="LAN de la oficina"',
      '/interface bridge port add bridge=bridge1 interface=ether2',
      '/interface wifi set wifi1 configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=clave-segura-1 disabled=no',
      '/interface bridge port add bridge=bridge1 interface=wifi1',
      '/interface list add name=WAN',
      '/interface list member add list=WAN interface=ether1-wan',
      '/ip address add address=192.168.88.1/24 interface=bridge1',
      '/ip pool add name=lan ranges=192.168.88.10-192.168.88.254',
      '/ip dhcp-server add interface=bridge1 address-pool=lan lease-time=1h',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
      '/ip dhcp-client add interface=ether1-wan',
      '/ip dns set servers=1.1.1.1 allow-remote-requests=yes',
      '/ip firewall filter add chain=input action=accept connection-state=established,related comment="defconf: accept established,related"',
      '/ip firewall filter add chain=input action=drop in-interface-list=WAN',
      '/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade',
      '/ip route add dst-address=10.50.0.0/16 gateway=192.168.88.200',
      '/ip service set telnet disabled=yes',
    ]);
    const body = (text: string) =>
      text
        .split('\n')
        .filter((l) => !l.startsWith('#'))
        .join('\n');
    const before = t.ok('/export show-sensitive');
    t.ok('/export file=respaldo show-sensitive');
    t.ok('/system reset-configuration no-defaults=yes');
    t.ok('y');
    expect(t.device.config.addressing.addresses).toEqual([]);
    const fresh = new Terminal(t.net, 'R1');
    expect(fresh.ok('/import respaldo.rsc')).toBe('Script file loaded and executed successfully');
    expect(body(fresh.ok('/export show-sensitive'))).toBe(body(before));
    const wifi = fresh.device.config.interfaces.find((i) => i.kind === 'wireless');
    expect(wifi?.kind === 'wireless' && wifi.security.passphrase).toBe('clave-segura-1');
  });

  it('un import con error informa la línea', () => {
    const t = term();
    t.ok('/system identity set name=X');
    t.ok('/export file=bueno');
    const device = t.device;
    const broken = {
      ...device,
      storage: {
        files: [
          ...device.storage.files,
          {
            name: 'malo.rsc',
            createdAt: t.net.now,
            payload: {
              kind: 'script' as const,
              text: '/ip address\nadd address=1.2.3.4/24 interface=nada',
            },
          },
        ],
      },
    };
    t.net = { ...t.net, devices: t.net.devices.map((d) => (d.id === device.id ? broken : d)) };
    expect(t.run('/import malo.rsc')).toContain('input does not match any value of interface');
  });
});

describe('arranque de labs', () => {
  it('ejecuta el script de arranque con el driver', () => {
    const yaml = `
id: arranque
vendor: routeros
title: { es: Arranque, en: Startup }
summary: { es: Prueba, en: Test }
difficulty: beginner
minutes: 5
topology:
  devices:
    - id: R1
      os: routeros
      board: sim-r5w
      startup: |
        /interface bridge
        add name=bridge1
        /ip address add address=192.168.88.1/24 \\
            interface=bridge1
  links: []
objectives:
  - id: lan
    text: { es: Tiene IP, en: Has IP }
    check: { hasAddress: { device: R1, iface: bridge1, prefix: 192.168.88.1/24 } }
    hints: [{ es: Nada, en: Nothing }]
explanation: { es: Fin, en: End }
`;
    const parsed = parseLabYaml(yaml);
    if (!parsed.ok) throw new Error(parsed.error);
    const loaded = loadLab(parsed.value, {
      platforms: { routeros: ROUTEROS_PLATFORM },
      runStartup: routerosStartup,
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
    const r1 = loaded.value.net.devices.find((d) => d.id === 'R1');
    expect(r1?.config.addressing.addresses.map((a) => formatIpv4(a.address.ip))).toEqual([
      '192.168.88.1',
    ]);
    const bad = loadLab(
      {
        ...parsed.value,
        topology: {
          ...parsed.value.topology,
          devices: [{ id: 'R1', os: 'routeros', board: 'sim-r5w', startup: '/ip adress print' }],
        },
      },
      { platforms: { routeros: ROUTEROS_PLATFORM }, runStartup: routerosStartup },
    );
    expect(!bad.ok && bad.error).toMatchObject({
      code: 'startup-failed',
      detail: expect.stringContaining('bad command name'),
    });
  });
});
