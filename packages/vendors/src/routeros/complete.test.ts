import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { type CompleteCtx, complete, describeType, help } from './complete';
import { ROUTEROS_PLATFORM } from './platform';
import { T } from './schema';
import { DEFAULT_CLOCK_BASE, newSession } from './session';

const n = net()
  .router('R1', 'sim-r5w', ROUTEROS_PLATFORM)
  .bridge('R1', 'bridge1', ['ether2'])
  .build();
const device = deviceIn(n, 'R1');
const menuCtx = {
  net: n,
  device,
  platform: ROUTEROS_PLATFORM,
  user: 'admin',
  clockBase: DEFAULT_CLOCK_BASE,
};

const ctxAt = (path: readonly string[] = []): CompleteCtx => ({
  menuCtx,
  session: { ...newSession(device), path },
});

/** Completa con el cursor al final de la línea. */
const tab = (input: string, path: readonly string[] = []) =>
  complete(input, input.length, ctxAt(path));
const texts = (input: string, path: readonly string[] = []) =>
  tab(input, path).candidates.map((c) => c.text);
const helpLines = (input: string, path: readonly string[] = []) =>
  help(input, ctxAt(path)).split('\n');

describe('complete: rutas y comandos', () => {
  it('completa submenús con prefijo', () => {
    const result = tab('/ip add');
    expect(result.candidates).toEqual([{ text: 'address', description: 'Address management' }]);
    expect(result.replaceFrom).toBe(4);
  });

  it('en la raíz propone submenús y comandos globales ordenados', () => {
    const all = texts('');
    expect(all).toEqual([...all].sort());
    expect(all).toEqual(expect.arrayContaining(['interface', 'ip', 'system', 'export', 'ping']));
    expect(texts('/i')).toEqual(['import', 'interface', 'ip']);
  });

  it('mezcla comandos del menú y globales', () => {
    expect(texts('/ip address p')).toEqual(['ping', 'print']);
    expect(texts('/ip address ')).toEqual(
      expect.arrayContaining(['add', 'print', 'remove', 'set', 'export', 'undo']),
    );
  });

  it('acepta rutas relativas a la sesión', () => {
    expect(texts('add', ['ip'])).toEqual(['address']);
    expect(texts('firewall f', ['ip'])).toEqual(['filter']);
    expect(texts('.. interface br', ['ip'])).toEqual(['bridge']);
    expect(texts('../interface/br', ['ip'])).toEqual(['bridge']);
    expect(texts('/interface br', ['ip'])).toEqual(['bridge']);
  });

  it('acepta la forma v7 con barras y completa solo el último segmento', () => {
    const result = tab('/ip/addr');
    expect(result.candidates.map((c) => c.text)).toEqual(['address']);
    expect(result.replaceFrom).toBe(4);
    expect(texts('/ip/address/pr')).toEqual(['print']);
    expect(texts('/interface/bridge/')).toEqual(expect.arrayContaining(['host', 'port', 'vlan']));
    expect(texts('/')).toEqual(texts(''));
  });

  it('completa en mitad de la línea según el cursor', () => {
    const result = complete('/ip addr print', 8, ctxAt());
    expect(result.candidates.map((c) => c.text)).toEqual(['address']);
    expect(result.replaceFrom).toBe(4);
  });

  it('solo mira el último comando tras `;`', () => {
    expect(texts('/ip address print; /interface br')).toEqual(['bridge']);
    expect(texts('/ip address print;/interface br')).toEqual(['bridge']);
    expect(texts('/ip address print; add', ['ip'])).toEqual(['address']);
  });
});

describe('complete: argumentos', () => {
  it('propone nombres de argumento con `=`', () => {
    const result = tab('/ip address add int');
    expect(result.candidates.map((c) => c.text)).toEqual(['interface=']);
    expect(result.replaceFrom).toBe('/ip address add '.length);
    expect(texts('/ip address add ')).toEqual(['address=', 'comment=', 'disabled=', 'interface=']);
  });

  it('acepta la forma v7 y rutas relativas antes del comando', () => {
    expect(texts('/ip/address/add int')).toEqual(['interface=']);
    expect(texts('address add int', ['ip'])).toEqual(['interface=']);
    expect(texts('add int', ['ip', 'address'])).toEqual(['interface=']);
  });

  it('no repite los argumentos ya escritos (aunque estén abreviados)', () => {
    expect(texts('/ip address add interface=ether1 ')).toEqual([
      'address=',
      'comment=',
      'disabled=',
    ]);
    expect(texts('/ip address add int=ether1 addr=1.1.1.1/24 ')).toEqual(['comment=', 'disabled=']);
  });

  it('add incluye los argumentos addOnly y set no', () => {
    expect(texts('/ip firewall filter add pl')).toEqual(['place-before=']);
    expect(texts('/ip firewall filter set pl')).toEqual([]);
  });

  it('los flags se proponen sin `=`', () => {
    expect(texts('/ip route add bl')).toEqual(['blackhole']);
    expect(texts('/interface monitor-traffic ')).toEqual(['interface=', 'once']);
  });

  it('print propone sus opciones como palabras', () => {
    expect(texts('/ip address print ')).toEqual([
      'brief',
      'count-only',
      'detail',
      'stats',
      'terse',
      'where',
      'without-paging',
    ]);
    expect(texts('/ip address print detail ')).not.toContain('detail');
  });

  it('acciones del menú usan sus argumentos', () => {
    expect(texts('/system reboot ')).toEqual([]);
    expect(texts('/system backup save ')).toEqual(['dont-encrypt=', 'name=', 'password=']);
    expect(texts('/tool traceroute ')).toEqual(['address=', 'count=']);
  });

  it('comandos globales: ping, export e import', () => {
    expect(texts('ping ')).toEqual([
      'address=',
      'count=',
      'interface=',
      'interval=',
      'size=',
      'src-address=',
    ]);
    expect(texts('/ip address export ')).toEqual([
      'compact',
      'file=',
      'hide-sensitive',
      'show-sensitive',
      'terse',
      'verbose',
    ]);
    expect(texts('import f')).toEqual(['file-name=']);
    expect(texts('undo ')).toEqual([]);
  });

  it('describe con PropDef.help o con el texto de la opción', () => {
    const detail = tab('/ip address print det').candidates[0];
    expect(detail?.description).toBe('Print all properties of each item');
    const iface = tab('/ip address add int').candidates[0];
    expect(iface).toEqual({ text: 'interface=' });
  });
});

describe('complete: valores', () => {
  it('nombres de interfaz', () => {
    const input = '/ip address add interface=eth';
    const result = tab(input);
    expect(result.candidates.map((c) => c.text)).toEqual([
      'ether1',
      'ether2',
      'ether3',
      'ether4',
      'ether5',
    ]);
    expect(result.replaceFrom).toBe(input.indexOf('=') + 1);
  });

  it('con el nombre del argumento abreviado', () => {
    expect(texts('/ip address add int=br')).toEqual(['bridge1']);
  });

  it('bridges', () => {
    const input = '/interface bridge port add bridge=';
    const result = tab(input);
    expect(result.candidates.map((c) => c.text)).toEqual(['bridge1']);
    expect(result.replaceFrom).toBe(input.length);
  });

  it('enums y booleanos', () => {
    expect(texts('/interface bridge add protocol-mode=r')).toEqual(['rstp']);
    expect(texts('/interface bridge add vlan-filtering=')).toEqual(['no', 'yes']);
    expect(texts('/ip route add blackhole=y')).toEqual(['yes']);
  });

  it('listas: completa el elemento tras la última coma', () => {
    const input = '/interface bridge vlan add tagged=ether1,br';
    const result = tab(input);
    expect(result.candidates.map((c) => c.text)).toEqual(['bridge1']);
    expect(result.replaceFrom).toBe(input.lastIndexOf(',') + 1);
    expect(texts('/ip firewall filter add connection-state=new,est')).toEqual(['established']);
  });

  it('valores negables: completa tras el `!`', () => {
    const input = '/ip firewall filter add in-interface=!br';
    const result = tab(input);
    expect(result.candidates.map((c) => c.text)).toEqual(['bridge1']);
    expect(result.replaceFrom).toBe(input.indexOf('!') + 1);
    expect(texts('/ip firewall filter add protocol=t')).toEqual(['tcp']);
  });

  it('listas de interfaz incluyen las incorporadas', () => {
    expect(texts('/ip firewall filter add in-interface-list=')).toEqual([
      'all',
      'dynamic',
      'none',
      'static',
    ]);
  });

  it('valores sin opciones conocidas no proponen nada', () => {
    expect(texts('/ip address add address=1')).toEqual([]);
    expect(texts('/ip address add nope=x')).toEqual([]);
  });

  it('print where: propiedades del menú y sus valores', () => {
    expect(texts('/ip address print where int')).toEqual(['interface']);
    expect(texts('/ip address print where interface=br')).toEqual(['bridge1']);
    expect(texts('/ip address print where interface!=br')).toEqual(['bridge1']);
  });
});

describe('complete: entradas raras', () => {
  it('nunca lanza y devuelve cero candidatos', () => {
    const weird = [
      '/ip address add comment="abc ',
      '/ip address add comment="abc def',
      '/xyz add',
      '/ip address print where interface=[/interface find ',
      ']',
      '/ip/address/print/x ',
      'address=1 ',
      '"/ip" add',
      '/i ',
    ];
    for (const input of weird) {
      expect(() => tab(input)).not.toThrow();
    }
    expect(tab('/ip address add comment="abc ').candidates).toEqual([]);
    expect(tab('/xyz add').candidates).toEqual([]);
    expect(tab('/i ').candidates).toEqual([]);
    expect(tab('/ip/address/print/x ').candidates).toEqual([]);
  });

  it('acota el cursor a la longitud de la entrada', () => {
    expect(complete('/ip add', 99, ctxAt()).replaceFrom).toBe(4);
    expect(complete('/ip add', -5, ctxAt()).replaceFrom).toBe(0);
    expect(complete('/ip add', Number.NaN, ctxAt()).candidates.map((c) => c.text)).toEqual([
      'address',
    ]);
  });
});

describe('help', () => {
  it('en la raíz: comandos globales y submenús', () => {
    const lines = helpLines('');
    expect(lines[0]).toBe('Global commands');
    expect(lines[1]).toBe('');
    expect(lines.some((l) => l.startsWith('..'))).toBe(false);
    expect(lines).toContain('interface/ -- Interface configuration');
    expect(lines).toContain('ip/ -- ip');
    expect(lines).toContain('export -- Print or save an export script');
    const entries = lines.slice(2).map((l) => l.split(' -- ')[0]?.replace(/\/$/, '') ?? '');
    expect(entries).toEqual([...entries].sort());
  });

  it('en /ip/address: ayuda del menú, subir y comandos', () => {
    const lines = helpLines('/ip address');
    expect(lines.slice(0, 3)).toEqual(['Address management', '', '.. -- go up to ip']);
    expect(lines).toContain('add -- Create a new item');
    expect(lines).toContain('print -- Print values of item properties');
    expect(lines).toContain('undo -- Undo previous action');
    expect(helpLines('', ['ip', 'address'])).toEqual(lines);
    expect(helpLines('/ip/address')).toEqual(lines);
  });

  it('un nivel por debajo de la raíz sube a root', () => {
    expect(helpLines('/ip').slice(0, 3)).toEqual(['ip', '', '.. -- go up to root']);
    expect(helpLines('/ip')).toContain('address/ -- Address management');
    expect(helpLines('/interface bridge port')[2]).toBe('.. -- go up to bridge');
  });

  it('tras un comando: argumentos con su tipo', () => {
    expect(helpLines('add ', ['ip', 'address'])).toEqual([
      'Create a new item',
      '',
      'address -- IP address with prefix',
      'comment -- Text',
      'disabled -- yes | no',
      'interface -- Interface name',
    ]);
    expect(helpLines('add ?', ['ip', 'address'])).toEqual(helpLines('add ', ['ip', 'address']));
    expect(helpLines('/ip address add int')).toEqual(helpLines('add ', ['ip', 'address']));
  });

  it('describe tipos de reglas, rutas y opciones de print', () => {
    const filter = helpLines('/ip firewall filter add ');
    expect(filter).toContain('in-interface -- Interface name (! to negate)');
    expect(filter).toContain('protocol -- Protocol name or number (! to negate)');
    expect(filter).toContain('src-port -- Port or port range (! to negate)');
    expect(filter).toContain(
      'connection-state -- List of: established | related | new | invalid | untracked',
    );
    const route = helpLines('/ip route add ');
    expect(route).toContain('distance -- Integer: 1..255');
    expect(route).toContain('gateway -- IP address or interface');
    expect(route).toContain('blackhole -- yes | no');
    expect(helpLines('/ip address print ')).toContain(
      'where -- Print only the items that match an expression',
    );
    expect(helpLines('ping ')).toContain('address -- IP address or DNS name');
    expect(helpLines('import ')).toContain('file-name -- File name');
  });

  it('comandos sin argumentos: solo su ayuda', () => {
    expect(help('undo', ctxAt())).toBe('Undo previous action');
  });

  it('entrada rara: ayuda genérica sin lanzar', () => {
    expect(() => help('/ip address add comment="abc', ctxAt())).not.toThrow();
    expect(helpLines('/ip address add comment="abc')[0]).toBe('Global commands');
    expect(helpLines('/ip xyz')[0]).toBe('ip');
    expect(helpLines('/ip address print;')[0]).toBe('Global commands');
  });
});

describe('describeType', () => {
  it('cubre todos los tipos', () => {
    expect(describeType(T.ip)).toBe('IP address');
    expect(describeType(T.prefix)).toBe('IP address with prefix');
    expect(describeType(T.ipList)).toBe('List of IP addresses');
    expect(describeType(T.rangeList)).toBe('List of address ranges');
    expect(describeType(T.address)).toBe('IP address, prefix or range');
    expect(describeType(T.mac)).toBe('MAC address');
    expect(describeType(T.bool)).toBe('yes | no');
    expect(describeType(T.flag)).toBe('yes | no');
    expect(describeType(T.int(1, 4094))).toBe('Integer: 1..4094');
    expect(describeType(T.time)).toBe('Time interval');
    expect(describeType(T.kib)).toBe('Size in KiB');
    expect(describeType(T.enumOf('a', 'b'))).toBe('a | b');
    expect(describeType(T.enumList('a', 'b'))).toBe('List of: a | b');
    expect(describeType(T.ref('pool'))).toBe('Pool name');
    expect(describeType(T.ref('dhcp-server'))).toBe('DHCP server name');
    expect(describeType(T.ref('interface-list'))).toBe('Interface list name');
    expect(describeType(T.ref('user'))).toBe('User name');
    expect(describeType(T.ref('bridge'))).toBe('Bridge name');
    expect(describeType(T.refList('interface'))).toBe('List of: Interface name');
    expect(describeType(T.vlanIds)).toBe('List of VLAN IDs');
    expect(describeType(T.ports)).toBe('Port or port range');
    expect(describeType(T.gateway)).toBe('IP address or interface');
    expect(describeType(T.protocol)).toBe('Protocol name or number');
    expect(describeType(T.neg(T.address))).toBe('IP address, prefix or range (! to negate)');
    expect(describeType(T.string)).toBe('Text');
    expect(describeType(T.name)).toBe('Text');
  });
});
