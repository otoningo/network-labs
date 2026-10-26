import { deviceId, type EvalContext, evaluate, formatPrefix, ipv4, type Network } from '@nos/core';
import { net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import { VRP_PLATFORM } from './platform';
import { VrpTerminal } from './terminal';

/**
 * R1 con VRP: PC1 en GE0/0/1 (192.168.88.10/24, puerta .1) y GE0/0/0 hacia un
 * ISP en 203.0.113.2/24, con ruta por defecto por 203.0.113.1. La ruta se pone
 * con el constructor: no depende del área de rutas.
 */
function lab(): Network {
  return net()
    .router('R1', 'sim-r5', VRP_PLATFORM)
    .host('PC1')
    .cloud('ISP')
    .link('R1:GigabitEthernet0/0/0', 'ISP:eth0')
    .link('R1:GigabitEthernet0/0/1', 'PC1:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP')
    .address('R1', 'GigabitEthernet0/0/0', '203.0.113.2/24')
    .address('R1', 'GigabitEthernet0/0/1', '192.168.88.1/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .address('PC1', 'eth0', '192.168.88.10/24')
    .route('PC1', '0.0.0.0/0', '192.168.88.1')
    .build();
}

const term = () => new VrpTerminal(lab(), 'R1');

/** Entradas de lista de direcciones de R1: lista, prefijo y comentario. */
const entries = (t: VrpTerminal) =>
  t.device.config.firewall.addressLists.map((e) => ({
    list: e.list,
    address: 'len' in e.address ? formatPrefix(e.address) : '',
    comment: e.comment,
    disabled: e.disabled,
  }));

const rules = (t: VrpTerminal) =>
  entries(t)
    .filter((e) => !e.list.endsWith(':def'))
    .map((e) => `${e.list} ${e.address} ${e.comment}`);

const ctxOf = (network: Network): EvalContext => ({ net: network, startup: new Map() });

const natToInternet = (network: Network) =>
  evaluate(
    {
      kind: 'natSourceIs',
      from: deviceId('PC1'),
      to: { ip: ipv4('93.184.216.34') },
      protocol: 'tcp',
      port: 443,
      expect: {
        addressOf: { device: deviceId('R1'), iface: { name: 'GigabitEthernet0/0/0' } },
      },
    },
    ctxOf(network),
  );

describe('ACL básicas', () => {
  it('acl number crea la ACL vacía y entra en su vista', () => {
    const t = term();
    t.ok('system-view');
    t.ok('acl number 2000');
    expect(t.prompt).toBe('[Huawei-acl-basic-2000]');
    // La ACL vacía existe gracias al marcador, que está deshabilitado.
    expect(entries(t)).toEqual([
      { list: 'acl2000:def', address: '0.0.0.0/32', comment: 'acl number 2000', disabled: true },
    ]);
    t.ok('quit');
    t.ok('acl 2000');
    expect(t.prompt).toBe('[Huawei-acl-basic-2000]');
    expect(entries(t)).toHaveLength(1);
    t.ok('quit');
    t.ok('acl 2001');
    expect(t.prompt).toBe('[Huawei-acl-basic-2001]');
  });

  it('solo acepta ACL básicas 2000-2999', () => {
    const t = term();
    t.ok('system-view');
    expect(t.run('acl number 3000')).toContain('Wrong parameter');
    expect(t.run('acl 1999')).toContain('Wrong parameter');
  });

  it('numera las reglas de 5 en 5 y guarda permit y deny en listas separadas', () => {
    const t = term();
    t.script([
      'system-view',
      'acl number 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'rule deny source 10.0.0.0 0.255.255.255',
      'rule 7 permit source 172.16.1.1 0',
      'rule permit source any',
      'rule deny',
    ]);
    expect(rules(t)).toEqual([
      'acl2000 192.168.88.0/24 rule 5 permit',
      'acl2000 172.16.1.1/32 rule 7 permit',
      'acl2000:deny 10.0.0.0/8 rule 10 deny',
      'acl2000 0.0.0.0/0 rule 15 permit',
      'acl2000:deny 0.0.0.0/0 rule 20 deny',
    ]);
    expect(t.ok('display acl 2000')).toContain(
      ' rule 7 permit source 172.16.1.1 0\n rule 10 deny source 10.0.0.0 0.255.255.255\n rule 15 permit\n rule 20 deny',
    );
  });

  it('inserta una regla con número en su sitio y la lista en orden', () => {
    const t = term();
    t.script([
      'system-view',
      'acl 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'rule permit source 192.168.89.0 0.0.0.255',
      'rule 7 deny source 192.168.90.0 0.0.0.255',
    ]);
    expect(t.ok('display acl 2000')).toBe(
      [
        'Basic ACL 2000, 3 rules',
        "Acl's step is 5",
        ' rule 5 permit source 192.168.88.0 0.0.0.255',
        ' rule 7 deny source 192.168.90.0 0.0.0.255',
        ' rule 10 permit source 192.168.89.0 0.0.0.255',
      ].join('\n'),
    );
    // La siguiente automática va por encima de la mayor.
    t.ok('rule permit source 10.1.0.0 0.0.255.255');
    expect(t.ok('display acl 2000')).toContain(' rule 15 permit source 10.1.0.0 0.0.255.255');
  });

  it('un número existente sustituye la regla y la repetida no hace nada', () => {
    const t = term();
    t.script(['system-view', 'acl 2000', 'rule permit source 192.168.88.0 0.0.0.255']);
    t.ok('rule 5 deny source 192.168.88.0 0.0.0.255');
    expect(rules(t)).toEqual(['acl2000:deny 192.168.88.0/24 rule 5 deny']);
    t.ok('rule deny source 192.168.88.0 0.0.0.255');
    expect(rules(t)).toHaveLength(1);
  });

  it('el comodín se aplica a la dirección y uno con huecos se rechaza', () => {
    const t = term();
    t.script(['system-view', 'acl 2000', 'rule permit source 192.168.88.77 0.0.0.255']);
    expect(rules(t)).toEqual(['acl2000 192.168.88.0/24 rule 5 permit']);
    const out = t.run('rule permit source 10.0.0.0 0.255.0.255');
    expect(out).toContain("Error: Wrong parameter found at '^' position.");
    // El ^ señala el comodín.
    const caret = out.split('\n')[0] ?? '';
    expect(caret.indexOf('^')).toBe(
      '[Huawei-acl-basic-2000]'.length + 'rule permit source 10.0.0.0 '.length,
    );
  });

  it('undo rule borra la regla y avisa si no existe', () => {
    const t = term();
    t.script(['system-view', 'acl 2000', 'rule permit source 192.168.88.0 0.0.0.255']);
    t.ok('undo rule 5');
    expect(rules(t)).toEqual([]);
    expect(t.run('undo rule 5')).toBe('Error: The specified rule does not exist yet.');
    // La ACL sigue existiendo, vacía.
    expect(t.ok('display acl 2000')).toBe("Basic ACL 2000, 0 rule\nAcl's step is 5");
  });

  it('undo acl borra la ACL entera', () => {
    const t = term();
    t.script([
      'system-view',
      'acl 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'rule deny',
      'quit',
      'undo acl number 2000',
    ]);
    expect(entries(t)).toEqual([]);
    expect(t.run('undo acl 2000')).toBe('Error: The ACL does not exist.');
    t.script(['acl 2001', 'quit', 'undo acl 2001']);
    expect(entries(t)).toEqual([]);
  });

  it('display acl all lista todas con el total de las que tienen reglas', () => {
    const t = term();
    t.script([
      'system-view',
      'acl 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'quit',
      'acl 2001',
      'return',
    ]);
    expect(t.ok('display acl all')).toBe(
      [
        ' Total quantity of nonempty ACL number is 1',
        '',
        'Basic ACL 2000, 1 rule',
        "Acl's step is 5",
        ' rule 5 permit source 192.168.88.0 0.0.0.255',
        '',
        'Basic ACL 2001, 0 rule',
        "Acl's step is 5",
      ].join('\n'),
    );
  });

  it('display this y la configuración muestran el bloque de la ACL', () => {
    const t = term();
    t.script([
      'system-view',
      'sysname R1',
      'acl number 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'rule deny source any',
    ]);
    const block = 'acl number 2000\n rule 5 permit source 192.168.88.0 0.0.0.255\n rule 10 deny';
    expect(t.ok('display this')).toBe(`#\n${block}\n#\nreturn`);
    const cfg = t.ok('display current-configuration');
    expect(cfg).toContain(`#\n sysname R1\n#\n${block}\n#`);
    // Las ACL van antes de las interfaces.
    expect(cfg.indexOf('acl number 2000')).toBeLessThan(cfg.indexOf('interface GigabitEthernet'));
  });
});

describe('nat outbound', () => {
  const natLab = () =>
    term().script([
      'system-view',
      'acl number 2000',
      'rule permit source 192.168.88.0 0.0.0.255',
      'quit',
      'interface GigabitEthernet0/0/0',
    ]);

  it('crea un srcnat masquerade por la interfaz con la lista de la ACL', () => {
    const t = natLab();
    t.ok('nat outbound 2000');
    const out = t.device.config.interfaces.find((i) => i.name === 'GigabitEthernet0/0/0');
    expect(t.device.config.firewall.nat).toEqual([
      expect.objectContaining({
        chain: 'srcnat',
        action: { kind: 'masquerade' },
        disabled: false,
        match: {
          outInterface: { value: out?.id, negate: false },
          srcAddressList: { value: 'acl2000', negate: false },
        },
      }),
    ]);
    // Repetirlo no duplica la regla.
    t.ok('nat outbound 2000');
    expect(t.device.config.firewall.nat).toHaveLength(1);
    expect(t.ok('display this')).toContain(
      'interface GigabitEthernet0/0/0\n ip address 203.0.113.2 255.255.255.0\n nat outbound 2000',
    );
    t.ok('undo nat outbound 2000');
    expect(t.device.config.firewall.nat).toEqual([]);
  });

  it('exige que la ACL exista', () => {
    const t = natLab();
    expect(t.run('nat outbound 2005')).toBe('Error: The ACL does not exist.');
    expect(t.run('nat outbound 4000')).toContain('Wrong parameter');
    expect(t.device.config.firewall.nat).toEqual([]);
  });

  it('display nat outbound muestra la interfaz, la ACL, su dirección y easyip', () => {
    const t = natLab();
    t.ok('nat outbound 2000');
    const out = t.ok('display nat outbound');
    expect(out).toContain(' NAT Outbound Information:');
    expect(out).toMatch(/Interface\s+Acl\s+Address-group\/IP\/Interface\s+Type/);
    expect(out).toMatch(/GigabitEthernet0\/0\/0\s+2000\s+203\.0\.113\.2\s+easyip/);
    expect(out).toContain('  Total : 1');
  });

  it('la PC sale a Internet con la dirección de GE0/0/0 solo con nat outbound', () => {
    const t = natLab();
    expect(natToInternet(t.net)).toBe(false);
    t.ok('nat outbound 2000');
    expect(natToInternet(t.net)).toBe(true);
    t.ok('undo nat outbound 2000');
    expect(natToInternet(t.net)).toBe(false);
  });

  it('una ACL sin la red de la PC no traduce nada', () => {
    const t = term().script([
      'system-view',
      'acl 2000',
      'rule permit source 10.0.0.0 0.255.255.255',
      'rule deny source 192.168.88.0 0.0.0.255',
      'quit',
      'interface GigabitEthernet0/0/0',
      'nat outbound 2000',
    ]);
    expect(natToInternet(t.net)).toBe(false);
  });

  it('borrar la ACL deja nat outbound sin efecto hasta que vuelve', () => {
    const t = natLab();
    t.script(['nat outbound 2000', 'quit', 'undo acl 2000']);
    expect(natToInternet(t.net)).toBe(false);
    expect(t.ok('display current-configuration')).toContain(' nat outbound 2000');
    t.script(['acl 2000', 'rule permit source 192.168.88.0 0.0.0.255']);
    expect(natToInternet(t.net)).toBe(true);
  });
});

describe('ayuda', () => {
  it('? en la vista de ACL ofrece rule y las acciones', () => {
    const t = term().script(['system-view', 'acl 2000']);
    expect(t.help('rule ')).toContain('permit');
    expect(t.help('rule permit source ')).toContain('any');
    expect(t.complete('rule p')).toEqual(['permit']);
  });
});
