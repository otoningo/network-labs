import { formatIpv4, formatPrefix, type Gateway, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/** R1 con VRP: GE0/0/0 hacia la nube del ISP y GE0/0/1 hacia una PC. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .cloud('ISP')
    .link('R1:GigabitEthernet0/0/0', 'ISP:eth0')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

/** Terminal en la vista de sistema con las dos interfaces ya direccionadas. */
function term(): VrpTerminal {
  return new VrpTerminal(lab(), 'R1').script([
    'system-view',
    'interface GigabitEthernet0/0/0',
    'ip address 203.0.113.2 24',
    'quit',
    'interface GigabitEthernet0/0/1',
    'ip address 192.168.1.1 24',
    'quit',
  ]);
}

function gatewayText(t: VrpTerminal, gw: Gateway): string {
  const name = (id: unknown) => t.device.config.interfaces.find((i) => i.id === id)?.name ?? '?';
  switch (gw.kind) {
    case 'ip':
      return formatIpv4(gw.ip);
    case 'iface':
      return name(gw.iface);
    case 'ip-iface':
      return `${formatIpv4(gw.ip)}%${name(gw.iface)}`;
    case 'blackhole':
      return 'blackhole';
  }
}

/** Las rutas del modelo como «destino via camino (distancia)». */
const routes = (t: VrpTerminal) =>
  t.device.config.routing.static.map(
    (r) => `${formatPrefix(r.dst)} via ${gatewayText(t, r.gateway)} (${r.distance}) ${r.table}`,
  );

describe('ip route-static', () => {
  it('acepta máscara o longitud y la preferencia por defecto es 60', () => {
    const t = term();
    t.ok('ip route-static 10.1.0.0 255.255.0.0 192.168.1.254');
    t.ok('ip route-static 10.2.0.0 16 192.168.1.254');
    expect(routes(t)).toEqual([
      '10.1.0.0/16 via 192.168.1.254 (60) main',
      '10.2.0.0/16 via 192.168.1.254 (60) main',
    ]);
  });

  it('guarda la preferencia y la cambia si se repite el mismo camino', () => {
    const t = term();
    t.ok('ip route-static 0.0.0.0 0 203.0.113.1 preference 100');
    expect(routes(t)).toEqual(['0.0.0.0/0 via 203.0.113.1 (100) main']);
    t.ok('ip route-static 0.0.0.0 0 203.0.113.1 pref 10');
    expect(routes(t)).toEqual(['0.0.0.0/0 via 203.0.113.1 (10) main']);
    expect(t.run('ip route-static 0.0.0.0 0 203.0.113.1 preference 0')).toContain(
      'Wrong parameter',
    );
  });

  it('repetir la misma ruta no cambia nada', () => {
    const t = term();
    t.ok('ip route-static 0.0.0.0 0 203.0.113.1');
    const before = t.net;
    t.ok('ip route-static 0.0.0.0 0.0.0.0 203.0.113.1 preference 60');
    expect(t.net).toBe(before);
    expect(routes(t)).toHaveLength(1);
  });

  it('normaliza un destino con bits de host a su red, como VRP', () => {
    const t = term();
    t.ok('ip route-static 10.1.1.7 24 192.168.1.254');
    expect(routes(t)).toEqual(['10.1.1.0/24 via 192.168.1.254 (60) main']);
  });

  it('acepta una ruta solo con interfaz, con interfaz y salto, y a NULL0', () => {
    const t = term();
    t.ok('ip route-static 10.3.0.0 16 GigabitEthernet0/0/1');
    t.ok('ip route-static 10.4.0.0 16 g0/0/1 192.168.1.254');
    t.ok('ip route-static 10.5.0.0 16 NULL0');
    expect(routes(t)).toEqual([
      '10.3.0.0/16 via GigabitEthernet0/0/1 (60) main',
      '10.4.0.0/16 via 192.168.1.254%GigabitEthernet0/0/1 (60) main',
      '10.5.0.0/16 via blackhole (60) main',
    ]);
    expect(t.run('ip route-static 10.6.0.0 16 GigabitEthernet0/0/9')).toContain('Wrong parameter');
  });

  it('rechaza un siguiente salto que es una dirección propia', () => {
    const t = term();
    expect(t.run('ip route-static 10.1.0.0 16 192.168.1.1')).toBe(
      'Error: The next hop address is invalid.',
    );
    expect(routes(t)).toEqual([]);
  });

  it('undo con salto quita esa ruta; sin salto, todas las del destino', () => {
    const t = term();
    t.script([
      'ip route-static 0.0.0.0 0 203.0.113.1',
      'ip route-static 0.0.0.0 0 192.168.1.254 preference 120',
      'ip route-static 10.1.0.0 16 192.168.1.254',
    ]);
    t.ok('undo ip route-static 0.0.0.0 0 192.168.1.254');
    expect(routes(t)).toEqual([
      '0.0.0.0/0 via 203.0.113.1 (60) main',
      '10.1.0.0/16 via 192.168.1.254 (60) main',
    ]);
    t.ok('ip route-static 0.0.0.0 0 192.168.1.254 preference 120');
    t.ok('undo ip route-static 0.0.0.0 0.0.0.0');
    expect(routes(t)).toEqual(['10.1.0.0/16 via 192.168.1.254 (60) main']);
  });

  it('undo de una ruta que no existe responde con el error de VRP', () => {
    const t = term();
    expect(t.run('undo ip route-static 10.9.0.0 16')).toBe(
      'Error: The static route does not exist.',
    );
    t.ok('ip route-static 10.9.0.0 16 192.168.1.254');
    expect(t.run('undo ip route-static 10.9.0.0 16 192.168.1.253')).toBe(
      'Error: The static route does not exist.',
    );
    expect(t.last?.ok).toBe(false);
  });

  it('desde una subvista se ejecuta y vuelve a la vista de sistema', () => {
    const t = term();
    t.ok('interface GigabitEthernet0/0/1');
    t.ok('ip route-static 10.1.0.0 16 192.168.1.254');
    expect(t.prompt).toBe('[Huawei]');
    expect(routes(t)).toHaveLength(1);
  });
});

describe('display ip routing-table', () => {
  it('muestra las rutas estáticas activas y las directas con sus /32', () => {
    const t = term();
    t.ok('ip route-static 0.0.0.0 0 203.0.113.1');
    const out = t.ok('display ip routing-table');
    const lines = out.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Route Flags: R - relay, D - download to fib',
      '-'.repeat(78),
      'Routing Tables: Public',
      '         Destinations : 11       Routes : 11',
    ]);
    expect(out).toContain(
      'Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface',
    );
    expect(out).toContain(
      '        0.0.0.0/0   Static  60   0          RD   203.0.113.1     GigabitEthernet0/0/0',
    );
    expect(out).toContain(
      '    192.168.1.0/24  Direct  0    0           D   192.168.1.1     GigabitEthernet0/0/1',
    );
    expect(out).toContain(
      '    192.168.1.1/32  Direct  0    0           D   127.0.0.1       GigabitEthernet0/0/1',
    );
    expect(out).toContain(
      '  192.168.1.255/32  Direct  0    0           D   127.0.0.1       GigabitEthernet0/0/1',
    );
    expect(out).toContain(
      '      127.0.0.0/8   Direct  0    0           D   127.0.0.1       InLoopBack0',
    );
    expect(lines.at(-1)).toBe(
      '255.255.255.255/32  Direct  0    0           D   127.0.0.1       InLoopBack0',
    );
  });

  it('se puede pedir desde la vista de usuario y abreviado', () => {
    const t = term();
    t.ok('return');
    expect(t.ok('dis ip rout')).toContain('Routing Tables: Public');
  });

  it('una ruta flotante no sale en la tabla pero sí como inactiva en protocol static', () => {
    const t = term();
    t.script([
      'ip route-static 0.0.0.0 0 203.0.113.1',
      'ip route-static 0.0.0.0 0 192.168.1.254 preference 120',
    ]);
    const all = t.ok('display ip routing-table');
    expect(all).not.toContain('192.168.1.254');
    const st = t.ok('display ip routing-table protocol static');
    expect(st).toContain('Public routing table : Static');
    expect(st).toContain('Destinations : 1        Routes : 2        Configured Routes : 2');
    const [active = '', inactive = ''] = st.split('Static routing table status : <Inactive>');
    expect(active).toContain('0.0.0.0/0   Static  60   0          RD   203.0.113.1');
    expect(inactive).toContain('0.0.0.0/0   Static  120  0           R   192.168.1.254');
  });

  it('una ruta solo con interfaz muestra la dirección propia como salto', () => {
    const t = term();
    t.ok('ip route-static 10.3.0.0 16 GigabitEthernet0/0/1');
    expect(t.ok('display ip routing-table')).toContain(
      '       10.3.0.0/16  Static  60   0           D   192.168.1.1     GigabitEthernet0/0/1',
    );
  });
});

describe('configuración', () => {
  it('display current-configuration lista las rutas tras las interfaces', () => {
    const t = term();
    t.script([
      'ip route-static 10.1.0.0 16 192.168.1.254 preference 80',
      'ip route-static 0.0.0.0 0 203.0.113.1',
      'ip route-static 10.5.0.0 16 NULL0',
    ]);
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain(
      [
        'interface NULL0',
        '#',
        ' ip route-static 0.0.0.0 0.0.0.0 203.0.113.1',
        ' ip route-static 10.1.0.0 255.255.0.0 192.168.1.254 preference 80',
        ' ip route-static 10.5.0.0 255.255.0.0 NULL0',
        '#',
      ].join('\n'),
    );
  });

  it('el arranque lee las rutas aunque vengan tras un bloque de interfaz', () => {
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(
      device,
      [
        '#',
        'interface GigabitEthernet0/0/0',
        ' ip address 203.0.113.2 255.255.255.0',
        '#',
        ' ip route-static 0.0.0.0 0.0.0.0 203.0.113.1',
        '#',
        'return',
      ].join('\n'),
    );
    if (!ran.ok) throw new Error(ran.error);
    expect(ran.value.config.routing.static.map((r) => formatPrefix(r.dst))).toEqual(['0.0.0.0/0']);
  });
});

describe('de punta a punta', () => {
  it('sin ruta por defecto no se llega a internet; con ella, sí', () => {
    const t = term();
    t.ok('return');
    expect(t.ok('ping -c 2 93.184.216.34')).toContain('100.00% packet loss');
    t.script(['system-view', 'ip route-static 0.0.0.0 0 203.0.113.1', 'return']);
    const out = t.ok('ping 93.184.216.34');
    expect(out).toContain('Reply from 93.184.216.34');
    expect(out).toContain('0.00% packet loss');
    t.script(['system-view', 'undo ip route-static 0.0.0.0 0 203.0.113.1', 'return']);
    expect(t.ok('ping -c 2 93.184.216.34')).toContain('100.00% packet loss');
  });
});
