/**
 * Pruebas de las correcciones del driver de RouterOS: permisos de los grupos
 * de usuario, nombres de ítems con Tab, columnas de traceroute, backup antes
 * de reset-configuration, comillas con `%` y líneas en los errores de import.
 */
import { type Network, saveScript } from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { routeros } from './driver';
import { AUTO_BACKUP } from './menus/system';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';
import { quote } from './values';

/** R1 con una PC en ether2. */
function single(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .link('R1:ether2', 'PC1:eth0')
    .address('PC1', 'eth0', '192.168.88.10/24')
    .build();
}

/** R1 y R2 por una /30 en ether1, con PC2 en la LAN de R2 y rutas en ambos sentidos. */
function routed(): Network {
  const base = net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .router('R2', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC2')
    .link('R1:ether1', 'R2:ether1')
    .link('R2:ether2', 'PC2:eth0')
    .address('PC2', 'eth0', '192.168.2.10/24')
    .route('PC2', '0.0.0.0/0', '192.168.2.1')
    .build();
  const r1 = new Terminal(base, 'R1').script([
    '/ip address add address=10.0.12.1/30 interface=ether1',
    '/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2',
  ]).net;
  return new Terminal(r1, 'R2').script([
    '/ip address add address=10.0.12.2/30 interface=ether1',
    '/ip address add address=192.168.2.1/24 interface=ether2',
  ]).net;
}

/** Red con `soporte` (grupo `group`) creado por admin, y su terminal. */
function loggedAs(group: 'read' | 'write' | 'full'): Terminal {
  const admin = new Terminal(single(), 'R1').script([
    `/user add name=soporte group=${group} password=Clave123`,
    '/ip address add address=192.168.88.1/24 interface=ether2',
    '/export file=base',
    '/system backup save name=x',
  ]);
  return new Terminal(admin.net, 'R1', { user: 'soporte' });
}

const DENIED = 'failure: not enough permissions (9)';

/** Configuración y archivos, para comprobar que un comando denegado no cambió nada. */
const snapshot = (t: Terminal): string =>
  JSON.stringify({ config: t.device.config, files: t.device.storage.files });

const tab = (t: Terminal, input: string): string[] =>
  routeros
    .complete(input, input.length, { net: t.net, device: t.device, session: t.session })
    .candidates.map((c) => c.text);

// ── Permisos ────────────────────────────────────────────────────────────────

describe('permisos de los grupos de usuario', () => {
  it('read puede consultar y diagnosticar', () => {
    const t = loggedAs('read');
    expect(t.ok('/ip address print')).toContain('192.168.88.1/24');
    expect(t.ok('/ping 192.168.88.10 count=1')).toContain('received=1');
    expect(t.ok(':put hola')).toBe('hola');
    expect(t.ok('/export')).toContain('/ip address');
    expect(t.ok('/tool traceroute 192.168.88.10')).toContain('192.168.88.10');
    expect(t.ok('/interface monitor-traffic ether2 once')).toContain('rx-bits-per-second');
    t.ok('/ip address');
    expect(t.prompt).toBe('[soporte@MikroTik] /ip/address> ');
  });

  it.each([
    '/ip address add address=10.0.0.1/24 interface=ether3',
    '/ip address remove 0',
    '/system identity set name=R1',
    '/interface disable ether3',
    '/export file=mio',
    '/import base.rsc',
    '/undo',
    '/system backup save name=x',
    '/system backup load name=x.backup',
    '/system reboot',
    '/system reset-configuration',
    '/ip dns cache flush',
    '/ip firewall filter reset-counters',
    '/file remove base.rsc',
    '/user add name=otro group=full password=x',
    '/ip address print; /system identity set name=R1',
  ])('read no puede: %s', (line) => {
    const t = loggedAs('read');
    const before = snapshot(t);
    expect(t.run(line)).toBe(DENIED);
    expect(t.last?.ok).toBe(false);
    // Se niega antes de preguntar [y/N].
    expect(t.session.pending).toBeNull();
    expect(snapshot(t)).toBe(before);
  });

  it('write cambia la configuración, guarda backups y reinicia', () => {
    const t = loggedAs('write');
    t.ok('/ip address add address=10.0.0.1/24 interface=ether3');
    t.ok('/system identity set name=R1');
    expect(t.device.config.system.identity).toBe('R1');
    expect(t.ok('/system backup save name=copia')).toBe('Configuration backup saved');
    expect(t.ok('/system reboot')).toBe('Reboot, yes? [y/N]:');
    t.ok('n');
    expect(t.ok('/export file=mio')).toBe('');
    expect(t.device.storage.files.map((f) => f.name)).toContain('mio.rsc');
  });

  it.each([
    '/user add name=otro group=full password=x',
    '/user set admin group=read',
    '/user remove admin',
    '/system reset-configuration',
    '/system backup load name=x.backup',
  ])('write no puede: %s', (line) => {
    const t = loggedAs('write');
    const before = snapshot(t);
    expect(t.run(line)).toBe(DENIED);
    expect(snapshot(t)).toBe(before);
  });

  it('un import de write se detiene en la línea que toca usuarios', () => {
    const t = loggedAs('write');
    const script = [
      '/system identity set name=Importado',
      '/user add name=intruso group=full password=x',
    ].join('\n');
    const device = saveScript(t.device, 'usuarios.rsc', script, t.net.now);
    t.net = { ...t.net, devices: t.net.devices.map((d) => (d.id === device.id ? device : d)) };
    expect(t.run('/import usuarios.rsc')).toBe(`${DENIED} (line 2)`);
    expect(t.device.config.system.users.map((u) => u.name)).toEqual(['admin', 'soporte']);
  });

  it('full, admin y los usuarios que no están en /user lo pueden todo', () => {
    const full = loggedAs('full');
    full.ok('/user add name=otro group=read password=x');
    expect(full.device.config.system.users.map((u) => u.name)).toContain('otro');
    const ghost = new Terminal(single(), 'R1', { user: 'invitado' });
    ghost.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(ghost.ok('/system reset-configuration')).toBe('Dangerous! Reset anyway? [y/N]:');
  });

  it('el permiso se mira al ejecutar: bajar de grupo a un usuario lo limita al momento', () => {
    const t = loggedAs('write');
    t.ok('/system identity set name=Antes');
    const admin = new Terminal(t.net, 'R1').script(['/user set soporte group=read']);
    t.net = admin.net;
    expect(t.run('/system identity set name=Despues')).toBe(DENIED);
    expect(t.device.config.system.identity).toBe('Antes');
  });
});

// ── Tab: nombres de ítems ───────────────────────────────────────────────────

describe('Tab en la posición numbers', () => {
  it('propone los nombres según lo escrito y sigue con los argumentos', () => {
    const t = new Terminal(single(), 'R1');
    expect(tab(t, '/interface set e')).toEqual(['ether1', 'ether2', 'ether3', 'ether4', 'ether5']);
    expect(tab(t, '/interface enable ether')).toEqual(tab(t, '/interface set e'));
    expect(tab(t, '/ip service disable t')).toEqual(['telnet']);
    expect(tab(t, '/ip service set w')).toEqual(['winbox', 'www', 'www-ssl']);
    // Tras el ítem, set propone sus argumentos y no más nombres.
    expect(tab(t, '/interface set ether1 ')).toEqual(
      expect.arrayContaining(['comment=', 'mtu=', 'name=']),
    );
    expect(tab(t, '/interface set ether1 e')).toEqual([]);
    expect(tab(t, '/interface set numbers=ether1 m')).toEqual(['mtu=']);
    expect(tab(t, '/interface set [find] n')).toEqual(['name=']);
  });

  it('con la palabra vacía: set lista argumentos; remove y disable, los ítems', () => {
    const t = new Terminal(single(), 'R1');
    expect(tab(t, '/ip service set ')).toEqual(['address=', 'disabled=', 'port=']);
    expect(tab(t, '/ip service disable ')).toEqual(
      expect.arrayContaining(['ssh', 'telnet', 'winbox']),
    );
    t.ok('/export file=copia');
    expect(tab(t, '/file remove ')).toEqual(['copia.rsc']);
  });

  it('acciones con numbers y menús sin nombres', () => {
    const t = new Terminal(single(), 'R1');
    t.ok('/user add name=soporte group=read password=x');
    expect(tab(t, '/user remove s')).toEqual(['soporte']);
    expect(tab(t, '/ip firewall filter set pl')).toEqual([]);
    expect(tab(t, '/system identity set ')).toEqual(['name=']);
  });

  it('los nombres con espacios se proponen entre comillas', () => {
    const t = new Terminal(single(), 'R1');
    t.ok('/interface set ether3 name="LAN oficina"');
    expect(tab(t, '/interface disable L')).toEqual(['"LAN oficina"']);
    expect(tab(t, '/interface disable "L')).toEqual(['"LAN oficina"']);
  });
});

// ── Traceroute ──────────────────────────────────────────────────────────────

describe('/tool traceroute', () => {
  const cells = (line: string | undefined): string[] => (line ?? '').trim().split(/\s+/);

  it('muestra las columnas de v7 con tiempos coherentes', () => {
    const t = new Terminal(routed(), 'R1');
    const lines = t.ok('/tool traceroute 192.168.2.10').split('\n');
    expect(lines[0]).toBe('Columns: ADDRESS, LOSS, SENT, LAST, AVG, BEST, WORST, STD-DEV, STATUS');
    expect(cells(lines[1])).toEqual([
      '#',
      'ADDRESS',
      'LOSS',
      'SENT',
      'LAST',
      'AVG',
      'BEST',
      'WORST',
      'STD-DEV',
      'STATUS',
    ]);
    expect(cells(lines[2])).toEqual([
      '1',
      '10.0.12.2',
      '0%',
      '3',
      '0.4ms',
      '0.4',
      '0.3',
      '0.5',
      '0.1',
    ]);
    expect(cells(lines[3])).toEqual([
      '2',
      '192.168.2.10',
      '0%',
      '3',
      '0.8ms',
      '0.8',
      '0.7',
      '0.9',
      '0.1',
    ]);
    expect(lines).toHaveLength(4);
  });

  it('count fija SENT y con una sola sonda no hay dispersión', () => {
    const t = new Terminal(routed(), 'R1');
    const lines = t.ok('/tool traceroute 192.168.2.10 count=1').split('\n');
    expect(cells(lines[2])).toEqual([
      '1',
      '10.0.12.2',
      '0%',
      '1',
      '0.4ms',
      '0.4',
      '0.4',
      '0.4',
      '0.0',
    ]);
    const five = t.ok('/tool traceroute 192.168.2.10 count=5').split('\n');
    expect(cells(five[3]).slice(0, 4)).toEqual(['2', '192.168.2.10', '0%', '5']);
  });

  it('un salto sin respuesta sale como timeout en STATUS', () => {
    const t = new Terminal(single(), 'R1');
    const lines = t.ok('/tool traceroute 10.99.99.99 count=2').split('\n');
    expect(lines).toHaveLength(3);
    expect(cells(lines[2])).toEqual(['1', '100%', '2', 'timeout']);
    const status = (lines[1] ?? '').indexOf('STATUS');
    expect((lines[2] ?? '').slice(status)).toBe('timeout');
  });
});

// ── reset-configuration ─────────────────────────────────────────────────────

describe('/system reset-configuration', () => {
  it('guarda auto-before-reset.backup y se puede restaurar', () => {
    const t = new Terminal(single(), 'R1').script([
      '/system identity set name=Oficina',
      '/ip address add address=192.168.88.1/24 interface=ether2',
    ]);
    t.ok('/system reset-configuration');
    t.ok('y');
    expect(t.last?.closed).toBe(true);
    expect(t.device.config.system.identity).toBe('MikroTik');
    expect(t.device.config.addressing.addresses).toEqual([]);
    const backup = t.device.storage.files.find((f) => f.name === AUTO_BACKUP);
    expect(backup?.payload.kind === 'backup' && backup.payload.config.system.identity).toBe(
      'Oficina',
    );
    const fresh = new Terminal(t.net, 'R1');
    expect(fresh.ok('/file print')).toContain(AUTO_BACKUP);
    fresh.ok(`/system backup load name=${AUTO_BACKUP}`);
    fresh.ok('y');
    expect(fresh.device.config.system.identity).toBe('Oficina');
  });

  it('con skip-backup=yes no guarda nada y los demás archivos sobreviven', () => {
    const t = new Terminal(single(), 'R1').script(['/export file=antes']);
    t.ok('/system reset-configuration skip-backup=yes');
    t.ok('y');
    expect(t.device.storage.files.map((f) => f.name)).toEqual(['antes.rsc']);
  });
});

// ── Comillas ────────────────────────────────────────────────────────────────

describe('quote', () => {
  it('% no obliga a poner comillas; los espacios y las comillas sí', () => {
    expect(quote('10.0.12.2%ether1')).toBe('10.0.12.2%ether1');
    expect(quote('50%')).toBe('50%');
    expect(quote('LAN oficina')).toBe('"LAN oficina"');
    expect(quote('di "hola"')).toBe('"di \\"hola\\""');
    expect(quote('')).toBe('""');
  });

  it('print detail de una ruta muestra immediate-gw sin comillas', () => {
    const t = new Terminal(routed(), 'R1');
    expect(t.ok('/ip route print detail where static')).toContain(' immediate-gw=10.0.12.2%ether1');
  });
});

// ── Errores de import ───────────────────────────────────────────────────────

describe('/import informa la línea del error', () => {
  function withScript(text: string): Terminal {
    const t = new Terminal(single(), 'R1');
    const device = saveScript(deviceIn(t.net, 'R1'), 'prueba.rsc', text, t.net.now);
    t.net = { ...t.net, devices: t.net.devices.map((d) => (d.id === device.id ? device : d)) };
    return t;
  }

  it('errores del núcleo: el mensaje con (line N)', () => {
    const t = withScript(
      [
        '/ip address add address=10.0.0.1/24 interface=ether2',
        '# comentario',
        '/ip address add address=10.0.0.1/24 interface=ether2',
      ].join('\n'),
    );
    expect(t.run('/import prueba.rsc')).toBe('failure: already have such address (line 3)');
    expect(t.last?.ok).toBe(false);
  });

  it('valores inválidos sin columna también llevan la línea', () => {
    const t = withScript('/ip address\nadd address=1.2.3.4/24 interface=nada');
    expect(t.run('/import prueba.rsc')).toBe(
      'input does not match any value of interface (line 2)',
    );
  });

  it('los de sintaxis conservan línea y columna', () => {
    const t = withScript('/system identity set name=A\n/ip adress print');
    expect(t.run('/import prueba.rsc')).toBe('bad command name adress (line 2 column 5)');
  });

  it('un import dentro de otro no repite la línea', () => {
    const inner = withScript('/ip address add address=10.0.0.1/24 interface=nada');
    const device = saveScript(inner.device, 'fuera.rsc', '\n/import prueba.rsc', inner.net.now);
    inner.net = {
      ...inner.net,
      devices: inner.net.devices.map((d) => (d.id === device.id ? device : d)),
    };
    expect(inner.run('/import fuera.rsc')).toBe(
      'input does not match any value of interface (line 1)',
    );
  });

  it('en una línea con `;` el error se muestra sin número de línea añadido', () => {
    const t = new Terminal(single(), 'R1');
    expect(
      t.run(
        '/ip address add address=10.0.0.1/24 interface=ether2; /ip address add address=10.0.0.1/24 interface=ether2',
      ),
    ).toBe('failure: already have such address');
  });
});
