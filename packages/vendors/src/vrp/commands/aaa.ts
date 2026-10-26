/**
 * AAA y servicios de gestión: la vista `aaa` con sus `local-user` (contraseña,
 * nivel y tipos de servicio), `telnet server enable` y `stelnet server
 * enable`, y los `display local-user` / `display telnet server status`.
 *
 * Correspondencia con el modelo neutral:
 * - La contraseña nunca se guarda (D-012): solo `hasPassword`. En la
 *   configuración sale siempre el mismo texto cifrado de relleno.
 * - El nivel de VRP se traduce al grupo neutral: 0-1 (consulta y supervisión)
 *   es `read`, 2 (configuración) es `write` y 3-15 (gestión) es `full`. Un
 *   usuario nuevo sin nivel tiene el 0 de VRP, así que nace `read`.
 * - El usuario neutral no tiene campo para el nivel exacto ni para los tipos de
 *   servicio, así que se guardan en su comentario con la sintaxis de VRP:
 *   `privilege level 3; service-type telnet ssh`. El grupo manda: si el nivel
 *   del comentario ya no le corresponde (otro driver lo cambió), se muestra el
 *   nivel típico del grupo.
 * - `telnet server enable` y `stelnet server enable` encienden los servicios
 *   neutrales `telnet` y `ssh`; los `undo` los deshabilitan.
 */
import type { Device, MgmtService, ServiceName, User, UserGroup } from '@nos/core';
import { type Area, type ConfigBlock, config, fault, intent, noop } from '../area';
import { arg, type CmdCtx, type CommandSpec, kw, type Node } from '../grammar';
import type { View, ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];

const UNDO = kw('undo', 'Negate a command or set its default');
const DISPLAY = kw('display', 'Display information');
const LOCAL_USER = kw('local-user', 'Set local user');
const USER_NAME = arg('name', { kind: 'word', max: 64 }, 'User name, in form of user@domain');
const SERVER = kw('server', 'Server');
const ENABLE = kw('enable', 'Enable');

/** Texto fijo que ocupa el lugar de la contraseña: la real nunca se guarda. */
export const PASSWORD_PLACEHOLDER = '%^%#Q2sFz7L1mN0pX9cVb3Kd5Rt8Yw4Hj6Gf%^%#';

/** Tipos de servicio de `local-user ... service-type`, con su letra de AuthMask. */
const SERVICE_TYPES: readonly (readonly [string, string, string])[] = [
  ['telnet', 'T', 'Telnet user'],
  ['ssh', 'S', 'SSH user'],
  ['http', 'H', 'HTTP user'],
  ['terminal', 'X', 'Terminal user'],
];

// ── Nivel y tipos de servicio en el comentario ──────────────────────────────

interface UserMeta {
  readonly level?: number;
  readonly services: readonly string[];
}

function metaOf(user: User): UserMeta {
  const text = user.comment ?? '';
  const level = /(?:^|; )privilege level (\d+)(?:;|$)/.exec(text);
  const services = /(?:^|; )service-type ([a-z ]+?)(?:;|$)/.exec(text);
  return {
    ...(level ? { level: Number(level[1]) } : {}),
    services: services ? (services[1] ?? '').split(' ').filter((s) => s !== '') : [],
  };
}

function metaComment(meta: UserMeta): string | undefined {
  const parts: string[] = [];
  if (meta.level !== undefined) parts.push(`privilege level ${meta.level}`);
  if (meta.services.length > 0) parts.push(`service-type ${meta.services.join(' ')}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/** Nivel de VRP → grupo neutral (ver la cabecera). */
export function groupForLevel(level: number): UserGroup {
  if (level <= 1) return 'read';
  return level === 2 ? 'write' : 'full';
}

/** Nivel que se muestra: el guardado si casa con el grupo, si no el típico del grupo. */
function levelOf(user: User): number | undefined {
  const stored = metaOf(user).level;
  if (stored !== undefined && groupForLevel(stored) === user.group) return stored;
  switch (user.group) {
    case 'full':
      return 15;
    case 'write':
      return 2;
    case 'read':
      return undefined;
  }
}

const userByName = (device: Device, name: string): User | undefined =>
  device.config.system.users.find((u) => u.name === name);

// ── Comandos ────────────────────────────────────────────────────────────────

/**
 * Cambia un usuario o lo crea si falta. VRP crea el usuario con cualquier
 * `local-user` y avisa con `Info: Add a new user.`
 */
function upsertUser(
  ctx: CmdCtx,
  name: string,
  change: (meta: UserMeta) => {
    readonly meta: UserMeta;
    readonly group?: UserGroup;
    readonly hasPassword?: boolean;
  },
) {
  const existing = userByName(ctx.device, name);
  const next = change(existing ? metaOf(existing) : { services: [] });
  const comment = metaComment(next.meta);
  if (!existing) {
    return config(
      [
        {
          op: 'add',
          coll: 'users',
          item: {
            name,
            group: next.group ?? 'read',
            hasPassword: next.hasPassword ?? false,
            disabled: false,
            ...(comment === undefined ? {} : { comment }),
          },
        },
      ],
      'Info: Add a new user.',
    );
  }
  return config([
    {
      op: 'set',
      coll: 'users',
      id: existing.id,
      patch: {
        ...(next.group === undefined ? {} : { group: next.group }),
        ...(next.hasPassword === undefined ? {} : { hasPassword: next.hasPassword }),
        ...(comment === undefined ? {} : { comment }),
      },
      ...(comment === undefined ? { unset: ['comment'] } : {}),
    },
  ]);
}

/** Todas las secuencias de tipos de servicio sin repetir, en cualquier orden. */
function serviceTypeForms(): Node[][] {
  const forms: Node[][] = [];
  const grow = (prefix: Node[], used: readonly string[]) => {
    for (const [word, , help] of SERVICE_TYPES) {
      if (used.includes(word)) continue;
      const next = [...prefix, kw(word, help)];
      forms.push(next);
      grow(next, [...used, word]);
    }
  };
  grow([LOCAL_USER, USER_NAME, kw('service-type', 'Set the access type of the user')], []);
  return forms;
}

const SERVICE_WORDS = SERVICE_TYPES.map(([word]) => word);

/** Enciende o apaga un servicio neutral; lo crea con su puerto si no existiera. */
function setService(ctx: CmdCtx, name: ServiceName, port: number, enabled: boolean) {
  const service = ctx.device.config.services.find((s) => s.name === name);
  if (!service) {
    if (!enabled) return noop();
    return config([
      { op: 'add', coll: 'services', item: { name, port, allowedFrom: [], disabled: false } },
    ]);
  }
  if (service.disabled === !enabled) return noop();
  return config([{ op: 'set', coll: 'services', id: service.id, patch: { disabled: !enabled } }]);
}

const commands: CommandSpec[] = [
  {
    views: ['system'],
    forms: [[kw('aaa', 'AAA')]],
    build: () => intent({ kind: 'session', change: { kind: 'enter', view: { kind: 'aaa' } } }),
  },
  {
    views: ['system'],
    forms: [
      [kw('telnet', 'Telnet protocol'), SERVER, ENABLE],
      [UNDO, kw('telnet', 'Telnet protocol'), SERVER, ENABLE],
    ],
    build: (m, ctx) => setService(ctx, 'telnet', 23, !m.has('undo')),
  },
  {
    views: ['system'],
    forms: [
      [kw('stelnet', 'Secure Telnet'), SERVER, ENABLE],
      [UNDO, kw('stelnet', 'Secure Telnet'), SERVER, ENABLE],
    ],
    build: (m, ctx) => setService(ctx, 'ssh', 22, !m.has('undo')),
  },
  {
    views: ['aaa'],
    forms: [
      [
        LOCAL_USER,
        USER_NAME,
        kw('password', 'Set password'),
        kw('irreversible-cipher', 'Irreversible cipher text'),
        arg('password', { kind: 'word', max: 128 }, 'The password'),
      ],
      [
        LOCAL_USER,
        USER_NAME,
        kw('password', 'Set password'),
        kw('cipher', 'Cipher text'),
        arg('password', { kind: 'word', max: 128 }, 'The password'),
      ],
    ],
    // El texto de la contraseña se descarta aquí mismo: solo cuenta que existe.
    build: (m, ctx) =>
      upsertUser(ctx, m.args['name'] ?? '', (meta) => ({ meta, hasPassword: true })),
  },
  {
    views: ['aaa'],
    forms: [
      [
        LOCAL_USER,
        USER_NAME,
        kw('privilege', 'Set admin user privilege'),
        kw('level', 'Set admin user privilege level'),
        arg('level', { kind: 'int', min: 0, max: 15 }, 'Level value'),
      ],
    ],
    build: (m, ctx) => {
      const level = Number(m.args['level']);
      return upsertUser(ctx, m.args['name'] ?? '', (meta) => ({
        meta: { ...meta, level },
        group: groupForLevel(level),
      }));
    },
  },
  {
    views: ['aaa'],
    forms: serviceTypeForms(),
    build: (m, ctx) => {
      // Se guardan en el orden fijo de VRP, no en el tecleado.
      const services = SERVICE_WORDS.filter((w) => m.has(w));
      return upsertUser(ctx, m.args['name'] ?? '', (meta) => ({ meta: { ...meta, services } }));
    },
  },
  {
    views: ['aaa'],
    forms: [[UNDO, LOCAL_USER, USER_NAME]],
    build: (m, ctx) => {
      const name = m.args['name'] ?? '';
      const user = userByName(ctx.device, name);
      if (!user) return fault('user-not-exist');
      if (user.name === ctx.session.user) return fault('user-online');
      return config([{ op: 'remove', coll: 'users', id: user.id }]);
    },
  },
  {
    views: ALL_VIEWS,
    forms: [
      [DISPLAY, kw('local-user', 'Display local user information')],
      [
        DISPLAY,
        kw('telnet', 'Telnet'),
        kw('server', 'Server'),
        kw('status', 'Display the status of the Telnet server'),
      ],
    ],
    build: (m) =>
      intent({
        kind: 'show',
        view: {
          kind: 'display',
          what: m.has('local-user') ? 'local-user' : 'telnet server status',
        },
      }),
  },
];

// ── Display y configuración ─────────────────────────────────────────────────

const RULER = `  ${'-'.repeat(76)}`;

function displayLocalUser(ctx: CmdCtx): string {
  const users = ctx.device.config.system.users;
  const rows = users.map((u) => {
    const mask =
      SERVICE_TYPES.filter(([word]) => metaOf(u).services.includes(word))
        .map(([, letter]) => letter)
        .join('') || '-';
    const level = levelOf(u);
    return `  ${u.name.padEnd(31)}${(u.disabled ? 'B' : 'A').padEnd(7)}${mask.padEnd(10)}${level === undefined ? '-' : level}`;
  });
  return [
    RULER,
    `  ${'User-name'.padEnd(31)}${'State'.padEnd(7)}${'AuthMask'.padEnd(10)}AdminLevel`,
    RULER,
    ...rows,
    RULER,
    `  Total ${users.length} user(s)`,
  ].join('\n');
}

const serviceOf = (device: Device, name: ServiceName): MgmtService | undefined =>
  device.config.services.find((s) => s.name === name);

const isOn = (service: MgmtService | undefined) => service !== undefined && !service.disabled;

function displayTelnetStatus(ctx: CmdCtx): string {
  const telnet = serviceOf(ctx.device, 'telnet');
  const state = isOn(telnet) ? 'Enable' : 'Disable';
  return [
    ` ${'TELNET IPV4 server'.padEnd(41)}:${state}`,
    ` ${'TELNET IPV6 server'.padEnd(41)}:${state}`,
    ` ${'TELNET server port'.padEnd(41)}:${telnet?.port ?? 23}`,
  ].join('\n');
}

function aaaBlock(device: Device): string[] {
  const lines = ['aaa'];
  for (const u of device.config.system.users) {
    if (u.hasPassword) {
      lines.push(` local-user ${u.name} password irreversible-cipher ${PASSWORD_PLACEHOLDER}`);
    }
    const level = levelOf(u);
    if (level !== undefined) lines.push(` local-user ${u.name} privilege level ${level}`);
    const services = metaOf(u).services;
    if (services.length > 0) lines.push(` local-user ${u.name} service-type ${services.join(' ')}`);
  }
  return lines;
}

/** `aaa` en el 60; los servidores Telnet y STelnet al final, en el 210. */
function blocks(device: Device): readonly ConfigBlock[] {
  const services: string[] = [];
  if (isOn(serviceOf(device, 'telnet'))) services.push(' telnet server enable');
  if (isOn(serviceOf(device, 'ssh'))) services.push(' stelnet server enable');
  return [
    { order: 60, lines: aaaBlock(device) },
    { order: 210, lines: services },
  ];
}

const viewBlock = (device: Device, view: View): readonly string[] | null =>
  view.kind === 'aaa' ? aaaBlock(device) : null;

export const AAA_AREA: Area = {
  commands,
  displays: {
    'local-user': (ctx) => displayLocalUser(ctx),
    'telnet server status': (ctx) => displayTelnetStatus(ctx),
  },
  blocks,
  viewBlock,
  messages: {
    'user-not-exist': 'Error: The user does not exist.',
    'user-online': 'Error: The user is online and cannot be deleted.',
  },
};
