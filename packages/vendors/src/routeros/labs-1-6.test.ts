/**
 * Batería de los labs 1 a 6 del curso "MikroTik desde cero": se conduce la CLI
 * como lo haría un alumno (incluidos los errores típicos) y se comprueba el
 * estado de la red, no las cadenas de comandos.
 *
 * Las pruebas marcadas con `it.fails` describen el comportamiento correcto de
 * RouterOS v7 que el simulador todavía no reproduce (ver el comentario BUG).
 */
import {
  deviceId,
  evaluate,
  formatIpv4,
  formatPrefix,
  ipv4,
  type Network,
  type Predicate,
  prefix,
  resolveName,
  type TraceResult,
  trace,
} from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { routeros } from './driver';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

// ── Ayudantes ───────────────────────────────────────────────────────────────

const holds = (network: Network, predicate: Predicate): boolean =>
  evaluate(predicate, { net: network, startup: new Map() });

const ctxOf = (t: Terminal) => ({ net: t.net, device: t.device, session: t.session });

/** Candidatos de Tab con el cursor al final de la línea. */
const tab = (t: Terminal, input: string): string[] =>
  routeros.complete(input, input.length, ctxOf(t)).candidates.map((c) => c.text);

/** Lo que muestra `?` con la línea escrita. */
const helpOf = (t: Terminal, input: string): string[] => routeros.help(input, ctxOf(t)).split('\n');

/** Configura un equipo por la CLI (exigiendo éxito) y devuelve la red resultante. */
const cli = (network: Network, id: string, lines: readonly string[]): Network =>
  new Terminal(network, id).script(lines).net;

const icmp = (network: Network, from: string, dst: string): TraceResult =>
  trace(network, { from: deviceId(from), dst: ipv4(dst), protocol: 'icmp' });

const tcp = (network: Network, from: string, dst: string, port: number, src?: string) =>
  trace(network, {
    from: deviceId(from),
    dst: ipv4(dst),
    protocol: 'tcp',
    dstPort: port,
    ...(src === undefined ? {} : { src: ipv4(src) }),
  });

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fila de un print en tabla cuya primera columna es `first` (con o sin número y flags). */
function rowOf(output: string, first: string): string | undefined {
  const re = new RegExp(`^\\d* +(?:[A-Za-z*]+ +)?${escapeRe(first)}(?: |$)`);
  return output.split('\n').find((line) => re.test(line));
}

/** Flags de esa fila ('' si no tiene ninguna, undefined si la fila no existe). */
function rowFlags(output: string, first: string): string | undefined {
  const line = rowOf(output, first);
  if (line === undefined) return undefined;
  const m = new RegExp(`^\\d* +(?:([A-Za-z*]+) +)?${escapeRe(first)}(?: |$)`).exec(line);
  return m?.[1] ?? '';
}

const macOf = (network: Network, id: string, iface = 'eth0'): string =>
  deviceIn(network, id).config.interfaces.find((i) => i.name === iface)?.mac ?? '';

const ifaceIdOf = (network: Network, id: string, name: string) =>
  deviceIn(network, id).config.interfaces.find((i) => i.name === name)?.id;

const dhcpOf = (network: Network, id: string) => deviceIn(network, id).oper.dhcpClients[0];

const addressOf = (network: Network, id: string): string | undefined => {
  const status = dhcpOf(network, id);
  return status?.address ? formatPrefix(status.address) : undefined;
};

// ── Lab 1: acceso inicial y CLI ─────────────────────────────────────────────

/** R1 recién salido de fábrica con una PC en ether2. */
function lab1(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .link('R1:ether2', 'PC1:eth0')
    .address('PC1', 'eth0', '192.168.88.10/24')
    .build();
}

describe('Lab 1: acceso inicial y CLI', () => {
  it('el prompt muestra usuario e identidad y se navega con /, .. y la forma v7', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(t.prompt).toBe('[admin@MikroTik] > ');
    t.ok('/ip address');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/address> ');
    t.ok('..');
    expect(t.prompt).toBe('[admin@MikroTik] /ip> ');
    t.ok('/');
    expect(t.prompt).toBe('[admin@MikroTik] > ');
    t.ok('/ip/service');
    expect(t.prompt).toBe('[admin@MikroTik] /ip/service> ');
    // Dentro del menú basta con el comando.
    expect(t.ok('print')).toContain('telnet');
    // La forma v7 ejecuta sin cambiar de menú.
    t.ok('/');
    expect(t.ok('/ip/service/print')).toContain('winbox');
    expect(t.prompt).toBe('[admin@MikroTik] > ');
  });

  it('acepta abreviaturas únicas y avisa cuando son ambiguas', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(t.ok('/sys id pr')).toBe('  name: MikroTik');
    expect(t.ok('/in pr')).toContain('ether1');
    t.ok('/ip addr add addr=192.168.88.1/24 int=ether2');
    expect(t.device.config.addressing.addresses.map((a) => formatPrefix(a.address))).toEqual([
      '192.168.88.1/24',
    ]);
    // `a` puede ser address o arp; `i` puede ser import, interface o ip.
    expect(t.run('/ip a print')).toBe('ambiguous command name a (line 1 column 5)');
    expect(t.last?.ok).toBe(false);
    expect(t.run('/i')).toBe('ambiguous command name i (line 1 column 2)');
  });

  it('errores de tecleo: comando inexistente y argumento desconocido', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(t.run('/ip adress print')).toBe('bad command name adress (line 1 column 5)');
    expect(t.run('/ip address prnt')).toBe('bad command name prnt (line 1 column 13)');
    expect(t.run('/ip address add adress=192.168.88.1/24 interface=ether2')).toBe(
      'expected end of command (line 1 column 17)',
    );
    expect(t.run('/system identity set nmae=R1')).toBe(
      'expected end of command (line 1 column 22)',
    );
    expect(t.last?.ok).toBe(false);
    // Nada de lo anterior cambió la configuración.
    expect(t.device.config.addressing.addresses).toEqual([]);
    expect(t.device.config.system.identity).toBe('MikroTik');
  });

  it('la ayuda con ? lista submenús y comandos del menú actual', () => {
    const t = new Terminal(lab1(), 'R1');
    const ip = helpOf(t, '/ip ');
    expect(ip.slice(0, 3)).toEqual(['ip', '', '.. -- go up to root']);
    expect(ip).toContain('address/ -- Address management');
    expect(ip).toContain('service/ -- IP services');
    t.ok('/ip address');
    const here = helpOf(t, '');
    expect(here.slice(0, 3)).toEqual(['Address management', '', '.. -- go up to ip']);
    expect(here).toContain('add -- Create a new item');
    expect(here).toContain('print -- Print values of item properties');
    expect(helpOf(t, 'add ?')).toEqual([
      'Create a new item',
      '',
      'address -- IP address with prefix',
      'comment -- Text',
      'disabled -- yes | no',
      'interface -- Interface name',
    ]);
  });

  it('Tab completa menús, comandos, argumentos y valores', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(tab(t, '/ip addr')).toEqual(['address']);
    expect(tab(t, '/sys')).toEqual(['system']);
    expect(tab(t, '/system identity set ')).toEqual(['name=']);
    expect(tab(t, '/ip address add int')).toEqual(['interface=']);
    expect(tab(t, '/ip address add interface=eth')).toEqual([
      'ether1',
      'ether2',
      'ether3',
      'ether4',
      'ether5',
    ]);
    expect(tab(t, '/user add group=')).toEqual(['full', 'read', 'write']);
    expect(tab(t, '/ip service set ')).toEqual(['address=', 'disabled=', 'port=']);
  });

  it('Tab tras set/disable propone los nombres de los ítems', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(tab(t, '/interface set e')).toEqual(['ether1', 'ether2', 'ether3', 'ether4', 'ether5']);
    expect(tab(t, '/ip service disable t')).toEqual(['telnet']);
  });

  it('cambiar la identidad cambia el prompt', () => {
    const t = new Terminal(lab1(), 'R1');
    t.ok('/system identity set name=R1-Oficina');
    expect(t.prompt).toBe('[admin@R1-Oficina] > ');
    expect(t.ok('/system identity print')).toBe('  name: R1-Oficina');
    expect(
      holds(t.net, {
        kind: 'setting',
        device: deviceId('R1'),
        key: 'system',
        path: ['identity'],
        match: { eq: 'R1-Oficina' },
      }),
    ).toBe(true);
    t.ok('/system identity set name="Router Central"');
    expect(t.prompt).toBe('[admin@Router Central] > ');
  });

  it('crea usuarios y cambia la clave de admin sin guardar contraseñas en claro', () => {
    const t = new Terminal(lab1(), 'R1');
    t.ok('/user add name=soporte group=read password=Secreto123');
    t.ok('/user set admin password=ClaveAdmin9');
    expect(t.device.config.system.users.map((u) => [u.name, u.group, u.hasPassword])).toEqual([
      ['admin', 'full', true],
      ['soporte', 'read', true],
    ]);
    const state = JSON.stringify({ net: t.net, session: t.session });
    expect(state).not.toContain('Secreto123');
    expect(state).not.toContain('ClaveAdmin9');
    const list = t.ok('/user print');
    expect(list).toContain('Columns: NAME, GROUP');
    expect(rowOf(list, 'soporte')).toMatch(/^1 soporte\s+read/);
    const detail = t.ok('/user print detail');
    expect(detail).toContain('name=soporte group=read');
    expect(detail).not.toContain('password');
    expect(t.ok('/export show-sensitive')).not.toContain('Secreto123');
  });

  it('errores típicos al crear usuarios', () => {
    const t = new Terminal(lab1(), 'R1');
    expect(t.run('/user add name=pepe group=superadmin password=x')).toBe(
      'invalid value for argument group',
    );
    t.ok('/user add name=pepe group=write password=x');
    expect(t.run('/user add name=pepe group=read password=y')).toMatch(/^failure: /);
    expect(t.device.config.system.users.map((u) => u.name)).toEqual(['admin', 'pepe']);
  });

  it('un usuario del grupo read no puede cambiar la configuración', () => {
    const network = cli(lab1(), 'R1', ['/user add name=soporte group=read password=Secreto123']);
    const s = new Terminal(network, 'R1', { user: 'soporte' });
    expect(s.prompt).toBe('[soporte@MikroTik] > ');
    expect(s.ok('/ip address print')).toBe('');
    expect(s.run('/ip address add address=192.168.88.1/24 interface=ether2')).toContain(
      'not enough permissions',
    );
    expect(s.last?.ok).toBe(false);
    expect(s.device.config.addressing.addresses).toEqual([]);
  });

  it('el log registra quién hizo cada cambio', () => {
    const t = new Terminal(lab1(), 'R1');
    t.ok('/user add name=tecnico group=full password=abc12345');
    t.ok('/system identity set name=R1');
    const tech = new Terminal(t.net, 'R1', { user: 'tecnico' });
    expect(tech.prompt).toBe('[tecnico@R1] > ');
    tech.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    const log = tech.ok('/log print').split('\n');
    expect(log).toEqual([
      ' 09:00:00 system,info user added by admin',
      ' 09:00:00 system,info system identity changed by admin',
      ' 09:00:00 system,info address added by tecnico',
    ]);
  });

  it('deshabilitar telnet y mover ssh al 2222 se nota en la red', () => {
    const t = new Terminal(lab1(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(tcp(t.net, 'PC1', '192.168.88.1', 23).ok).toBe(true);
    expect(tcp(t.net, 'PC1', '192.168.88.1', 22).ok).toBe(true);
    t.ok('/ip service disable telnet');
    t.ok('/ip service set ssh port=2222');
    const telnet = tcp(t.net, 'PC1', '192.168.88.1', 23);
    expect(telnet.ok).toBe(false);
    expect(telnet.forward.end).toMatchObject({ kind: 'port-closed', device: 'R1' });
    expect(tcp(t.net, 'PC1', '192.168.88.1', 22).ok).toBe(false);
    expect(tcp(t.net, 'PC1', '192.168.88.1', 2222).ok).toBe(true);
    const services = t.device.config.services;
    expect(services.find((s) => s.name === 'telnet')?.disabled).toBe(true);
    expect(services.find((s) => s.name === 'ssh')?.port).toBe(2222);
    const out = t.ok('/ip service print');
    expect(rowFlags(out, 'telnet')).toBe('X');
    expect(rowOf(out, 'ssh')).toMatch(/ssh\s+2222$/);
    expect(t.ok('/ip service print where disabled')).toBe(
      [
        'Flags: X - DISABLED',
        'Columns: NAME, PORT, ADDRESS',
        '#   NAME     PORT  ADDRESS',
        '0 X telnet     23',
        '1 X www-ssl   443',
      ].join('\n'),
    );
    expect(t.ok('/ip service print detail where name=ssh')).toBe(
      ' 0  name=ssh port=2222 address=""',
    );
  });

  it('print, print detail, print where y count-only', () => {
    const t = new Terminal(lab1(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2 comment=LAN');
    t.ok('/ip address add address=10.0.0.1/24 interface=ether3');
    expect(t.ok('/ip address print')).toBe(
      [
        'Columns: ADDRESS, NETWORK, INTERFACE',
        '# ADDRESS          NETWORK       INTERFACE',
        ';;; LAN',
        '0 192.168.88.1/24  192.168.88.0  ether2',
        '1 10.0.0.1/24      10.0.0.0      ether3',
      ].join('\n'),
    );
    expect(t.ok('/ip address print detail')).toBe(
      [
        ' 0  ;;; LAN',
        '    address=192.168.88.1/24 network=192.168.88.0 interface=ether2',
        '    actual-interface=ether2',
        '',
        ' 1  address=10.0.0.1/24 network=10.0.0.0 interface=ether3',
        '    actual-interface=ether3',
      ].join('\n'),
    );
    const where = t.ok('/ip address print where interface=ether3');
    expect(where).toContain('10.0.0.1/24');
    expect(where).not.toContain('192.168.88.1/24');
    expect(t.ok('/ip address print count-only')).toBe('2');
    // Los números son los del último print: el 0 de "print where" es 10.0.0.1.
    t.ok('/ip address remove 0');
    expect(t.device.config.addressing.addresses.map((a) => formatPrefix(a.address))).toEqual([
      '192.168.88.1/24',
    ]);
  });

  it('/system resource print muestra uptime, versión y placa', () => {
    const t = new Terminal(lab1(), 'R1');
    const out = t.ok('/system resource print').split('\n');
    expect(out).toContain('             uptime: 0s');
    expect(out).toContain('         board-name: sim-r5w');
    expect(out.some((l) => l.trim().startsWith('version: 7'))).toBe(true);
    expect(out.some((l) => l.trim().startsWith('free-memory:'))).toBe(true);
  });
});

// ── Lab 2: interfaces y direcciones IP ──────────────────────────────────────

/** R1 con el ISP en ether1, PC1 en ether2, PC2 en ether3 y nada en ether4-5. */
function lab2(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .cloud('ISP')
    .link('R1:ether1', 'ISP:eth0')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .address('PC1', 'eth0', '192.168.88.10/24')
    .address('PC2', 'eth0', '192.168.88.11/24')
    .build();
}

describe('Lab 2: interfaces y direcciones IP', () => {
  it('/interface print marca con R las interfaces con enlace y con X las deshabilitadas', () => {
    const t = new Terminal(lab2(), 'R1');
    const out = t.ok('/interface print');
    expect(out.split('\n').slice(0, 3)).toEqual([
      'Flags: X - DISABLED, R - RUNNING',
      'Columns: NAME, TYPE, ACTUAL-MTU, MAC-ADDRESS',
      '#   NAME    TYPE   ACTUAL-MTU  MAC-ADDRESS',
    ]);
    expect(rowFlags(out, 'ether1')).toBe('R');
    expect(rowFlags(out, 'ether2')).toBe('R');
    expect(rowFlags(out, 'ether4')).toBe('');
    expect(rowFlags(out, 'wifi1')).toBe('X');
    const running = (name: string) =>
      holds(t.net, { kind: 'interfaceRunning', device: deviceId('R1'), iface: { name } });
    expect(running('ether2')).toBe(true);
    expect(running('ether4')).toBe(false);
  });

  it('renombrar ether1 a ether1-wan y seguir usándola', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/interface set ether1 name=ether1-wan');
    expect(t.run('/ip address add address=203.0.113.2/24 interface=ether1')).toBe(
      'input does not match any value of interface',
    );
    t.ok('/ip address add address=203.0.113.2/24 interface=ether1-wan');
    expect(rowOf(t.ok('/interface print'), 'ether1-wan')).toBeDefined();
    expect(t.ok('/interface print detail')).toContain('name=ether1-wan default-name=ether1');
    expect(rowOf(t.ok('/ip address print'), '203.0.113.2/24')).toMatch(/ether1-wan$/);
    expect(
      holds(t.net, {
        kind: 'hasAddress',
        device: deviceId('R1'),
        iface: { name: 'ether1-wan' },
        prefix: prefix('203.0.113.2/24'),
      }),
    ).toBe(true);
    expect(icmp(t.net, 'R1', '203.0.113.1').ok).toBe(true);
    expect(t.ok('/export')).toContain('set [ find default-name=ether1 ] name=ether1-wan');
    // Tab ya propone el nombre nuevo.
    expect(tab(t, '/ip address add interface=ether1')).toEqual(['ether1-wan']);
  });

  it('los comentarios aparecen con ;;; encima de la fila', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/interface comment ether1 comment="Enlace al ISP"');
    t.ok('/interface set ether2 comment=LAN');
    const lines = t.ok('/interface print').split('\n');
    const at = lines.indexOf(';;; Enlace al ISP');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^0 +R +ether1 /);
    expect(t.device.config.interfaces.slice(0, 2).map((i) => i.comment)).toEqual([
      'Enlace al ISP',
      'LAN',
    ]);
  });

  it('deshabilitar una interfaz corta la conectividad y habilitarla la recupera', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(true);
    t.ok('/interface disable ether2');
    expect(rowFlags(t.ok('/interface print'), 'ether2')).toBe('X');
    expect(t.device.config.interfaces.find((i) => i.name === 'ether2')?.disabled).toBe(true);
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(false);
    expect(t.ok('/ping 192.168.88.10 count=2')).toContain('sent=2 received=0 packet-loss=100%');
    t.ok('/interface enable ether2');
    expect(rowFlags(t.ok('/interface print'), 'ether2')).toBe('R');
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(true);
  });

  it('añadir, cambiar y quitar direcciones', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    t.ok('/ip address print');
    t.ok('/ip address set 0 address=192.168.88.254/24');
    expect(
      formatPrefix(t.device.config.addressing.addresses[0]?.address ?? prefix('0.0.0.0/0')),
    ).toBe('192.168.88.254/24');
    expect(icmp(t.net, 'PC1', '192.168.88.254').ok).toBe(true);
    t.ok('/ip address disable 0');
    expect(rowFlags(t.ok('/ip address print'), '192.168.88.254/24')).toBe('X');
    expect(icmp(t.net, 'PC1', '192.168.88.254').ok).toBe(false);
    t.ok('/ip address enable 0');
    t.ok('/ip address remove 0');
    expect(t.device.config.addressing.addresses).toEqual([]);
    expect(t.run('/ip address remove 0')).toBe('no such item');
  });

  it('olvidar la máscara deja una /32 y la LAN queda fuera de alcance', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1 interface=ether2');
    expect(rowOf(t.ok('/ip address print'), '192.168.88.1/32')).toMatch(
      /192\.168\.88\.1\/32\s+192\.168\.88\.1\s+ether2/,
    );
    expect(t.ok('/ping 192.168.88.10 count=1')).toContain('packet-loss=100%');
    t.ok('/ip address set [find address="192.168.88.1/32"] address=192.168.88.1/24');
    expect(t.ok('/ping 192.168.88.10 count=1')).toContain('packet-loss=0%');
  });

  it('errores típicos: dirección repetida, interfaz inexistente, IP inválida y falta de argumentos', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    expect(t.run('/ip address add address=192.168.88.1/24 interface=ether2')).toBe(
      'failure: already have such address',
    );
    expect(t.run('/ip address add address=10.0.0.1/24 interface=ether9')).toBe(
      'input does not match any value of interface',
    );
    expect(t.run('/ip address add address=192.168.300.1/24 interface=ether3')).toBe(
      'invalid value for argument address',
    );
    expect(t.run('/ip address add address=10.0.0.1/24')).toBe(
      'missing value(s) of argument(s) interface',
    );
    expect(t.device.config.addressing.addresses).toHaveLength(1);
  });

  it('una dirección en un puerto de bridge queda inválida (flag I)', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    t.ok('/interface bridge add name=bridge1');
    t.ok('/interface bridge port add bridge=bridge1 interface=ether2');
    const out = t.ok('/ip address print');
    expect(out.split('\n')[0]).toBe('Flags: I - INVALID');
    expect(rowFlags(out, '192.168.88.1/24')).toBe('I');
    expect(rowFlags(t.ok('/interface print'), 'ether2')).toBe('RS');
    expect(
      holds(t.net, {
        kind: 'hasAddress',
        device: deviceId('R1'),
        iface: { name: 'ether2' },
        prefix: prefix('192.168.88.1/24'),
      }),
    ).toBe(false);
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(false);
    // La solución: la dirección va en el bridge.
    t.ok('/ip address set [find interface=ether2] interface=bridge1');
    expect(rowFlags(t.ok('/ip address print'), '192.168.88.1/24')).toBe('');
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(true);
  });

  it('ping a una PC conectada directamente', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    const lines = t.ok('/ping 192.168.88.10 count=3').split('\n');
    expect(lines[0]).toBe(
      '  SEQ HOST                                     SIZE TTL TIME       STATUS',
    );
    expect(lines.slice(1, 4).map((l) => l.trim().split(/\s+/).slice(0, 3))).toEqual([
      ['0', '192.168.88.10', '56'],
      ['1', '192.168.88.10', '56'],
      ['2', '192.168.88.10', '56'],
    ]);
    expect(lines[4]).toMatch(/^ {4}sent=3 received=3 packet-loss=0% min-rtt=/);
    // Ping continuo: se corta con Ctrl+C.
    t.ok('/ping 192.168.88.10');
    expect(t.last?.live?.stop?.(t.net, 4)).toContain('sent=4 received=4 packet-loss=0%');
    t.key('ctrl-c');
    expect(t.prompt).toBe('[admin@MikroTik] > ');
  });

  it('ping a una PC conectada directamente muestra TTL 64', () => {
    const t = new Terminal(lab2(), 'R1');
    t.ok('/ip address add address=192.168.88.1/24 interface=ether2');
    const reply = t.ok('/ping 192.168.88.10 count=1').split('\n')[1] ?? '';
    expect(reply.trim().split(/\s+/)[3]).toBe('64');
  });
});

// ── Lab 3: rutas estáticas ──────────────────────────────────────────────────

/**
 * R1 y R2 unidos por una /30 en ether1 (y un segundo enlace en ether3 para el
 * respaldo), cada uno con su LAN en ether2. Las PCs ya tienen su gateway.
 */
function lab3(): Network {
  const base = net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .router('R2', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .link('R1:ether1', 'R2:ether1')
    .link('R1:ether3', 'R2:ether3')
    .link('R1:ether2', 'PC1:eth0')
    .link('R2:ether2', 'PC2:eth0')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .address('PC2', 'eth0', '192.168.2.10/24')
    .route('PC2', '0.0.0.0/0', '192.168.2.1')
    .build();
  const withR1 = cli(base, 'R1', [
    '/ip address add address=10.0.12.1/30 interface=ether1',
    '/ip address add address=192.168.1.1/24 interface=ether2',
  ]);
  return cli(withR1, 'R2', [
    '/ip address add address=10.0.12.2/30 interface=ether1',
    '/ip address add address=192.168.2.1/24 interface=ether2',
  ]);
}

/** R1 y R2 con las rutas estáticas hacia la LAN del otro. */
const lab3Routed = (): Network =>
  cli(cli(lab3(), 'R1', ['/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2']), 'R2', [
    '/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1',
  ]);

describe('Lab 3: rutas estáticas', () => {
  it('sin rutas estáticas R1 no sabe llegar a la LAN remota', () => {
    const result = icmp(lab3(), 'PC1', '192.168.2.10');
    expect(result.ok).toBe(false);
    expect(result.forward.end).toEqual({ kind: 'no-route', device: 'R1' });
  });

  it('con la ruta solo en R1 la ida llega pero la vuelta se pierde en R2', () => {
    const network = cli(lab3(), 'R1', [
      '/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2',
    ]);
    const result = icmp(network, 'PC1', '192.168.2.10');
    expect(result.forward.end).toEqual({ kind: 'delivered', device: 'PC2', emulated: false });
    expect(result.reply?.end).toEqual({ kind: 'no-route', device: 'R2' });
    expect(result.ok).toBe(false);
  });

  it('con las rutas en los dos routers hay conectividad en ambos sentidos', () => {
    const network = lab3Routed();
    expect(icmp(network, 'PC1', '192.168.2.10').ok).toBe(true);
    expect(icmp(network, 'PC2', '192.168.1.10').ok).toBe(true);
    expect(
      holds(network, {
        kind: 'reachable',
        from: deviceId('PC1'),
        to: { device: deviceId('PC2') },
        protocol: 'icmp',
      }),
    ).toBe(true);
    expect(
      holds(network, {
        kind: 'routeActive',
        device: deviceId('R1'),
        dst: prefix('192.168.2.0/24'),
        via: { ip: ipv4('10.0.12.2') },
      }),
    ).toBe(true);
  });

  it('/ip route print distingue rutas estáticas (As) y conectadas (DAc)', () => {
    const t = new Terminal(lab3Routed(), 'R1');
    expect(t.ok('/ip route print')).toBe(
      [
        'Flags: D - DYNAMIC; A - ACTIVE; c - CONNECT, s - STATIC',
        'Columns: DST-ADDRESS, GATEWAY, DISTANCE',
        '#     DST-ADDRESS     GATEWAY    DISTANCE',
        '0  As 192.168.2.0/24  10.0.12.2         1',
        '  DAc 10.0.12.0/30    ether1            0',
        '  DAc 192.168.1.0/24  ether2            0',
      ].join('\n'),
    );
    const detail = t.ok('/ip route print detail where static');
    expect(detail).toContain('dst-address=192.168.2.0/24 gateway=10.0.12.2');
    expect(detail).toContain('10.0.12.2%ether1');
    expect(t.ok('/ip route print count-only where dynamic')).toBe('2');
  });

  it('un gateway mal escrito deja la ruta inactiva (I) y no hay conectividad', () => {
    const network = cli(lab3(), 'R1', [
      '/ip route add dst-address=192.168.2.0/24 gateway=10.0.21.2',
    ]);
    const t = new Terminal(network, 'R1');
    const out = t.ok('/ip route print');
    expect(out.split('\n')[0]).toBe(
      'Flags: D - DYNAMIC; I - INACTIVE, A - ACTIVE; c - CONNECT, s - STATIC',
    );
    expect(rowFlags(out, '192.168.2.0/24')).toBe('Is');
    expect(icmp(network, 'PC1', '192.168.2.10').forward.end).toEqual({
      kind: 'no-route',
      device: 'R1',
    });
    // Corregirlo con set deja la ruta activa.
    t.ok('/ip route set [find dst-address=192.168.2.0/24] gateway=10.0.12.2');
    expect(rowFlags(t.ok('/ip route print'), '192.168.2.0/24')).toBe('As');
  });

  it('errores típicos al añadir rutas', () => {
    const t = new Terminal(lab3(), 'R1');
    expect(t.run('/ip route add dst-address=192.168.2.0/24')).toBe(
      'missing value(s) of argument(s) gateway',
    );
    expect(t.run('/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2 distance=0')).toBe(
      'value of distance out of range (1..255)',
    );
    expect(
      t.run('/ip route add dst-address=192.168.2.1/24 gateway=10.0.12.2').length,
    ).toBeGreaterThan(0);
    expect(t.last?.ok).toBe(false);
    expect(t.device.config.routing.static).toEqual([]);
  });

  it('un gateway por interfaz en Ethernet no basta sin proxy-arp en el vecino', () => {
    const network = cli(
      cli(lab3(), 'R1', ['/ip route add dst-address=192.168.2.0/24 gateway=ether1']),
      'R2',
      ['/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1'],
    );
    const result = icmp(network, 'PC1', '192.168.2.10');
    expect(result.ok).toBe(false);
    expect(result.forward.end).toMatchObject({ kind: 'arp-failed', device: 'R1' });
  });

  it('failover por distancia: si cae el enlace principal entra la ruta de respaldo', () => {
    const backup = cli(
      cli(lab3(), 'R1', [
        '/ip address add address=10.0.21.1/30 interface=ether3',
        '/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2 distance=1',
        '/ip route add dst-address=192.168.2.0/24 gateway=10.0.21.2 distance=2',
      ]),
      'R2',
      [
        '/ip address add address=10.0.21.2/30 interface=ether3',
        '/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1 distance=1',
        '/ip route add dst-address=192.168.1.0/24 gateway=10.0.21.1 distance=2',
      ],
    );
    const t = new Terminal(backup, 'R1');
    const outOfR1 = () =>
      icmp(t.net, 'PC1', '192.168.2.10').forward.hops.find((h) => h.device === 'R1')?.outIface;
    expect(icmp(t.net, 'PC1', '192.168.2.10').ok).toBe(true);
    expect(outOfR1()).toBe(ifaceIdOf(t.net, 'R1', 'ether1'));
    const before = t.ok('/ip route print where dst-address=192.168.2.0/24');
    expect(rowOf(before, '192.168.2.0/24')).toMatch(/^0 As 192\.168\.2\.0\/24\s+10\.0\.12\.2\s+1$/);

    t.ok('/interface disable ether1');
    expect(icmp(t.net, 'PC1', '192.168.2.10').ok).toBe(true);
    expect(outOfR1()).toBe(ifaceIdOf(t.net, 'R1', 'ether3'));
    const after = t.ok('/ip route print where dst-address=192.168.2.0/24').split('\n');
    expect(after.slice(-2)).toEqual([
      '0 Is 192.168.2.0/24  10.0.12.2         1',
      '1 As 192.168.2.0/24  10.0.21.2         2',
    ]);

    t.ok('/interface enable ether1');
    expect(outOfR1()).toBe(ifaceIdOf(t.net, 'R1', 'ether1'));
  });

  it('check-gateway=ping desactiva la ruta cuyo gateway no responde', () => {
    // El enlace sigue arriba pero R2 ya no tiene la 10.0.12.2: nadie contesta en ese gateway.
    const network = cli(lab3(), 'R2', ['/ip address remove [find address="10.0.12.2/30"]']);
    const t = new Terminal(network, 'R1');
    t.ok('/ip address add address=10.0.21.1/30 interface=ether3');
    t.ok('/ip route add gateway=10.0.12.2 distance=1 check-gateway=ping');
    t.ok('/ip route add gateway=10.0.21.2 distance=2');
    const out = t.ok('/ip route print where dst-address=0.0.0.0/0');
    expect(rowOf(out, '0.0.0.0/0')).toMatch(/Is\s+0\.0\.0\.0\/0\s+10\.0\.12\.2/);
    expect(
      holds(t.net, {
        kind: 'routeActive',
        device: deviceId('R1'),
        dst: prefix('0.0.0.0/0'),
        via: { ip: ipv4('10.0.21.2') },
      }),
    ).toBe(true);
  });

  it('una ruta blackhole descarta el tráfico sin buscar gateway', () => {
    const t = new Terminal(lab3Routed(), 'R1');
    t.ok('/ip route add dst-address=10.99.0.0/16 blackhole');
    expect(t.device.config.routing.static.at(-1)?.gateway).toEqual({ kind: 'blackhole' });
    const out = t.ok('/ip route print');
    expect(out.split('\n')[0]).toContain('B - BLACKHOLE');
    expect(rowFlags(out, '10.99.0.0/16')).toContain('B');
    expect(icmp(t.net, 'PC1', '10.99.1.1').forward.end).toEqual({
      kind: 'blackhole',
      device: 'R1',
    });
    // Lo demás sigue funcionando.
    expect(icmp(t.net, 'PC1', '192.168.2.10').ok).toBe(true);
  });

  it('/tool traceroute muestra cada salto hasta la PC remota', () => {
    const t = new Terminal(lab3Routed(), 'R1');
    const lines = t.ok('/tool traceroute 192.168.2.10').split('\n');
    expect(lines[0]).toMatch(/^Columns: ADDRESS, LOSS, SENT, LAST/);
    expect(lines[2]).toMatch(/^1\s+10\.0\.12\.2\s+0%/);
    expect(lines[3]).toMatch(/^2\s+192\.168\.2\.10\s+0%/);
    expect(lines).toHaveLength(4);
  });

  it('el ping desde R1 engaña: sale con 10.0.12.1 y no prueba la vuelta hacia la LAN', () => {
    const t = new Terminal(
      cli(lab3(), 'R1', ['/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2']),
      'R1',
    );
    // R2 conoce 10.0.12.0/30 (conectada), así que desde el router todo parece bien...
    expect(t.ok('/ping 192.168.2.10 count=1')).toContain('received=1');
    expect(t.ok('/tool traceroute 192.168.2.10').split('\n').at(-1)).toMatch(
      /^2\s+192\.168\.2\.10\s+0%/,
    );
    // ...pero con origen en la LAN la respuesta no vuelve, igual que para PC1.
    expect(t.ok('/ping 192.168.2.10 count=1 src-address=192.168.1.1')).toContain(
      'packet-loss=100%',
    );
    expect(icmp(t.net, 'PC1', '192.168.2.10').ok).toBe(false);
  });

  it('traceroute con count=1 envía una sola sonda por salto', () => {
    const t = new Terminal(lab3Routed(), 'R1');
    const lines = t.ok('/tool traceroute 192.168.2.10 count=1').split('\n');
    expect(lines[2]).toMatch(/^1\s+10\.0\.12\.2\s+0%\s+1\s/);
  });
});

// ── Lab 4: bridge y VLANs ───────────────────────────────────────────────────

/** Tres PCs de la misma subred en ether2-ether4 de R1. */
function lab4Bridge(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .host('PC3')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .link('R1:ether4', 'PC3:eth0')
    .address('PC1', 'eth0', '192.168.88.11/24')
    .address('PC2', 'eth0', '192.168.88.12/24')
    .address('PC3', 'eth0', '192.168.88.13/24')
    .build();
}

/**
 * Router-on-a-stick: R1 con PC1 (VLAN 10) en ether2, PC2 (VLAN 20) en ether3 y
 * un troncal en ether5 hacia SW (otro RouterOS usado como switch) con PC3
 * (VLAN 10) en ether2 y PC4 (VLAN 20) en ether3.
 */
function lab4Vlans(): Network {
  return net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .router('SW', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .host('PC3')
    .host('PC4')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .link('R1:ether5', 'SW:ether1')
    .link('SW:ether2', 'PC3:eth0')
    .link('SW:ether3', 'PC4:eth0')
    .address('PC1', 'eth0', '10.0.10.11/24')
    .route('PC1', '0.0.0.0/0', '10.0.10.1')
    .address('PC2', 'eth0', '10.0.20.12/24')
    .route('PC2', '0.0.0.0/0', '10.0.20.1')
    .address('PC3', 'eth0', '10.0.10.13/24')
    .route('PC3', '0.0.0.0/0', '10.0.10.1')
    .address('PC4', 'eth0', '10.0.20.14/24')
    .route('PC4', '0.0.0.0/0', '10.0.20.1')
    .build();
}

const R1_PORTS = [
  '/interface bridge add name=bridge1',
  '/interface bridge port add bridge=bridge1 interface=ether2 pvid=10',
  '/interface bridge port add bridge=bridge1 interface=ether3 pvid=20',
  '/interface bridge port add bridge=bridge1 interface=ether5',
];

const R1_L3 = [
  '/interface vlan add name=vlan10 vlan-id=10 interface=bridge1',
  '/interface vlan add name=vlan20 vlan-id=20 interface=bridge1',
  '/ip address add address=10.0.10.1/24 interface=vlan10',
  '/ip address add address=10.0.20.1/24 interface=vlan20',
];

/** R1 completo; `tagged` es la lista de miembros etiquetados de las VLAN 10 y 20. */
const r1Vlans = (tagged: string): readonly string[] => [
  ...R1_PORTS,
  `/interface bridge vlan add bridge=bridge1 vlan-ids=10 tagged=${tagged}`,
  `/interface bridge vlan add bridge=bridge1 vlan-ids=20 tagged=${tagged}`,
  ...R1_L3,
  '/interface bridge set bridge1 vlan-filtering=yes',
];

const swVlans = (vlanIds: string): readonly string[] => [
  '/system identity set name=SW',
  '/interface bridge add name=bridge1',
  '/interface bridge port add bridge=bridge1 interface=ether1',
  '/interface bridge port add bridge=bridge1 interface=ether2 pvid=10',
  '/interface bridge port add bridge=bridge1 interface=ether3 pvid=20',
  `/interface bridge vlan add bridge=bridge1 vlan-ids=${vlanIds} tagged=ether1`,
  '/interface bridge set bridge1 vlan-filtering=yes',
];

describe('Lab 4: bridge y VLANs', () => {
  it('un bridge con ether2-ether4 pone a las PCs en el mismo dominio L2', () => {
    const t = new Terminal(lab4Bridge(), 'R1');
    // Sin bridge cada puerto es una red aparte: R1 no conmuta.
    expect(icmp(t.net, 'PC1', '192.168.88.12').ok).toBe(false);
    t.script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2',
      '/interface bridge port add bridge=bridge1 interface=ether3',
      '/interface bridge port add bridge=bridge1 interface=ether4',
    ]);
    expect(icmp(t.net, 'PC1', '192.168.88.12').ok).toBe(true);
    expect(icmp(t.net, 'PC3', '192.168.88.11').ok).toBe(true);
    // Es conmutación pura: R1 no aparece como salto L3.
    expect(icmp(t.net, 'PC1', '192.168.88.13').forward.hops.map((h) => h.device)).toEqual([
      'PC1',
      'PC3',
    ]);
    t.ok('/ip address add address=192.168.88.1/24 interface=bridge1');
    expect(t.ok('/ping 192.168.88.13 count=1')).toContain('received=1');
  });

  it('/interface bridge port print y la flag S de los puertos esclavos', () => {
    const t = new Terminal(lab4Bridge(), 'R1').script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2',
      '/interface bridge port add bridge=bridge1 interface=ether5',
    ]);
    const ports = t.ok('/interface bridge port print');
    expect(ports).toContain('Columns: INTERFACE, BRIDGE');
    expect(rowOf(ports, 'ether2')).toMatch(/^0\s+ether2\s+bridge1\s/);
    // ether5 no tiene cable: puerto inactivo.
    expect(rowFlags(ports, 'ether5')).toBe('I');
    const ifaces = t.ok('/interface print');
    expect(rowFlags(ifaces, 'ether2')).toBe('RS');
    expect(rowFlags(ifaces, 'bridge1')).toBe('R');
    expect(t.run('/interface bridge port add bridge=bridge1 interface=ether2')).toBe(
      'failure: device already added as bridge port',
    );
    expect(t.run('/interface bridge port add bridge=bridge2 interface=ether3')).toBe(
      'input does not match any value of bridge',
    );
  });

  it('/interface bridge host print aprende las MAC de las PCs en su puerto', () => {
    const t = new Terminal(lab4Bridge(), 'R1').script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2',
      '/interface bridge port add bridge=bridge1 interface=ether3',
    ]);
    const out = t.ok('/interface bridge host print');
    expect(out).toContain('Columns: MAC-ADDRESS, VID, ON-INTERFACE, BRIDGE');
    const pc1 = macOf(t.net, 'PC1');
    expect(rowFlags(out, pc1)).toBe('D');
    expect(rowOf(out, pc1)).toMatch(/ether2\s+bridge1$/);
    expect(rowOf(out, macOf(t.net, 'PC2'))).toMatch(/ether3\s+bridge1$/);
    // Las MAC propias de los puertos son locales.
    expect(rowFlags(out, macOf(t.net, 'R1', 'ether2'))).toBe('DL');
  });

  it('con vlan-filtering cada puerto toma su pvid y aparecen filas dinámicas', () => {
    const t = new Terminal(lab4Vlans(), 'R1').script([
      ...R1_PORTS,
      '/interface bridge set bridge1 vlan-filtering=yes',
    ]);
    const bridge = t.device.config.interfaces.find((i) => i.name === 'bridge1');
    expect(bridge?.kind === 'bridge' && bridge.vlanFiltering).toBe(true);
    expect(t.device.config.bridging.ports.map((p) => p.pvid)).toEqual([10, 20, 1]);
    const out = t.ok('/interface bridge vlan print');
    expect(out.split('\n')[0]).toBe('Flags: D - DYNAMIC');
    const rows = out.split('\n').filter((l) => / D bridge1 /.test(l));
    expect(rows).toHaveLength(3);
    expect(rows.find((l) => /bridge1\s+10\s/.test(l))).toMatch(/ether2$/);
    expect(rows.find((l) => /bridge1\s+20\s/.test(l))).toMatch(/ether3$/);
    expect(rows.find((l) => /bridge1\s+1\s/.test(l))).toContain('bridge1');
    expect(t.device.config.bridging.vlans).toEqual([]);
    expect(t.run('/interface bridge vlan remove 0')).toBe('failure: can not change dynamic');
  });

  it('error clásico: olvidar tagged=bridge1 deja a las VLAN sin router', () => {
    const t = new Terminal(cli(lab4Vlans(), 'R1', r1Vlans('ether5')), 'R1');
    expect(icmp(t.net, 'PC1', '10.0.10.1').forward.end).toMatchObject({
      kind: 'arp-failed',
      device: 'PC1',
    });
    expect(icmp(t.net, 'PC1', '10.0.20.12').ok).toBe(false);
    const out = t.ok('/interface bridge vlan print');
    expect(out.split('\n').find((l) => /^0\s+bridge1\s+10\s/.test(l))).toMatch(
      /10\s+ether5\s+ether2$/,
    );
    // La interfaz VLAN existe y está "running", pero no recibe nada del bridge.
    expect(rowFlags(t.ok('/interface vlan print'), 'vlan10')).toBe('R');
  });

  it('con tagged=bridge1 hay ruteo entre VLANs (router-on-a-stick)', () => {
    const t = new Terminal(cli(lab4Vlans(), 'R1', r1Vlans('ether5')), 'R1');
    t.ok('/interface bridge vlan set [find vlan-ids=10] tagged=bridge1,ether5');
    t.ok('/interface bridge vlan set [find vlan-ids=20] tagged=bridge1,ether5');
    expect(icmp(t.net, 'PC1', '10.0.10.1').ok).toBe(true);
    const routed = icmp(t.net, 'PC1', '10.0.20.12');
    expect(routed.ok).toBe(true);
    expect(routed.forward.hops.map((h) => h.device)).toEqual(['PC1', 'R1', 'PC2']);
    const out = t.ok('/interface bridge vlan print');
    expect(out.split('\n').find((l) => /^0\s+bridge1\s+10\s/.test(l))).toMatch(
      /10\s+bridge1,ether5\s+ether2$/,
    );
    expect(t.ok('/interface vlan print')).toBe(
      [
        'Flags: R - RUNNING',
        'Columns: NAME, MTU, ARP, VLAN-ID, INTERFACE',
        '#   NAME     MTU  ARP      VLAN-ID  INTERFACE',
        '0 R vlan10  1500  enabled       10  bridge1',
        '1 R vlan20  1500  enabled       20  bridge1',
      ].join('\n'),
    );
  });

  it('el troncal lleva las dos VLAN hasta el segundo equipo', () => {
    const network = cli(cli(lab4Vlans(), 'R1', r1Vlans('bridge1,ether5')), 'SW', swVlans('10,20'));
    // Misma VLAN a través del troncal: conmutación, sin pasar por la CPU de R1.
    const sameVlan = icmp(network, 'PC1', '10.0.10.13');
    expect(sameVlan.ok).toBe(true);
    expect(sameVlan.forward.hops.map((h) => h.device)).toEqual(['PC1', 'PC3']);
    // Entre VLANs del switch: sube por el troncal y R1 rutea.
    const between = icmp(network, 'PC3', '10.0.20.14');
    expect(between.ok).toBe(true);
    expect(between.forward.hops.map((h) => h.device)).toEqual(['PC3', 'R1', 'PC4']);
    expect(
      holds(network, {
        kind: 'reachable',
        from: deviceId('PC4'),
        to: { device: deviceId('PC1') },
        protocol: 'icmp',
      }),
    ).toBe(true);
  });

  it('si el troncal no lleva la VLAN 20, la PC de esa VLAN en el switch queda aislada', () => {
    const network = cli(cli(lab4Vlans(), 'R1', r1Vlans('bridge1,ether5')), 'SW', swVlans('10'));
    expect(icmp(network, 'PC3', '10.0.10.1').ok).toBe(true);
    expect(icmp(network, 'PC4', '10.0.20.1').ok).toBe(false);
    expect(icmp(network, 'PC2', '10.0.20.14').ok).toBe(false);
  });

  it('/interface bridge host print del switch muestra las MAC por VLAN', () => {
    const network = cli(cli(lab4Vlans(), 'R1', r1Vlans('bridge1,ether5')), 'SW', swVlans('10,20'));
    const sw = new Terminal(network, 'SW');
    expect(sw.prompt).toBe('[admin@SW] > ');
    const out = sw.ok('/interface bridge host print').split('\n');
    const r1Bridge = macOf(network, 'R1', 'bridge1');
    const r1Rows = out.filter((l) => l.includes(r1Bridge));
    expect(r1Rows).toHaveLength(2);
    expect(r1Rows[0]).toMatch(/\s10\s+ether1\s+bridge1$/);
    expect(r1Rows[1]).toMatch(/\s20\s+ether1\s+bridge1$/);
    expect(out.find((l) => l.includes(macOf(network, 'PC3')))).toMatch(/\s10\s+ether2\s+bridge1$/);
    expect(out.find((l) => l.includes(macOf(network, 'PC4')))).toMatch(/\s20\s+ether3\s+bridge1$/);
  });
});

// ── Lab 5: servidor DHCP ────────────────────────────────────────────────────

/** R1 con tres PCs en DHCP (ether2-4) y un ISP que da DHCP en ether1. */
function lab5(): Network {
  return net()
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
    .dhcpClient('PC3', 'eth0')
    .build();
}

const LAN = [
  '/interface bridge add name=bridge1',
  '/interface bridge port add bridge=bridge1 interface=ether2',
  '/interface bridge port add bridge=bridge1 interface=ether3',
  '/interface bridge port add bridge=bridge1 interface=ether4',
  '/ip address add address=192.168.88.1/24 interface=bridge1',
];

const dhcpLan = (ranges: string): readonly string[] => [
  ...LAN,
  `/ip pool add name=pool-lan ranges=${ranges}`,
  '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
  '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
];

describe('Lab 5: servidor DHCP', () => {
  it('el pool, el servidor (dhcp1) y la red se crean por la CLI', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    expect(t.ok('/ip pool print')).toBe(
      [
        'Columns: NAME, RANGES',
        '# NAME      RANGES',
        '0 pool-lan  192.168.88.10-192.168.88.254',
      ].join('\n'),
    );
    expect(t.device.config.dhcpServer.servers.map((s) => s.name)).toEqual(['dhcp1']);
    expect(rowOf(t.ok('/ip dhcp-server print'), 'dhcp1')).toMatch(
      /^0 dhcp1\s+bridge1\s+pool-lan\s+30m$/,
    );
    expect(rowOf(t.ok('/ip dhcp-server network print'), '192.168.88.0/24')).toMatch(
      /192\.168\.88\.0\/24\s+192\.168\.88\.1\s+192\.168\.88\.1$/,
    );
  });

  it('los clientes reciben dirección desde lo más alto del pool, con gateway y DNS', () => {
    const t = new Terminal(lab5(), 'R1').script(LAN);
    expect(dhcpOf(t.net, 'PC1')?.status).toBe('searching');
    t.script([
      '/ip pool add name=pool-lan ranges=192.168.88.10-192.168.88.254',
      '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
    ]);
    expect(['PC1', 'PC2', 'PC3'].map((pc) => addressOf(t.net, pc))).toEqual([
      '192.168.88.254/24',
      '192.168.88.253/24',
      '192.168.88.252/24',
    ]);
    const pc1 = dhcpOf(t.net, 'PC1');
    expect(pc1?.gateway === undefined ? '' : formatIpv4(pc1.gateway)).toBe('192.168.88.1');
    expect(pc1?.dns.map(formatIpv4)).toEqual(['192.168.88.1']);
    expect(
      holds(t.net, {
        kind: 'leaseBound',
        server: deviceId('R1'),
        client: deviceId('PC3'),
        within: prefix('192.168.88.0/24'),
      }),
    ).toBe(true);
    expect(icmp(t.net, 'PC1', '192.168.88.1').ok).toBe(true);
    expect(icmp(t.net, 'PC1', '192.168.88.252').ok).toBe(true);
  });

  it('/ip dhcp-server lease print muestra los leases dinámicos y el log las asignaciones', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    const out = t.ok('/ip dhcp-server lease print');
    expect(out.split('\n').slice(0, 2)).toEqual([
      'Flags: D - DYNAMIC',
      'Columns: ADDRESS, MAC-ADDRESS, HOST-NAME, SERVER, STATUS, LAST-SEEN',
    ]);
    expect(rowOf(out, '192.168.88.254')).toBe(
      `0 D 192.168.88.254  ${macOf(t.net, 'PC1')}  PC1        dhcp1   bound   0s`,
    );
    expect(rowFlags(out, '192.168.88.252')).toBe('D');
    expect(t.ok('/ip dhcp-server lease print detail where host-name=PC2')).toContain(
      'status=bound expires-after=30m',
    );
    expect(t.ok('/log print')).toContain(
      `dhcp,info dhcp1 assigned 192.168.88.254 for ${macOf(t.net, 'PC1')} PC1`,
    );
  });

  it('make-static convierte un lease dinámico en estático y permite fijar otra IP', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    t.ok('/ip dhcp-server lease print');
    t.ok('/ip dhcp-server lease make-static [find host-name=PC2]');
    expect(t.device.config.dhcpServer.staticLeases.map((l) => [l.mac, formatIpv4(l.ip)])).toEqual([
      [macOf(t.net, 'PC2'), '192.168.88.253'],
    ]);
    expect(rowFlags(t.ok('/ip dhcp-server lease print'), '192.168.88.253')).toBe('');
    t.ok('/ip dhcp-server lease set [find host-name=PC2] address=192.168.88.50');
    expect(addressOf(t.net, 'PC2')).toBe('192.168.88.50/24');
    // Los dinámicos no cambian.
    expect(addressOf(t.net, 'PC1')).toBe('192.168.88.254/24');
  });

  it('un lease estático reserva una IP para una MAC concreta', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    t.ok(`/ip dhcp-server lease add address=192.168.88.50 mac-address=${macOf(t.net, 'PC3')}`);
    expect(addressOf(t.net, 'PC3')).toBe('192.168.88.50/24');
    const out = t.ok('/ip dhcp-server lease print');
    expect(rowFlags(out, '192.168.88.50')).toBe('');
    expect(rowOf(out, '192.168.88.50')).toMatch(/192\.168\.88\.50\s+\S+\s+PC3\s+all\s+bound/);
    // Una reserva para una MAC que no está en la red queda esperando.
    t.ok('/ip dhcp-server lease add address=192.168.88.60 mac-address=00:11:22:33:44:55');
    expect(rowOf(t.ok('/ip dhcp-server lease print'), '192.168.88.60')).toMatch(/waiting\s+never$/);
    expect(
      t.run('/ip dhcp-server lease add address=192.168.88.61 mac-address=00:11:22:33:44'),
    ).toBe('invalid value for argument mac-address');
  });

  it('pool agotado: el tercer cliente se queda buscando', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.100-192.168.88.101'));
    expect(['PC1', 'PC2', 'PC3'].map((pc) => addressOf(t.net, pc))).toEqual([
      '192.168.88.101/24',
      '192.168.88.100/24',
      undefined,
    ]);
    expect(dhcpOf(t.net, 'PC3')?.status).toBe('searching');
    expect(t.ok('/ip dhcp-server lease print count-only')).toBe('2');
    // Ampliar el pool resuelve el problema.
    t.ok('/ip pool set pool-lan ranges=192.168.88.100-192.168.88.110');
    expect(addressOf(t.net, 'PC3')).toBe('192.168.88.110/24');
  });

  it('el log avisa cuando el pool se agota', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.100-192.168.88.101'));
    expect(t.ok('/log print')).toContain(
      'dhcp1 failed to give out IP address: pool <pool-lan> is empty',
    );
  });

  it('/ip pool used print muestra las direcciones entregadas', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.100-192.168.88.101'));
    const out = t.ok('/ip pool used print');
    expect(out).toContain('pool-lan');
    expect(out).toContain('192.168.88.101');
  });

  it('se puede borrar un lease dinámico para que el cliente pida otro', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    t.ok('/ip dhcp-server lease print');
    t.ok('/ip dhcp-server lease remove [find host-name=PC1]');
  });

  it('un servidor DHCP sobre un puerto del bridge queda inválido y no entrega nada', () => {
    const t = new Terminal(lab5(), 'R1').script([
      ...LAN,
      '/ip pool add name=pool-lan ranges=192.168.88.10-192.168.88.254',
      '/ip dhcp-server add interface=ether2 address-pool=pool-lan',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1',
    ]);
    const out = t.ok('/ip dhcp-server print');
    expect(out.split('\n')[0]).toBe('Flags: I - INVALID');
    expect(rowFlags(out, 'dhcp1')).toBe('I');
    expect(dhcpOf(t.net, 'PC1')?.status).toBe('searching');
    expect(t.ok('/ip dhcp-server lease print')).toBe('');
    t.ok('/ip dhcp-server set dhcp1 interface=bridge1');
    expect(addressOf(t.net, 'PC1')).toBe('192.168.88.254/24');
  });

  it('sin /ip dhcp-server network los clientes no reciben gateway ni DNS', () => {
    const t = new Terminal(lab5(), 'R1').script([
      ...LAN,
      '/ip pool add name=pool-lan ranges=192.168.88.10-192.168.88.254',
      '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
    ]);
    const pc1 = dhcpOf(t.net, 'PC1');
    expect(pc1?.status).toBe('bound');
    expect(pc1?.gateway).toBeUndefined();
    expect(pc1?.dns).toEqual([]);
  });

  it('errores típicos: pool inexistente y segundo servidor en la misma interfaz', () => {
    const t = new Terminal(lab5(), 'R1').script(dhcpLan('192.168.88.10-192.168.88.254'));
    expect(t.run('/ip dhcp-server add interface=bridge1 address-pool=pool-lna')).toBe(
      'input does not match any value of address-pool',
    );
    expect(t.run('/ip dhcp-server add interface=bridge1 address-pool=pool-lan')).toMatch(
      /^failure: /,
    );
    expect(t.run('/ip pool add name=otro ranges=192.168.88.300-192.168.88.310')).toBe(
      'invalid value for argument ranges',
    );
    expect(t.device.config.dhcpServer.servers).toHaveLength(1);
  });

  it('cliente DHCP en la WAN: el ISP le da dirección, ruta por defecto y DNS', () => {
    const t = new Terminal(lab5(), 'R1');
    t.ok('/ip dhcp-client add interface=ether1');
    const client = t.ok('/ip dhcp-client print');
    expect(client.split('\n')[0]).toBe(
      'Columns: INTERFACE, USE-PEER-DNS, ADD-DEFAULT-ROUTE, STATUS, ADDRESS',
    );
    expect(rowOf(client, 'ether1')).toMatch(/^0 ether1\s+yes\s+yes\s+bound\s+203\.0\.113\.10\/24$/);
    expect(t.ok('/ip dhcp-client print detail')).toContain('gateway=203.0.113.1');
    const addresses = t.ok('/ip address print');
    expect(rowFlags(addresses, '203.0.113.10/24')).toBe('D');
    expect(t.run('/ip address remove 0')).toBe('failure: can not change dynamic');
    const routes = t.ok('/ip route print');
    expect(rowOf(routes, '0.0.0.0/0')).toMatch(/^\s+DAd 0\.0\.0\.0\/0\s+203\.0\.113\.1\s+1$/);
    expect(t.ok('/ip dns print')).toContain('dynamic-servers: 1.1.1.1');
    expect(t.ok('/ping 8.8.8.8 count=1')).toContain('received=1');
    expect(t.ok(':resolve example.com')).toBe('93.184.216.34');
    expect(
      holds(t.net, {
        kind: 'leaseBound',
        server: deviceId('ISP'),
        client: deviceId('R1'),
      }),
    ).toBe(true);
  });
});

// ── Lab 6: NAT y masquerade ─────────────────────────────────────────────────

/**
 * R1 con el ISP en ether1 (Internet emulado), PC1 en ether2 y un servidor web
 * (SRV, puerto 80) en ether3. `srvGateway=false` deja al servidor sin gateway.
 */
function lab6Net(srvGateway = true): Network {
  const builder = net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('SRV')
    .cloud('ISP')
    .link('R1:ether1', 'ISP:eth0')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'SRV:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('PC1', 'eth0', '192.168.88.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.88.1')
    .dns('PC1', ['8.8.8.8'])
    .address('SRV', 'eth0', '192.168.99.20/24')
    .service('SRV', 'http', 80);
  return (srvGateway ? builder.route('SRV', '0.0.0.0/0', '192.168.99.1') : builder).build();
}

const WAN_LAN = [
  '/ip address add address=203.0.113.2/24 interface=ether1',
  '/ip address add address=192.168.88.1/24 interface=ether2',
  '/ip address add address=192.168.99.1/24 interface=ether3',
  '/ip route add gateway=203.0.113.1',
];

const lab6 = (srvGateway = true): Terminal =>
  new Terminal(lab6Net(srvGateway), 'R1').script(WAN_LAN);

const PORT_FORWARD =
  '/ip firewall nat add chain=dstnat in-interface=ether1 protocol=tcp dst-port=8080 action=dst-nat to-addresses=192.168.99.20 to-ports=80';

describe('Lab 6: NAT y masquerade', () => {
  it('sin NAT la ida llega a Internet pero la respuesta nunca vuelve', () => {
    const t = lab6();
    const result = icmp(t.net, 'PC1', '8.8.8.8');
    expect(result.forward.end).toEqual({ kind: 'delivered', device: 'ISP', emulated: true });
    // Internet ve una dirección privada y no sabe devolverle nada.
    expect(result.delivered?.src === undefined ? '' : formatIpv4(result.delivered.src)).toBe(
      '192.168.88.10',
    );
    expect(result.reply?.end).toEqual({ kind: 'no-route', device: 'ISP' });
    expect(result.ok).toBe(false);
    // El propio router sí sale: usa su IP pública.
    expect(t.ok('/ping 8.8.8.8 count=1')).toContain('received=1');
  });

  it('masquerade por ether1: la LAN sale con la IP de la WAN', () => {
    const t = lab6();
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    const result = icmp(t.net, 'PC1', '8.8.8.8');
    expect(result.ok).toBe(true);
    expect(result.delivered?.src === undefined ? '' : formatIpv4(result.delivered.src)).toBe(
      '203.0.113.2',
    );
    expect(
      holds(t.net, {
        kind: 'natSourceIs',
        from: deviceId('PC1'),
        to: { ip: ipv4('8.8.8.8') },
        protocol: 'icmp',
        expect: { addressOf: { device: deviceId('R1'), iface: { name: 'ether1' } } },
      }),
    ).toBe(true);
    expect(t.device.config.firewall.nat.map((r) => [r.chain, r.action.kind])).toEqual([
      ['srcnat', 'masquerade'],
    ]);
  });

  it('error típico: masquerade en la interfaz de la LAN no da Internet', () => {
    const t = lab6();
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade');
    expect(icmp(t.net, 'PC1', '8.8.8.8').ok).toBe(false);
    t.ok('/ip firewall nat set 0 out-interface=ether1');
    expect(icmp(t.net, 'PC1', '8.8.8.8').ok).toBe(true);
  });

  it('con /interface list WAN y out-interface-list=WAN', () => {
    const t = lab6().script([
      '/interface list add name=WAN',
      '/interface list add name=LAN',
      '/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade comment="salida a Internet"',
    ]);
    // La lista todavía está vacía: la regla no coincide con nada.
    expect(icmp(t.net, 'PC1', '8.8.8.8').ok).toBe(false);
    t.ok('/interface list member add list=WAN interface=ether1');
    t.ok('/interface list member add list=LAN interface=ether2');
    const result = icmp(t.net, 'PC1', '8.8.8.8');
    expect(result.ok).toBe(true);
    expect(result.delivered?.src === undefined ? '' : formatIpv4(result.delivered.src)).toBe(
      '203.0.113.2',
    );
    const lists = t.ok('/interface list print');
    expect(rowFlags(lists, 'WAN')).toBe('');
    expect(rowFlags(lists, 'all')).toBe('*');
    expect(t.ok('/interface list member print')).toBe(
      ['Columns: LIST, INTERFACE', '# LIST  INTERFACE', '0 WAN   ether1', '1 LAN   ether2'].join(
        '\n',
      ),
    );
    expect(t.ok('/ip firewall nat print')).toBe(
      [
        ' 0  ;;; salida a Internet',
        '    chain=srcnat action=masquerade out-interface-list=WAN',
      ].join('\n'),
    );
    expect(t.run('/interface list member add list=WAM interface=ether1')).toBe(
      'input does not match any value of list',
    );
  });

  it('el DNS de Internet solo responde a la LAN cuando hay NAT', () => {
    const t = lab6();
    expect(resolveName(t.net, deviceId('PC1'), 'example.com').outcome).toBe('timeout');
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    const answer = resolveName(t.net, deviceId('PC1'), 'example.com');
    expect(answer.outcome).toBe('answered');
    expect(answer.address === undefined ? '' : formatIpv4(answer.address)).toBe('93.184.216.34');
  });

  it('dst-nat publica el servidor web interno (puerto 8080 → 80)', () => {
    const t = lab6();
    const visit = () => tcp(t.net, 'ISP', '203.0.113.2', 8080, '198.51.100.7');
    expect(visit().forward.end).toEqual({ kind: 'port-closed', device: 'R1' });
    t.ok(PORT_FORWARD);
    const result = visit();
    expect(result.ok).toBe(true);
    expect(result.forward.end).toEqual({ kind: 'delivered', device: 'SRV', emulated: false });
    const seen = result.delivered;
    expect(
      seen === undefined ? '' : `${formatIpv4(seen.src)} → ${formatIpv4(seen.dst)}:${seen.dstPort}`,
    ).toBe('198.51.100.7 → 192.168.99.20:80');
    // Otro puerto no está publicado.
    expect(tcp(t.net, 'ISP', '203.0.113.2', 443, '198.51.100.7').ok).toBe(false);
    expect(
      holds(t.net, {
        kind: 'reachable',
        from: deviceId('ISP'),
        to: { ip: ipv4('203.0.113.2') },
        protocol: 'tcp',
        port: 8080,
      }),
    ).toBe(true);
  });

  it('error típico: el servidor sin gateway no puede responder al port forwarding', () => {
    const t = lab6(false);
    t.ok(PORT_FORWARD);
    const result = tcp(t.net, 'ISP', '203.0.113.2', 8080, '198.51.100.7');
    expect(result.forward.end).toEqual({ kind: 'delivered', device: 'SRV', emulated: false });
    expect(result.reply?.end).toEqual({ kind: 'no-route', device: 'SRV' });
    expect(result.ok).toBe(false);
  });

  it('error típico: un dst-nat sin in-interface secuestra también la navegación de la LAN', () => {
    const t = lab6();
    t.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    t.ok(
      '/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 action=dst-nat to-addresses=192.168.99.20',
    );
    // PC1 quiere una web de Internet y termina en el servidor interno.
    expect(tcp(t.net, 'PC1', '93.184.216.34', 80).forward.end).toMatchObject({
      kind: 'delivered',
      device: 'SRV',
    });
    t.ok('/ip firewall nat set 1 in-interface=ether1');
    expect(tcp(t.net, 'PC1', '93.184.216.34', 80).forward.end).toMatchObject({
      kind: 'delivered',
      device: 'ISP',
    });
    expect(tcp(t.net, 'ISP', '203.0.113.2', 80, '198.51.100.7').forward.end).toMatchObject({
      kind: 'delivered',
      device: 'SRV',
    });
  });

  it('/ip firewall nat print muestra las reglas en detalle y en estadísticas', () => {
    const t = lab6().script([
      '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
      PORT_FORWARD,
    ]);
    const out = t.ok('/ip firewall nat print');
    expect(out).toContain(' 0  chain=srcnat action=masquerade out-interface=ether1');
    expect(out).toContain('chain=dstnat action=dst-nat');
    expect(out).toContain('to-addresses=192.168.99.20 to-ports=80');
    expect(t.ok('/ip firewall nat print stats').split('\n').slice(0, 3)).toEqual([
      'Columns: CHAIN, ACTION, BYTES, PACKETS',
      '# CHAIN   ACTION      BYTES  PACKETS',
      '0 srcnat  masquerade      0        0',
    ]);
    expect(t.ok('/ip firewall nat print count-only where chain=dstnat')).toBe('1');
  });

  it('errores típicos al escribir reglas NAT', () => {
    const t = lab6();
    // masquerade solo tiene sentido en srcnat.
    expect(t.run('/ip firewall nat add chain=dstnat action=masquerade')).toMatch(/^failure: /);
    expect(t.last?.ok).toBe(false);
    expect(t.run('/ip firewall nat add chain=srcnat action=dst-nat to-addresses=1.1.1.1')).toMatch(
      /^failure: /,
    );
    // dst-port sin protocol.
    expect(
      t.run(
        '/ip firewall nat add chain=dstnat dst-port=80 action=dst-nat to-addresses=192.168.99.20',
      ),
    ).toBe(
      'failure: src-port and dst-port can be specified only for tcp, udp, udp-lite, dccp and sctp protocols',
    );
    expect(t.run('/ip firewall nat add chain=forward action=masquerade')).toBe(
      'invalid value for argument chain',
    );
    expect(t.device.config.firewall.nat).toEqual([]);
  });

  it('NAT con la WAN por DHCP: masquerade usa la dirección dinámica', () => {
    const t = new Terminal(lab5(), 'R1').script([
      ...dhcpLan('192.168.88.10-192.168.88.254'),
      '/ip dhcp-client add interface=ether1',
      '/interface list add name=WAN',
      '/interface list member add list=WAN interface=ether1',
      '/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade',
    ]);
    const result = icmp(t.net, 'PC1', '8.8.8.8');
    expect(result.ok).toBe(true);
    expect(result.delivered?.src === undefined ? '' : formatIpv4(result.delivered.src)).toBe(
      '203.0.113.10',
    );
  });
});
