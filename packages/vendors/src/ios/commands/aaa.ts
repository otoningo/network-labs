/**
 * Acceso al equipo: `enable secret`, usuarios locales (`username ... privilege
 * N secret ...`), las líneas de consola y vty (`line vty 0 4` con `transport
 * input`, `login local`, `password`...), las claves RSA (`crypto key generate
 * rsa`), `ip ssh version 2` y los `show ip ssh` / `show users`.
 *
 * Correspondencia con el modelo neutral:
 * - La contraseña nunca se guarda (D-012): solo `hasPassword`. En la
 *   configuración sale siempre el mismo texto cifrado de relleno.
 * - El privilegio se traduce al grupo neutral: 0-1 es `read`, 2-14 `write` y 15
 *   `full`. El número exacto y si es `secret` o `password` van en el comentario
 *   del usuario (`privilege 15; secret`).
 * - Telnet y SSH son los servicios neutrales `telnet` y `ssh`, y la
 *   reconciliación los enciende solo cuando de verdad se puede entrar por ellos:
 *   Telnet si `transport input` lo admite y la línea tiene con qué validar
 *   (`login` con `password`, `login local` con algún usuario con contraseña, o
 *   `no login`); SSH si además hay claves RSA y `login local`. Así lo que se
 *   comprueba es lo que hace la red, no lo que se escribió.
 * - El resto (enable, líneas, claves, dominio) vive en los ajustes de meta.ts.
 */
import type { Device, MgmtService, Op, ServiceName, User, UserGroup } from '@nos/core';
import {
  type Area,
  type Built,
  type ConfigBlock,
  config,
  fault,
  intent,
  noop,
  show,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, kw, type Node } from '../grammar';
import { type IosMeta, type LineMeta, type LineProto, metaOf, metaOps } from '../meta';
import { EXEC_VIEWS } from '../session';

/** Textos fijos que ocupan el lugar de las contraseñas: las reales nunca se guardan. */
export const SECRET_PLACEHOLDER = '$1$nLab$Zq3xR8vK2mW5tY7uP0aS9.';
export const PASSWORD7_PLACEHOLDER = '0822455D0A165445415F59';

const NO = kw('no', 'Negate a command or set its defaults');
const SHOW = kw('show', 'Show running system information');
const ENABLE = kw('enable', 'Modify enable password parameters');
const USERNAME = kw('username', 'Establish User Name Authentication');
const USER_NAME = arg('name', { kind: 'word', max: 64 }, 'User name');
const PRIVILEGE = [
  kw('privilege', 'Set user privilege level'),
  arg('level', { kind: 'int', min: 0, max: 15 }, 'User privilege level'),
];
const PW = arg('password', { kind: 'word', max: 128 }, 'The UNENCRYPTED (cleartext) password');

// ── Usuarios ────────────────────────────────────────────────────────────────

interface UserMeta {
  readonly level: number;
  readonly kind: 'secret' | 'password' | 'none';
}

function userMeta(user: User): UserMeta {
  const m = /^privilege (\d+); (secret|password|none)$/.exec(user.comment ?? '');
  if (m) return { level: Number(m[1]), kind: m[2] as UserMeta['kind'] };
  return { level: user.group === 'full' ? 15 : 1, kind: user.hasPassword ? 'secret' : 'none' };
}

/** Privilegio de IOS → grupo neutral (ver la cabecera). */
export function groupForLevel(level: number): UserGroup {
  if (level <= 1) return 'read';
  return level >= 15 ? 'full' : 'write';
}

/** Privilegio que se muestra: el guardado si casa con el grupo, si no el típico del grupo. */
function levelOf(user: User): number {
  const stored = userMeta(user).level;
  if (groupForLevel(stored) === user.group) return stored;
  return user.group === 'full' ? 15 : user.group === 'write' ? 2 : 1;
}

/** Formas de `username`: con o sin privilegio, y con secret, password o nada más. */
function usernameForms(): Node[][] {
  const forms: Node[][] = [];
  for (const withLevel of [false, true]) {
    const head: Node[] = [USERNAME, USER_NAME, ...(withLevel ? PRIVILEGE : [])];
    if (withLevel) forms.push(head);
    const secret = kw('secret', 'Specify the secret for the user');
    const password = kw('password', 'Specify the password for the user');
    forms.push(
      [...head, secret, PW],
      [...head, secret, arg('type', { kind: 'int', min: 0, max: 9 }, 'Encryption type'), PW],
      [...head, password, PW],
      [...head, password, arg('type', { kind: 'int', min: 0, max: 7 }, 'Encryption type'), PW],
    );
  }
  return forms;
}

function setUser(
  ctx: CmdCtx,
  name: string,
  level: number | undefined,
  kind: UserMeta['kind'] | undefined,
): Built {
  const existing = ctx.device.config.system.users.find((u) => u.name === name);
  const before = existing ? userMeta(existing) : { level: 1, kind: 'none' as const };
  const next: UserMeta = { level: level ?? before.level, kind: kind ?? before.kind };
  const fields = {
    group: groupForLevel(next.level),
    hasPassword: next.kind !== 'none',
    comment: `privilege ${next.level}; ${next.kind}`,
  };
  if (!existing) {
    return config([{ op: 'add', coll: 'users', item: { name, ...fields, disabled: false } }]);
  }
  return config([{ op: 'set', coll: 'users', id: existing.id, patch: fields }]);
}

// ── Líneas ──────────────────────────────────────────────────────────────────

type LineName = 'vty' | 'con';

const lineView = (ctx: CmdCtx): LineName | null =>
  ctx.session.view.kind === 'line' ? ctx.session.view.line : null;

function editLine(ctx: CmdCtx, change: (line: LineMeta) => LineMeta, message?: string): Built {
  const which = lineView(ctx);
  if (!which) return noop();
  return config(
    metaOps(ctx.device, (meta): IosMeta => ({ ...meta, [which]: change(meta[which]) })),
    message,
  );
}

const TRANSPORTS: readonly (readonly [string, readonly LineProto[], string])[] = [
  ['all', ['telnet', 'ssh'], 'All protocols'],
  ['none', [], 'No protocols'],
  ['ssh', ['ssh'], 'TCP/IP SSH protocol'],
  ['telnet', ['telnet'], 'TCP/IP Telnet protocol'],
];

function transportForms(): Node[][] {
  const head = [
    kw('transport', 'Define transport protocols for line'),
    kw('input', 'Define which protocols to use when connecting to the terminal server'),
  ];
  const forms: Node[][] = TRANSPORTS.map(([word, , help]) => [...head, kw(word, help)]);
  forms.push(
    [...head, kw('telnet', 'TCP/IP Telnet protocol'), kw('ssh', 'TCP/IP SSH protocol')],
    [...head, kw('ssh', 'TCP/IP SSH protocol'), kw('telnet', 'TCP/IP Telnet protocol')],
  );
  return forms;
}

// ── Servicios según las líneas (reconciliación) ─────────────────────────────

const serviceOf = (device: Device, name: ServiceName): MgmtService | undefined =>
  device.config.services.find((s) => s.name === name);

/** Qué servicios se pueden usar de verdad con la configuración actual. */
export function usable(device: Device): { readonly telnet: boolean; readonly ssh: boolean } {
  const meta = metaOf(device);
  const vty = meta.vty;
  const users = device.config.system.users.some((u) => u.hasPassword && !u.disabled);
  const login =
    vty.login === 'none' ||
    (vty.login === 'line' && vty.password) ||
    (vty.login === 'local' && users);
  return {
    telnet: vty.transport.includes('telnet') && login,
    ssh:
      vty.transport.includes('ssh') && meta.rsaBits !== undefined && vty.login === 'local' && users,
  };
}

function reconcile(device: Device): readonly Op[] {
  const want = usable(device);
  const ops: Op[] = [];
  for (const name of ['telnet', 'ssh'] as const) {
    const service = serviceOf(device, name);
    if (service && service.disabled === want[name]) {
      ops.push({ op: 'set', coll: 'services', id: service.id, patch: { disabled: !want[name] } });
    }
  }
  return ops;
}

// ── Comandos ────────────────────────────────────────────────────────────────

const commands: CommandSpec[] = [
  // ── enable secret / password ──
  {
    views: ['config'],
    forms: [
      [ENABLE, kw('secret', 'Assign the privileged level secret'), PW],
      [
        ENABLE,
        kw('secret', 'Assign the privileged level secret'),
        arg('type', { kind: 'int', min: 0, max: 9 }, 'Encryption type'),
        PW,
      ],
      [ENABLE, kw('password', 'Assign the privileged level password'), PW],
      [
        ENABLE,
        kw('password', 'Assign the privileged level password'),
        arg('type', { kind: 'int', min: 0, max: 7 }, 'Encryption type'),
        PW,
      ],
    ],
    build: (m, ctx) => {
      // Con las dos configuradas manda el secret, como en IOS: el password no lo pisa.
      const kind = m.has('secret') ? 'secret' : 'password';
      return config(
        metaOps(ctx.device, (meta) =>
          kind === 'password' && meta.enable === 'secret' ? meta : { ...meta, enable: kind },
        ),
      );
    },
  },
  {
    views: ['config'],
    forms: [
      [NO, ENABLE, kw('secret', 'Assign the privileged level secret')],
      [NO, ENABLE, kw('password', 'Assign the privileged level password')],
    ],
    build: (m, ctx) =>
      config(
        metaOps(ctx.device, (meta) => {
          if (meta.enable !== (m.has('secret') ? 'secret' : 'password')) return meta;
          const { enable: _gone, ...rest } = meta;
          return rest;
        }),
      ),
  },

  // ── Usuarios ──
  {
    views: ['config'],
    forms: usernameForms(),
    build: (m, ctx) => {
      const level = m.args['level'] === undefined ? undefined : Number(m.args['level']);
      const kind = m.has('secret') ? 'secret' : m.has('password') ? 'password' : undefined;
      return setUser(ctx, m.args['name'] ?? '', level, kind);
    },
  },
  {
    views: ['config'],
    forms: [[NO, USERNAME, USER_NAME]],
    build: (m, ctx) => {
      const user = ctx.device.config.system.users.find((u) => u.name === m.args['name']);
      if (!user) return noop();
      return config([{ op: 'remove', coll: 'users', id: user.id }]);
    },
  },

  // ── Líneas ──
  {
    views: ['config'],
    forms: [
      [
        kw('line', 'Configure a terminal line'),
        kw('vty', 'Virtual terminal'),
        arg('first', { kind: 'int', min: 0, max: 15 }, 'First Line number'),
        arg('last', { kind: 'int', min: 1, max: 15 }, 'Last Line number'),
      ],
      [
        kw('line', 'Configure a terminal line'),
        kw('vty', 'Virtual terminal'),
        arg('first', { kind: 'int', min: 0, max: 15 }, 'First Line number'),
      ],
      [
        kw('line', 'Configure a terminal line'),
        kw('console', 'Primary terminal line'),
        kw('0', 'First Line number'),
      ],
    ],
    build: (m) =>
      intent({
        kind: 'session',
        change: { kind: 'enter', view: { kind: 'line', line: m.has('vty') ? 'vty' : 'con' } },
      }),
  },
  {
    // La línea auxiliar existe en la configuración pero no lleva a ningún sitio.
    views: ['config'],
    forms: [
      [
        kw('line', 'Configure a terminal line'),
        kw('aux', 'Auxiliary line'),
        kw('0', 'First Line number'),
      ],
    ],
    build: () => noop(),
  },
  {
    views: ['line'],
    forms: transportForms(),
    build: (m, ctx) => {
      const transport: LineProto[] = m.has('all')
        ? ['telnet', 'ssh']
        : (['telnet', 'ssh'] as const).filter((p) => m.has(p));
      return editLine(ctx, (line) => ({ ...line, transport, transportSet: true }));
    },
  },
  {
    views: ['line'],
    forms: [[kw('login', 'Enable password checking')]],
    build: (_m, ctx) => {
      const which = lineView(ctx);
      const line = which ? metaOf(ctx.device)[which] : undefined;
      // Como IOS: se acepta, pero avisa de que nadie podrá entrar hasta poner `password`.
      const warn =
        line && !line.password ? "% Login disabled on line 1, until 'password' is set" : undefined;
      return editLine(ctx, (l) => ({ ...l, login: 'line' }), warn);
    },
  },
  {
    views: ['line'],
    forms: [[kw('login', 'Enable password checking'), kw('local', 'Local password checking')]],
    build: (_m, ctx) => editLine(ctx, (l) => ({ ...l, login: 'local' })),
  },
  {
    views: ['line'],
    forms: [[NO, kw('login', 'Enable password checking')]],
    build: (_m, ctx) => editLine(ctx, (l) => ({ ...l, login: 'none' })),
  },
  {
    views: ['line'],
    forms: [
      [kw('password', 'Set a password'), PW],
      [
        kw('password', 'Set a password'),
        arg('type', { kind: 'int', min: 0, max: 7 }, 'Encryption type'),
        PW,
      ],
    ],
    build: (_m, ctx) => editLine(ctx, (l) => ({ ...l, password: true })),
  },
  {
    views: ['line'],
    forms: [[NO, kw('password', 'Set a password')]],
    build: (_m, ctx) => editLine(ctx, (l) => ({ ...l, password: false })),
  },
  {
    views: ['line'],
    forms: [
      [
        kw('exec-timeout', 'Set the EXEC timeout'),
        arg('min', { kind: 'int', min: 0, max: 35791 }, 'Timeout in minutes'),
      ],
      [
        kw('exec-timeout', 'Set the EXEC timeout'),
        arg('min', { kind: 'int', min: 0, max: 35791 }, 'Timeout in minutes'),
        arg('sec', { kind: 'int', min: 0, max: 2147483 }, 'Timeout in seconds'),
      ],
    ],
    build: (m, ctx) => {
      const timeout = [Number(m.args['min']), Number(m.args['sec'] ?? 0)] as const;
      const isDefault = timeout[0] === 10 && timeout[1] === 0;
      return editLine(ctx, (l) => {
        const { execTimeout: _old, ...rest } = l;
        return isDefault ? rest : { ...rest, execTimeout: timeout };
      });
    },
  },
  {
    views: ['line'],
    forms: [
      [
        kw('logging', 'Modify message logging facilities'),
        kw('synchronous', 'Synchronized message output'),
      ],
      [
        NO,
        kw('logging', 'Modify message logging facilities'),
        kw('synchronous', 'Synchronized message output'),
      ],
    ],
    build: (m, ctx) => editLine(ctx, (l) => ({ ...l, loggingSync: !m.has('no') })),
  },

  // ── SSH ──
  {
    views: ['config'],
    forms: [
      [
        kw('crypto', 'Encryption module'),
        kw('key', 'Long term key operations'),
        kw('generate', 'Generate new keys'),
        kw('rsa', 'Generate RSA keys'),
      ],
      [
        kw('crypto', 'Encryption module'),
        kw('key', 'Long term key operations'),
        kw('generate', 'Generate new keys'),
        kw('rsa', 'Generate RSA keys'),
        kw('general-keys', 'Generate a general purpose RSA key pair for signing and encryption'),
      ],
      [
        kw('crypto', 'Encryption module'),
        kw('key', 'Long term key operations'),
        kw('generate', 'Generate new keys'),
        kw('rsa', 'Generate RSA keys'),
        kw('modulus', 'Provide number of modulus bits on the command line'),
        arg('bits', { kind: 'int', min: 360, max: 4096 }, 'size of the key modulus [360-4096]'),
      ],
      [
        kw('crypto', 'Encryption module'),
        kw('key', 'Long term key operations'),
        kw('generate', 'Generate new keys'),
        kw('rsa', 'Generate RSA keys'),
        kw('general-keys', 'Generate a general purpose RSA key pair for signing and encryption'),
        kw('modulus', 'Provide number of modulus bits on the command line'),
        arg('bits', { kind: 'int', min: 360, max: 4096 }, 'size of the key modulus [360-4096]'),
      ],
    ],
    build: (m, ctx) => {
      if (ctx.device.config.system.identity === 'Router') return fault('rsa-hostname');
      const domain = metaOf(ctx.device).domain;
      if (domain === undefined) return fault('rsa-domain');
      const bits = m.args['bits'];
      if (bits !== undefined) {
        return intent({ kind: 'vendor', action: { kind: 'rsa', bits: Number(bits) } });
      }
      return intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'vendor',
            action: {
              kind: 'message',
              text: [
                `The name for the keys will be: ${ctx.device.config.system.identity}.${domain}`,
                'Choose the size of the key modulus in the range of 360 to 4096 for your',
                '  General Purpose Keys. Choosing a key modulus greater than 512 may take',
                '  a few minutes.',
                '',
                'How many bits in the modulus [512]: ',
              ].join('\n'),
            },
          },
          { kind: 'session', change: { kind: 'ask', pending: { kind: 'rsa' } } },
        ],
      });
    },
  },
  {
    views: ['config'],
    forms: [
      [
        kw('crypto', 'Encryption module'),
        kw('key', 'Long term key operations'),
        kw('zeroize', 'Remove keys'),
        kw('rsa', 'Remove RSA keys'),
      ],
    ],
    build: (_m, ctx) => {
      if (metaOf(ctx.device).rsaBits === undefined) return noop();
      return config(
        metaOps(ctx.device, (meta) => {
          const { rsaBits: _gone, ...rest } = meta;
          return rest;
        }),
        '%SSH-5-DISABLED: SSH 1.99 has been disabled',
      );
    },
  },
  {
    views: ['config'],
    forms: [
      [
        kw('ip', 'Global IP configuration subcommands'),
        kw('ssh', 'Configure ssh options'),
        kw('version', 'Specify protocol version to be supported'),
        kw('2', 'Protocol version 2'),
      ],
      [
        NO,
        kw('ip', 'Global IP configuration subcommands'),
        kw('ssh', 'Configure ssh options'),
        kw('version', 'Specify protocol version to be supported'),
      ],
    ],
    build: (m, ctx) => {
      if (m.has('no')) {
        return config(
          metaOps(ctx.device, (meta) => {
            const { sshVersion: _gone, ...rest } = meta;
            return rest;
          }),
        );
      }
      const bits = metaOf(ctx.device).rsaBits;
      const warn =
        bits === undefined || bits < 768
          ? 'Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).'
          : undefined;
      return config(
        metaOps(ctx.device, (meta) => ({ ...meta, sshVersion: 2 })),
        warn,
      );
    },
  },

  // ── Show ──
  {
    views: EXEC_VIEWS,
    forms: [
      [SHOW, kw('ip', 'IP information'), kw('ssh', 'Information on SSH')],
      [SHOW, kw('users', 'Display information about terminal lines')],
    ],
    build: (m) => show(m.has('users') ? 'users' : 'ip ssh'),
  },
];

// ── Show y configuración ────────────────────────────────────────────────────

function showIpSsh(device: Device): string {
  const meta = metaOf(device);
  const timers = 'Authentication timeout: 120 secs; Authentication retries: 3';
  if (meta.rsaBits === undefined) {
    return [
      'SSH Disabled - version 1.99',
      '%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).',
      timers,
    ].join('\n');
  }
  const v2 = meta.sshVersion === 2;
  return [`SSH Enabled - version ${v2 ? '2.0' : '1.99'}`, timers].join('\n');
}

function showUsers(ctx: CmdCtx): string {
  return [
    `${'    Line'.padEnd(15)}${'User'.padEnd(11)}${'Host(s)'.padEnd(21)}${'Idle'.padEnd(11)}Location`,
    `${'*  0 con 0'.padEnd(26)}${'idle'.padEnd(21)}00:00:00`,
    '',
    `  ${'Interface'.padEnd(9)}${'User'.padEnd(15)}${'Mode'.padEnd(10)}${'Idle'.padEnd(11)}Peer Address`,
    ...(ctx.session.user === 'console' ? [] : [`  ${ctx.session.user}`]),
  ].join('\n');
}

function lineLines(header: string, line: LineMeta, isVty: boolean): string[] {
  const out = [header];
  if (line.execTimeout) out.push(` exec-timeout ${line.execTimeout[0]} ${line.execTimeout[1]}`);
  if (line.password) out.push(` password 7 ${PASSWORD7_PLACEHOLDER}`);
  if (line.loggingSync) out.push(' logging synchronous');
  if (line.login === 'line') out.push(' login');
  if (line.login === 'local') out.push(' login local');
  if (isVty && line.transportSet) {
    const t = line.transport;
    const words = t.length === 0 ? 'none' : t.length === 2 ? 'all' : (t[0] ?? 'none');
    out.push(` transport input ${words}`);
  }
  return out;
}

function blocks(device: Device): readonly ConfigBlock[] {
  const meta = metaOf(device);
  const enable =
    meta.enable === 'secret'
      ? [`enable secret 5 ${SECRET_PLACEHOLDER}`]
      : meta.enable === 'password'
        ? [`enable password 7 ${PASSWORD7_PLACEHOLDER}`]
        : [];
  const users = device.config.system.users.map((u) => {
    const level = levelOf(u);
    const kind = userMeta(u).kind;
    const head = `username ${u.name}${level === 1 ? '' : ` privilege ${level}`}`;
    if (kind === 'secret') return `${head} secret 5 ${SECRET_PLACEHOLDER}`;
    if (kind === 'password') return `${head} password 7 ${PASSWORD7_PLACEHOLDER}`;
    return head;
  });
  return [
    { order: 30, lines: enable },
    { order: 35, lines: ['no aaa new-model'] },
    { order: 60, lines: users },
    { order: 65, lines: meta.sshVersion === 2 ? ['ip ssh version 2'] : [] },
    {
      order: 170,
      lines: [
        ...lineLines('line con 0', meta.con, false),
        'line aux 0',
        ...lineLines('line vty 0 4', meta.vty, true),
      ],
    },
  ];
}

export const AAA_AREA: Area = {
  commands,
  shows: {
    'ip ssh': (ctx) => showIpSsh(ctx.device),
    users: (ctx) => showUsers(ctx),
  },
  blocks,
  reconcile,
  messages: {
    'rsa-hostname': '% Please define a hostname other than Router.',
    'rsa-domain': '% Please define a domain-name first.',
  },
};
