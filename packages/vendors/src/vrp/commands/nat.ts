/**
 * ACL básicas y NAT: `acl number 2000-2999` con sus `rule permit|deny
 * source`, `nat outbound` (Easy IP) en la interfaz de salida, y los `display
 * acl` / `display nat outbound`.
 *
 * Correspondencia con el modelo neutral (D-044):
 * - Cada regla es una entrada de lista de direcciones. Las `permit` van en la
 *   lista `acl<N>` y las `deny` en `acl<N>:deny`; el comentario guarda el número
 *   y la acción (`rule 5 permit`). El comodín se guarda como prefijo
 *   (0.0.0.255 → /24) y `any` (o la regla sin `source`) como 0.0.0.0/0.
 * - Una ACL existe mientras exista su marcador: una entrada deshabilitada
 *   0.0.0.0/32 en la lista `acl<N>:def`. Así una ACL vacía sigue existiendo, y
 *   el motor nunca la usa: ninguna regla de NAT apunta a esa lista y además la
 *   entrada está deshabilitada. El marcador se crea con la ACL y se borra con
 *   `undo acl`; las reglas no lo tocan.
 * - `nat outbound N` es un srcnat masquerade por la interfaz cuyo origen está
 *   en la lista `acl<N>`. Las `deny` se guardan y se muestran, pero el NAT del
 *   simulador solo usa las `permit`.
 */
import {
  type Device,
  formatIpv4,
  type Interface,
  type IpRange,
  type Ipv4,
  type Ipv4Prefix,
  type ItemId,
  lenOfMask,
  maskOf,
  type NatRule,
  networkOf,
  type Op,
  parseIpv4,
} from '@nos/core';
import { type Area, type ConfigBlock, config, currentIface, fault, intent, noop } from '../area';
import { arg, type CmdCtx, type CommandSpec, kw, type Node } from '../grammar';
import type { View, ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];

/** Paso de numeración de las reglas: VRP numera 5, 10, 15... */
const STEP = 5;
const RULE_ID_MAX = 4_294_967_294;

const UNDO = kw('undo', 'Negate a command or set its default');
const DISPLAY = kw('display', 'Display information');
const ACL = kw('acl', 'Specify ACL configuration information');
const NUMBER = kw('number', 'Specify a numbered ACL');
const ACL_NUM = arg(
  'acl',
  { kind: 'int', min: 2000, max: 2999 },
  'Basic access-list(add to current using rules)',
);
const RULE = kw('rule', 'Specify an ACL rule');
const RULE_ID = arg('id', { kind: 'int', min: 0, max: RULE_ID_MAX }, 'ID of ACL rule');
const SOURCE = kw('source', 'Specify source address');

// ── Nombres de listas ───────────────────────────────────────────────────────

const permitList = (n: number) => `acl${n}`;
const denyList = (n: number) => `acl${n}:deny`;
const markerList = (n: number) => `acl${n}:def`;
const LIST_RE = /^acl(\d+)(?::(deny|def))?$/;
const COMMENT_RE = /^rule (\d+) (permit|deny)$/;

/** El marcador de existencia: nunca coincide con nada (ver la cabecera). */
const MARKER: Ipv4Prefix = { ip: 0 as Ipv4, len: 32 };

type Action = 'permit' | 'deny';

interface AclRule {
  readonly id: number;
  readonly action: Action;
  readonly address: Ipv4Prefix;
  readonly entry: ItemId;
}

const isPrefix = (a: Ipv4Prefix | IpRange): a is Ipv4Prefix => 'len' in a;

/** Números de las ACL que existen (marcador o alguna regla), en orden. */
function aclNumbers(device: Device): number[] {
  const found = new Set<number>();
  for (const e of device.config.firewall.addressLists) {
    const m = LIST_RE.exec(e.list);
    const n = Number(m?.[1]);
    if (m && n >= 2000 && n <= 2999) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

const aclExists = (device: Device, n: number) => aclNumbers(device).includes(n);

/** Las reglas de una ACL, ordenadas por número. */
function rulesOf(device: Device, n: number): AclRule[] {
  const rules: AclRule[] = [];
  for (const e of device.config.firewall.addressLists) {
    if (e.list !== permitList(n) && e.list !== denyList(n)) continue;
    const m = COMMENT_RE.exec(e.comment ?? '');
    if (!m || !isPrefix(e.address)) continue;
    rules.push({
      id: Number(m[1]),
      action: m[2] as Action,
      address: e.address,
      entry: e.id,
    });
  }
  return rules.sort((a, b) => a.id - b.id);
}

/** Siguiente número libre: el primer múltiplo del paso por encima del mayor. */
const nextRuleId = (rules: readonly AclRule[]): number => {
  const max = rules.reduce((m, r) => Math.max(m, r.id), 0);
  return (Math.floor(max / STEP) + 1) * STEP;
};

/** Comodín X.X.X.X → longitud de prefijo; null si los bits no son contiguos. */
function lenOfWildcard(text: string): number | null {
  if (text === '0') return 32;
  const wildcard = parseIpv4(text);
  if (wildcard === null) return null;
  return lenOfMask((~wildcard >>> 0) as Ipv4);
}

const wildcardText = (len: number): string =>
  len === 32 ? '0' : formatIpv4((~maskOf(len) >>> 0) as Ipv4);

/** Una regla con la sintaxis de VRP; `source any` se imprime sin `source`. */
function ruleLine(rule: AclRule): string {
  const head = ` rule ${rule.id} ${rule.action}`;
  if (rule.address.len === 0) return head;
  return `${head} source ${formatIpv4(rule.address.ip)} ${wildcardText(rule.address.len)}`;
}

// ── NAT ─────────────────────────────────────────────────────────────────────

/** Número de ACL de una regla de NAT creada por `nat outbound`; null si no lo es. */
function easyIpAcl(rule: NatRule): number | null {
  if (rule.chain !== 'srcnat' || rule.action.kind !== 'masquerade') return null;
  const out = rule.match.outInterface;
  const list = rule.match.srcAddressList;
  if (!out || out.negate || !list || list.negate) return null;
  const m = /^acl(\d+)$/.exec(list.value);
  return m ? Number(m[1]) : null;
}

const easyIpRules = (device: Device) =>
  device.config.firewall.nat.flatMap((rule) => {
    const acl = easyIpAcl(rule);
    const iface = rule.match.outInterface?.value;
    return acl === null || iface === undefined ? [] : [{ rule, acl, iface }];
  });

// ── Comandos ────────────────────────────────────────────────────────────────

const aclView = (ctx: CmdCtx): number | null =>
  ctx.session.view.kind === 'acl' ? ctx.session.view.number : null;

/** Formas de `rule`: con o sin número, permit o deny, y con o sin origen. */
function ruleForms(): Node[][] {
  const forms: Node[][] = [];
  for (const withId of [false, true]) {
    for (const action of ['permit', 'deny'] as const) {
      const head: Node[] = [
        RULE,
        ...(withId ? [RULE_ID] : []),
        kw(
          action,
          action === 'permit'
            ? 'Specify matched packet permitted'
            : 'Specify matched packet denied',
        ),
      ];
      forms.push(
        head,
        [...head, SOURCE, kw('any', 'Any source')],
        [
          ...head,
          SOURCE,
          arg('ip', { kind: 'ipv4' }, 'Address of source'),
          arg('wildcard', { kind: 'wildcard' }, 'Wildcard bits'),
        ],
        [
          ...head,
          SOURCE,
          arg('ip', { kind: 'ipv4' }, 'Address of source'),
          kw('0', 'Wildcard bits : 0.0.0.0 ( a host )'),
        ],
      );
    }
  }
  return forms;
}

function addRule(
  ctx: CmdCtx,
  n: number,
  action: Action,
  idText: string | undefined,
  address: Ipv4Prefix,
) {
  const rules = rulesOf(ctx.device, n);
  const id = idText === undefined ? nextRuleId(rules) : Number(idText);
  // Sin números libres por encima del mayor: falla con el error genérico.
  if (id > RULE_ID_MAX) return fault('rule-id-exhausted');
  const replaced = rules.find((r) => r.id === id);
  const others = rules.filter((r) => r.id !== id);
  // VRP no crea dos reglas con el mismo contenido: la repetida no hace nada.
  const duplicate = others.some(
    (r) => r.action === action && r.address.ip === address.ip && r.address.len === address.len,
  );
  if (duplicate) return noop();
  if (
    replaced &&
    replaced.action === action &&
    replaced.address.ip === address.ip &&
    replaced.address.len === address.len
  ) {
    return noop();
  }
  const ops: Op[] = [];
  // Con un número que ya existe, la regla nueva sustituye a la anterior.
  if (replaced) ops.push({ op: 'remove', coll: 'addressLists', id: replaced.entry });
  // Las entradas quedan guardadas en el orden de los números, como se listan.
  const after = others.find((r) => r.id > id);
  ops.push({
    op: 'add',
    coll: 'addressLists',
    item: {
      list: action === 'permit' ? permitList(n) : denyList(n),
      address,
      comment: `rule ${id} ${action}`,
      disabled: false,
    },
    ...(after ? { before: after.entry } : {}),
  });
  return config(ops);
}

const commands: CommandSpec[] = [
  {
    views: ['system'],
    forms: [
      [ACL, NUMBER, ACL_NUM],
      [ACL, ACL_NUM],
    ],
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      const enter = {
        kind: 'session',
        change: { kind: 'enter', view: { kind: 'acl', number: n } },
      } as const;
      if (aclExists(ctx.device, n)) return intent(enter);
      const create: Op = {
        op: 'add',
        coll: 'addressLists',
        item: { list: markerList(n), address: MARKER, comment: `acl number ${n}`, disabled: true },
      };
      return intent({ kind: 'sequence', steps: [{ kind: 'config', ops: [create] }, enter] });
    },
  },
  {
    views: ['system'],
    forms: [
      [UNDO, ACL, NUMBER, ACL_NUM],
      [UNDO, ACL, ACL_NUM],
    ],
    build: (m, ctx) => {
      const n = Number(m.args['acl']);
      if (!aclExists(ctx.device, n)) return fault('acl-not-exist');
      // VRP borra la ACL aunque `nat outbound` la use: la referencia es por número
      // y queda en la interfaz sin coincidir con nada hasta que la ACL vuelva.
      const lists = [permitList(n), denyList(n), markerList(n)];
      return config(
        ctx.device.config.firewall.addressLists
          .filter((e) => lists.includes(e.list))
          .map((e): Op => ({ op: 'remove', coll: 'addressLists', id: e.id })),
      );
    },
  },
  {
    views: ['acl'],
    forms: ruleForms(),
    build: (m, ctx) => {
      const n = aclView(ctx);
      if (n === null) return noop();
      const action: Action = m.has('permit') ? 'permit' : 'deny';
      const ipText = m.args['ip'];
      if (ipText === undefined) {
        return addRule(ctx, n, action, m.args['id'], { ip: 0 as Ipv4, len: 0 });
      }
      const ip = parseIpv4(ipText);
      const len = m.has('0') ? 32 : lenOfWildcard(m.args['wildcard'] ?? '');
      // El simulador guarda prefijos: un comodín con huecos no tiene equivalente.
      if (ip === null || len === null) return fault('wrong-parameter', m.argAt['wildcard']);
      return addRule(ctx, n, action, m.args['id'], networkOf({ ip, len }));
    },
  },
  {
    views: ['acl'],
    forms: [[UNDO, RULE, RULE_ID]],
    build: (m, ctx) => {
      const n = aclView(ctx);
      if (n === null) return noop();
      const rule = rulesOf(ctx.device, n).find((r) => r.id === Number(m.args['id']));
      if (!rule) return fault('rule-not-exist');
      return config([{ op: 'remove', coll: 'addressLists', id: rule.entry }]);
    },
  },
  {
    views: ['interface'],
    forms: [
      [
        kw('nat', 'Specify NAT configuration information'),
        kw('outbound', 'Specify net address translation outbound'),
        arg('acl', { kind: 'int', min: 2000, max: 3999 }, 'Access list number'),
      ],
    ],
    build: (m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      const n = Number(m.args['acl']);
      if (!aclExists(ctx.device, n)) return fault('acl-not-exist');
      const already = easyIpRules(ctx.device).some((r) => r.iface === iface.id && r.acl === n);
      if (already) return noop();
      return config([
        {
          op: 'add',
          coll: 'natRules',
          item: {
            chain: 'srcnat',
            action: { kind: 'masquerade' },
            match: {
              outInterface: { value: iface.id, negate: false },
              srcAddressList: { value: permitList(n), negate: false },
            },
            disabled: false,
          },
        },
      ]);
    },
  },
  {
    views: ['interface'],
    forms: [
      [
        UNDO,
        kw('nat', 'Specify NAT configuration information'),
        kw('outbound', 'Specify net address translation outbound'),
        arg('acl', { kind: 'int', min: 2000, max: 3999 }, 'Access list number'),
      ],
    ],
    build: (m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      const n = Number(m.args['acl']);
      const targets = easyIpRules(ctx.device).filter((r) => r.iface === iface.id && r.acl === n);
      return config(
        targets.map(({ rule }): Op => ({ op: 'remove', coll: 'natRules', id: rule.id })),
      );
    },
  },
  {
    views: ALL_VIEWS,
    forms: [
      [DISPLAY, ACL, kw('all', 'All of the ACL')],
      [DISPLAY, ACL, ACL_NUM],
    ],
    build: (m) =>
      intent({
        kind: 'show',
        view: { kind: 'display', what: 'acl', arg: m.args['acl'] ?? 'all' },
      }),
  },
  {
    views: ALL_VIEWS,
    forms: [
      [
        DISPLAY,
        kw('nat', 'NAT information'),
        kw('outbound', 'Display net address translation outbound information'),
      ],
    ],
    build: () => intent({ kind: 'show', view: { kind: 'display', what: 'nat outbound' } }),
  },
];

// ── Display y configuración ─────────────────────────────────────────────────

function aclSummary(device: Device, n: number): string[] {
  const rules = rulesOf(device, n);
  return [
    `Basic ACL ${n}, ${rules.length} ${rules.length > 1 ? 'rules' : 'rule'}`,
    `Acl's step is ${STEP}`,
    ...rules.map(ruleLine),
  ];
}

function displayAcl(ctx: CmdCtx, which: string | undefined): string {
  const device = ctx.device;
  if (which !== undefined && which !== 'all') {
    const n = Number(which);
    return aclExists(device, n) ? aclSummary(device, n).join('\n') : '';
  }
  const numbers = aclNumbers(device);
  const nonEmpty = numbers.filter((n) => rulesOf(device, n).length > 0).length;
  return [
    ` Total quantity of nonempty ACL number is ${nonEmpty}`,
    ...numbers.flatMap((n) => ['', ...aclSummary(device, n)]),
  ].join('\n');
}

const RULER = ` ${'-'.repeat(74)}`;

function displayNatOutbound(ctx: CmdCtx): string {
  const device = ctx.device;
  const rows = easyIpRules(device).map(({ acl, iface }) => {
    const name = device.config.interfaces.find((i) => i.id === iface)?.name ?? '';
    // Easy IP: la dirección que se usa es la de la propia interfaz de salida.
    const addr = device.config.addressing.addresses.find((a) => a.iface === iface && !a.disabled);
    const ip = addr ? formatIpv4(addr.address.ip) : '0.0.0.0';
    return ` ${name.padEnd(29)}${String(acl).padEnd(8)}${ip.padEnd(32)}easyip`;
  });
  return [
    ' NAT Outbound Information:',
    RULER,
    ` ${'Interface'.padEnd(29)}${'Acl'.padEnd(8)}${'Address-group/IP/Interface'.padEnd(32)}Type`,
    RULER,
    ...rows,
    RULER,
    `  Total : ${rows.length}`,
  ].join('\n');
}

const aclBlock = (device: Device, n: number): string[] => [
  `acl number ${n}`,
  ...rulesOf(device, n).map(ruleLine),
];

/** Una ACL por bloque, en orden de número (orden 40). */
function blocks(device: Device): readonly ConfigBlock[] {
  return aclNumbers(device).map((n) => ({ order: 40, lines: aclBlock(device, n) }));
}

function interfaceLines(device: Device, iface: Interface): readonly string[] {
  return easyIpRules(device)
    .filter((r) => r.iface === iface.id)
    .map((r) => ` nat outbound ${r.acl}`);
}

function viewBlock(device: Device, view: View): readonly string[] | null {
  if (view.kind !== 'acl') return null;
  return aclExists(device, view.number) ? aclBlock(device, view.number) : [];
}

export const NAT_AREA: Area = {
  commands,
  displays: {
    acl: (ctx, which) => displayAcl(ctx, which),
    'nat outbound': (ctx) => displayNatOutbound(ctx),
  },
  blocks,
  interfaceLines,
  viewBlock,
  messages: {
    'acl-not-exist': 'Error: The ACL does not exist.',
    'rule-not-exist': 'Error: The specified rule does not exist yet.',
  },
};
