/**
 * Batería de los labs 7–12 del curso "MikroTik desde cero": se escribe en la
 * consola de R1 como lo haría un alumno (incluidos los errores típicos) y se
 * comprueba el estado de la red con trazados, resolución DNS, Torch y los
 * predicados de validación del núcleo.
 *
 * Las pruebas marcadas con `it.fails` afirman el comportamiento correcto de
 * RouterOS real y documentan (con `// BUG:`) dónde el simulador aún difiere.
 */
import {
  type DeviceId,
  deviceId,
  evaluate,
  formatIpv4,
  type IpProtocol,
  type Ipv4,
  type ItemId,
  ipv4,
  type Network,
  type Predicate,
  ping,
  prefix,
  recordTrace,
  resolveName,
  type TraceResult,
  tick,
  trace,
} from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

// ── Topología común ─────────────────────────────────────────────────────────

/** Dirección "de Internet" desde la que llega el atacante de los labs. */
const ATTACKER = ipv4('198.51.100.7');
const EXAMPLE = '93.184.216.34';

/**
 * R1 (sim-r5w) con el ISP en ether1, PC1 en ether2, PC2 en ether3 y una
 * portátil wifi (estación de "Oficina" con "clave-segura"). Con `traffic`,
 * PC1 descarga a 8 Mbps y PC2 navega a 100 kbps.
 */
function topology(options: { traffic?: boolean } = {}): Network {
  const builder = net()
    .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
    .host('PC1')
    .host('PC2')
    .host('LAP', 'sim-host-w')
    .cloud('ISP')
    .link('R1:ether1', 'ISP:eth0')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': EXAMPLE } })
    .dhcpServer('ISP', {
      iface: 'eth0',
      pool: '203.0.113.10-203.0.113.20',
      network: '203.0.113.0/24',
      gateway: '203.0.113.1',
      dns: ['1.1.1.1'],
    })
    .dhcpClient('PC1', 'eth0')
    .dhcpClient('PC2', 'eth0')
    .wifi('LAP', 'wlan0', 'station', 'Oficina', 'clave-segura')
    .dhcpClient('LAP', 'wlan0');
  if (options.traffic) {
    builder
      .flow({
        id: 'descarga',
        from: 'PC1',
        to: EXAMPLE,
        protocol: 'tcp',
        dstPort: 443,
        bps: 200_000,
        replyBps: 8_000_000,
      })
      .flow({
        id: 'navegacion',
        from: 'PC2',
        to: EXAMPLE,
        protocol: 'tcp',
        dstPort: 80,
        bps: 10_000,
        replyBps: 100_000,
      });
  }
  return builder.build();
}

/** Lo que el alumno ya dejó hecho en los labs 1–6: bridge LAN, DHCP, cliente WAN y NAT. */
const OFICINA: readonly string[] = [
  '/interface bridge add name=bridge1',
  '/interface bridge port add bridge=bridge1 interface=ether2',
  '/interface bridge port add bridge=bridge1 interface=ether3',
  '/ip address add address=192.168.88.1/24 interface=bridge1',
  '/ip pool add name=lan ranges=192.168.88.10-192.168.88.254',
  '/ip dhcp-server add interface=bridge1 address-pool=lan',
  '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
  '/ip dhcp-client add interface=ether1',
  '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
];

/** El pool reparte desde arriba: PC1 se enciende primero. */
const PC1_IP = '192.168.88.254';
const PC2_IP = '192.168.88.253';

const fresh = (options: { traffic?: boolean } = {}) => new Terminal(topology(options), 'R1');
const office = (options: { traffic?: boolean } = {}) => fresh(options).script(OFICINA);

/** Instalar la contraseña wifi del laboratorio (la misma que usa la portátil). */
const WIFI_ON =
  '/interface wifi set wifi1 configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=clave-segura disabled=no';

// ── Ayudantes ───────────────────────────────────────────────────────────────

interface Probe {
  readonly from: string;
  readonly dst: string | Ipv4;
  readonly protocol: IpProtocol;
  readonly port?: number | undefined;
  readonly src?: Ipv4 | undefined;
}

function go(network: Network, p: Probe): TraceResult {
  return trace(network, {
    from: deviceId(p.from),
    dst: typeof p.dst === 'string' ? ipv4(p.dst) : p.dst,
    protocol: p.protocol,
    ...(p.port === undefined ? {} : { dstPort: p.port }),
    ...(p.src === undefined ? {} : { src: p.src }),
  });
}

/** IP que R1 obtuvo por DHCP en ether1. */
function wanIp(t: Terminal): Ipv4 {
  const address = t.device.oper.dhcpClients[0]?.address;
  if (!address) throw new Error('R1 no obtuvo IP en ether1');
  return address.ip;
}

/** Un equipo de Internet intenta conectar con la IP WAN del router. */
const fromInternet = (t: Terminal, protocol: IpProtocol, port?: number): TraceResult =>
  go(t.net, { from: 'ISP', dst: wanIp(t), protocol, port, src: ATTACKER });

const check = (t: Terminal, predicate: Predicate): boolean =>
  evaluate(predicate, { net: t.net, startup: new Map() });

const R1: DeviceId = deviceId('R1');

function ruleId(t: Terminal, comment: string): ItemId {
  const rule = t.device.config.firewall.filter.find((r) => r.comment === comment);
  if (!rule) throw new Error(`no hay regla con comentario ${comment}`);
  return rule.id;
}

/** Celdas de la fila de una tabla cuyo primer campo es `first`. */
function cells(output: string, first: string): string[] {
  const line = output.split('\n').find((l) => l.trim().split(/\s+/)[0] === first);
  return line?.trim().split(/\s+/) ?? [];
}

/** Última línea de una salida (el total de Torch). */
const lastLine = (output: string): string[] => output.split('\n').at(-1)?.trim().split(/\s+/) ?? [];

/** `8.0Mbps` → 8000000. */
function bps(text: string | undefined): number {
  const match = /^([\d.]+)(bps|kbps|Mbps|Gbps)$/.exec(text ?? '');
  if (!match) return Number.NaN;
  const scale = { bps: 1, kbps: 1e3, Mbps: 1e6, Gbps: 1e9 }[match[2] as 'bps'];
  return Number(match[1]) * scale;
}

const dhcpOf = (t: Terminal, host: string) => deviceIn(t.net, host).oper.dhcpClients[0];

// ── Lab 7 ───────────────────────────────────────────────────────────────────

describe('Lab 7 · Firewall: proteger el router', () => {
  const PROTEGER = [
    '/ip firewall filter add chain=input action=accept connection-state=established,related comment=establecidas',
    '/ip firewall filter add chain=input action=accept protocol=icmp comment=icmp',
    '/ip firewall filter add chain=input action=drop in-interface=ether1 comment=wan',
  ];

  it('sin reglas, el router atiende SSH y Winbox desde Internet', () => {
    const t = office();
    expect(fromInternet(t, 'tcp', 22).ok).toBe(true);
    expect(fromInternet(t, 'tcp', 8291).ok).toBe(true);
    expect(t.device.config.firewall.filter).toEqual([]);
  });

  it('accept established, accept icmp y drop desde ether1 cierran el router a Internet', () => {
    const t = office().script(PROTEGER);
    expect(fromInternet(t, 'tcp', 22).forward.end).toEqual({
      kind: 'filtered',
      device: R1,
      chain: 'input',
      action: 'drop',
      rule: ruleId(t, 'wan'),
    });
    expect(fromInternet(t, 'tcp', 8291).ok).toBe(false);
    // El ping sigue permitido porque la regla icmp va antes que el drop.
    expect(fromInternet(t, 'icmp').ok).toBe(true);
    const out = t.ok('/ip firewall filter print');
    expect(out).toContain('chain=input action=drop in-interface=ether1');
    expect(out.indexOf(';;; icmp')).toBeLessThan(out.indexOf(';;; wan'));
  });

  it('desde la LAN el router y la salida a Internet siguen funcionando', () => {
    const t = office().script(PROTEGER);
    expect(go(t.net, { from: 'PC1', dst: '192.168.88.1', protocol: 'tcp', port: 22 }).ok).toBe(
      true,
    );
    // La IP WAN también responde a la LAN: la regla solo mira la interfaz de entrada.
    expect(go(t.net, { from: 'PC1', dst: wanIp(t), protocol: 'tcp', port: 8291 }).ok).toBe(true);
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
    expect(t.ok('/ping 8.8.8.8 count=2')).toContain('sent=2 received=2 packet-loss=0%');
  });

  it('con una lista WAN la regla sigue valiendo al renombrar el puerto', () => {
    const t = office().script([
      '/interface list add name=WAN',
      '/interface list member add list=WAN interface=ether1',
      '/ip firewall filter add chain=input action=accept connection-state=established,related',
      '/ip firewall filter add chain=input action=drop in-interface-list=WAN comment=wan',
    ]);
    expect(fromInternet(t, 'tcp', 22).forward.end).toMatchObject({
      kind: 'filtered',
      rule: ruleId(t, 'wan'),
    });
    t.ok('/interface set ether1 name=ether1-wan');
    expect(fromInternet(t, 'tcp', 22).forward.end).toMatchObject({
      kind: 'filtered',
      rule: ruleId(t, 'wan'),
    });
    expect(t.ok('/interface list member print')).toContain('ether1-wan');
    expect(t.ok('/ip firewall filter print')).toContain('in-interface-list=WAN');
  });

  it('error típico: escribir mal el nombre de la lista', () => {
    const t = office();
    t.ok('/interface list add name=WAN');
    expect(t.run('/interface list member add list=wan interface=ether1')).toBe(
      'input does not match any value of list',
    );
    expect(t.run('/ip firewall filter add chain=input action=drop in-interface-list=WAM')).toBe(
      'input does not match any value of in-interface-list',
    );
    expect(t.device.config.firewall.filter).toEqual([]);
  });

  it('error típico: el drop antes del accept established deja al router sin Internet', () => {
    const t = office().script([
      '/ip dns set servers=1.1.1.1',
      '/ip firewall filter add chain=input action=drop in-interface=ether1',
      '/ip firewall filter add chain=input action=accept connection-state=established,related',
    ]);
    const out = t.ok('/ping 8.8.8.8 count=2');
    expect(out).toContain('timeout');
    expect(out).toContain('sent=2 received=0 packet-loss=100%');
    expect(t.run(':resolve example.com')).toContain('failure');
    // La LAN no se entera: su tráfico va por forward, no por input.
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
    // Arreglo: mover la regla de aceptar arriba.
    t.ok('/ip firewall filter print');
    t.ok('/ip firewall filter move 1 0');
    expect(t.device.config.firewall.filter.map((r) => r.action.kind)).toEqual(['accept', 'drop']);
    expect(t.ok('/ping 8.8.8.8 count=1')).toContain('packet-loss=0%');
    expect(t.ok(':resolve example.com')).toBe(EXAMPLE);
  });

  it('place-before inserta la regla delante de la indicada', () => {
    const t = office().script([
      '/ip firewall filter add chain=input action=drop in-interface=ether1 comment=wan',
      '/ip firewall filter print',
      '/ip firewall filter add chain=input action=accept protocol=icmp comment=icmp place-before=0',
    ]);
    expect(t.device.config.firewall.filter.map((r) => r.comment)).toEqual(['icmp', 'wan']);
    expect(fromInternet(t, 'icmp').ok).toBe(true);
    expect(fromInternet(t, 'tcp', 22).ok).toBe(false);
    // place-before no se guarda en la regla: no aparece en print ni en export.
    expect(t.ok('/ip firewall filter print')).not.toContain('place-before');
    expect(t.ok('/ip firewall filter export')).not.toContain('place-before');
  });

  it('disable deja la regla con flag X y sin efecto; enable la reactiva', () => {
    const t = office().script(PROTEGER);
    t.ok('/ip firewall filter print');
    t.ok('/ip firewall filter disable 2');
    const out = t.ok('/ip firewall filter print');
    expect(out).toMatch(/Flags: X - disabled/i);
    expect(out).toMatch(/^ *2 +X +;;; wan$/m);
    expect(fromInternet(t, 'tcp', 22).ok).toBe(true);
    t.ok('/ip firewall filter enable 2');
    expect(fromInternet(t, 'tcp', 22).ok).toBe(false);
  });

  it('error típico: proteger el router en la cadena forward no sirve', () => {
    const t = office();
    t.ok('/ip firewall filter add chain=forward action=drop in-interface=ether1');
    expect(fromInternet(t, 'tcp', 22).ok).toBe(true);
  });

  it('error típico: drop de input sin interfaz encierra también a la LAN; safe mode lo deshace', () => {
    const t = office();
    expect(t.key('ctrl-x')).toBe('[Safe Mode taken]');
    t.ok('/ip firewall filter add chain=input action=drop');
    expect(go(t.net, { from: 'PC1', dst: '192.168.88.1', protocol: 'tcp', port: 8291 }).ok).toBe(
      false,
    );
    t.key('ctrl-d');
    expect(t.last?.closed).toBe(true);
    expect(t.device.config.firewall.filter).toEqual([]);
    expect(go(t.net, { from: 'PC1', dst: '192.168.88.1', protocol: 'tcp', port: 8291 }).ok).toBe(
      true,
    );
  });

  it('solo los puertos indicados: dst-port con protocol=tcp', () => {
    const t = office();
    t.ok(
      '/ip firewall filter add chain=input action=drop protocol=tcp dst-port=22,8291 in-interface=ether1',
    );
    expect(fromInternet(t, 'tcp', 22).ok).toBe(false);
    expect(fromInternet(t, 'tcp', 8291).ok).toBe(false);
    expect(fromInternet(t, 'tcp', 80).ok).toBe(true);
    expect(fromInternet(t, 'icmp').ok).toBe(true);
  });

  it('error típico: dst-port sin protocol', () => {
    const t = office();
    expect(t.run('/ip firewall filter add chain=input dst-port=22 action=drop')).toMatch(
      /^failure: .*can be specified only for tcp, udp/,
    );
    expect(t.last?.ok).toBe(false);
    expect(t.device.config.firewall.filter).toEqual([]);
  });

  it('bloquear un PC en forward por dirección', () => {
    const t = office();
    t.ok(`/ip firewall filter add chain=forward src-address=${PC2_IP} action=drop comment=pc2`);
    expect(go(t.net, { from: 'PC2', dst: '8.8.8.8', protocol: 'icmp' }).forward.end).toMatchObject({
      kind: 'filtered',
      chain: 'forward',
      rule: ruleId(t, 'pc2'),
    });
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
    // Al router sí llega: forward no se aplica al tráfico dirigido a él.
    expect(go(t.net, { from: 'PC2', dst: '192.168.88.1', protocol: 'icmp' }).ok).toBe(true);
  });

  it('bloquear con address-list y src-address-list', () => {
    const t = office().script([
      `/ip firewall address-list add list=bloqueados address=${PC2_IP}`,
      '/ip firewall filter add chain=forward src-address-list=bloqueados action=drop',
    ]);
    expect(t.ok('/ip firewall address-list print')).toMatch(/0 bloqueados\s+192\.168\.88\.253/);
    expect(go(t.net, { from: 'PC2', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(false);
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
    // Añadir otro equipo a la lista no requiere tocar la regla.
    t.ok(`/ip firewall address-list add list=bloqueados address=${PC1_IP}`);
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(false);
    // Y sacarlo lo desbloquea.
    t.ok('/ip firewall address-list remove [find address=192.168.88.254]');
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  it('error típico: una errata en el nombre de la lista no da error pero no bloquea a nadie', () => {
    const t = office().script([
      `/ip firewall address-list add list=bloqueados address=${PC2_IP}`,
      '/ip firewall filter add chain=forward src-address-list=bloqueado action=drop',
    ]);
    expect(t.last?.ok).toBe(true);
    expect(go(t.net, { from: 'PC2', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  // BUG: las entradas con timeout no caducan (ni salen como dinámicas); el bloqueo es permanente.
  it.fails('una entrada de address-list con timeout caduca sola', () => {
    const t = office().script([
      `/ip firewall address-list add list=castigo address=${PC2_IP} timeout=1m`,
      '/ip firewall filter add chain=forward src-address-list=castigo action=drop',
    ]);
    expect(go(t.net, { from: 'PC2', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(false);
    t.net = tick(t.net, 61);
    expect(t.ok('/ip firewall address-list print')).not.toContain(PC2_IP);
    expect(go(t.net, { from: 'PC2', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  it('log=yes con log-prefix deja el intento de Internet en /log print', () => {
    const t = office().script([
      '/ip firewall filter add chain=input action=accept connection-state=established,related',
      '/ip firewall filter add chain=input action=drop in-interface=ether1 log=yes log-prefix=WAN-DROP',
    ]);
    t.net = recordTrace(t.net, fromInternet(t, 'tcp', 22));
    const log = t.ok('/log print where topics~"firewall"');
    expect(log.split('\n')).toHaveLength(1);
    expect(log).toContain(
      'firewall,info WAN-DROP input: in:ether1 out:(unknown 0), connection-state:new',
    );
    expect(log).toContain(`proto TCP (SYN), 198.51.100.7:49152->${formatIpv4(wanIp(t))}:22`);
  });

  it('log en forward: el ping del PC bloqueado aparece con su prefijo', () => {
    const t = office();
    t.ok(
      `/ip firewall filter add chain=forward src-address=${PC2_IP} action=drop log=yes log-prefix=BLOQUEO`,
    );
    t.net = ping(t.net, deviceId('PC2'), ipv4('8.8.8.8'), { count: 1 }).net;
    const log = t.ok('/log print');
    expect(log).toContain(
      'firewall,info BLOQUEO forward: in:bridge1 out:ether1, connection-state:new',
    );
    expect(log).toContain('proto ICMP (type 8, code 0), 192.168.88.253->8.8.8.8');
    // Las reglas sin log no escriben nada.
    t.net = ping(t.net, deviceId('PC1'), ipv4('8.8.8.8'), { count: 1 }).net;
    expect(t.ok('/log print where topics~"firewall"').split('\n')).toHaveLength(1);
  });

  it('el log de una respuesta de ping descartada dice established e ICMP type 0', () => {
    const t = office().script([
      '/ip firewall filter add chain=input action=drop in-interface=ether1 log=yes log-prefix=WAN',
    ]);
    t.ok('/ping 8.8.8.8 count=1');
    const log = t.ok('/log print where topics~"firewall"');
    expect(log).toContain('connection-state:established');
    expect(log).toContain('proto ICMP (type 0, code 0), 8.8.8.8->');
  });

  it('print stats cuenta las respuestas del ping en la regla established', () => {
    const t = office().script(PROTEGER);
    t.ok('/ping 8.8.8.8 count=3');
    const stats = t.ok('/ip firewall filter print stats');
    expect(stats.split('\n')[0]).toBe('Columns: CHAIN, ACTION, BYTES, PACKETS');
    expect(cells(stats, '0')).toEqual(['0', 'input', 'accept', '252', '3']);
    expect(cells(stats, '1')).toEqual(['1', 'input', 'accept', '0', '0']);
    // Dos pings desde Internet suben el contador de la regla icmp.
    t.net = ping(t.net, deviceId('ISP'), wanIp(t), { count: 2, src: ATTACKER }).net;
    expect(cells(t.ok('/ip firewall filter print stats'), '1')).toEqual([
      '1',
      'input',
      'accept',
      '168',
      '2',
    ]);
  });

  it('reset-counters pone a cero los contadores de las reglas indicadas', () => {
    const t = office().script(PROTEGER);
    t.ok('/ping 8.8.8.8 count=3');
    t.net = ping(t.net, deviceId('ISP'), wanIp(t), { count: 2, src: ATTACKER }).net;
    t.ok('/ip firewall filter print stats');
    t.ok('/ip firewall filter reset-counters 0');
    const stats = t.ok('/ip firewall filter print stats');
    expect(cells(stats, '0')).toEqual(['0', 'input', 'accept', '0', '0']);
    expect(cells(stats, '1')).toEqual(['1', 'input', 'accept', '168', '2']);
    t.ok('/ip firewall filter reset-counters 0,1');
    const filterIds = new Set(t.device.config.firewall.filter.map((r) => r.id));
    expect(
      t.device.oper.ruleCounters.filter((c) => filterIds.has(c.rule) && c.packets > 0),
    ).toEqual([]);
  });

  // BUG: falta reset-counters-all (RouterOS v7 lo tiene en filter, nat y mangle).
  it.fails('reset-counters-all pone a cero todos los contadores', () => {
    const t = office().script(PROTEGER);
    t.ok('/ping 8.8.8.8 count=3');
    t.ok('/ip firewall filter reset-counters-all');
    expect(cells(t.ok('/ip firewall filter print stats'), '0')).toEqual([
      '0',
      'input',
      'accept',
      '0',
      '0',
    ]);
  });

  it('error típico: in-interface con un puerto del bridge no bloquea al PC', () => {
    const t = office();
    t.ok('/ip firewall filter add chain=forward in-interface=ether2 action=drop');
    // El tráfico enrutado entra por bridge1, no por ether2.
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  // BUG: RouterOS marca la regla como inválida y explica que hay que usar el bridge.
  it.fails('una regla con un puerto esclavo del bridge sale inválida con la pista del maestro', () => {
    const t = office();
    t.ok('/ip firewall filter add chain=forward in-interface=ether2 action=drop');
    const out = t.ok('/ip firewall filter print');
    expect(out).toContain('I - INVALID');
    expect(out).toContain(
      'in/out-interface matcher not possible when interface (ether2) is slave - use master instead (bridge1)',
    );
  });

  // BUG: connection-nat-state no existe, así que la regla de defconf no se puede escribir.
  it.fails('la regla de forward de defconf con connection-nat-state=!dstnat', () => {
    const t = office();
    t.ok(
      '/ip firewall filter add chain=forward action=drop connection-state=new connection-nat-state=!dstnat in-interface=ether1 comment="defconf: drop all from WAN not DSTNATed"',
    );
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  // BUG: hw-offload no existe, así que la regla de fasttrack de defconf no se puede escribir.
  it.fails('fasttrack de defconf con hw-offload=yes', () => {
    const t = office();
    t.ok(
      '/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related hw-offload=yes',
    );
    expect(t.device.config.firewall.filter.map((r) => r.action.kind)).toEqual(['fasttrack']);
  });
});

// ── Lab 8 ───────────────────────────────────────────────────────────────────

describe('Lab 8 · Wireless básico', () => {
  const associated = (t: Terminal) =>
    check(t, { kind: 'wifiAssociated', client: deviceId('LAP'), ap: R1, ssid: 'Oficina' });

  it('wifi1 sale deshabilitada y sin SSID: nadie se asocia', () => {
    const t = office();
    const out = t.ok('/interface wifi print');
    expect(out).toMatch(/Flags: X - disabled/i);
    expect(out).toMatch(/^0 +X +wifi1\b/m);
    expect(associated(t)).toBe(false);
    expect(t.ok('/interface wifi registration-table print count-only')).toBe('0');
  });

  it('con SSID, WPA2, contraseña y disabled=no la portátil se asocia', () => {
    const t = office();
    t.ok(WIFI_ON);
    expect(associated(t)).toBe(true);
    const lapMac = deviceIn(t.net, 'LAP').config.interfaces[0]?.mac ?? '';
    expect(t.device.oper.wifiRegistrations.map((r) => r.mac)).toEqual([lapMac]);
    const table = t.ok('/interface wifi registration-table print');
    expect(cells(table, '0').slice(0, 2)).toEqual(['0', 'wifi1']);
    expect(table).toContain(lapMac);
    expect(t.ok('/interface wifi print')).toMatch(/^0 +R +wifi1\b/m);
  });

  it('error típico: una contraseña distinta no asocia; al corregirla sí', () => {
    const t = office();
    t.ok(WIFI_ON.replace('clave-segura', 'otra-clave-1'));
    expect(associated(t)).toBe(false);
    expect(t.ok('/interface wifi registration-table print count-only')).toBe('0');
    t.ok('/interface wifi set wifi1 security.passphrase=clave-segura');
    expect(associated(t)).toBe(true);
  });

  it('error típico: olvidar disabled=no deja la radio apagada', () => {
    const t = office();
    t.ok(WIFI_ON.replace(' disabled=no', ''));
    expect(associated(t)).toBe(false);
    t.ok('/interface wifi enable wifi1');
    expect(associated(t)).toBe(true);
  });

  it('error típico: el SSID distingue mayúsculas', () => {
    const t = office();
    t.ok(WIFI_ON.replace('ssid=Oficina', 'ssid=oficina'));
    expect(associated(t)).toBe(false);
  });

  it('asociada pero fuera del bridge no recibe DHCP; con wifi1 en el bridge sí', () => {
    const t = office();
    t.ok(WIFI_ON);
    expect(dhcpOf(t, 'LAP')?.status).toBe('searching');
    t.ok('/interface bridge port add bridge=bridge1 interface=wifi1');
    expect(
      check(t, {
        kind: 'leaseBound',
        server: R1,
        client: deviceId('LAP'),
        within: prefix('192.168.88.0/24'),
      }),
    ).toBe(true);
    expect(t.ok('/ip dhcp-server lease print')).toMatch(/192\.168\.88\.252\s+\S+\s+LAP\s+dhcp1/);
    expect(go(t.net, { from: 'LAP', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  it('una contraseña WPA2 de menos de 8 caracteres se rechaza', () => {
    const t = office();
    expect(t.run('/interface wifi set wifi1 security.passphrase=1234567')).toContain('passphrase');
    expect(t.last?.ok).toBe(false);
  });

  it('un tipo de autenticación inexistente da error', () => {
    const t = office();
    expect(t.run('/interface wifi set wifi1 security.authentication-types=wpa5-psk')).toBe(
      'invalid value for argument security.authentication-types',
    );
  });

  it('la contraseña no sale en export; show-sensitive la muestra', () => {
    const t = office();
    t.ok(WIFI_ON);
    const plain = t.ok('/export');
    expect(plain).toMatch(/set \[ find default-name=wifi1 \].*ssid=Oficina/);
    expect(plain).not.toContain('clave-segura');
    expect(t.ok('/export show-sensitive')).toContain('passphrase=clave-segura');
  });
});

// ── Lab 9 ───────────────────────────────────────────────────────────────────

describe('Lab 9 · DNS y caché', () => {
  const DNS = '/ip dns set servers=1.1.1.1 allow-remote-requests=yes';
  const resolvesViaR1 = (t: Terminal, host: string, name: string, to: string) =>
    check(t, { kind: 'resolves', from: deviceId(host), name, to: ipv4(to), via: R1 });

  it('/ip dns print distingue servidores propios y los dinámicos del DHCP', () => {
    const t = office();
    const before = t.ok('/ip dns print');
    expect(before).toMatch(/^ +servers:$/m);
    expect(before).toContain('dynamic-servers: 1.1.1.1');
    expect(before).toContain('allow-remote-requests: no');
    t.ok(DNS);
    const after = t.ok('/ip dns print');
    expect(after).toMatch(/^ +servers: 1\.1\.1\.1$/m);
    expect(after).toContain('allow-remote-requests: yes');
    expect(t.device.config.dns.allowRemoteRequests).toBe(true);
  });

  it(':resolve, :put [:resolve] y ping por nombre', () => {
    const t = office().script([DNS]);
    expect(t.ok(':resolve example.com')).toBe(EXAMPLE);
    expect(t.ok(':put [:resolve example.com]')).toBe(EXAMPLE);
    const out = t.ok('/ping example.com count=1');
    expect(cells(out, '0').slice(0, 2)).toEqual(['0', EXAMPLE]);
    expect(out).toContain('packet-loss=0%');
  });

  it('los PCs reciben al router como DNS y resuelven a través de R1', () => {
    const t = office().script([DNS]);
    expect(dhcpOf(t, 'PC1')?.dns).toEqual([ipv4('192.168.88.1')]);
    const result = resolveName(t.net, deviceId('PC1'), 'example.com');
    expect(result.outcome).toBe('answered');
    expect(result.chain.slice(0, 2)).toEqual([deviceId('PC1'), R1]);
    expect(resolvesViaR1(t, 'PC2', 'example.com', EXAMPLE)).toBe(true);
  });

  it('la caché guarda la respuesta, caduca con el TTL y flush la vacía', () => {
    const t = office().script([DNS]);
    t.net = resolveName(t.net, deviceId('PC1'), 'example.com').net;
    const cache = t.ok('/ip dns cache print');
    expect(cells(cache, '0')).toEqual(['0', 'example.com', 'A', EXAMPLE, '5m']);
    t.net = tick(t.net, 301);
    expect(t.ok('/ip dns cache print')).not.toContain('example.com');
    t.ok(':resolve example.com');
    expect(t.ok('/ip dns cache print')).toContain('example.com');
    t.ok('/ip dns cache flush');
    expect(t.device.oper.dnsCache).toEqual([]);
    expect(t.ok('/ip dns cache print')).not.toContain('example.com');
  });

  it('entradas estáticas A y CNAME, también para los PCs', () => {
    const t = office().script([
      DNS,
      '/ip dns static add name=router.lan address=192.168.88.1',
      '/ip dns static add name=www.lan type=CNAME cname=router.lan',
    ]);
    const out = t.ok('/ip dns static print');
    expect(cells(out, '0')).toEqual(['0', 'router.lan', 'A', '192.168.88.1', '1d']);
    expect(cells(out, '1').slice(0, 3)).toEqual(['1', 'www.lan', 'CNAME']);
    expect(t.ok(':resolve router.lan')).toBe('192.168.88.1');
    expect(t.ok(':resolve www.lan')).toBe('192.168.88.1');
    expect(resolvesViaR1(t, 'PC1', 'router.lan', '192.168.88.1')).toBe(true);
    expect(resolvesViaR1(t, 'PC1', 'www.lan', '192.168.88.1')).toBe(true);
  });

  it('error típico: sin allow-remote-requests los PCs no resuelven, aunque el router sí', () => {
    const t = office().script(['/ip dns set servers=1.1.1.1']);
    expect(t.ok(':resolve example.com')).toBe(EXAMPLE);
    expect(resolveName(t.net, deviceId('PC1'), 'example.com').outcome).toBe('timeout');
    // Por IP sí navegan: es un problema de DNS, no de NAT.
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
    t.ok('/ip dns set allow-remote-requests=yes');
    expect(resolvesViaR1(t, 'PC1', 'example.com', EXAMPLE)).toBe(true);
  });

  it('sin NAT los PCs resuelven a través del router pero no navegan', () => {
    const t = office().script([DNS]);
    t.ok('/ip firewall nat print');
    t.ok('/ip firewall nat remove 0');
    expect(resolvesViaR1(t, 'PC1', 'example.com', EXAMPLE)).toBe(true);
    expect(go(t.net, { from: 'PC1', dst: EXAMPLE, protocol: 'tcp', port: 443 }).ok).toBe(false);
  });

  it('sin WAN el router no puede resolver', () => {
    const t = fresh().script(OFICINA.filter((line) => !line.includes('dhcp-client')));
    t.ok('/ip dns set servers=1.1.1.1');
    expect(t.run(':resolve example.com')).toContain('failure');
    expect(t.last?.ok).toBe(false);
    t.run('/ping example.com count=1');
    expect(t.last?.ok).toBe(false);
  });

  it('un nombre inexistente da failure: dns name does not exist', () => {
    const t = office().script([DNS]);
    expect(t.run(':resolve nada.example')).toBe('failure: dns name does not exist');
  });

  it('error típico: una IP mal escrita en servers', () => {
    const t = office();
    expect(t.run('/ip dns set servers=1.1.1')).toBe('invalid value for argument servers');
    expect(t.device.config.dns.servers).toEqual([]);
  });

  it('allow-remote-requests sin firewall deja un DNS abierto a Internet; una regla lo cierra', () => {
    const t = office().script([DNS]);
    expect(fromInternet(t, 'udp', 53).ok).toBe(true);
    t.ok(
      '/ip firewall filter add chain=input action=drop in-interface=ether1 protocol=udp dst-port=53',
    );
    expect(fromInternet(t, 'udp', 53).forward.end).toMatchObject({
      kind: 'filtered',
      chain: 'input',
    });
    expect(resolvesViaR1(t, 'PC1', 'example.com', EXAMPLE)).toBe(true);
  });

  // BUG: sin dns-server (y dns-none=no) RouterOS entrega a los clientes los DNS del propio router.
  it.fails('sin dns-server en la red DHCP los PCs reciben los DNS del router', () => {
    const t = fresh().script(
      OFICINA.map((line) =>
        line.startsWith('/ip dhcp-server network')
          ? '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1'
          : line,
      ),
    );
    expect(dhcpOf(t, 'PC1')?.dns).toContain(ipv4('1.1.1.1'));
    expect(resolveName(t.net, deviceId('PC1'), 'example.com').outcome).toBe('answered');
  });
});

// ── Lab 10 ──────────────────────────────────────────────────────────────────

describe('Lab 10 · Respaldo y restauración', () => {
  const backupNames = (t: Terminal) =>
    t.device.storage.files.filter((f) => f.payload.kind === 'backup').map((f) => f.name);

  it('save con nombre crea el .backup y /file print lo lista', () => {
    const t = office();
    expect(t.ok('/system backup save name=antes')).toBe('Configuration backup saved');
    expect(cells(t.ok('/file print'), '0').slice(0, 3)).toEqual(['0', 'antes.backup', 'backup']);
    expect(check(t, { kind: 'fileExists', device: R1, type: 'backup', name: 'antes*' })).toBe(true);
  });

  it('save sin nombre usa identidad-fecha-hora', () => {
    const t = office();
    t.ok('/system identity set name=Oficina');
    t.ok('/system backup save');
    expect(backupNames(t)).toEqual(['Oficina-20260105-0900.backup']);
  });

  it('load pide confirmación; con y restaura y cierra la sesión', () => {
    const t = office().script([
      '/system identity set name=Oficina',
      '/system backup save name=antes',
    ]);
    t.script([
      '/system identity set name=Roto',
      '/ip address remove [find interface=bridge1]',
      '/ip pool remove 0',
    ]);
    expect(dhcpOf(t, 'PC1')?.status).toBe('searching');
    expect(t.ok('/system backup load name=antes.backup')).toBe('Restore and reboot? [y/N]:');
    expect(t.prompt).toBe('');
    expect(t.ok('y')).toContain('System configuration restored');
    expect(t.last?.closed).toBe(true);
    expect(t.device.config.system.identity).toBe('Oficina');
    expect(
      check(t, { kind: 'configMatches', device: R1, snapshot: { file: 'antes.backup' } }),
    ).toBe(true);
    expect(dhcpOf(t, 'PC1')?.status).toBe('bound');
    const after = new Terminal(t.net, 'R1');
    expect(after.prompt).toBe('[admin@Oficina] > ');
  });

  it('load respondiendo n no cambia nada', () => {
    const t = office().script([
      '/system backup save name=antes',
      '/system identity set name=Nuevo',
    ]);
    t.ok('/system backup load name=antes.backup');
    t.ok('n');
    expect(t.last?.closed).toBeUndefined();
    expect(t.prompt).toBe('[admin@Nuevo] > ');
    expect(t.device.config.system.identity).toBe('Nuevo');
  });

  it('error típico: load sin la extensión .backup no encuentra el archivo', () => {
    const t = office().script([
      '/system backup save name=antes',
      '/system identity set name=Nuevo',
    ]);
    t.run('/system backup load name=antes');
    expect(t.last?.ok).toBe(false);
    expect(t.prompt).toBe('[admin@Nuevo] > ');
  });

  it('el reinicio del load vacía la caché DNS y los contadores', () => {
    const t = office().script([
      '/ip dns set servers=1.1.1.1',
      '/ip firewall filter add chain=input action=accept connection-state=established,related',
      '/system backup save name=antes',
    ]);
    t.ok(':resolve example.com');
    t.ok('/ping 8.8.8.8 count=2');
    expect(t.device.oper.dnsCache).not.toEqual([]);
    expect(t.device.oper.ruleCounters).not.toEqual([]);
    t.script(['/system backup load name=antes.backup', 'y']);
    expect(t.device.oper.dnsCache).toEqual([]);
    expect(t.device.oper.ruleCounters).toEqual([]);
  });

  it('export file + reset-configuration no-defaults keep-users + import lo reconstruye', () => {
    const t = office().script([
      '/system identity set name=Oficina',
      '/user add name=profe group=full password=clave-de-prueba',
      '/export file=config',
    ]);
    expect(t.ok('/file print')).toMatch(/0 config\.rsc\s+script/);
    expect(t.ok('/system reset-configuration no-defaults=yes keep-users=yes')).toBe(
      'Dangerous! Reset anyway? [y/N]:',
    );
    t.ok('y');
    expect(t.last?.closed).toBe(true);
    expect(t.device.config.addressing.addresses).toEqual([]);
    expect(t.device.config.system.identity).toBe('MikroTik');
    expect(t.device.config.system.users.map((u) => u.name)).toEqual(['admin', 'profe']);
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(false);
    // Los archivos sobreviven al reset.
    const again = new Terminal(t.net, 'R1');
    expect(again.ok('/file print')).toContain('config.rsc');
    expect(again.ok('/import config.rsc')).toBe('Script file loaded and executed successfully');
    expect(again.prompt).toBe('[admin@Oficina] > ');
    expect(dhcpOf(again, 'PC1')?.status).toBe('bound');
    expect(go(again.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(true);
  });

  it('sin keep-users se pierden los usuarios creados', () => {
    const t = office().script(['/user add name=profe group=full password=clave-de-prueba']);
    t.script(['/system reset-configuration no-defaults=yes', 'y']);
    expect(t.device.config.system.users.map((u) => u.name)).toEqual(['admin']);
  });

  it('error típico: exportar sin show-sensitive pierde la contraseña wifi', () => {
    const t = office().script([
      WIFI_ON,
      '/interface bridge port add bridge=bridge1 interface=wifi1',
    ]);
    t.script(['/export file=sin-claves', '/export file=con-claves show-sensitive']);
    t.script(['/system reset-configuration no-defaults=yes', 'y']);
    const lost = new Terminal(t.net, 'R1');
    lost.ok('/import sin-claves.rsc');
    const wifi = lost.device.config.interfaces.find((i) => i.kind === 'wireless');
    expect(wifi?.kind === 'wireless' && wifi.security.passphrase).toBeUndefined();
    expect(lost.device.oper.wifiRegistrations).toEqual([]);
    lost.script(['/system reset-configuration no-defaults=yes', 'y']);
    const good = new Terminal(lost.net, 'R1');
    good.ok('/import con-claves.rsc');
    expect(good.device.oper.wifiRegistrations).toHaveLength(1);
    expect(dhcpOf(good, 'LAP')?.status).toBe('bound');
  });

  it('error típico: importar sin resetear choca con lo que ya existe', () => {
    const t = office().script(['/export file=config']);
    expect(t.run('/import config.rsc')).toContain('failure: already have interface with such name');
    expect(t.last?.ok).toBe(false);
  });

  it('error típico: un .backup no se puede importar como script', () => {
    const t = office().script(['/system backup save name=antes']);
    t.run('/import antes.backup');
    expect(t.last?.ok).toBe(false);
  });

  it('/file remove borra por nombre y por número', () => {
    const t = office().script(['/system backup save name=antes', '/export file=config']);
    t.ok('/file remove antes.backup');
    expect(t.device.storage.files.map((f) => f.name)).toEqual(['config.rsc']);
    t.ok('/file print');
    t.ok('/file remove 0');
    expect(t.device.storage.files).toEqual([]);
    expect(t.ok('/file print')).not.toContain('config.rsc');
    t.run('/system backup load name=antes.backup');
    expect(t.last?.ok).toBe(false);
  });

  // BUG: reset-configuration no guarda auto-before-reset.backup (skip-backup=no por defecto).
  it.fails('reset-configuration guarda antes auto-before-reset.backup', () => {
    const t = office().script(['/system identity set name=Oficina']);
    t.script(['/system reset-configuration no-defaults=yes', 'y']);
    expect(backupNames(t)).toContain('auto-before-reset.backup');
    const after = new Terminal(t.net, 'R1');
    after.script(['/system backup load name=auto-before-reset.backup', 'y']);
    expect(after.device.config.system.identity).toBe('Oficina');
  });
});

// ── Lab 11 ──────────────────────────────────────────────────────────────────

describe('Lab 11 · Monitoreo con Torch', () => {
  const traffic = () => office({ traffic: true });
  const BLOQUEO = `/ip firewall filter add chain=forward src-address=${PC1_IP} action=drop`;

  it('torch en el bridge LAN con src-address identifica al PC que más descarga', () => {
    const t = traffic();
    const out = t.ok('/tool torch interface=bridge1 src-address=0.0.0.0/0 duration=1s');
    expect(out.split('\n').slice(0, 2)).toEqual([
      'Columns: SRC-ADDRESS, TX, RX, TX-PACKETS, RX-PACKETS',
      expect.stringMatching(/^SRC-ADDRESS\s+TX\s+RX\s+TX-PACKETS\s+RX-PACKETS$/),
    ]);
    // En el bridge, TX es lo que el router entrega al PC: su descarga.
    expect(cells(out, PC1_IP).slice(0, 3)).toEqual([PC1_IP, '8.0Mbps', '200.0kbps']);
    expect(cells(out, PC2_IP).slice(0, 3)).toEqual([PC2_IP, '100.0kbps', '10.0kbps']);
    const heavy = [PC1_IP, PC2_IP].sort((a, b) => bps(cells(out, b)[1]) - bps(cells(out, a)[1]));
    expect(heavy[0]).toBe(PC1_IP);
    expect(lastLine(out).slice(0, 2)).toEqual(['8.1Mbps', '210.0kbps']);
  });

  it('sin clasificadores torch solo muestra el total', () => {
    const t = traffic();
    const out = t.ok('/tool torch interface=ether1 duration=1s');
    expect(out.split('\n')).toHaveLength(3);
    expect(out.split('\n')[0]).toBe('Columns: TX, RX, TX-PACKETS, RX-PACKETS');
    expect(out).not.toContain('192.168.88.');
    // En la WAN, RX es la bajada total de la oficina.
    expect(lastLine(out).slice(0, 2)).toEqual(['210.0kbps', '8.1Mbps']);
  });

  // BUG: Torch muestra la cabecera recibida por el router (antes del masquerade) en todas sus interfaces.
  it.fails('torch en ether1 (WAN con masquerade) ve la IP pública, no la de los PCs', () => {
    const t = traffic();
    const out = t.ok('/tool torch interface=ether1 src-address=0.0.0.0/0 duration=1s');
    expect(out).not.toContain(PC1_IP);
    expect(out).toContain(formatIpv4(wanIp(t)));
  });

  it('torch en un puerto del bridge solo ve a su PC', () => {
    const t = traffic();
    const two = t.ok('/tool torch interface=ether2 src-address=0.0.0.0/0 duration=1s');
    expect(cells(two, PC1_IP).slice(0, 3)).toEqual([PC1_IP, '8.0Mbps', '200.0kbps']);
    expect(two).not.toContain(PC2_IP);
    const three = t.ok('/tool torch ether3 src-address=0.0.0.0/0 duration=1s');
    expect(three).toContain(PC2_IP);
    expect(three).not.toContain(PC1_IP);
  });

  it('con src-address y dst-address muestra a quién descarga cada PC', () => {
    const t = traffic();
    const out = t.ok(
      '/tool torch interface=bridge1 src-address=0.0.0.0/0 dst-address=0.0.0.0/0 duration=1s',
    );
    expect(out.split('\n')[0]).toBe(
      'Columns: SRC-ADDRESS, DST-ADDRESS, TX, RX, TX-PACKETS, RX-PACKETS',
    );
    expect(cells(out, PC1_IP).slice(0, 3)).toEqual([PC1_IP, EXAMPLE, '8.0Mbps']);
  });

  // BUG: el valor de src-address se ignora: solo activa el clasificador, no filtra.
  it.fails('src-address con una IP concreta limita torch a ese equipo', () => {
    const t = traffic();
    const out = t.ok(`/tool torch interface=bridge1 src-address=${PC1_IP}/32 duration=1s`);
    expect(out).toContain(PC1_IP);
    expect(out).not.toContain(PC2_IP);
  });

  it('error típico: torch sobre una interfaz que no existe', () => {
    const t = traffic();
    expect(t.run('/tool torch interface=ether9 duration=1s')).toBe(
      'input does not match any value of interface',
    );
  });

  it('torch sin duration es una vista en vivo que se redibuja con la red actual', () => {
    const t = traffic();
    t.ok('/tool torch interface=bridge1 src-address=0.0.0.0/0');
    const live = t.last?.live;
    expect(live?.mode).toBe('replace');
    expect(cells(live?.frame(t.net, 0) ?? '', PC1_IP)[1]).toBe('8.0Mbps');
    const blocked = new Terminal(t.net, 'R1');
    blocked.ok(BLOQUEO);
    expect(cells(live?.frame(blocked.net, 1) ?? '', PC1_IP)[1]).toBe('0bps');
  });

  it('monitor-traffic once refleja el tráfico tras avanzar el reloj', () => {
    const t = traffic();
    expect(t.ok('/interface monitor-traffic ether1 once')).toContain('rx-bits-per-second: 0bps');
    t.net = tick(t.net, 5);
    const out = t.ok('/interface monitor-traffic ether1 once');
    expect(out).toMatch(/^ +name: ether1$/m);
    expect(out).toMatch(/^ +rx-bits-per-second: 8\.1Mbps$/m);
    expect(out).toMatch(/^ +tx-bits-per-second: 210\.0kbps$/m);
    t.ok('/interface monitor-traffic ether2');
    expect(t.last?.live?.frame(t.net, 0)).toMatch(/tx-bits-per-second: 8\.0Mbps/);
  });

  it('/interface print stats acumula los bytes de 5 segundos', () => {
    const t = traffic();
    t.net = tick(t.net, 5);
    const out = t.ok('/interface print stats');
    expect(out.split('\n')).toContain('Columns: NAME, RX-BYTE, TX-BYTE, RX-PACKET, TX-PACKET');
    // 8,1 Mbps durante 5 s = 5 062 500 bytes de bajada por ether1.
    expect(out).toMatch(/ether1\s+5 062 500\s+131 250/);
    expect(out).toMatch(/ether2\s+125 000\s+5 000 000/);
    const ether1 = t.device.oper.interfaces.find(
      (i) => i.iface === t.device.config.interfaces[0]?.id,
    );
    expect(ether1?.rx.bytes).toBe(5_062_500);
  });

  it('al bloquear al PC pesado, torch del bridge ya no muestra su bajada', () => {
    const t = traffic();
    t.ok(BLOQUEO);
    const out = t.ok('/tool torch interface=bridge1 src-address=0.0.0.0/0 duration=1s');
    // Sigue llegando lo que envía PC1, pero ya no hay respuesta.
    expect(cells(out, PC1_IP).slice(0, 3)).toEqual([PC1_IP, '0bps', '200.0kbps']);
    expect(cells(out, PC2_IP).slice(0, 3)).toEqual([PC2_IP, '100.0kbps', '10.0kbps']);
    t.net = tick(t.net, 5);
    expect(t.ok('/interface monitor-traffic ether1 once')).toMatch(
      /rx-bits-per-second: 100\.0kbps/,
    );
  });

  // BUG: Torch cuenta como TX por ether1 los paquetes que el firewall descartó en forward.
  it.fails('tras bloquearlo, torch en ether1 no muestra tráfico del PC bloqueado', () => {
    const t = traffic();
    t.ok(BLOQUEO);
    const out = t.ok('/tool torch interface=ether1 duration=1s');
    expect(lastLine(out).slice(0, 2)).toEqual(['10.0kbps', '100.0kbps']);
  });
});

// ── Lab 12 ──────────────────────────────────────────────────────────────────

describe('Lab 12 · Oficina pequeña', () => {
  const SCRIPT: readonly string[] = [
    '/system identity set name=Oficina',
    '/interface bridge add name=bridge-lan comment="LAN oficina"',
    '/interface bridge port add bridge=bridge-lan interface=ether2',
    '/interface bridge port add bridge=bridge-lan interface=ether3',
    '/interface bridge port add bridge=bridge-lan interface=ether4',
    '/interface wifi set [ find default-name=wifi1 ] configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=clave-segura disabled=no',
    '/interface bridge port add bridge=bridge-lan interface=wifi1',
    '/interface list add name=WAN',
    '/interface list add name=LAN',
    '/interface list member add list=WAN interface=ether1',
    '/interface list member add list=LAN interface=bridge-lan',
    '/ip address add address=192.168.10.1/24 interface=bridge-lan',
    '/ip dhcp-client add interface=ether1 disabled=no',
    '/ip pool add name=pool-lan ranges=192.168.10.100-192.168.10.199',
    '/ip dhcp-server add name=dhcp-lan interface=bridge-lan address-pool=pool-lan lease-time=8h',
    '/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=192.168.10.1',
    '/ip dns set servers=1.1.1.1,8.8.8.8 allow-remote-requests=yes',
    '/ip dns static add name=router.lan address=192.168.10.1',
    '/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade comment="salida a Internet"',
    '/ip firewall filter add chain=input action=accept connection-state=established,related,untracked',
    '/ip firewall filter add chain=input action=drop connection-state=invalid',
    '/ip firewall filter add chain=input action=accept in-interface-list=LAN',
    '/ip firewall filter add chain=input action=drop in-interface-list=!LAN comment="resto de input"',
    '/ip firewall filter add chain=forward action=accept connection-state=established,related,untracked',
    '/ip firewall filter add chain=forward action=drop connection-state=invalid',
    '/ip firewall filter add chain=forward action=accept in-interface-list=LAN out-interface-list=WAN',
    '/ip firewall filter add chain=forward action=drop in-interface-list=WAN',
    '/ip neighbor discovery-settings set discover-interface-list=LAN',
    '/ip service disable telnet,ftp,www,api,api-ssl',
    '/ip service set ssh address=192.168.10.0/24',
  ];
  const HOSTS = ['PC1', 'PC2', 'LAP'] as const;
  const LAN = prefix('192.168.10.0/24');

  const oficina = () => fresh().script(SCRIPT);

  /** Todo lo que el lab valida al final, contra el estado de la red. */
  function works(t: Terminal): void {
    for (const host of HOSTS) {
      const client = deviceId(host);
      expect(check(t, { kind: 'leaseBound', server: R1, client, within: LAN }), host).toBe(true);
      expect(
        check(t, {
          kind: 'natSourceIs',
          from: client,
          to: { ip: ipv4('8.8.8.8') },
          protocol: 'icmp',
          expect: { addressOf: { device: R1, iface: { name: 'ether1' } } },
        }),
        host,
      ).toBe(true);
      expect(
        check(t, {
          kind: 'resolves',
          from: client,
          name: 'example.com',
          to: ipv4(EXAMPLE),
          via: R1,
        }),
        host,
      ).toBe(true);
    }
    expect(
      check(t, { kind: 'wifiAssociated', client: deviceId('LAP'), ap: R1, ssid: 'Oficina' }),
    ).toBe(true);
    for (const [protocol, port] of [
      ['tcp', 22],
      ['tcp', 8291],
      ['udp', 53],
      ['icmp', undefined],
    ] as const) {
      expect(fromInternet(t, protocol, port).forward.end, `${protocol}/${port}`).toMatchObject({
        kind: 'filtered',
        device: R1,
        chain: 'input',
        rule: ruleId(t, 'resto de input'),
      });
    }
  }

  it('el script completo se aplica sin errores', () => {
    const t = oficina();
    expect(t.prompt).toBe('[admin@Oficina] > ');
    expect(cells(t.ok('/interface bridge port print'), '3').slice(0, 3)).toEqual([
      '3',
      'wifi1',
      'bridge-lan',
    ]);
    expect(t.ok('/ip service print')).toMatch(/3\s+ssh\s+22\s+192\.168\.10\.0\/24/);
    expect(t.ok('/ip dhcp-client print')).toMatch(/ether1.*bound\s+203\.0\.113\.\d+\/24/);
  });

  it('PCs y portátil reciben lease del pool LAN', () => {
    const t = oficina();
    const leases = t.ok('/ip dhcp-server lease print');
    for (const host of HOSTS)
      expect(leases).toMatch(new RegExp(`192\\.168\\.10\\.1\\d\\d .*${host}`));
    expect(leases.split('\n').filter((l) => /^\d+ D /.test(l))).toHaveLength(3);
  });

  it('todos navegan con la IP WAN como origen y resuelven a través de R1', () => {
    const t = oficina();
    works(t);
    const seen = go(t.net, { from: 'LAP', dst: EXAMPLE, protocol: 'tcp', port: 443 });
    expect(seen.ok).toBe(true);
    expect(seen.delivered?.src).toBe(wanIp(t));
  });

  it('el router no responde a SSH, Winbox, DNS ni ping desde Internet', () => {
    const t = oficina();
    expect(
      check(t, {
        kind: 'blocked',
        by: 'firewall',
        from: deviceId('ISP'),
        to: { ip: wanIp(t) },
        protocol: 'tcp',
        port: 22,
      }),
    ).toBe(true);
    expect(fromInternet(t, 'icmp').ok).toBe(false);
    expect(fromInternet(t, 'udp', 53).ok).toBe(false);
  });

  it('desde la LAN se administra por SSH; desde Internet tampoco entraría sin el firewall', () => {
    const t = oficina();
    expect(go(t.net, { from: 'PC1', dst: '192.168.10.1', protocol: 'tcp', port: 22 }).ok).toBe(
      true,
    );
    // Telnet quedó deshabilitado.
    expect(go(t.net, { from: 'PC1', dst: '192.168.10.1', protocol: 'tcp', port: 23 }).ok).toBe(
      false,
    );
    t.ok('/ip firewall filter disable [find comment="resto de input"]');
    // La restricción de /ip service ssh address=... es una segunda barrera.
    expect(fromInternet(t, 'tcp', 22).forward.end).toMatchObject({ kind: 'port-closed' });
  });

  it('el propio router sale a Internet y resuelve nombres', () => {
    const t = oficina();
    expect(t.ok('/ping 8.8.8.8 count=2')).toContain('packet-loss=0%');
    expect(t.ok(':resolve example.com')).toBe(EXAMPLE);
    expect(t.ok(':resolve router.lan')).toBe('192.168.10.1');
  });

  it('export show-sensitive + reset + import deja la oficina funcionando igual', () => {
    const t = oficina();
    const body = (text: string) =>
      text
        .split('\n')
        .filter((l) => !l.startsWith('#'))
        .join('\n');
    const before = t.ok('/export show-sensitive');
    t.ok('/export file=oficina show-sensitive');
    t.script(['/system reset-configuration no-defaults=yes', 'y']);
    expect(go(t.net, { from: 'PC1', dst: '8.8.8.8', protocol: 'icmp' }).ok).toBe(false);
    const restored = new Terminal(t.net, 'R1');
    expect(restored.ok('/import oficina.rsc')).toBe('Script file loaded and executed successfully');
    expect(body(restored.ok('/export show-sensitive'))).toBe(body(before));
    works(restored);
  });

  // BUG: /tool mac-server no existe (endurecimiento habitual de defconf: MAC-Winbox solo desde la LAN).
  it.fails('/tool mac-server limitado a la lista LAN', () => {
    const t = oficina();
    t.ok('/tool mac-server set allowed-interface-list=LAN');
    t.ok('/tool mac-server mac-winbox set allowed-interface-list=LAN');
    expect(t.ok('/export')).toContain('/tool mac-server');
  });
});
