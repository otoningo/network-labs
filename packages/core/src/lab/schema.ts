/**
 * Esquema de un lab tal como se escribe en YAML (ver D-016 en DECISIONES.md).
 * Los textos visibles son bilingües en el mismo archivo. Los predicados usan
 * nombres legibles; el cargador los resuelve a ids.
 */
import { z } from 'zod';
import { BOARDS } from '../device/boards';
import { COLLECTION_KEYS, type CollectionKey, type SingletonKey } from '../model/collections';
import { parseIpv4, parsePrefix, parseRange } from '../net/ipv4';

const OS_IDS = ['routeros', 'vrp', 'vyos', 'ios', 'host', 'internet'] as const;
export const VENDOR_OS = ['routeros', 'vrp', 'vyos', 'ios'] as const;
const SINGLETON_KEYS = ['system', 'dns', 'discovery'] as const satisfies readonly SingletonKey[];

const Name = z.string().min(1);
const DeviceRef = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,23}$/, { error: 'id de dispositivo inválido' });
const IpStr = z.string().refine((s) => parseIpv4(s) !== null, { error: 'IPv4 inválida' });
const PrefixStr = z.string().refine((s) => s.includes('/') && parsePrefix(s) !== null, {
  error: 'prefijo inválido (se espera a.b.c.d/len)',
});
const RangeStr = z.string().refine((s) => parseRange(s) !== null, { error: 'rango inválido' });
const PortStr = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]*:.+$/, { error: 'se espera DISPOSITIVO:interfaz' });
const Port = z.number().int().min(1).max(65535);
const Protocol = z.enum(['icmp', 'tcp', 'udp']);
const Collection = z.enum(COLLECTION_KEYS as [CollectionKey, ...CollectionKey[]]);
const Count = z.union([
  z.number().int().min(0),
  z.string().regex(/^(>=|<=|==|>|<)\s*\d+$/, { error: 'conteo inválido (ej. ">=1")' }),
]);

export const Localized = z.strictObject({ es: Name, en: Name });
export type LocalizedText = z.infer<typeof Localized>;

// ── Predicados ──────────────────────────────────────────────────────────────

export type AuthoringMatcher =
  | string
  | number
  | boolean
  | { ip: string }
  | { prefix: string }
  | { within: string }
  | { iface: string }
  | { includes: string | number | { ip: string } | { iface: string } }
  | { exists: boolean };

const Matcher: z.ZodType<AuthoringMatcher> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.strictObject({ ip: IpStr }),
  z.strictObject({ prefix: PrefixStr }),
  z.strictObject({ within: PrefixStr }),
  z.strictObject({ iface: Name }),
  z.strictObject({
    includes: z.union([
      z.string(),
      z.number(),
      z.strictObject({ ip: IpStr }),
      z.strictObject({ iface: Name }),
    ]),
  }),
  z.strictObject({ exists: z.boolean() }),
]);

interface AuthoringFlow {
  from: string;
  to: string;
  protocol?: 'icmp' | 'tcp' | 'udp' | undefined;
  port?: number | undefined;
}

export type AuthoringPredicate =
  | { all: AuthoringPredicate[] }
  | { any: AuthoringPredicate[] }
  | { not: AuthoringPredicate }
  | {
      hasAddress: {
        device: string;
        iface: string;
        prefix?: string | undefined;
        within?: string | undefined;
      };
    }
  | { routeActive: { device: string; dst: string; via?: string | undefined } }
  | { reachable: AuthoringFlow }
  | { blocked: AuthoringFlow & { by?: 'firewall' | 'any' | undefined } }
  | { natSourceIs: AuthoringFlow & { expect: string | { addressOf: string } } }
  | { leaseBound: { server: string; client: string; within?: string | undefined } }
  | { wifiAssociated: { client: string; ap: string; ssid?: string | undefined } }
  | { resolves: { from: string; name: string; to?: string | undefined; via?: string | undefined } }
  | { fileExists: { device: string; type: 'backup' | 'script'; name?: string | undefined } }
  | {
      configMatches: {
        device: string;
        snapshot: 'startup' | { file: string };
        scope?: CollectionKey[] | undefined;
      };
    }
  | {
      exists: {
        device: string;
        collection: CollectionKey;
        where?: Record<string, AuthoringMatcher> | undefined;
        count?: string | number | undefined;
      };
    }
  | { setting: { device: string; key: SingletonKey; field: string; is: AuthoringMatcher } }
  | { interfaceRunning: { device: string; iface: string } }
  | { neighborSeen: { device: string; peer: string } };

const Flow = {
  from: DeviceRef,
  to: Name,
  protocol: Protocol.optional(),
  port: Port.optional(),
};

export const PredicateSchema: z.ZodType<AuthoringPredicate> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(PredicateSchema).min(1) }),
    z.strictObject({ any: z.array(PredicateSchema).min(1) }),
    z.strictObject({ not: PredicateSchema }),
    z.strictObject({
      hasAddress: z.strictObject({
        device: DeviceRef,
        iface: Name,
        prefix: PrefixStr.optional(),
        within: PrefixStr.optional(),
      }),
    }),
    z.strictObject({
      routeActive: z.strictObject({ device: DeviceRef, dst: PrefixStr, via: Name.optional() }),
    }),
    z.strictObject({ reachable: z.strictObject(Flow) }),
    z.strictObject({
      blocked: z.strictObject({ ...Flow, by: z.enum(['firewall', 'any']).optional() }),
    }),
    z.strictObject({
      natSourceIs: z.strictObject({
        ...Flow,
        expect: z.union([IpStr, z.strictObject({ addressOf: PortStr })]),
      }),
    }),
    z.strictObject({
      leaseBound: z.strictObject({
        server: DeviceRef,
        client: DeviceRef,
        within: PrefixStr.optional(),
      }),
    }),
    z.strictObject({
      wifiAssociated: z.strictObject({ client: DeviceRef, ap: DeviceRef, ssid: Name.optional() }),
    }),
    z.strictObject({
      resolves: z.strictObject({
        from: DeviceRef,
        name: Name,
        to: IpStr.optional(),
        via: DeviceRef.optional(),
      }),
    }),
    z.strictObject({
      fileExists: z.strictObject({
        device: DeviceRef,
        type: z.enum(['backup', 'script']),
        name: Name.optional(),
      }),
    }),
    z.strictObject({
      configMatches: z.strictObject({
        device: DeviceRef,
        snapshot: z.union([z.literal('startup'), z.strictObject({ file: Name })]),
        scope: z.array(Collection).optional(),
      }),
    }),
    z.strictObject({
      exists: z.strictObject({
        device: DeviceRef,
        collection: Collection,
        where: z.record(z.string(), Matcher).optional(),
        count: Count.optional(),
      }),
    }),
    z.strictObject({
      setting: z.strictObject({
        device: DeviceRef,
        key: z.enum(SINGLETON_KEYS),
        field: Name,
        is: Matcher,
      }),
    }),
    z.strictObject({ interfaceRunning: z.strictObject({ device: DeviceRef, iface: Name }) }),
    z.strictObject({ neighborSeen: z.strictObject({ device: DeviceRef, peer: DeviceRef }) }),
  ]),
);

// ── Topología ───────────────────────────────────────────────────────────────

const HostSetup = z.strictObject({
  ip: z.union([z.literal('dhcp'), PrefixStr]).optional(),
  gateway: IpStr.optional(),
  dns: z.array(IpStr).optional(),
  services: z
    .array(z.strictObject({ name: z.enum(['ssh', 'telnet', 'http', 'https']), port: Port }))
    .optional(),
  wifi: z.strictObject({ ssid: Name, passphrase: z.string().min(8).max(63).optional() }).optional(),
});

const InternetSetup = z.strictObject({
  address: PrefixStr,
  dhcp: z.strictObject({ pool: RangeStr, dns: z.array(IpStr).optional() }).optional(),
  answers: z.array(PrefixStr).optional(),
  tcpPorts: z.array(Port).optional(),
  dns: z.record(z.string(), IpStr).optional(),
});

const DeviceSchema = z.strictObject({
  id: DeviceRef,
  os: z.enum(OS_IDS),
  board: z.string().refine((b) => b in BOARDS, { error: 'placa desconocida' }),
  label: Localized.optional(),
  position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  startup: z.string().optional(),
  host: HostSetup.optional(),
  internet: InternetSetup.optional(),
});

const FlowSchema = z.strictObject({
  id: Name,
  from: DeviceRef,
  to: Name,
  protocol: Protocol,
  port: Port.optional(),
  bps: z.number().int().min(0),
  replyBps: z.number().int().min(0).optional(),
});

const ObjectiveSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  text: Localized,
  check: PredicateSchema,
  /** De sutil a explícita. Ninguna debe ser la solución completa. */
  hints: z.array(Localized).min(1).max(4),
});

// ── Lab ─────────────────────────────────────────────────────────────────────

function deviceRefs(p: AuthoringPredicate): string[] {
  if ('all' in p) return p.all.flatMap(deviceRefs);
  if ('any' in p) return p.any.flatMap(deviceRefs);
  if ('not' in p) return deviceRefs(p.not);
  if ('hasAddress' in p) return [p.hasAddress.device];
  if ('routeActive' in p) return [p.routeActive.device];
  if ('reachable' in p) return [p.reachable.from];
  if ('blocked' in p) return [p.blocked.from];
  if ('natSourceIs' in p) {
    const e = p.natSourceIs.expect;
    return [
      p.natSourceIs.from,
      ...(typeof e === 'string' ? [] : [e.addressOf.split(':')[0] ?? '']),
    ];
  }
  if ('leaseBound' in p) return [p.leaseBound.server, p.leaseBound.client];
  if ('wifiAssociated' in p) return [p.wifiAssociated.client, p.wifiAssociated.ap];
  if ('resolves' in p) return [p.resolves.from, ...(p.resolves.via ? [p.resolves.via] : [])];
  if ('fileExists' in p) return [p.fileExists.device];
  if ('configMatches' in p) return [p.configMatches.device];
  if ('exists' in p) return [p.exists.device];
  if ('setting' in p) return [p.setting.device];
  if ('interfaceRunning' in p) return [p.interfaceRunning.device];
  return [p.neighborSeen.device, p.neighborSeen.peer];
}

export const LabSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    vendor: z.enum(VENDOR_OS),
    path: z.string().optional(),
    order: z.number().int().min(0).optional(),
    title: Localized,
    summary: Localized,
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    minutes: z.number().int().min(1).max(120),
    topology: z.strictObject({
      devices: z.array(DeviceSchema).min(1),
      links: z.array(z.tuple([PortStr, PortStr])).default([]),
      flows: z.array(FlowSchema).default([]),
    }),
    objectives: z.array(ObjectiveSchema).min(1),
    explanation: Localized,
  })
  .superRefine((lab, ctx) => {
    const ids = lab.topology.devices.map((d) => d.id);
    const known = new Set(ids);
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) issue(['topology', 'devices', i, 'id'], `id repetido: ${id}`);
    });
    lab.topology.devices.forEach((d, i) => {
      const at = ['topology', 'devices', i];
      if (d.host && d.os !== 'host')
        issue([...at, 'host'], '`host` solo aplica a equipos con os: host');
      if (d.internet && d.os !== 'internet')
        issue([...at, 'internet'], '`internet` solo aplica a os: internet');
      if (d.os === 'internet' && !d.internet)
        issue(at, 'un equipo os: internet necesita la sección `internet`');
      if (d.startup !== undefined && (d.os === 'host' || d.os === 'internet')) {
        issue([...at, 'startup'], '`startup` solo aplica a equipos de fabricante');
      }
    });
    if (lab.topology.devices.filter((d) => d.os === 'internet').length > 1) {
      issue(['topology', 'devices'], 'solo puede haber un equipo os: internet');
    }
    lab.topology.links.forEach((link, i) => {
      for (const end of link) {
        const dev = end.split(':')[0] ?? '';
        if (!known.has(dev)) issue(['topology', 'links', i], `dispositivo desconocido: ${dev}`);
      }
    });
    lab.topology.flows.forEach((f, i) => {
      if (!known.has(f.from))
        issue(['topology', 'flows', i, 'from'], `dispositivo desconocido: ${f.from}`);
    });
    const objectiveIds = lab.objectives.map((o) => o.id);
    lab.objectives.forEach((o, i) => {
      if (objectiveIds.indexOf(o.id) !== i)
        issue(['objectives', i, 'id'], `objetivo repetido: ${o.id}`);
      for (const ref of deviceRefs(o.check)) {
        if (!known.has(ref)) issue(['objectives', i, 'check'], `dispositivo desconocido: ${ref}`);
      }
    });
  });

export type LabDefinition = z.infer<typeof LabSchema>;
export type LabDevice = LabDefinition['topology']['devices'][number];

/** JSON Schema del formato, para autocompletado en editores de YAML. */
export function labJsonSchema(): unknown {
  return z.toJSONSchema(LabSchema, { unrepresentable: 'any' });
}
