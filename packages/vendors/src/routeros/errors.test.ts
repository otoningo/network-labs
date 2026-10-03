import type { CoreError, DriverError, ItemId, SyntaxFault } from '@nos/core';
import { describe, expect, it } from 'vitest';
import { describeError, describeScriptError } from './errors';

const syntax = (fault: SyntaxFault, line?: number): string =>
  describeError({ kind: 'syntax', fault }, line);
const vendor = (code: string, detail?: string): string =>
  describeError(detail === undefined ? { kind: 'vendor', code } : { kind: 'vendor', code, detail });
const core = (error: CoreError): string => describeError({ kind: 'core', error });

describe('describeError: errores de sintaxis', () => {
  it('lleva la posición (line L column C) con la columna en base 1', () => {
    expect(syntax({ code: 'bad-command', at: 4, detail: { name: 'adress' } })).toBe(
      'bad command name adress (line 1 column 5)',
    );
    expect(syntax({ code: 'syntax', at: 0 })).toBe('syntax error (line 1 column 1)');
    expect(syntax({ code: 'expected-end', at: 17 })).toBe(
      'expected end of command (line 1 column 18)',
    );
    expect(syntax({ code: 'expected-command', at: 12 })).toBe(
      'expected command name (line 1 column 13)',
    );
  });

  it('usa la línea del script cuando se indica', () => {
    expect(syntax({ code: 'syntax', at: 2 }, 7)).toBe('syntax error (line 7 column 3)');
  });

  it('omite la posición si no la hay', () => {
    expect(syntax({ code: 'bad-command', detail: { name: 'add' } })).toBe('bad command name add');
    expect(syntax({ code: 'syntax' })).toBe('syntax error');
    expect(syntax({ code: 'expected-end' })).toBe('expected end of command');
    expect(syntax({ code: 'expected-command' })).toBe('expected command name');
  });

  it('distingue comando, argumento y valor ambiguos', () => {
    expect(syntax({ code: 'ambiguous', at: 1, detail: { name: 'i', what: 'command' } })).toBe(
      'ambiguous command name i (line 1 column 2)',
    );
    expect(syntax({ code: 'ambiguous', at: 15, detail: { name: 'd', what: 'argument' } })).toBe(
      'ambiguous argument name d (line 1 column 16)',
    );
    expect(syntax({ code: 'ambiguous', at: 15, detail: { name: 'action', what: 'value' } })).toBe(
      'ambiguous value of action, more than one possible value matches input',
    );
    expect(syntax({ code: 'ambiguous', detail: { name: 'p' } })).toBe('ambiguous command name p');
  });

  it('redacta los errores de valores', () => {
    expect(syntax({ code: 'invalid-value', at: 3, detail: { arg: 'address' } })).toBe(
      'invalid value for argument address',
    );
    expect(syntax({ code: 'no-match', detail: { arg: 'interface' } })).toBe(
      'input does not match any value of interface',
    );
    expect(syntax({ code: 'out-of-range', detail: { arg: 'mtu', min: 64, max: 65535 } })).toBe(
      'value of mtu out of range (64..65535)',
    );
    expect(syntax({ code: 'missing-args', detail: { args: 'address,interface' } })).toBe(
      'missing value(s) of argument(s) address,interface',
    );
  });

  it('redacta los fallos de ítems y de undo/redo', () => {
    expect(syntax({ code: 'no-such-item' })).toBe('no such item');
    expect(syntax({ code: 'not-allowed', detail: { reason: 'dynamic' } })).toBe(
      'failure: can not change dynamic',
    );
    expect(syntax({ code: 'not-allowed', detail: { reason: 'builtin' } })).toBe(
      'failure: can not change builtin',
    );
    expect(syntax({ code: 'not-allowed' })).toBe('failure: not allowed');
    expect(syntax({ code: 'nothing-to-undo' })).toBe('failure: nothing to undo');
    expect(syntax({ code: 'nothing-to-redo' })).toBe('failure: nothing to redo');
    expect(syntax({ code: 'no-such-file' })).toBe('failure: no such file');
  });

  it('redacta los fallos de DNS', () => {
    expect(syntax({ code: 'dns-nxdomain' })).toBe('failure: dns name does not exist');
    expect(syntax({ code: 'dns-timeout' })).toBe('failure: dns server failure');
  });

  it('deja pasar el mensaje ya redactado de un script', () => {
    const message = 'bad command name foo (line 3 column 1)';
    expect(syntax({ code: 'script-error', detail: { line: 3, message } })).toBe(message);
  });

  it('un código desconocido se muestra como failure', () => {
    expect(syntax({ code: 'weird-thing', at: 3 })).toBe('failure: weird-thing');
  });
});

describe('describeError: errores del driver', () => {
  it('usa detail como argumento principal del código', () => {
    expect(vendor('bad-command', 'print')).toBe('bad command name print');
    expect(vendor('invalid-value', 'address')).toBe('invalid value for argument address');
    expect(vendor('no-match', 'interface')).toBe('input does not match any value of interface');
    expect(vendor('missing-args', 'file-name')).toBe('missing value(s) of argument(s) file-name');
    expect(vendor('not-allowed', 'builtin')).toBe('failure: can not change builtin');
    expect(vendor('ambiguous', 'ip')).toBe('ambiguous command name ip');
    expect(vendor('script-error', 'syntax error (line 2 column 5)')).toBe(
      'syntax error (line 2 column 5)',
    );
  });

  it('sin detail o sin argumento principal', () => {
    expect(vendor('no-such-file')).toBe('failure: no such file');
    expect(vendor('nothing-to-undo')).toBe('failure: nothing to undo');
    expect(vendor('dns-nxdomain')).toBe('failure: dns name does not exist');
    expect(vendor('not-allowed')).toBe('failure: not allowed');
    expect(vendor('not-enough-permissions')).toBe('failure: not enough permissions (9)');
    expect(vendor('out-of-range', 'count')).toBe('value of count out of range');
    expect(vendor('mystery', 'whatever')).toBe('failure: mystery');
  });

  it('errores de script: añade la línea solo si el mensaje no dice dónde', () => {
    const at = (fault: SyntaxFault): DriverError => ({ kind: 'syntax', fault });
    expect(describeScriptError(at({ code: 'bad-command', at: 4, detail: { name: 'x' } }), 2)).toBe(
      'bad command name x (line 2 column 5)',
    );
    // `no-match` trae columna pero su mensaje no la muestra.
    expect(
      describeScriptError(at({ code: 'no-match', at: 9, detail: { arg: 'interface' } }), 3),
    ).toBe('input does not match any value of interface (line 3)');
    expect(describeScriptError({ kind: 'vendor', code: 'not-enough-permissions' }, 1)).toBe(
      'failure: not enough permissions (9) (line 1)',
    );
    expect(
      describeScriptError(
        { kind: 'vendor', code: 'script-error', detail: 'no such item (line 7)' },
        2,
      ),
    ).toBe('no such item (line 7)');
  });

  it('nunca tropieza con claves de Object.prototype', () => {
    expect(vendor('constructor', 'x')).toBe('failure: constructor');
    expect(vendor('toString')).toBe('failure: toString');
  });
});

describe('describeError: errores del núcleo', () => {
  it('duplicados con el mensaje de cada menú', () => {
    expect(core({ code: 'duplicate', scope: 'addresses', field: 'address', value: 'x' })).toBe(
      'failure: already have such address',
    );
    expect(core({ code: 'duplicate', scope: 'interfaces', field: 'name', value: 'x' })).toBe(
      'failure: already have interface with such name',
    );
    expect(core({ code: 'duplicate', scope: 'interfaces', field: 'vlanId', value: 'x' })).toBe(
      'failure: vlan with the same vlan-id already exists on this interface',
    );
    expect(core({ code: 'duplicate', scope: 'bridgePorts', field: 'iface', value: 'x' })).toBe(
      'failure: device already added as bridge port',
    );
    expect(core({ code: 'duplicate', scope: 'dhcpClients', field: 'iface', value: 'x' })).toBe(
      'failure: dhcp-client already exists on this interface',
    );
    expect(core({ code: 'duplicate', scope: 'dhcpServers', field: 'iface', value: 'x' })).toBe(
      'failure: interface already has dhcp server',
    );
    expect(core({ code: 'duplicate', scope: 'dhcpServers', field: 'name', value: 'x' })).toBe(
      'failure: already have dhcp server with such name',
    );
    expect(core({ code: 'duplicate', scope: 'users', field: 'name', value: 'x' })).toBe(
      'failure: already have user with such name',
    );
    expect(core({ code: 'duplicate', scope: 'pools', field: 'name', value: 'x' })).toBe(
      'failure: already have pool with such name',
    );
    expect(core({ code: 'duplicate', scope: 'interfaceLists', field: 'name', value: 'x' })).toBe(
      'failure: already have interface list with such name',
    );
    expect(core({ code: 'duplicate', scope: 'staticArp', field: 'ip', value: 'x' })).toBe(
      'failure: already have such entry',
    );
  });

  it('not-found según ámbito y campo', () => {
    expect(core({ code: 'not-found', scope: 'storage', ref: 'a.rsc' })).toBe(
      'failure: no such file',
    );
    expect(core({ code: 'not-found', scope: 'routes', ref: '7' })).toBe('no such item');
    expect(core({ code: 'not-found', scope: 'dhcpServers', field: 'pool', ref: '3' })).toBe(
      'input does not match any value of address-pool',
    );
    expect(
      core({ code: 'not-found', scope: 'discovery', field: 'interfaceList', ref: 'LAN' }),
    ).toBe('input does not match any value of discover-interface-list');
    expect(core({ code: 'not-found', scope: 'filterRules', field: 'before', ref: '9' })).toBe(
      'input does not match any value of place-before',
    );
  });

  it('invalid-value traduce el campo y los casos especiales', () => {
    expect(
      core({
        code: 'invalid-value',
        scope: 'interfaces',
        field: 'mac',
        value: 'zz',
        expected: 'mac',
      }),
    ).toBe('invalid value for argument mac-address');
    expect(
      core({
        code: 'invalid-value',
        scope: 'interfaces',
        field: 'channelMhz',
        value: '9999',
        expected: 'wifi-channel',
      }),
    ).toBe('invalid value for argument channel.frequency');
    expect(
      core({
        code: 'invalid-value',
        scope: 'interfaces',
        field: 'kind',
        value: 'ethernet',
        expected: 'creatable-kind',
      }),
    ).toBe('failure: can not create this kind of interface');
    expect(
      core({
        code: 'invalid-value',
        scope: 'interfaces',
        field: 'kind',
        value: 'vlan',
        expected: 'mutable-field',
      }),
    ).toBe('failure: can not change type');
  });

  it('out-of-range con el nombre de RouterOS', () => {
    expect(
      core({
        code: 'out-of-range',
        scope: 'interfaces',
        field: 'vlanId',
        value: 0,
        min: 1,
        max: 4094,
      }),
    ).toBe('value of vlan-id out of range (1..4094)');
    expect(
      core({
        code: 'out-of-range',
        scope: 'dns',
        field: 'cacheSizeKiB',
        value: 1,
        min: 64,
        max: 8192,
      }),
    ).toBe('value of cache-size out of range (64..8192)');
  });

  it('pasa a kebab-case los campos sin traducción', () => {
    expect(
      core({ code: 'out-of-range', scope: 'routes', field: 'someValue', value: 0, min: 1, max: 2 }),
    ).toBe('value of some-value out of range (1..2)');
    expect(
      core({
        code: 'invalid-value',
        scope: 'natRules',
        field: 'action.toAddresses',
        value: 'x',
        expected: 'ip-range',
      }),
    ).toBe('invalid value for argument to-addresses');
  });

  it('in-use, missing-required y not-removable', () => {
    expect(
      core({
        code: 'in-use',
        scope: 'pools',
        id: 1 as ItemId,
        usedBy: [{ coll: 'dhcpServers', id: 2 as ItemId }],
      }),
    ).toBe('failure: item is in use');
    expect(core({ code: 'missing-required', scope: 'system', field: 'identity' })).toBe(
      'missing value(s) of argument(s) name',
    );
    expect(core({ code: 'missing-required', scope: 'filterRules', field: 'action.target' })).toBe(
      'missing value(s) of argument(s) jump-target',
    );
    expect(core({ code: 'not-removable', scope: 'interfaces', id: 1 as ItemId })).toBe(
      'failure: can not remove physical interface',
    );
    expect(core({ code: 'not-removable', scope: 'services', id: 1 as ItemId })).toBe(
      'failure: can not remove this item',
    );
  });

  it('conflictos con su frase propia', () => {
    const conflict = (detail: Extract<CoreError, { code: 'conflict' }>['detail']): string =>
      core({ code: 'conflict', scope: 'filterRules', detail });
    expect(conflict('tagged-and-untagged')).toBe(
      'failure: interface can not be tagged and untagged at the same time',
    );
    expect(conflict('port-requires-tcp-udp')).toBe(
      'failure: src-port and dst-port can be specified only for tcp, udp, udp-lite, dccp and sctp protocols',
    );
    expect(conflict('action-chain-mismatch')).toBe('failure: action is not valid for this chain');
    expect(conflict('self-reference')).toBe('failure: can not reference itself');
    expect(conflict('reserved-name')).toBe('failure: name is reserved');
  });

  it('nunca devuelve una traza', () => {
    const errors: DriverError[] = [
      { kind: 'syntax', fault: { code: 'syntax', at: 3 } },
      { kind: 'vendor', code: 'no-such-file' },
      { kind: 'core', error: { code: 'not-found', scope: 'routes', ref: '1' } },
    ];
    for (const e of errors) expect(describeError(e)).not.toMatch(/Error|at .*\(|\n/);
  });
});
