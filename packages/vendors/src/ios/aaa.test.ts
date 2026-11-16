import { deviceId, type EvalContext, evaluate, ipv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { IOS_PLATFORM } from './platform';
import { IosTerminal } from './terminal';

/** R1 con Gi0/1 encendida en 192.168.1.1/24 y una PC del técnico detrás. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', IOS_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/1', 'PC1:eth0')
    .enable('R1', 'GigabitEthernet0/1')
    .address('R1', 'GigabitEthernet0/1', '192.168.1.1/24')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

const term = () => new IosTerminal(lab(), 'R1').script(['enable', 'configure terminal']);
const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });
const flow = (port: number) =>
  ({
    from: deviceId('PC1'),
    to: { ip: ipv4('192.168.1.1') },
    protocol: 'tcp',
    port,
  }) as const;
const opens = (network: Network, port: number) =>
  evaluate({ kind: 'reachable', ...flow(port) }, ctxOf(network));
const users = (t: IosTerminal) =>
  t.device.config.system.users.map((u) => `${u.name} ${u.group} ${u.hasPassword}`);

describe('usuarios y enable secret', () => {
  it('el privilegio decide el grupo y la contraseña nunca se guarda', () => {
    const t = term();
    t.ok('username admin privilege 15 secret Cl4ve-Segura');
    t.ok('username operador privilege 5 password otra');
    t.ok('username lector secret x');
    expect(users(t)).toEqual(['admin full true', 'operador write true', 'lector read true']);
    expect(JSON.stringify(t.device.config)).not.toContain('Cl4ve-Segura');
    const run = t.ok('do show running-config | include username');
    expect(run).toMatch(/^username admin privilege 15 secret 5 \$1\$\S+$/m);
    expect(run).toMatch(/^username operador privilege 5 password 7 \S+$/m);
    expect(run).toMatch(/^username lector secret 5 \S+$/m);
    t.ok('username lector privilege 15');
    expect(users(t)).toContain('lector full true');
    t.ok('no username lector');
    expect(users(t)).toEqual(['admin full true', 'operador write true']);
  });

  it('enable secret se imprime cifrado y manda sobre enable password', () => {
    const t = term();
    t.ok('enable password abc');
    t.ok('enable secret class');
    t.ok('enable password otra');
    expect(t.ok('do sh run | i enable')).toMatch(/^enable secret 5 \$1\$\S+$/);
    t.ok('no enable secret');
    expect(t.ok('do sh run | i enable')).toBe('');
  });
});

describe('líneas vty, Telnet y SSH', () => {
  it('de fábrica no se puede entrar por Telnet ni por SSH', () => {
    const t = term();
    expect(opens(t.net, 23)).toBe(false);
    expect(opens(t.net, 22)).toBe(false);
    expect(t.ok('do sh run | section line vty')).toBe('line vty 0 4\n login');
  });

  it('login sin password avisa; con password Telnet ya responde', () => {
    const t = term();
    t.ok('line vty 0 4');
    expect(t.ok('login')).toBe("% Login disabled on line 1, until 'password' is set");
    t.ok('password cisco');
    expect(opens(t.net, 23)).toBe(true);
    t.ok('no password');
    expect(opens(t.net, 23)).toBe(false);
  });

  it('SSH necesita nombre, dominio, claves RSA, login local y un usuario', () => {
    const t = term();
    t.script(['line vty 0 4', 'login local', 'transport input ssh', 'exit']);
    expect(t.run('crypto key generate rsa modulus 1024')).toBe(
      '% Please define a hostname other than Router.',
    );
    t.ok('hostname R1');
    expect(t.run('crypto key generate rsa modulus 1024')).toBe(
      '% Please define a domain-name first.',
    );
    t.ok('ip domain-name lab.local');
    expect(t.ok('do show ip ssh')).toContain('SSH Disabled - version 1.99');
    expect(t.ok('crypto key generate rsa general-keys modulus 1024')).toContain(
      '%SSH-5-ENABLED: SSH 1.99 has been enabled',
    );
    // Sin ningún usuario con contraseña, login local no deja entrar a nadie.
    expect(opens(t.net, 22)).toBe(false);
    t.ok('username admin privilege 15 secret cisco');
    expect(opens(t.net, 22)).toBe(true);
    expect(opens(t.net, 23)).toBe(false);
    t.ok('ip ssh version 2');
    expect(t.ok('do show ip ssh')).toContain('SSH Enabled - version 2.0');
  });

  it('crypto key generate rsa sin modulus pregunta el tamaño', () => {
    const t = term();
    t.script(['hostname R1', 'ip domain name lab.local']);
    const ask = t.ok('crypto key generate rsa');
    expect(ask).toContain('The name for the keys will be: R1.lab.local');
    expect(ask.endsWith('How many bits in the modulus [512]: ')).toBe(true);
    expect(t.prompt).toBe('');
    expect(t.ok('2048')).toContain('% Generating 2048 bit RSA keys');
    expect(t.prompt).toBe('R1(config)#');
    expect(t.ok('crypto key zeroize rsa')).toBe('%SSH-5-DISABLED: SSH 1.99 has been disabled');
  });

  it('transport input all deja Telnet abierto aunque haya SSH', () => {
    const t = term();
    t.script([
      'hostname R1',
      'ip domain-name lab.local',
      'crypto key generate rsa modulus 1024',
      'username admin privilege 15 secret cisco',
      'line vty 0 4',
      'login local',
    ]);
    expect([opens(t.net, 22), opens(t.net, 23)]).toEqual([true, true]);
    t.ok('transport input ssh');
    expect([opens(t.net, 22), opens(t.net, 23)]).toEqual([true, false]);
    t.ok('transport input none');
    expect([opens(t.net, 22), opens(t.net, 23)]).toEqual([false, false]);
  });

  it('la configuración de las líneas sale en el orden de IOS', () => {
    const t = term();
    t.script([
      'line con 0',
      'exec-timeout 0 0',
      'logging synchronous',
      'line vty 0 4',
      'password cisco',
      'login local',
      'transport input ssh',
      'end',
    ]);
    expect(t.ok('show running-config | begin line con')).toBe(
      [
        'line con 0',
        ' exec-timeout 0 0',
        ' logging synchronous',
        'line aux 0',
        'line vty 0 4',
        ' password 7 0822455D0A165445415F59',
        ' login local',
        ' transport input ssh',
        '!',
        'end',
      ].join('\n'),
    );
  });
});
