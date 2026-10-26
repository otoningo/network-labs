import { formatPrefix, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { vrpStartup } from './driver';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/** R1 con VRP, una PC en GE0/0/1 con 192.168.1.10/24 y gateway en .1. */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .address('PC1', 'eth0', '192.168.1.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.1.1')
    .build();
}

const term = () => new VrpTerminal(lab(), 'R1');
const addresses = (t: VrpTerminal) =>
  t.device.config.addressing.addresses.map((a) => formatPrefix(a.address));

describe('vistas y prompt', () => {
  it('pasa de la vista de usuario a la de sistema y a la de interfaz', () => {
    const t = term();
    expect(t.prompt).toBe('<Huawei>');
    t.ok('system-view');
    expect(t.prompt).toBe('[Huawei]');
    t.ok('interface GigabitEthernet0/0/1');
    expect(t.prompt).toBe('[Huawei-GigabitEthernet0/0/1]');
    t.ok('quit');
    expect(t.prompt).toBe('[Huawei]');
    t.ok('interface g0/0/1');
    t.ok('return');
    expect(t.prompt).toBe('<Huawei>');
  });

  it('acepta abreviaturas por prefijo único y el tipo de interfaz separado del número', () => {
    const t = term();
    t.ok('sys');
    t.ok('int GigabitEthernet 0/0/1');
    expect(t.prompt).toBe('[Huawei-GigabitEthernet0/0/1]');
    t.ok('q');
    t.ok('sysn R1');
    expect(t.prompt).toBe('[R1]');
  });

  it('Ctrl+Z vuelve a la vista de usuario y quit desde ella cierra la sesión', () => {
    const t = term();
    t.script(['system-view', 'interface GigabitEthernet0/0/1']);
    t.key('ctrl-z');
    expect(t.prompt).toBe('<Huawei>');
    t.ok('quit');
    expect(t.last?.closed).toBe(true);
  });
});

describe('errores con la voz de VRP', () => {
  it('señala con ^ el comando que no existe', () => {
    const t = term();
    t.ok('system-view');
    const out = t.run('sysnme R1');
    expect(out).toBe(
      `${' '.repeat('[Huawei]'.length)}^\nError: Unrecognized command found at '^' position.`,
    );
    expect(t.last?.ok).toBe(false);
  });

  it('distingue parámetro erróneo, comando incompleto, ambiguo y de más', () => {
    const t = term();
    t.script(['system-view', 'interface GigabitEthernet0/0/1']);
    expect(t.run('ip address 192.168.1.300 24')).toContain(
      "Error: Wrong parameter found at '^' position.",
    );
    expect(t.run('ip address 192.168.1.1')).toContain(
      "Error: Incomplete command found at '^' position.",
    );
    expect(t.run('ip address 192.168.1.1 24 extra')).toContain(
      "Error: Too many parameters found at '^' position.",
    );
    // En la vista de usuario «s» puede ser save o system-view.
    t.ok('return');
    expect(t.run('s')).toContain("Error: Ambiguous command found at '^' position.");
  });

  it('no deja entrar en una interfaz que el equipo no tiene', () => {
    const t = term();
    t.ok('system-view');
    expect(t.run('interface GigabitEthernet0/0/9')).toContain('Wrong parameter');
  });
});

describe('direcciones', () => {
  it('acepta máscara o longitud y la nueva dirección reemplaza a la anterior', () => {
    const t = term();
    t.script([
      'system-view',
      'interface GigabitEthernet0/0/1',
      'ip address 192.168.1.1 255.255.255.0',
    ]);
    expect(addresses(t)).toEqual(['192.168.1.1/24']);
    t.ok('ip address 192.168.1.2 24');
    expect(addresses(t)).toEqual(['192.168.1.2/24']);
    t.ok('undo ip address');
    expect(addresses(t)).toEqual([]);
  });

  it('rechaza la dirección de red y la que choca con otra interfaz', () => {
    const t = term();
    t.script(['system-view', 'interface GigabitEthernet0/0/1']);
    expect(t.run('ip address 192.168.1.0 24')).toBe('Error: The specified IP address is invalid.');
    t.ok('ip address 192.168.1.1 24');
    t.script(['quit', 'interface GigabitEthernet0/0/2']);
    expect(t.run('ip address 192.168.1.5 24')).toBe(
      'Error: The specified address conflicts with another address.',
    );
  });

  it('la PC llega al router cuando la interfaz tiene su dirección', () => {
    const t = term();
    t.script([
      'system-view',
      'interface GigabitEthernet0/0/1',
      'ip address 192.168.1.1 24',
      'return',
    ]);
    const out = t.ok('ping 192.168.1.10');
    expect(out).toContain('PING 192.168.1.10: 56  data bytes, press CTRL_C to break');
    expect(out).toContain('Reply from 192.168.1.10: bytes=56 Sequence=1');
    expect(out).toContain('5 packet(s) received');
    expect(out).toContain('0.00% packet loss');
  });

  it('un ping sin camino informa de los tiempos agotados', () => {
    const t = term();
    const out = t.ok('ping -c 2 10.9.9.9');
    expect(out).toContain('    Request time out');
    expect(out).toContain('100.00% packet loss');
  });

  it('shutdown apaga la interfaz y display ip interface brief lo refleja', () => {
    const t = term();
    t.script(['system-view', 'interface GigabitEthernet0/0/1', 'ip address 192.168.1.1 24']);
    let brief = t.ok('display ip interface brief');
    expect(brief).toMatch(/GigabitEthernet0\/0\/1\s+192\.168\.1\.1\/24\s+up\s+up/);
    t.ok('shutdown');
    brief = t.ok('display ip interface brief');
    expect(brief).toMatch(/GigabitEthernet0\/0\/1\s+192\.168\.1\.1\/24\s+\*down\s+down/);
    expect(brief).toMatch(/NULL0\s+unassigned\s+up\s+up\(s\)/);
  });
});

describe('configuración', () => {
  it('display current-configuration sale del modelo, con sus # y su return', () => {
    const t = term();
    t.script([
      'system-view',
      'sysname R1',
      'interface GigabitEthernet0/0/1',
      'description LAN de la oficina',
      'ip address 192.168.1.1 24',
    ]);
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain('#\n sysname R1\n#');
    expect(cfg).toContain(
      'interface GigabitEthernet0/0/1\n description LAN de la oficina\n ip address 192.168.1.1 255.255.255.0',
    );
    expect(cfg.endsWith('#\nreturn')).toBe(true);
    expect(t.ok('display this')).toContain(' ip address 192.168.1.1 255.255.255.0');
  });

  it('save pregunta y guarda solo con Y', () => {
    const t = term();
    expect(t.ok('save')).toContain('Are you sure to continue?[Y/N]:');
    expect(t.prompt).toBe('');
    t.ok('n');
    expect(t.device.storage.files).toHaveLength(0);
    t.ok('save');
    expect(t.ok('y')).toContain('Save the configuration successfully.');
    expect(t.device.storage.files.map((f) => f.name)).toEqual(['vrpcfg.zip']);
    expect(t.ok('display saved-configuration')).toContain('sysname Huawei');
  });
});

describe('ayuda y autocompletado', () => {
  it('? lista lo que puede venir y lo que empieza por lo escrito', () => {
    const t = term();
    t.ok('system-view');
    expect(t.help('sysname ')).toContain('TEXT<1-246>');
    expect(t.help('sys')).toContain('sysname');
    expect(t.help('interface GigabitEthernet0/0/1 ')).toContain('<cr>');
  });

  it('Tab completa la palabra a medias', () => {
    const t = term();
    expect(t.complete('system-v')).toEqual(['system-view']);
    expect(t.complete('dis')).toEqual(['display']);
  });
});

describe('usuarios', () => {
  it('un usuario de solo lectura no ve system-view', () => {
    const base = lab();
    const ro: Network = {
      ...base,
      devices: base.devices.map((d) =>
        d.id === 'R1'
          ? {
              ...d,
              config: {
                ...d.config,
                system: {
                  ...d.config.system,
                  users: [
                    ...d.config.system.users,
                    {
                      id: 99 as never,
                      name: 'mirar',
                      group: 'read',
                      hasPassword: true,
                      disabled: false,
                    },
                  ],
                },
              },
            }
          : d,
      ),
    };
    const t = new VrpTerminal(ro, 'R1', { user: 'mirar' });
    expect(t.run('system-view')).toContain('Unrecognized command');
  });
});

describe('arranque de labs', () => {
  it('display current-configuration se puede volver a cargar como arranque', () => {
    const t = term();
    t.script([
      'system-view',
      'sysname R1',
      'interface GigabitEthernet0/0/1',
      'ip address 192.168.1.1 24',
    ]);
    const saved = t.ok('display current-configuration');
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(device, saved);
    if (!ran.ok) throw new Error(ran.error);
    expect(ran.value.config.system.identity).toBe('R1');
  });

  it('el script de arranque se lee como la configuración de VRP', () => {
    const device = lab().devices.find((d) => d.id === 'R1');
    if (!device) throw new Error('falta R1');
    const ran = vrpStartup(
      device,
      [
        '#',
        ' sysname Oficina',
        '#',
        'interface GigabitEthernet0/0/1',
        ' ip address 192.168.1.1 255.255.255.0',
        '#',
        'return',
      ].join('\n'),
    );
    if (!ran.ok) throw new Error(ran.error);
    expect(ran.value.config.system.identity).toBe('Oficina');
    expect(ran.value.config.addressing.addresses.map((a) => formatPrefix(a.address))).toEqual([
      '192.168.1.1/24',
    ]);
  });
});
