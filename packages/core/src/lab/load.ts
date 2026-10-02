/**
 * Carga un lab: crea los dispositivos con su plataforma, aplica la
 * configuración de hosts e Internet, conecta los cables, ejecuta los scripts de
 * arranque con el driver del fabricante (inyectado) y resuelve los predicados.
 */
import { BOARDS } from '../device/boards';
import { createDevice } from '../device/factory';
import { BUILTIN_PLATFORMS, type PlatformSpec } from '../device/platform';
import { converge } from '../engine/converge';
import { type DeviceId, deviceId, type ItemId, simTime } from '../model/brand';
import type { DeviceConfig } from '../model/config';
import { interfaceByName } from '../model/lookup';
import type {
  Device,
  Flow,
  InternetEmulation,
  Link,
  Network,
  OsId,
  PortRef,
} from '../model/network';
import { err, ok, type Result } from '../model/result';
import { ipv4, networkOf, parseIpv4, prefix, range } from '../net/ipv4';
import { applyOps, type Op } from '../ops/apply';
import { type EvalContext, evaluate } from '../validate/evaluate';
import type {
  CountCmp,
  CountOp,
  IfRef,
  Matcher,
  Predicate,
  Target,
  WhereClause,
} from '../validate/predicates';
import type { AuthoringMatcher, AuthoringPredicate, LabDefinition, LabDevice } from './schema';

export type StartupRunner = (device: Device, script: string) => Result<Device, string>;

export interface LabEnvironment {
  /** Plataformas de fabricante; `host` e `internet` vienen incluidas. */
  readonly platforms: Readonly<Partial<Record<OsId, PlatformSpec>>>;
  /** Ejecuta un script de arranque con el driver del fabricante. */
  readonly runStartup?: StartupRunner;
}

export type LabLoadError =
  | { readonly code: 'unknown-platform'; readonly device: string; readonly os: OsId }
  | { readonly code: 'unknown-board'; readonly device: string; readonly board: string }
  | { readonly code: 'unknown-port'; readonly port: string }
  | { readonly code: 'port-in-use'; readonly port: string }
  | { readonly code: 'unknown-device'; readonly ref: string }
  | { readonly code: 'unknown-host'; readonly name: string }
  | { readonly code: 'no-startup-runner'; readonly device: string }
  | { readonly code: 'startup-failed'; readonly device: string; readonly detail: string }
  | { readonly code: 'setup-failed'; readonly device: string; readonly detail: string };

export interface ObjectiveCheck {
  readonly id: string;
  readonly check: Predicate;
}

export interface LabRuntime {
  readonly lab: LabDefinition;
  readonly net: Network;
  readonly startup: ReadonlyMap<DeviceId, DeviceConfig>;
  readonly objectives: readonly ObjectiveCheck[];
}

// ── Configuración neutral de hosts e Internet ───────────────────────────────

function firstIface(device: Device): ItemId | undefined {
  return device.config.interfaces[0]?.id;
}

function hostOps(device: Device, setup: NonNullable<LabDevice['host']>): Op[] {
  const iface = firstIface(device);
  if (iface === undefined) return [];
  const ops: Op[] = [];
  if (setup.wifi) {
    ops.push({
      op: 'set',
      coll: 'interfaces',
      id: iface,
      patch: {
        disabled: false,
        mode: 'station',
        ssid: setup.wifi.ssid,
        security:
          setup.wifi.passphrase === undefined
            ? { auth: ['open'] }
            : { auth: ['wpa2-psk'], passphrase: setup.wifi.passphrase },
      },
    });
  }
  if (setup.ip === 'dhcp') {
    ops.push({
      op: 'add',
      coll: 'dhcpClients',
      item: { iface, addDefaultRoute: true, routeDistance: 1, usePeerDns: true, disabled: false },
    });
  } else if (setup.ip !== undefined) {
    ops.push({
      op: 'add',
      coll: 'addresses',
      item: { iface, address: prefix(setup.ip), disabled: false },
    });
  }
  if (setup.gateway !== undefined) {
    ops.push({
      op: 'add',
      coll: 'routes',
      item: {
        dst: prefix('0.0.0.0/0'),
        gateway: { kind: 'ip', ip: ipv4(setup.gateway) },
        distance: 1,
        table: 'main',
        disabled: false,
      },
    });
  }
  if (setup.dns)
    ops.push({ op: 'setSingleton', key: 'dns', patch: { servers: setup.dns.map(ipv4) } });
  for (const s of setup.services ?? []) {
    ops.push({
      op: 'add',
      coll: 'services',
      item: { name: s.name, port: s.port, allowedFrom: [], disabled: false },
    });
  }
  return ops;
}

function internetOps(device: Device, setup: NonNullable<LabDevice['internet']>): Op[] {
  const iface = firstIface(device);
  if (iface === undefined) return [];
  const address = prefix(setup.address);
  const ops: Op[] = [];
  if (setup.dhcp) {
    // El pool va primero para que su id sea el siguiente libre del dispositivo.
    const poolId = device.nextId as ItemId;
    ops.push(
      {
        op: 'add',
        coll: 'pools',
        item: { name: 'isp', ranges: [range(setup.dhcp.pool)], disabled: false },
      },
      {
        op: 'add',
        coll: 'dhcpServers',
        item: {
          name: 'isp',
          iface,
          pool: poolId,
          leaseTimeS: 86400,
          authoritative: true,
          disabled: false,
        },
      },
      {
        op: 'add',
        coll: 'dhcpNetworks',
        item: {
          prefix: networkOf(address),
          gateway: address.ip,
          dnsServers: (setup.dhcp.dns ?? []).map(ipv4),
          disabled: false,
        },
      },
    );
  }
  ops.push({ op: 'add', coll: 'addresses', item: { iface, address, disabled: false } });
  return ops;
}

// ── Predicados ──────────────────────────────────────────────────────────────

function ifRef(net: Network, device: string, name: string): IfRef {
  const d = net.devices.find((x) => x.id === device);
  const iface = d && interfaceByName(d.config, name);
  return iface ? { id: iface.id } : { name };
}

function target(text: string): Target {
  const ip = parseIpv4(text);
  return ip === null ? { device: deviceId(text) } : { ip };
}

function count(value: string | number | undefined): CountCmp {
  if (value === undefined) return { op: '>=', n: 1 };
  if (typeof value === 'number') return { op: '==', n: value };
  const match = /^(>=|<=|==|>|<)\s*(\d+)$/.exec(value);
  return { op: (match?.[1] ?? '>=') as CountOp, n: Number(match?.[2] ?? 1) };
}

function matcher(net: Network, device: string, m: AuthoringMatcher): Matcher {
  if (typeof m !== 'object') return { eq: m };
  if ('ip' in m) return { ip: ipv4(m.ip) };
  if ('prefix' in m) return { prefix: prefix(m.prefix) };
  if ('within' in m) return { within: prefix(m.within) };
  if ('iface' in m) return { iface: ifRef(net, device, m.iface) };
  if ('exists' in m) return { exists: m.exists };
  const inc = m.includes;
  if (typeof inc !== 'object') return { includes: inc };
  return 'ip' in inc
    ? { includes: { ip: ipv4(inc.ip) } }
    : { includes: { iface: ifRef(net, device, inc.iface) } };
}

const flow = (f: {
  from: string;
  to: string;
  protocol?: 'icmp' | 'tcp' | 'udp' | undefined;
  port?: number | undefined;
}) => ({
  from: deviceId(f.from),
  to: target(f.to),
  protocol: f.protocol ?? 'icmp',
  ...(f.port === undefined ? {} : { port: f.port }),
});

export function resolvePredicate(net: Network, p: AuthoringPredicate): Predicate {
  if ('all' in p) return { kind: 'all', of: p.all.map((x) => resolvePredicate(net, x)) };
  if ('any' in p) return { kind: 'any', of: p.any.map((x) => resolvePredicate(net, x)) };
  if ('not' in p) return { kind: 'not', of: resolvePredicate(net, p.not) };
  if ('hasAddress' in p) {
    const h = p.hasAddress;
    return {
      kind: 'hasAddress',
      device: deviceId(h.device),
      iface: ifRef(net, h.device, h.iface),
      ...(h.prefix === undefined ? {} : { prefix: prefix(h.prefix) }),
      ...(h.within === undefined ? {} : { within: prefix(h.within) }),
    };
  }
  if ('routeActive' in p) {
    const r = p.routeActive;
    const base = { kind: 'routeActive' as const, device: deviceId(r.device), dst: prefix(r.dst) };
    if (r.via === undefined) return base;
    const ip = parseIpv4(r.via);
    return { ...base, via: ip === null ? { iface: ifRef(net, r.device, r.via) } : { ip } };
  }
  if ('reachable' in p) return { kind: 'reachable', ...flow(p.reachable) };
  if ('blocked' in p)
    return { kind: 'blocked', by: p.blocked.by ?? 'firewall', ...flow(p.blocked) };
  if ('natSourceIs' in p) {
    const e = p.natSourceIs.expect;
    let expect: (Predicate & { kind: 'natSourceIs' })['expect'];
    if (typeof e === 'string') {
      expect = { ip: ipv4(e) };
    } else {
      const [dev = '', name = ''] = e.addressOf.split(/:(.*)/s);
      expect = { addressOf: { device: deviceId(dev), iface: ifRef(net, dev, name) } };
    }
    return { kind: 'natSourceIs', expect, ...flow(p.natSourceIs) };
  }
  if ('leaseBound' in p) {
    const l = p.leaseBound;
    return {
      kind: 'leaseBound',
      server: deviceId(l.server),
      client: deviceId(l.client),
      ...(l.within === undefined ? {} : { within: prefix(l.within) }),
    };
  }
  if ('wifiAssociated' in p) {
    const w = p.wifiAssociated;
    return {
      kind: 'wifiAssociated',
      client: deviceId(w.client),
      ap: deviceId(w.ap),
      ...(w.ssid === undefined ? {} : { ssid: w.ssid }),
    };
  }
  if ('resolves' in p) {
    const r = p.resolves;
    return {
      kind: 'resolves',
      from: deviceId(r.from),
      name: r.name,
      ...(r.to === undefined ? {} : { to: ipv4(r.to) }),
      ...(r.via === undefined ? {} : { via: deviceId(r.via) }),
    };
  }
  if ('fileExists' in p) {
    const f = p.fileExists;
    return {
      kind: 'fileExists',
      device: deviceId(f.device),
      type: f.type,
      ...(f.name === undefined ? {} : { name: f.name }),
    };
  }
  if ('configMatches' in p) {
    const c = p.configMatches;
    return {
      kind: 'configMatches',
      device: deviceId(c.device),
      snapshot: c.snapshot,
      ...(c.scope === undefined ? {} : { scope: c.scope }),
    };
  }
  if ('exists' in p) {
    const x = p.exists;
    const where: WhereClause[] = Object.entries(x.where ?? {}).map(([path, m]) => ({
      path: path.split('.'),
      match: matcher(net, x.device, m),
    }));
    return {
      kind: 'exists',
      device: deviceId(x.device),
      coll: x.collection,
      where,
      count: count(x.count),
    };
  }
  if ('setting' in p) {
    const s = p.setting;
    return {
      kind: 'setting',
      device: deviceId(s.device),
      key: s.key,
      path: s.field.split('.'),
      match: matcher(net, s.device, s.is),
    };
  }
  if ('interfaceRunning' in p) {
    const i = p.interfaceRunning;
    return {
      kind: 'interfaceRunning',
      device: deviceId(i.device),
      iface: ifRef(net, i.device, i.iface),
    };
  }
  return {
    kind: 'neighborSeen',
    device: deviceId(p.neighborSeen.device),
    peer: deviceId(p.neighborSeen.peer),
  };
}

// ── Carga ───────────────────────────────────────────────────────────────────

function parsePort(spec: string): { device: string; iface: string } {
  const index = spec.indexOf(':');
  return { device: spec.slice(0, index), iface: spec.slice(index + 1) };
}

export function loadLab(lab: LabDefinition, env: LabEnvironment): Result<LabRuntime, LabLoadError> {
  const platforms: Partial<Record<OsId, PlatformSpec>> = { ...BUILTIN_PLATFORMS, ...env.platforms };
  let devices: Device[] = [];

  for (const spec of lab.topology.devices) {
    const platform = platforms[spec.os];
    if (!platform) return err({ code: 'unknown-platform', device: spec.id, os: spec.os });
    const hardware = BOARDS[spec.board];
    if (!hardware) return err({ code: 'unknown-board', device: spec.id, board: spec.board });
    const created = createDevice(deviceId(spec.id), hardware, platform);
    if (!created.ok)
      return err({ code: 'setup-failed', device: spec.id, detail: JSON.stringify(created.error) });
    let device = created.value;
    const ops = spec.host
      ? hostOps(device, spec.host)
      : spec.internet
        ? internetOps(device, spec.internet)
        : [];
    const applied = applyOps(device, ops);
    if (!applied.ok)
      return err({ code: 'setup-failed', device: spec.id, detail: JSON.stringify(applied.error) });
    device = applied.value.device;
    devices.push(device);
  }

  // Los cables se conectan por nombre de fábrica, antes de que un script pueda renombrar.
  const links: Link[] = [];
  const used = new Set<string>();
  for (const [a, b] of lab.topology.links) {
    const ends: PortRef[] = [];
    for (const spec of [a, b]) {
      const { device, iface } = parsePort(spec);
      const d = devices.find((x) => x.id === device);
      const found = d && interfaceByName(d.config, iface);
      if (!d || !found || found.kind !== 'ethernet')
        return err({ code: 'unknown-port', port: spec });
      if (used.has(spec)) return err({ code: 'port-in-use', port: spec });
      used.add(spec);
      ends.push({ device: d.id, iface: found.id });
    }
    const [endA, endB] = ends as [PortRef, PortRef];
    links.push({ id: `${a}<->${b}`, a: endA, b: endB, up: true });
  }

  for (const spec of lab.topology.devices) {
    if (spec.startup === undefined || spec.startup.trim() === '') continue;
    if (!env.runStartup) return err({ code: 'no-startup-runner', device: spec.id });
    const current = devices.find((d) => d.id === spec.id);
    if (!current) continue;
    const ran = env.runStartup(current, spec.startup);
    if (!ran.ok) return err({ code: 'startup-failed', device: spec.id, detail: ran.error });
    devices = devices.map((d) => (d.id === spec.id ? ran.value : d));
  }

  const internetSpec = lab.topology.devices.find((d) => d.internet);
  const internet: InternetEmulation | undefined = internetSpec?.internet && {
    device: deviceId(internetSpec.id),
    answers: (internetSpec.internet.answers ?? ['0.0.0.0/0']).map(prefix),
    tcpPorts: internetSpec.internet.tcpPorts ?? [80, 443],
    dns: Object.entries(internetSpec.internet.dns ?? {}).map(([name, address]) => ({
      name,
      address: ipv4(address),
    })),
  };

  const flows: Flow[] = [];
  for (const f of lab.topology.flows) {
    const ip =
      parseIpv4(f.to) ??
      internet?.dns.find((r) => r.name.toLowerCase() === f.to.toLowerCase())?.address;
    if (ip === undefined) return err({ code: 'unknown-host', name: f.to });
    flows.push({
      id: f.id,
      from: deviceId(f.from),
      to: ip,
      protocol: f.protocol,
      ...(f.port === undefined ? {} : { dstPort: f.port }),
      bps: f.bps,
      replyBps: f.replyBps ?? 0,
    });
  }

  const net = converge({
    devices,
    links,
    scenario: { flows, ...(internet ? { internet } : {}) },
    now: simTime(0),
  });

  return ok({
    lab,
    net,
    startup: new Map(net.devices.map((d) => [d.id, d.config])),
    objectives: lab.objectives.map((o) => ({ id: o.id, check: resolvePredicate(net, o.check) })),
  });
}

/** Estado de cada objetivo para una red dada (por defecto, la del arranque). */
export function evaluateObjectives(
  runtime: LabRuntime,
  net: Network = runtime.net,
): ReadonlyMap<string, boolean> {
  const ctx: EvalContext = { net, startup: runtime.startup };
  return new Map(runtime.objectives.map((o) => [o.id, evaluate(o.check, ctx)]));
}
