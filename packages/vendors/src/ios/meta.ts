/**
 * Ajustes propios de IOS que el modelo neutral no tiene dónde guardar: el
 * `enable secret`, el dominio (`ip domain-name`), las claves RSA, la versión de
 * SSH y la configuración de las líneas vty y de consola.
 *
 * Se guardan en el comentario del servicio neutral `ssh` como `ios {json}`
 * (solo lo que no es de fábrica). Es el mismo recurso que usa el driver de VRP
 * para el nivel de los usuarios: el comentario viaja con la configuración, así
 * que `write memory` lo guarda y `configMatches` lo compara. Las contraseñas
 * nunca se guardan (D-012): solo si existen.
 *
 * Alternativa descartada: campos nuevos en el núcleo que ningún otro driver
 * usaría y que no cambian la simulación por sí mismos. Lo que sí la cambia
 * (si Telnet y SSH responden) se traduce a los servicios neutrales en la
 * reconciliación de commands/aaa.ts.
 */
import type { Device, MgmtService, Op } from '@nos/core';

export type LineProto = 'telnet' | 'ssh';

export interface LineMeta {
  /** `transport input`: protocolos admitidos. */
  readonly transport: readonly LineProto[];
  /** Si `transport input` se escribió (si no, vale el de fábrica y no se imprime). */
  readonly transportSet: boolean;
  /** `login` (contraseña de la línea), `login local` (usuarios) o `no login`. */
  readonly login: 'none' | 'line' | 'local';
  /** `password` en la línea. */
  readonly password: boolean;
  /** `exec-timeout` en minutos y segundos, si no es el de fábrica. */
  readonly execTimeout?: readonly [number, number];
  readonly loggingSync: boolean;
}

export interface IosMeta {
  readonly enable?: 'secret' | 'password';
  readonly domain?: string;
  readonly domainLookup: boolean;
  readonly rsaBits?: number;
  readonly sshVersion?: 2;
  readonly passwordEncryption: boolean;
  readonly vty: LineMeta;
  readonly con: LineMeta;
}

/** Líneas vty de fábrica: Telnet y SSH admitidos, `login` y sin contraseña. */
export const DEFAULT_VTY: LineMeta = {
  transport: ['telnet', 'ssh'],
  transportSet: false,
  login: 'line',
  password: false,
  loggingSync: false,
};

export const DEFAULT_CON: LineMeta = {
  transport: [],
  transportSet: false,
  login: 'none',
  password: false,
  loggingSync: false,
};

export const DEFAULT_META: IosMeta = {
  domainLookup: true,
  passwordEncryption: false,
  vty: DEFAULT_VTY,
  con: DEFAULT_CON,
};

const TAG = 'ios ';

const carrier = (device: Device): MgmtService | undefined =>
  device.config.services.find((s) => s.name === 'ssh');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLine(raw: unknown, base: LineMeta): LineMeta {
  if (!isRecord(raw)) return base;
  const transport = Array.isArray(raw['transport'])
    ? raw['transport'].filter((p): p is LineProto => p === 'telnet' || p === 'ssh')
    : base.transport;
  const login = raw['login'];
  const timeout = raw['execTimeout'];
  return {
    transport,
    transportSet: raw['transportSet'] === true,
    login: login === 'none' || login === 'line' || login === 'local' ? login : base.login,
    password: raw['password'] === true,
    loggingSync: raw['loggingSync'] === true,
    ...(Array.isArray(timeout) && timeout.length === 2
      ? { execTimeout: [Number(timeout[0]), Number(timeout[1])] as const }
      : {}),
  };
}

export function metaOf(device: Device): IosMeta {
  const comment = carrier(device)?.comment ?? '';
  if (!comment.startsWith(TAG)) return DEFAULT_META;
  let raw: unknown;
  try {
    raw = JSON.parse(comment.slice(TAG.length));
  } catch {
    return DEFAULT_META;
  }
  if (!isRecord(raw)) return DEFAULT_META;
  const enable = raw['enable'];
  return {
    ...(enable === 'secret' || enable === 'password' ? { enable } : {}),
    ...(typeof raw['domain'] === 'string' ? { domain: raw['domain'] } : {}),
    ...(typeof raw['rsaBits'] === 'number' ? { rsaBits: raw['rsaBits'] } : {}),
    ...(raw['sshVersion'] === 2 ? { sshVersion: 2 as const } : {}),
    domainLookup: raw['domainLookup'] !== false,
    passwordEncryption: raw['passwordEncryption'] === true,
    vty: readLine(raw['vty'], DEFAULT_VTY),
    con: readLine(raw['con'], DEFAULT_CON),
  };
}

const sameLine = (a: LineMeta, b: LineMeta): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Texto del comentario: solo lo que no es de fábrica; undefined si todo lo es. */
function encode(meta: IosMeta): string | undefined {
  const out: Record<string, unknown> = {};
  if (meta.enable) out['enable'] = meta.enable;
  if (meta.domain !== undefined) out['domain'] = meta.domain;
  if (!meta.domainLookup) out['domainLookup'] = false;
  if (meta.rsaBits !== undefined) out['rsaBits'] = meta.rsaBits;
  if (meta.sshVersion !== undefined) out['sshVersion'] = meta.sshVersion;
  if (meta.passwordEncryption) out['passwordEncryption'] = true;
  if (!sameLine(meta.vty, DEFAULT_VTY)) out['vty'] = meta.vty;
  if (!sameLine(meta.con, DEFAULT_CON)) out['con'] = meta.con;
  return Object.keys(out).length === 0 ? undefined : `${TAG}${JSON.stringify(out)}`;
}

/** Operaciones que dejan los ajustes como `change` diga; ninguna si no cambia nada. */
export function metaOps(device: Device, change: (meta: IosMeta) => IosMeta): Op[] {
  const current = metaOf(device);
  const next = change(current);
  const comment = encode(next);
  if (comment === encode(current)) return [];
  const service = carrier(device);
  if (!service) {
    return [
      {
        op: 'add',
        coll: 'services',
        item: {
          name: 'ssh',
          port: 22,
          allowedFrom: [],
          disabled: true,
          ...(comment === undefined ? {} : { comment }),
        },
      },
    ];
  }
  return [
    {
      op: 'set',
      coll: 'services',
      id: service.id,
      patch: comment === undefined ? {} : { comment },
      ...(comment === undefined ? { unset: ['comment'] } : {}),
    },
  ];
}
