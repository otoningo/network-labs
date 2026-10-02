/**
 * Mensajes de error con la voz de la consola de RouterOS. Nunca se muestra una
 * traza: cada código del parser, de las acciones o del núcleo se convierte en
 * la frase que imprimiría el equipo real, con los nombres de propiedad de
 * RouterOS en lugar de los campos del modelo neutral.
 */
import type { ConflictDetail, CoreError, DriverError, ErrorScope } from '@nos/core';

type Detail = Readonly<Record<string, string | number>>;

/** Busca sin tropezar con claves heredadas de Object.prototype. */
function lookup(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const textOf = (detail: Detail | undefined, key: string): string => {
  const value = detail?.[key];
  return value === undefined ? '' : String(value);
};

/** `prefijo valor`, o solo el prefijo si no hay valor. */
const withArg = (prefix: string, value: string): string =>
  value === '' ? prefix : `${prefix} ${value}`;

const position = (at: number | undefined, line: number): string =>
  at === undefined ? '' : ` (line ${line} column ${at + 1})`;

// ── Códigos del parser y del driver ─────────────────────────────────────────

/** Argumento principal de cada código cuando llega como error `vendor` con `detail` de texto. */
const MAIN_ARG: Readonly<Record<string, string>> = {
  'bad-command': 'name',
  ambiguous: 'name',
  'invalid-value': 'arg',
  'no-match': 'arg',
  'out-of-range': 'arg',
  'missing-args': 'args',
  'not-allowed': 'reason',
  'script-error': 'message',
};

function describeCode(
  code: string,
  at: number | undefined,
  detail: Detail | undefined,
  line: number,
): string {
  const where = position(at, line);
  switch (code) {
    case 'bad-command':
      return `${withArg('bad command name', textOf(detail, 'name'))}${where}`;
    case 'syntax':
      return `syntax error${where}`;
    case 'expected-end':
      return `expected end of command${where}`;
    case 'expected-command':
      return `expected command name${where}`;
    case 'ambiguous': {
      const name = textOf(detail, 'name');
      switch (textOf(detail, 'what')) {
        case 'argument':
          return `${withArg('ambiguous argument name', name)}${where}`;
        case 'value':
          return `ambiguous value of ${name}, more than one possible value matches input`;
        default:
          return `${withArg('ambiguous command name', name)}${where}`;
      }
    }
    case 'invalid-value':
      return withArg('invalid value for argument', textOf(detail, 'arg'));
    case 'no-match':
      return withArg('input does not match any value of', textOf(detail, 'arg'));
    case 'out-of-range': {
      const min = textOf(detail, 'min');
      const max = textOf(detail, 'max');
      const range = min === '' || max === '' ? '' : ` (${min}..${max})`;
      return `value of ${textOf(detail, 'arg')} out of range${range}`;
    }
    case 'missing-args':
      return withArg('missing value(s) of argument(s)', textOf(detail, 'args'));
    case 'no-such-item':
      return 'no such item';
    case 'not-allowed':
      switch (textOf(detail, 'reason')) {
        case 'dynamic':
          return 'failure: can not change dynamic';
        case 'builtin':
          return 'failure: can not change builtin';
        default:
          return 'failure: not allowed';
      }
    case 'nothing-to-undo':
      return 'failure: nothing to undo';
    case 'nothing-to-redo':
      return 'failure: nothing to redo';
    case 'no-such-file':
      return 'failure: no such file';
    case 'dns-nxdomain':
      return 'failure: dns name does not exist';
    case 'dns-timeout':
      return 'failure: dns server failure';
    case 'script-error': {
      // El mensaje ya viene redactado (con su línea): se muestra tal cual.
      const message = textOf(detail, 'message');
      return message === '' ? `failure: ${code}` : message;
    }
    default:
      return `failure: ${code}`;
  }
}

// ── Errores del núcleo ──────────────────────────────────────────────────────

/**
 * Campos del modelo con otro nombre en RouterOS. Los que no aparecen aquí se
 * pasan de camelCase a kebab-case (`name`, `mtu`, `chain`... quedan igual).
 */
const FIELD_NAMES: Readonly<Partial<Record<ErrorScope, Readonly<Record<string, string>>>>> = {
  interfaces: {
    mac: 'mac-address',
    vlanId: 'vlan-id',
    parent: 'interface',
    ssid: 'configuration.ssid',
    channelMhz: 'channel.frequency',
    'security.passphrase': 'security.passphrase',
    kind: 'type',
  },
  bridgePorts: { iface: 'interface' },
  bridgeVlans: { vlanIds: 'vlan-ids' },
  addresses: { iface: 'interface' },
  staticArp: { iface: 'interface', ip: 'address', mac: 'mac-address' },
  dhcpClients: { iface: 'interface', routeDistance: 'default-route-distance' },
  routes: { dst: 'dst-address', table: 'routing-table' },
  pools: { next: 'next-pool' },
  dhcpServers: { iface: 'interface', pool: 'address-pool', leaseTimeS: 'lease-time' },
  dhcpNetworks: { prefix: 'address' },
  staticLeases: { mac: 'mac-address', ip: 'address' },
  dnsStatic: { ttlS: 'ttl' },
  filterRules: {
    'action.target': 'jump-target',
    'match.inInterface': 'in-interface',
    'match.outInterface': 'out-interface',
    'match.protocol': 'protocol',
  },
  natRules: {
    'action.target': 'jump-target',
    'match.inInterface': 'in-interface',
    'match.outInterface': 'out-interface',
    'match.protocol': 'protocol',
  },
  addressLists: { timeoutS: 'timeout' },
  interfaceListMembers: { iface: 'interface' },
  system: { identity: 'name', timezone: 'time-zone-name' },
  dns: { cacheSizeKiB: 'cache-size' },
  discovery: { interfaceList: 'discover-interface-list' },
};

/** Campos con el mismo nombre en todas las colecciones. */
const COMMON_FIELDS: Readonly<Record<string, string>> = { before: 'place-before' };

const kebab = (field: string): string => field.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function propName(scope: ErrorScope, field: string): string {
  const table = FIELD_NAMES[scope];
  const mapped = (table && lookup(table, field)) ?? lookup(COMMON_FIELDS, field);
  if (mapped !== undefined) return mapped;
  // En las reglas de firewall los campos `match.x` y `action.x` son propiedades planas.
  const flat =
    scope === 'filterRules' || scope === 'natRules'
      ? field.replace(/^(match|action)\./, '')
      : field;
  return kebab(flat);
}

/** Cómo llama RouterOS a un ítem de cada ámbito, para `already have X with such name`. */
const NOUNS: Readonly<Record<ErrorScope, string>> = {
  interfaces: 'interface',
  interfaceLists: 'interface list',
  interfaceListMembers: 'interface list member',
  bridgePorts: 'bridge port',
  bridgeVlans: 'bridge vlan',
  addresses: 'address',
  staticArp: 'arp entry',
  dhcpClients: 'dhcp client',
  routes: 'route',
  pools: 'pool',
  dhcpServers: 'dhcp server',
  dhcpNetworks: 'dhcp network',
  staticLeases: 'lease',
  dnsStatic: 'static dns entry',
  filterRules: 'rule',
  natRules: 'rule',
  addressLists: 'address list entry',
  users: 'user',
  services: 'service',
  system: 'system setting',
  dns: 'dns setting',
  discovery: 'discovery setting',
  storage: 'file',
};

const CONFLICTS: Readonly<Record<ConflictDetail, string>> = {
  'tagged-and-untagged': 'failure: interface can not be tagged and untagged at the same time',
  'port-requires-tcp-udp':
    'failure: src-port and dst-port can be specified only for tcp, udp, udp-lite, dccp and sctp protocols',
  'action-chain-mismatch': 'failure: action is not valid for this chain',
  'self-reference': 'failure: can not reference itself',
  'reserved-name': 'failure: name is reserved',
};

function duplicate(scope: ErrorScope, field: string): string {
  if (scope === 'addresses') return 'failure: already have such address';
  if (scope === 'interfaces' && field === 'vlanId')
    return 'failure: vlan with the same vlan-id already exists on this interface';
  if (scope === 'bridgePorts') return 'failure: device already added as bridge port';
  if (scope === 'dhcpClients') return 'failure: dhcp-client already exists on this interface';
  if (scope === 'dhcpServers' && field === 'iface')
    return 'failure: interface already has dhcp server';
  if (field === 'name') return `failure: already have ${NOUNS[scope]} with such name`;
  return 'failure: already have such entry';
}

function describeCore(error: CoreError): string {
  switch (error.code) {
    case 'duplicate':
      return duplicate(error.scope, error.field);
    case 'not-found':
      if (error.scope === 'storage') return 'failure: no such file';
      return error.field === undefined
        ? 'no such item'
        : `input does not match any value of ${propName(error.scope, error.field)}`;
    case 'invalid-value': {
      const prop = propName(error.scope, error.field);
      if (error.expected === 'creatable-kind')
        return 'failure: can not create this kind of interface';
      if (error.expected === 'mutable-field') return `failure: can not change ${prop}`;
      return `invalid value for argument ${prop}`;
    }
    case 'out-of-range':
      return `value of ${propName(error.scope, error.field)} out of range (${error.min}..${error.max})`;
    case 'in-use':
      return 'failure: item is in use';
    case 'missing-required':
      return `missing value(s) of argument(s) ${propName(error.scope, error.field)}`;
    case 'conflict':
      return CONFLICTS[error.detail];
    case 'not-removable':
      return error.scope === 'interfaces'
        ? 'failure: can not remove physical interface'
        : 'failure: can not remove this item';
  }
}

// ── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Texto que muestra la consola para un error. `line` es la línea del script
 * (1 en la consola interactiva) y solo aparece en los códigos con posición.
 */
export function describeError(error: DriverError, line = 1): string {
  switch (error.kind) {
    case 'syntax':
      return describeCode(error.fault.code, error.fault.at, error.fault.detail, line);
    case 'vendor': {
      const key = lookup(MAIN_ARG, error.code);
      const detail =
        key === undefined || error.detail === undefined ? undefined : { [key]: error.detail };
      return describeCode(error.code, undefined, detail, line);
    }
    case 'core':
      return describeCore(error.error);
  }
}
