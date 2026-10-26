/**
 * DNS del equipo: el resolvedor propio (`dns resolve`), sus servidores
 * (`dns server`), el proxy para la LAN (`dns proxy enable`) y `display dns server`.
 *
 * `dns resolve` no se guarda: el modelo neutral no tiene interruptor para el
 * resolvedor del equipo, que resuelve en cuanto tiene servidores. Por eso
 * `dns resolve` se acepta sin cambiar nada, la configuración lo imprime
 * siempre que hay servidores y `undo dns resolve` los quita, que es lo único
 * que deja al equipo sin resolver nombres en el modelo. Alternativa descartada:
 * un campo nuevo en el núcleo solo para VRP, sin efecto en la simulación.
 */
import { type Device, formatIpv4, type Ipv4, parseIpv4 } from '@nos/core';
import { type Area, type ConfigBlock, config, fault, intent, noop } from '../area';
import { arg, type CommandSpec, kw } from '../grammar';
import type { ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];

/** Servidores DNS que admite VRP. */
const MAX_SERVERS = 6;

const UNDO = kw('undo', 'Negate a command or set its default');
const DNS = kw('dns', 'Domain name system');
const RESOLVE = kw('resolve', 'Enable dynamic domain name resolution');
const SERVER = kw('server', 'Specify a DNS server');
const SERVER_IP = arg('ip', { kind: 'ipv4' }, 'IP address of the DNS server');
const PROXY_ENABLE = [kw('proxy', 'DNS proxy'), kw('enable', 'Enable the DNS proxy')];

const setServers = (servers: readonly Ipv4[]) =>
  config([{ op: 'setSingleton', key: 'dns', patch: { servers } }]);

const commands: CommandSpec[] = [
  {
    views: ['system'],
    forms: [[DNS, RESOLVE]],
    // Sin estado propio: ver la cabecera.
    build: () => noop(),
  },
  {
    views: ['system'],
    forms: [[UNDO, DNS, RESOLVE]],
    build: (_m, ctx) => (ctx.device.config.dns.servers.length === 0 ? noop() : setServers([])),
  },
  {
    views: ['system'],
    forms: [[DNS, SERVER, SERVER_IP]],
    build: (m, ctx) => {
      const ip = parseIpv4(m.args['ip'] ?? '');
      const servers = ctx.device.config.dns.servers;
      if (ip === null || servers.includes(ip)) return noop();
      if (servers.length >= MAX_SERVERS) return fault('dns-server-limit');
      return setServers([...servers, ip]);
    },
  },
  {
    views: ['system'],
    forms: [[UNDO, DNS, SERVER, SERVER_IP]],
    build: (m, ctx) => {
      const ip = parseIpv4(m.args['ip'] ?? '');
      const servers = ctx.device.config.dns.servers;
      if (ip === null || !servers.includes(ip)) return fault('dns-server-not-exist');
      return setServers(servers.filter((s) => s !== ip));
    },
  },
  {
    views: ['system'],
    forms: [[DNS, ...PROXY_ENABLE]],
    build: () => config([{ op: 'setSingleton', key: 'dns', patch: { allowRemoteRequests: true } }]),
  },
  {
    views: ['system'],
    forms: [[UNDO, DNS, ...PROXY_ENABLE]],
    build: () =>
      config([{ op: 'setSingleton', key: 'dns', patch: { allowRemoteRequests: false } }]),
  },
  {
    views: ALL_VIEWS,
    forms: [
      [
        kw('display', 'Display information'),
        kw('dns', 'Domain name system'),
        kw('server', 'DNS server information'),
      ],
    ],
    build: () => intent({ kind: 'show', view: { kind: 'display', what: 'dns server' } }),
  },
];

/** Servidores estáticos (S) y los aprendidos por DHCP (D). */
function displayServers(device: Device): string {
  const rows = [
    ...device.config.dns.servers.map((ip) => ({ type: 'S', ip })),
    ...device.oper.dynamicDnsServers
      .filter((ip) => !device.config.dns.servers.includes(ip))
      .map((ip) => ({ type: 'D', ip })),
  ];
  return [
    'Type:',
    'D:Dynamic    S:Static',
    '',
    'No.  Type  IP Address',
    ...rows.map((r, i) => `${String(i + 1).padEnd(5)}${r.type.padEnd(6)}${formatIpv4(r.ip)}`),
  ].join('\n');
}

function blocks(device: Device): readonly ConfigBlock[] {
  const dns = device.config.dns;
  const lines: string[] = [];
  if (dns.servers.length > 0) {
    lines.push(' dns resolve', ...dns.servers.map((ip) => ` dns server ${formatIpv4(ip)}`));
  }
  if (dns.allowRemoteRequests) lines.push(' dns proxy enable');
  return lines.length === 0 ? [] : [{ order: 20, lines }];
}

export const DNS_AREA: Area = {
  commands,
  displays: { 'dns server': (ctx) => displayServers(ctx.device) },
  blocks,
  messages: {
    'dns-server-limit': 'Error: The number of DNS servers has reached the upper limit.',
    'dns-server-not-exist': 'Error: The DNS server does not exist.',
  },
};
