import { deviceId, type EvalContext, evaluate, formatPrefix, ipv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { configBody } from './config-text';
import { iosStartup, startupLines } from './driver';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/** R1 con IOS y una PC en Gi0/1 con 192.168.1.10/24 y la puerta de enlace en .1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

const term = () => new IosTerminal(lab(), 'R1');
const addresses = (t: IosTerminal) =>
  t.device.config.addressing.addresses.map((a) => formatPrefix(a.address));
const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });
const pcReachesRouter = (network: Network) =>
  evaluate(
    { kind: 'reachable', from: deviceId('PC1'), to: { ip: ipv4('192.168.1.1') }, protocol: 'icmp' },
    ctxOf(network),
  );

describe('modos y prompt', () => {
  it('pasa de EXEC de usuario a privilegiado, a configuración y a la interfaz', () => {
    const t = term();
    expect(t.prompt).toBe('Router>');
    t.ok('enable');
    expect(t.prompt).toBe('Router#');
    expect(t.ok('configure terminal')).toBe(
      'Enter configuration commands, one per line.  End with CNTL/Z.',
    );
    expect(t.prompt).toBe('Router(config)#');
    t.ok('interface GigabitEthernet0/1');
    expect(t.prompt).toBe('Router(config-if)#');
    t.ok('exit');
    expect(t.prompt).toBe('Router(config)#');
    expect(t.ok('end')).toBe('%SYS-5-CONFIG_I: Configured from console by console');
    expect(t.prompt).toBe('Router#');
    t.ok('disable');
    expect(t.prompt).toBe('Router>');
    t.ok('exit');
    expect(t.last?.closed).toBe(true);
  });

  it('el prompt de cada submodo y el nombre nuevo al momento', () => {
    const t = term();
    t.script(['en', 'conf t', 'hostname R1']);
    expect(t.prompt).toBe('R1(config)#');
    t.ok('ip dhcp pool LAN');
    expect(t.prompt).toBe('R1(dhcp-config)#');
    t.ok('line vty 0 4');
    expect(t.prompt).toBe('R1(config-line)#');
    t.ok('line console 0');
    expect(t.prompt).toBe('R1(config-line)#');
  });

  it('acepta abreviaturas por prefijo único y el tipo de interfaz separado del número', () => {
    const t = term();
    t.script(['en', 'conf t', 'int GigabitEthernet 0/1']);
    expect(t.prompt).toBe('Router(config-if)#');
    t.ok('ex');
    t.ok('int gi0/2');
    t.ok('int g0/0');
    t.ok('ip add 10.0.0.1 255.255.255.0');
    expect(addresses(t)).toEqual(['10.0.0.1/24']);
    t.ok('end');
    expect(t.ok('sh ip int br')).toContain('GigabitEthernet0/0         10.0.0.1');
    expect(t.ok('wr')).toBe('Building configuration...\n[OK]');
  });

  it('Ctrl+Z y Ctrl+C vuelven al EXEC privilegiado desde cualquier modo de configuración', () => {
    const t = term();
    t.script(['enable', 'configure terminal', 'interface g0/1']);
    expect(t.key('ctrl-z')).toBe('%SYS-5-CONFIG_I: Configured from console by console');
    expect(t.prompt).toBe('Router#');
    expect(t.key('ctrl-z')).toBe('');
    expect(t.prompt).toBe('Router#');
    t.script(['conf t', 'ip dhcp pool X']);
    t.key('ctrl-c');
    expect(t.prompt).toBe('Router#');
  });

  it('un comando de configuración global desde un submodo sale a configuración y se ejecuta', () => {
    const t = term();
    t.script(['en', 'conf t', 'int g0/1', 'hostname R1']);
    expect(t.prompt).toBe('R1(config)#');
    t.script(['int g0/1', 'interface g0/2']);
    expect(t.prompt).toBe('R1(config-if)#');
  });

  it('do ejecuta comandos de EXEC desde configuración, con filtros', () => {
    const t = term();
    t.script(['en', 'conf t', 'int g0/1', 'ip address 192.168.1.1 255.255.255.0']);
    expect(t.ok('do show ip interface brief')).toContain('192.168.1.1');
    expect(t.prompt).toBe('Router(config-if)#');
    expect(t.ok('do sh run | include 192.168')).toBe(' ip address 192.168.1.1 255.255.255.0');
  });

  it('configure a secas pregunta desde dónde y acepta Enter', () => {
    const t = term();
    t.ok('enable');
    expect(t.ok('configure')).toBe('Configuring from terminal, memory, or network [terminal]? ');
    expect(t.prompt).toBe('');
    expect(t.ok('')).toBe('Enter configuration commands, one per line.  End with CNTL/Z.');
    expect(t.prompt).toBe('Router(config)#');
  });

  it('en EXEC de usuario no hay configuración ni show running-config', () => {
    const t = term();
    expect(t.run('configure terminal')).toContain("% Invalid input detected at '^' marker.");
    expect(t.run('show running-config')).toContain("% Invalid input detected at '^' marker.");
    expect(t.ok('show version')).toContain('Version 15.1');
  });
});

describe('errores con la voz de IOS', () => {
  it('señala con ^ la palabra que no existe, alineada con el prompt', () => {
    const t = term();
    t.script(['en', 'conf t']);
    expect(t.run('hostnme R1')).toBe(
      `${' '.repeat('Router(config)#'.length)}^\n% Invalid input detected at '^' marker.`,
    );
    expect(t.last?.ok).toBe(false);
    t.ok('int g0/1');
    expect(t.run('ip address 192.168.1.300 255.255.255.0')).toBe(
      `${' '.repeat('Router(config-if)#ip address '.length)}^\n% Invalid input detected at '^' marker.`,
    );
  });

  it('comando incompleto y ambiguo', () => {
    const t = term();
    t.ok('en');
    expect(t.run('show')).toBe('% Incomplete command.');
    expect(t.run('c')).toBe('% Ambiguous command:  "c"');
    t.ok('conf t');
    expect(t.run('ip address 1.1.1.1')).toContain('^');
    t.ok('int g0/1');
    expect(t.run('ip address 192.168.1.1')).toBe('% Incomplete command.');
  });

  it('una palabra suelta en EXEC se toma por un equipo al que conectarse', () => {
    const t = term();
    expect(t.run('hola')).toBe(
      'Translating "hola"...domain server (255.255.255.255)\n% Unknown command or computer name, or unable to find computer address',
    );
    t.script(['en', 'conf t', 'no ip domain-lookup', 'end']);
    expect(t.run('hola')).toBe(
      'Translating "hola"\n% Unknown command or computer name, or unable to find computer address',
    );
  });

  it('un comando de configuración en EXEC marca la segunda palabra', () => {
    const t = term();
    t.ok('enable');
    expect(t.run('hostname R1')).toBe(
      `${' '.repeat('Router#hostname '.length)}^\n% Invalid input detected at '^' marker.`,
    );
  });

  it('con do, el ^ cuenta lo que ocupa el do', () => {
    const t = term();
    t.script(['en', 'conf t']);
    expect(t.run('do show ip rute')).toBe(
      `${' '.repeat('Router(config)#do show ip '.length)}^\n% Invalid input detected at '^' marker.`,
    );
  });

  it('dirección de red o de difusión, solapada con otra interfaz y nombre ilegal', () => {
    const t = term();
    t.script(['en', 'conf t', 'int g0/1']);
    expect(t.run('ip address 192.168.1.0 255.255.255.0')).toBe(
      'Bad mask /24 for address 192.168.1.0',
    );
    t.ok('ip address 192.168.1.1 255.255.255.0');
    t.ok('int g0/2');
    expect(t.run('ip address 192.168.1.2 255.255.255.0')).toBe(
      '% 192.168.1.0 overlaps with GigabitEthernet0/1',
    );
    expect(t.run('hostname 1abc')).toBe('% Hostname contains one or more illegal characters.');
  });
});

describe('interfaces apagadas de fábrica', () => {
  it('salen administratively down y la PC no llega hasta el no shutdown', () => {
    const t = term();
    t.script(['en', 'conf t', 'int g0/1', 'ip address 192.168.1.1 255.255.255.0']);
    expect(t.ok('do show ip interface brief')).toContain(
      'GigabitEthernet0/1         192.168.1.1     YES manual administratively down down',
    );
    expect(pcReachesRouter(t.net)).toBe(false);
    expect(t.ok('no shutdown')).toBe(
      '%LINK-5-CHANGED: Interface GigabitEthernet0/1, changed state to up\n\n%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to up',
    );
    expect(pcReachesRouter(t.net)).toBe(true);
    expect(t.ok('do sh ip int br')).toContain(
      '192.168.1.1     YES manual up                    up',
    );
    expect(t.ok('shutdown')).toBe(
      '%LINK-5-CHANGED: Interface GigabitEthernet0/1, changed state to administratively down\n\n%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/1, changed state to down',
    );
    expect(pcReachesRouter(t.net)).toBe(false);
  });

  it('sin cable, no shutdown deja la interfaz down sin avisos', () => {
    const t = term();
    t.script(['en', 'conf t', 'int g0/3']);
    expect(t.ok('no shutdown')).toBe('');
    expect(t.ok('do sh ip int br')).toContain(
      'GigabitEthernet0/3         unassigned      YES unset  down                  down',
    );
  });

  it('description, no ip address y show interfaces', () => {
    const t = term();
    t.script([
      'en',
      'conf t',
      'int g0/1',
      'description LAN de ventas',
      'ip address 192.168.1.1 255.255.255.0',
      'no shut',
    ]);
    const detail = t.ok('do show interfaces g0/1');
    expect(detail).toContain('GigabitEthernet0/1 is up, line protocol is up');
    expect(detail).toContain('  Description: LAN de ventas');
    expect(detail).toContain('  Internet address is 192.168.1.1/24');
    t.ok('no ip address');
    expect(addresses(t)).toEqual([]);
    t.ok('no description');
    expect(t.device.config.interfaces.find((i) => i.name === 'GigabitEthernet0/1')?.comment).toBe(
      undefined,
    );
  });
});

describe('show running-config', () => {
  it('tiene la forma de IOS y cuenta sus bytes', () => {
    const t = term();
    t.script([
      'en',
      'conf t',
      'hostname R1',
      'int g0/1',
      'ip address 192.168.1.1 255.255.255.0',
      'no shut',
      'end',
    ]);
    const run = t.ok('show running-config');
    const lines = run.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'Building configuration...',
      '',
      `Current configuration : ${configBody(t.device).length + 1} bytes`,
    ]);
    expect(run).toContain('!\nversion 15.1\n');
    expect(run).toContain('!\nhostname R1\n!');
    expect(run).toContain(
      'interface GigabitEthernet0/1\n ip address 192.168.1.1 255.255.255.0\n duplex auto\n speed auto\n!',
    );
    expect(run).toContain('interface GigabitEthernet0/0\n no ip address\n shutdown\n');
    expect(run).toContain('line vty 0 4\n login\n!\nend');
    expect(lines.at(-1)).toBe('end');
  });

  it('se puede volver a cargar como script de arranque y sale igual', () => {
    const t = term();
    t.script([
      'en',
      'conf t',
      'hostname R1',
      'enable secret clase',
      'int g0/1',
      'description LAN',
      'ip address 192.168.1.1 255.255.255.0',
      'ip nat inside',
      'no shut',
      'int g0/0',
      'ip address 203.0.113.2 255.255.255.0',
      'ip nat outside',
      'no shut',
      'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      'access-list 1 permit 192.168.1.0 0.0.0.255',
      'ip nat inside source list 1 interface g0/0 overload',
      'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
      'ip dhcp pool LAN',
      'network 192.168.1.0 255.255.255.0',
      'default-router 192.168.1.1',
      'dns-server 192.168.1.1',
      'lease 2',
      'ip domain-name lab.local',
      'ip name-server 8.8.8.8',
      'ip dns server',
      'username admin privilege 15 secret cisco',
      'line vty 0 4',
      'login local',
      'transport input ssh',
      'end',
    ]);
    const run = t.ok('show running-config');
    const fresh = lab().devices.find((d) => d.id === 'R1');
    if (!fresh) throw new Error('falta R1');
    const loaded = iosStartup(fresh, run);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(configBody(loaded.value)).toBe(configBody(t.device));
  });

  it('el script de arranque salta comentarios, end y version, y enciende las interfaces que nombra', () => {
    expect(
      startupLines(
        '!\nversion 15.1\nhostname R1\n!\n int g0/1\n  ip address 10.0.0.1 255.0.0.0\ninterface Null0\nend\n',
      ),
    ).toEqual([
      'hostname R1',
      'int g0/1',
      'no shutdown',
      'ip address 10.0.0.1 255.0.0.0',
      'interface Null0',
    ]);
    const fresh = lab().devices.find((d) => d.id === 'R1');
    if (!fresh) throw new Error('falta R1');
    const loaded = iosStartup(
      fresh,
      'interface g0/1\n description LAN\ninterface g0/2\n shutdown\n',
    );
    if (!loaded.ok) throw new Error(loaded.error);
    const off = (name: string) =>
      loaded.value.config.interfaces.find((i) => i.name === name)?.disabled;
    expect([
      off('GigabitEthernet0/0'),
      off('GigabitEthernet0/1'),
      off('GigabitEthernet0/2'),
    ]).toEqual([true, false, true]);
  });
});

describe('guardar la configuración', () => {
  it('startup-config no existe hasta write memory', () => {
    const t = term();
    t.ok('enable');
    expect(t.ok('show startup-config')).toBe('startup-config is not present');
    expect(t.ok('write memory')).toBe('Building configuration...\n[OK]');
    expect(t.ok('show startup-config')).toMatch(/^Using \d+ out of 262136 bytes\n!\nversion 15.1/);
  });

  it('copy running-config startup-config pregunta el destino y Enter lo acepta', () => {
    const t = term();
    t.script(['en', 'conf t', 'hostname R1', 'end']);
    expect(t.ok('copy run start')).toBe('Destination filename [startup-config]? ');
    expect(t.prompt).toBe('');
    expect(t.ok('')).toBe('Building configuration...\n[OK]');
    expect(t.prompt).toBe('R1#');
    expect(t.ok('sh start | i hostname')).toBe('hostname R1');
    const saved = evaluate(
      { kind: 'configMatches', device: deviceId('R1'), snapshot: { file: 'startup-config' } },
      ctxOf(t.net),
    );
    expect(saved).toBe(true);
    // Un cambio después de guardar deja lo guardado atrás.
    t.script(['conf t', 'hostname R2', 'end']);
    expect(
      evaluate(
        { kind: 'configMatches', device: deviceId('R1'), snapshot: { file: 'startup-config' } },
        ctxOf(t.net),
      ),
    ).toBe(false);
  });

  it('Ctrl+C cancela la pregunta y erase startup-config borra lo guardado', () => {
    const t = term();
    t.ok('en');
    t.ok('copy running-config startup-config');
    t.key('ctrl-c');
    expect(t.prompt).toBe('Router#');
    expect(t.ok('show startup-config')).toBe('startup-config is not present');
    t.ok('wr');
    expect(t.ok('erase startup-config')).toContain('[confirm]');
    expect(t.ok('')).toBe('[OK]\nErase of nvram: complete');
    expect(t.ok('show startup-config')).toBe('startup-config is not present');
  });
});

describe('ayuda y autocompletado', () => {
  it('? lista lo que puede venir con descripciones', () => {
    const t = term();
    t.ok('enable');
    expect(t.help('sh')).toBe('show');
    const ip = t.help('show ip ');
    expect(ip).toContain('interface');
    expect(ip).toContain('route');
    t.script(['conf t', 'int g0/1']);
    expect(t.help('ip address ')).toContain('A.B.C.D');
    expect(t.help('ip address 192.168.1.1 255.255.255.0 ')).toContain('<cr>');
    expect(t.help('xyz')).toBe('% Unrecognized command');
    expect(t.help('do sh')).toBe('show');
  });

  it('Tab completa la palabra a medias', () => {
    const t = term();
    t.ok('enable');
    expect(t.complete('conf')).toEqual(['configure']);
    t.ok('conf t');
    expect(t.complete('host')).toEqual(['hostname']);
  });
});
