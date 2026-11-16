/**
 * ACL estándar numeradas y NAT de salida (PAT): `access-list N permit|deny`,
 * `ip nat inside` / `ip nat outside` en las interfaces e `ip nat inside source
 * list N interface X overload`, con `show access-lists` y `show ip nat translations`.
 *
 * Correspondencia con el modelo neutral:
 * - Cada línea de una ACL es una entrada de lista de direcciones. Las `permit`
 *   van en la lista `acl<N>` y las `deny` en `acl<N>:deny`; el comentario guarda
 *   el número de secuencia y la acción (`seq 10 permit`). El comodín se guarda
 *   como prefijo (0.0.0.255 → /24), `host` como /32 y `any` como 0.0.0.0/0.
 *   Una ACL numerada existe mientras tenga alguna línea, como en IOS.
 * - `ip nat inside` / `ip nat outside` hacen a la interfaz miembro de las listas
 *   de interfaces `nat-inside` / `nat-outside` (las crea la plataforma de fábrica).
 * - `ip nat inside source list N interface X overload` es un srcnat masquerade
 *   cuyo origen está en `acl<N>`, que sale por X y que además exige entrar por
 *   una interfaz `inside` y salir por una `outside`. Así el marcado cuenta: sin
 *   `ip nat inside` en la LAN o sin `ip nat outside` en la WAN no se traduce nada.
 *   Las `deny` se guardan y se muestran, pero el NAT del simulador solo usa las `permit`.
 */
import {
  type Device,
  formatIpv4,
  type Interface,
  type Ipv4,
  type Ipv4Prefix,
  type ItemId,
  type NatRule,
  networkOf,
  type Op,
  parseIpv4,
} from '@nos/core';
import {
  type Area,
  type Built,
  type ConfigBlock,
  config,
  currentIface,
  fault,
  type InterfaceLine,
  ifaceById,
  ifaceByName,
  noop,
  show,
  wildcardOf,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, canonicalIface, kw, type Node } from '../grammar';
import { EXEC_VIEWS } from '../session';
import { lenOfWildcard } from './shared';

export const NAT_INSIDE = 'nat-inside';
export const NAT_OUTSIDE = 'nat-outside';
const STEP = 10;

const NO = kw('no', 'Negate a command or set its defaults');
const SHOW = kw('show', 'Show running system information');
const ACCESS_LIST = kw('access-list', 'Add an access list entry');
const ACL_NUMBERS = [
  arg('acl', { kind: 'int', min: 1, max: 99 }, 'IP standard access list'),
  arg('acl', { kind: 'int', min: 1300, max: 1999 }, 'IP standard access list (expanded range)'),
];
const IP = kw('ip', 'Global IP configuration subcommands');
const NAT = kw('nat', 'NAT configuration commands');
const INSIDE = kw('inside', 'Inside address translation');
const OUTSIDE = kw('outside', 'Outside address translation');

// ── ACL ─────────────────────────────────────────────────────────────────────

const permitList = (n: number) => `acl${n}`;
const denyList = (n: number) => `acl${n}:deny`;
const LIST_RE = /^acl(\d+)(?::deny)?$/;
const COMMENT_RE = /^seq (\d+) (permit|deny)$/;

type Action = 'permit' | 'deny';

interface AclLine {
  readonly seq: number;
  readonly action: Action;
  readonly address: Ipv4Prefix;
  readonly entry: ItemId;
}

function aclNumbers(device: Device): number[] {
  const found = new Set<number>();
  for (const e of device.config.firewall.addressLists) {
    const m = LIST_RE.exec(e.list);
    if (m) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function linesOf(device: Device, n: number): AclLine[] {
  const out: AclLine[] = [];
  for (const e of device.config.firewall.addressLists) {
    if (e.list !== permitList(n) && e.list !== denyList(n)) continue;
    const m = COMMENT_RE.exec(e.comment ?? '');
    if (!m || !('len' in e.address)) continue;
    out.push({ seq: Number(m[1]), action: m[2] as Action, address: e.address, entry: e.id });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function aclForms(): Node[][] {
  const forms: Node[][] = [];
  for (const num of ACL_NUMBERS) {
    for (const action of ['permit', 'deny'] as const) {
      const head: Node[] = [
        ACCESS_LIST,
        num,
        kw(
          action,
          action === 'permit' ? 'Specify packets to forward' : 'Specify packets to reject',
        ),
      ];
      forms.push(
        [...head, kw('any', 'Any source host')],
        [...head, kw('host', 'A single host address'), arg('ip', { kind: 'ipv4' }, 'Host address')],
        [...head, arg('ip', { kind: 'ipv4' }, 'Address to match')],
        [
          ...head,
          arg('ip', { kind: 'ipv4' }, 'Address to match'),
          arg('wildcard', { kind: 'wildcard' }, 'Wildcard bits'),
        ],
      );
    }
  }
  return forms;
}

function addLine(ctx: CmdCtx, n: number, action: Action, address: Ipv4Prefix): Built {
  const lines = linesOf(ctx.device, n);
  // La misma línea repetida no hace nada.
  if (
    lines.some(
      (l) => l.action === action && l.address.ip === address.ip && l.address.len === address.len,
    )
  ) {
    return noop();
  }
  const seq = (Math.floor(Math.max(0, ...lines.map((l) => l.seq)) / STEP) + 1) * STEP;
  return config([
    {
      op: 'add',
      coll: 'addressLists',
      item: {
        list: action === 'permit' ? permitList(n) : denyList(n),
        address,
        comment: `seq ${seq} ${action}`,
        disabled: false,
      },
    },
  ]);
}

/** Origen de una línea de ACL; el `^` va al comodín si tiene huecos (el simulador guarda prefijos). */
function sourceOf(m: {
  readonly args: Readonly<Record<string, string>>;
  readonly has: (w: string) => boolean;
}): Ipv4Prefix | null {
  if (m.has('any')) return { ip: 0 as Ipv4, len: 0 };
  const ip = parseIpv4(m.args['ip'] ?? '');
  if (ip === null) return null;
  const wildcard = m.args['wildcard'];
  const len = wildcard === undefined ? 32 : lenOfWildcard(wildcard);
  if (len === null) return null;
  return networkOf({ ip, len });
}

// ── NAT ─────────────────────────────────────────────────────────────────────

/** ACL de una regla creada por `ip nat inside source list`; null si no lo es. */
function patAcl(rule: NatRule): number | null {
  if (rule.chain !== 'srcnat' || rule.action.kind !== 'masquerade') return null;
  const m = /^acl(\d+)$/.exec(rule.match.srcAddressList?.value ?? '');
  return m && rule.match.outInterface ? Number(m[1]) : null;
}

const patRules = (device: Device) =>
  device.config.firewall.nat.flatMap((rule) => {
    const acl = patAcl(rule);
    const iface = rule.match.outInterface?.value;
    return acl === null || iface === undefined ? [] : [{ rule, acl, iface }];
  });

const listByName = (device: Device, name: string) =>
  device.config.interfaceLists.find((l) => l.name === name);

function memberOf(device: Device, list: string, iface: ItemId) {
  const l = listByName(device, list);
  return l
    ? device.config.interfaceListMembers.find((m) => m.list === l.id && m.iface === iface)
    : undefined;
}

/** Marca la interfaz actual como inside u outside (una excluye a la otra) o le quita la marca. */
function mark(ctx: CmdCtx, side: typeof NAT_INSIDE | typeof NAT_OUTSIDE, on: boolean): Built {
  const iface = currentIface(ctx);
  if (!iface) return noop();
  const other = side === NAT_INSIDE ? NAT_OUTSIDE : NAT_INSIDE;
  const ops: Op[] = [];
  const current = memberOf(ctx.device, side, iface.id);
  if (!on) {
    if (current) ops.push({ op: 'remove', coll: 'interfaceListMembers', id: current.id });
    return config(ops);
  }
  const opposite = memberOf(ctx.device, other, iface.id);
  if (opposite) ops.push({ op: 'remove', coll: 'interfaceListMembers', id: opposite.id });
  if (!current) {
    const list = listByName(ctx.device, side);
    if (!list) return fault('nat-not-supported');
    ops.push({
      op: 'add',
      coll: 'interfaceListMembers',
      item: { list: list.id, iface: iface.id, disabled: false },
    });
  }
  return config(ops);
}

const PAT_HEAD: Node[] = [
  IP,
  NAT,
  INSIDE,
  kw('source', 'Source address translation'),
  kw('list', 'Specify access list describing local addresses'),
];

function patForms(no: boolean): Node[][] {
  const forms: Node[][] = [];
  for (const num of ACL_NUMBERS) {
    const body = [
      ...(no ? [NO] : []),
      ...PAT_HEAD,
      num,
      kw('interface', 'Specify interface for global address'),
      arg('iface', { kind: 'iface' }, 'GigabitEthernet IEEE 802.3z'),
    ];
    forms.push(body, [...body, kw('overload', 'Overload an address translation')]);
  }
  return forms;
}

const commands: CommandSpec[] = [
  {
    views: ['config'],
    forms: aclForms(),
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      const source = sourceOf(m);
      if (!source) return fault('invalid', m.argAt['wildcard']);
      return addLine(ctx, n, m.has('permit') ? 'permit' : 'deny', source);
    },
  },
  {
    views: ['config'],
    forms: ACL_NUMBERS.map((num) => [NO, ACCESS_LIST, num]),
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      return config(
        linesOf(ctx.device, n).map(
          (l): Op => ({ op: 'remove', coll: 'addressLists', id: l.entry }),
        ),
      );
    },
  },
  {
    views: ['interface'],
    forms: [
      [IP, NAT, INSIDE],
      [IP, NAT, OUTSIDE],
      [NO, IP, NAT, INSIDE],
      [NO, IP, NAT, OUTSIDE],
    ],
    build: (m, ctx) => mark(ctx, m.has('inside') ? NAT_INSIDE : NAT_OUTSIDE, !m.has('no')),
  },
  {
    views: ['config'],
    forms: patForms(false),
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      const iface = ifaceByName(ctx.device, canonicalIface(m.args['iface'] ?? '') ?? '');
      if (!iface) return fault('invalid', m.argAt['iface']);
      const comment = m.has('overload') ? 'overload' : undefined;
      const existing = patRules(ctx.device).find((r) => r.acl === n);
      if (existing && existing.iface === iface.id && existing.rule.comment === comment)
        return noop();
      const ops: Op[] = existing ? [{ op: 'remove', coll: 'natRules', id: existing.rule.id }] : [];
      ops.push({
        op: 'add',
        coll: 'natRules',
        item: {
          chain: 'srcnat',
          action: { kind: 'masquerade' },
          match: {
            srcAddressList: { value: permitList(n), negate: false },
            outInterface: { value: iface.id, negate: false },
            inInterfaceList: { value: NAT_INSIDE, negate: false },
            outInterfaceList: { value: NAT_OUTSIDE, negate: false },
          },
          ...(comment === undefined ? {} : { comment }),
          disabled: false,
        },
      });
      return config(ops);
    },
  },
  {
    views: ['config'],
    forms: patForms(true),
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      const targets = patRules(ctx.device).filter((r) => r.acl === n);
      if (targets.length === 0) return fault('nat-mapping-not-found');
      return config(
        targets.map(({ rule }): Op => ({ op: 'remove', coll: 'natRules', id: rule.id })),
      );
    },
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [SHOW, kw('access-lists', 'List access lists')],
      ...ACL_NUMBERS.map((num) => [SHOW, kw('access-lists', 'List access lists'), num]),
    ],
    build: (m) => show('access-lists', m.args['acl']),
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [
        SHOW,
        kw('ip', 'IP information'),
        kw('nat', 'IP NAT information'),
        kw('translations', 'Translation entries'),
      ],
    ],
    build: () => show('ip nat translations'),
  },
];

// ── Show y configuración ────────────────────────────────────────────────────

/** Origen como lo escribe IOS: `any`, la IP sola (host) o `IP comodín`. */
function sourceText(address: Ipv4Prefix, style: 'config' | 'show'): string {
  if (address.len === 0) return 'any';
  const ip = formatIpv4(address.ip);
  if (address.len === 32) return ip;
  return style === 'config'
    ? `${ip} ${wildcardOf(address.len)}`
    : `${ip}, wildcard bits ${wildcardOf(address.len)}`;
}

function showAccessLists(ctx: CmdCtx, which: string | undefined): string {
  const device = ctx.device;
  const numbers = aclNumbers(device).filter((n) => which === undefined || String(n) === which);
  return numbers
    .flatMap((n) => [
      `Standard IP access list ${n}`,
      ...linesOf(device, n).map((l) => `    ${l.seq} ${l.action} ${sourceText(l.address, 'show')}`),
    ])
    .join('\n');
}

function showTranslations(ctx: CmdCtx): string {
  const rows = ctx.device.oper.conntrack
    .filter((c) => c.srcNat)
    .map((c) => {
      const ep = (e: { ip: Ipv4; port?: number }) =>
        `${formatIpv4(e.ip)}${e.port === undefined ? '' : `:${e.port}`}`;
      return `${`${c.protocol} ${ep(c.reply.dst)}`.padEnd(26)}${ep(c.original.src).padEnd(22)}${ep(c.original.dst).padEnd(22)}${ep(c.reply.src)}`;
    });
  return [
    `${'Pro Inside global'.padEnd(26)}${'Inside local'.padEnd(22)}${'Outside local'.padEnd(22)}Outside global`,
    ...rows,
  ].join('\n');
}

function interfaceLines(device: Device, iface: Interface): readonly InterfaceLine[] {
  if (memberOf(device, NAT_INSIDE, iface.id)) return [{ order: 30, line: ' ip nat inside' }];
  if (memberOf(device, NAT_OUTSIDE, iface.id)) return [{ order: 30, line: ' ip nat outside' }];
  return [];
}

function blocks(device: Device): readonly ConfigBlock[] {
  const nat = patRules(device).map(({ rule, acl, iface }) => {
    const name = ifaceById(device, iface)?.name ?? '';
    return `ip nat inside source list ${acl} interface ${name}${rule.comment === 'overload' ? ' overload' : ''}`;
  });
  const acls = aclNumbers(device).flatMap((n) =>
    linesOf(device, n).map(
      (l) => `access-list ${n} ${l.action} ${sourceText(l.address, 'config')}`,
    ),
  );
  return [
    { order: 130, lines: nat },
    { order: 150, lines: acls },
  ];
}

export const NAT_AREA: Area = {
  commands,
  shows: {
    'access-lists': (ctx, which) => showAccessLists(ctx, which),
    'ip nat translations': (ctx) => showTranslations(ctx),
  },
  blocks,
  interfaceLines,
  messages: {
    'nat-mapping-not-found': '%Dynamic mapping not found',
    'nat-not-supported': '% NAT is not available on this interface',
  },
};
