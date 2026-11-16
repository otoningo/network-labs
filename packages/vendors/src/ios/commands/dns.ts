/**
 * DNS del equipo: los servidores a los que pregunta (`ip name-server`), el
 * servicio para la LAN (`ip dns server`), los nombres estáticos (`ip host`), el
 * dominio (`ip domain-name`, que también piden las claves RSA de SSH), la
 * búsqueda de nombres (`ip domain-lookup`) y `show hosts`.
 */
import { type Device, formatIpv4, type Ipv4, type Op, parseIpv4 } from '@nos/core';
import { type Area, type Built, type ConfigBlock, config, fault, noop, show } from '../area';
import { arg, type CommandSpec, kw, type Node } from '../grammar';
import { metaOf, metaOps } from '../meta';
import { EXEC_VIEWS } from '../session';
import { ipArgs } from './shared';

/** Servidores DNS que admite IOS. */
const MAX_SERVERS = 6;
const HOST_TTL_S = 86_400;

const NO = kw('no', 'Negate a command or set its defaults');
const IP = kw('ip', 'Global IP configuration subcommands');
const NAME_SERVER = kw('name-server', 'Specify address of name server to use');
const DNS_SERVER = [
  kw('dns', 'Configure DNS server for a zone'),
  kw('server', 'Enable DNS server'),
];
const DOMAIN_NAME = [
  [kw('domain-name', 'Define the default domain name')],
  [kw('domain', 'IP DNS Resolver'), kw('name', 'Define the default domain name')],
];
const DOMAIN_LOOKUP = [
  [kw('domain-lookup', 'Enable IP Domain Name System hostname translation')],
  [
    kw('domain', 'IP DNS Resolver'),
    kw('lookup', 'Enable IP Domain Name System hostname translation'),
  ],
];
const HOST = kw('host', 'Add an entry to the ip hostname table');
const SERVER_ARGS = ['ip1', 'ip2', 'ip3', 'ip4', 'ip5', 'ip6'] as const;

function serverForms(head: readonly Node[]): Node[][] {
  return SERVER_ARGS.map((_n, i) => [
    ...head,
    ...SERVER_ARGS.slice(0, i + 1).map((name) =>
      arg(name, { kind: 'ipv4' }, 'Domain server IP address'),
    ),
  ]);
}

const setServers = (servers: readonly Ipv4[]): Built =>
  config([{ op: 'setSingleton', key: 'dns', patch: { servers } }]);

const commands: CommandSpec[] = [
  {
    views: ['config'],
    forms: serverForms([IP, NAME_SERVER]),
    build: (m, ctx) => {
      const current = ctx.device.config.dns.servers;
      const added = ipArgs(m.args, SERVER_ARGS).filter((ip) => !current.includes(ip));
      if (added.length === 0) return noop();
      const next = [...current, ...added];
      if (next.length > MAX_SERVERS) return fault('dns-server-limit');
      return setServers(next);
    },
  },
  {
    views: ['config'],
    forms: [[NO, IP, NAME_SERVER], ...serverForms([NO, IP, NAME_SERVER])],
    build: (m, ctx) => {
      const gone = ipArgs(m.args, SERVER_ARGS);
      const current = ctx.device.config.dns.servers;
      if (gone.length === 0) return current.length === 0 ? noop() : setServers([]);
      return setServers(current.filter((ip) => !gone.includes(ip)));
    },
  },
  {
    views: ['config'],
    forms: [
      [IP, ...DNS_SERVER],
      [NO, IP, ...DNS_SERVER],
    ],
    build: (m, ctx) => {
      const on = !m.has('no');
      if (ctx.device.config.dns.allowRemoteRequests === on) return noop();
      return config([{ op: 'setSingleton', key: 'dns', patch: { allowRemoteRequests: on } }]);
    },
  },
  {
    views: ['config'],
    forms: DOMAIN_NAME.map((words) => [
      IP,
      ...words,
      arg('domain', { kind: 'word', max: 64 }, 'Default domain name'),
    ]),
    build: (m, ctx) =>
      config(metaOps(ctx.device, (meta) => ({ ...meta, domain: m.args['domain'] ?? '' }))),
  },
  {
    views: ['config'],
    forms: DOMAIN_NAME.map((words) => [NO, IP, ...words]),
    build: (_m, ctx) =>
      config(
        metaOps(ctx.device, (meta) => {
          const { domain: _gone, ...rest } = meta;
          return rest;
        }),
      ),
  },
  {
    views: ['config'],
    forms: [...DOMAIN_LOOKUP.map((w) => [IP, ...w]), ...DOMAIN_LOOKUP.map((w) => [NO, IP, ...w])],
    build: (m, ctx) =>
      config(metaOps(ctx.device, (meta) => ({ ...meta, domainLookup: !m.has('no') }))),
  },
  {
    views: ['config'],
    forms: [
      [
        IP,
        HOST,
        arg('name', { kind: 'word', max: 64 }, 'Name of host'),
        arg('ip', { kind: 'ipv4' }, 'Host IP address'),
      ],
    ],
    build: (m, ctx) => {
      const name = m.args['name'] ?? '';
      const address = parseIpv4(m.args['ip'] ?? '');
      if (address === null) return noop();
      const existing = ctx.device.config.dns.static.find((s) => s.name === name);
      const ops: Op[] = existing ? [{ op: 'remove', coll: 'dnsStatic', id: existing.id }] : [];
      ops.push({
        op: 'add',
        coll: 'dnsStatic',
        item: { name, type: 'A', address, ttlS: HOST_TTL_S, disabled: false },
      });
      return config(ops);
    },
  },
  {
    views: ['config'],
    forms: [
      [NO, IP, HOST, arg('name', { kind: 'word', max: 64 }, 'Name of host')],
      [
        NO,
        IP,
        HOST,
        arg('name', { kind: 'word', max: 64 }, 'Name of host'),
        arg('ip', { kind: 'ipv4' }, 'Host IP address'),
      ],
    ],
    build: (m, ctx) => {
      const existing = ctx.device.config.dns.static.find((s) => s.name === m.args['name']);
      if (!existing) return noop();
      return config([{ op: 'remove', coll: 'dnsStatic', id: existing.id }]);
    },
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [
        kw('show', 'Show running system information'),
        kw('hosts', 'IP domain-name, lookup style, nameservers, and host table'),
      ],
    ],
    build: () => show('hosts'),
  },
];

function showHosts(device: Device): string {
  const meta = metaOf(device);
  const dns = device.config.dns;
  return [
    meta.domain === undefined ? 'Default domain is not set' : `Default domain is ${meta.domain}`,
    `Name/address lookup uses ${meta.domainLookup ? 'domain service' : 'static mappings'}`,
    `Name servers are ${dns.servers.length > 0 ? dns.servers.map(formatIpv4).join(', ') : '255.255.255.255'}`,
    '',
    'Codes: UN - unknown, EX - expired, OK - OK, ?? - revalidate',
    '       temp - temporary, perm - permanent',
    '       NA - Not Applicable None - Not defined',
    '',
    `${'Host'.padEnd(26)}${'Port'.padEnd(6)}${'Flags'.padEnd(11)}${'Age'.padEnd(4)}${'Type'.padEnd(7)}Address(es)`,
    ...dns.static.map(
      (s) =>
        `${s.name.padEnd(26)}${'None'.padEnd(6)}${'(perm, OK)'.padEnd(11)}${'0'.padEnd(4)}${'IP'.padEnd(7)}${s.address === undefined ? '' : formatIpv4(s.address)}`,
    ),
  ].join('\n');
}

function blocks(device: Device): readonly ConfigBlock[] {
  const meta = metaOf(device);
  const dns = device.config.dns;
  const lines: string[] = [];
  if (!meta.domainLookup) lines.push('no ip domain lookup');
  if (meta.domain !== undefined) lines.push(`ip domain name ${meta.domain}`);
  for (const s of dns.static) {
    if (s.address !== undefined) lines.push(`ip host ${s.name} ${formatIpv4(s.address)}`);
  }
  for (const ip of dns.servers) lines.push(`ip name-server ${formatIpv4(ip)}`);
  return [
    { order: 50, lines },
    { order: 120, lines: dns.allowRemoteRequests ? ['ip dns server'] : [] },
  ];
}

export const DNS_AREA: Area = {
  commands,
  shows: { hosts: (ctx) => showHosts(ctx.device) },
  blocks,
  messages: { 'dns-server-limit': '% Maximum number of name servers reached' },
};
