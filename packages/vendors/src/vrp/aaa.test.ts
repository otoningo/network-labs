import { deviceId, type EvalContext, evaluate, ipv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { PASSWORD_PLACEHOLDER } from './commands/aaa';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/** R1 con VRP y una PC en GE0/0/1: 192.168.1.10/24 hacia el router en .1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .address('R1', 'GigabitEthernet0/0/1', '192.168.1.1/24')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

const term = () => new VrpTerminal(lab(), 'R1');
const userOf = (t: VrpTerminal, name: string) =>
  t.device.config.system.users.find((u) => u.name === name);
const serviceOf = (t: VrpTerminal, name: string) =>
  t.device.config.services.find((s) => s.name === name);

const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });
const telnetFlow = {
  from: deviceId('PC1'),
  to: { ip: ipv4('192.168.1.1') },
  protocol: 'tcp',
  port: 23,
} as const;

describe('vista AAA y usuarios locales', () => {
  it('aaa entra en la vista y display this muestra el bloque', () => {
    const t = term();
    t.script(['system-view', 'aaa']);
    expect(t.prompt).toBe('[Huawei-aaa]');
    // El admin de fábrica tiene contraseña y acceso total (nivel 15).
    expect(t.ok('display this')).toBe(
      [
        '#',
        'aaa',
        ` local-user admin password irreversible-cipher ${PASSWORD_PLACEHOLDER}`,
        ' local-user admin privilege level 15',
        '#',
        'return',
      ].join('\n'),
    );
  });

  it('crea el usuario con contraseña sin guardar nunca el texto', () => {
    const t = term();
    t.script(['system-view', 'aaa']);
    expect(t.ok('local-user soporte password irreversible-cipher Secreto@123')).toBe(
      'Info: Add a new user.',
    );
    const user = userOf(t, 'soporte');
    expect(user).toMatchObject({ hasPassword: true, group: 'read', disabled: false });
    expect(JSON.stringify(t.device.config)).not.toContain('Secreto@123');
    // Cambiar la contraseña de un usuario que ya existe no avisa.
    expect(t.ok('local-user soporte password cipher Otra@456')).toBe('');
    expect(JSON.stringify(t.device.config)).not.toContain('Otra@456');
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain(
      ` local-user soporte password irreversible-cipher ${PASSWORD_PLACEHOLDER}`,
    );
    expect(cfg).not.toContain('Secreto@123');
    expect(cfg).not.toContain('Otra@456');
  });

  it('privilege level 3 da el grupo full y el nivel sale en la configuración', () => {
    const t = term();
    t.script([
      'system-view',
      'aaa',
      'local-user tecnico password irreversible-cipher Clave@2024',
      'local-user tecnico privilege level 3',
    ]);
    expect(userOf(t, 'tecnico')).toMatchObject({ group: 'full', hasPassword: true });
    expect(t.ok('display this')).toContain(' local-user tecnico privilege level 3');
  });

  it('traduce los niveles 0-1 a read, 2 a write y 3-15 a full', () => {
    const t = term();
    t.script(['system-view', 'aaa']);
    const cases: readonly (readonly [number, string])[] = [
      [0, 'read'],
      [1, 'read'],
      [2, 'write'],
      [3, 'full'],
      [15, 'full'],
    ];
    for (const [level, group] of cases) {
      t.ok(`local-user u${level} privilege level ${level}`);
      expect(userOf(t, `u${level}`)?.group).toBe(group);
    }
    // Sin contraseña todavía: el usuario existe pero sin ella.
    expect(userOf(t, 'u2')?.hasPassword).toBe(false);
    expect(t.run('local-user u1 privilege level 16')).toContain('Wrong parameter');
  });

  it('service-type se guarda en el comentario y sale en la configuración', () => {
    const t = term();
    t.script([
      'system-view',
      'aaa',
      'local-user tecnico password irreversible-cipher Clave@2024',
      'local-user tecnico privilege level 15',
      'local-user tecnico service-type ssh telnet',
    ]);
    expect(userOf(t, 'tecnico')?.comment).toBe('privilege level 15; service-type telnet ssh');
    const block = t.ok('display this');
    expect(block).toContain(' local-user tecnico privilege level 15');
    expect(block).toContain(' local-user tecnico service-type telnet ssh');
    // Repetir un tipo no es válido.
    expect(t.run('local-user tecnico service-type ssh ssh')).toContain('Error:');
    t.ok('local-user tecnico service-type terminal');
    expect(t.ok('display this')).toContain(' local-user tecnico service-type terminal');
    expect(userOf(t, 'tecnico')?.group).toBe('full');
  });

  it('undo local-user borra el usuario pero no el de la sesión', () => {
    const t = term();
    t.script(['system-view', 'aaa', 'local-user soporte password cipher Clave@2024']);
    t.ok('undo local-user soporte');
    expect(userOf(t, 'soporte')).toBeUndefined();
    expect(t.run('undo local-user soporte')).toBe('Error: The user does not exist.');
    expect(t.run('undo local-user admin')).toBe('Error: The user is online and cannot be deleted.');
    expect(userOf(t, 'admin')).toBeDefined();
  });

  it('display local-user lista usuarios, estado, servicios y nivel', () => {
    const t = term();
    t.script([
      'system-view',
      'aaa',
      'local-user tecnico password irreversible-cipher Clave@2024',
      'local-user tecnico privilege level 3',
      'local-user tecnico service-type telnet ssh',
      'local-user mirar password cipher Clave@2024',
    ]);
    const out = t.ok('display local-user');
    expect(out).toMatch(/User-name\s+State\s+AuthMask\s+AdminLevel/);
    expect(out).toMatch(/admin\s+A\s+-\s+15/);
    expect(out).toMatch(/tecnico\s+A\s+TS\s+3/);
    expect(out).toMatch(/mirar\s+A\s+-\s+-/);
    expect(out).toContain('  Total 3 user(s)');
  });
});

describe('servicios de gestión', () => {
  it('telnet sale activo de fábrica y stelnet apagado', () => {
    const t = term();
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain('#\n telnet server enable\n#\nreturn');
    expect(cfg).not.toContain('stelnet server enable');
    expect(t.ok('display telnet server status')).toMatch(/TELNET IPV4 server\s+:Enable/);
  });

  it('undo telnet server enable deshabilita el servicio neutral y se nota en la red', () => {
    const t = term();
    expect(evaluate({ kind: 'reachable', ...telnetFlow }, ctxOf(t.net))).toBe(true);
    t.script(['system-view', 'undo telnet server enable']);
    expect(serviceOf(t, 'telnet')?.disabled).toBe(true);
    expect(evaluate({ kind: 'blocked', by: 'any', ...telnetFlow }, ctxOf(t.net))).toBe(true);
    expect(t.ok('display current-configuration')).not.toContain('telnet server enable');
    expect(t.ok('display telnet server status')).toMatch(/TELNET IPV4 server\s+:Disable/);
    t.ok('telnet server enable');
    expect(serviceOf(t, 'telnet')?.disabled).toBe(false);
    expect(evaluate({ kind: 'reachable', ...telnetFlow }, ctxOf(t.net))).toBe(true);
  });

  it('stelnet server enable enciende ssh', () => {
    const t = term();
    t.script(['system-view', 'stelnet server enable']);
    expect(serviceOf(t, 'ssh')?.disabled).toBe(false);
    expect(t.ok('display current-configuration')).toContain(
      '#\n telnet server enable\n stelnet server enable\n#',
    );
    const ssh = { ...telnetFlow, port: 22 };
    expect(evaluate({ kind: 'reachable', ...ssh }, ctxOf(t.net))).toBe(true);
    t.ok('undo stelnet server enable');
    expect(serviceOf(t, 'ssh')?.disabled).toBe(true);
    expect(evaluate({ kind: 'blocked', by: 'any', ...ssh }, ctxOf(t.net))).toBe(true);
  });
});

describe('arranque de labs', () => {
  it('la configuración de AAA y servicios se vuelve a leer igual', () => {
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(
      device,
      [
        '#',
        ' undo telnet server enable',
        ' stelnet server enable',
        '#',
        'aaa',
        ` local-user tecnico password irreversible-cipher ${PASSWORD_PLACEHOLDER}`,
        ' local-user tecnico privilege level 15',
        '#',
        'return',
      ].join('\n'),
    );
    if (!ran.ok) throw new Error(ran.error);
    const users = ran.value.config.system.users;
    expect(users.find((u) => u.name === 'tecnico')).toMatchObject({
      group: 'full',
      hasPassword: true,
    });
    const services = ran.value.config.services;
    expect(services.find((s) => s.name === 'telnet')?.disabled).toBe(true);
    expect(services.find((s) => s.name === 'ssh')?.disabled).toBe(false);
  });
});
