/**
 * Evidencia de un predicado: lo que la red reporta hoy sobre lo que el
 * objetivo pide. Son datos neutros (sin idioma); la interfaz los redacta.
 * Sirve para mostrar, junto a la casilla, por qué una tarea se da por cumplida.
 */
import { resolveName } from '../engine/runtime';
import { addressesOf } from '../engine/trace';
import type { DeviceId } from '../model/brand';
import type { CollectionKey, SingletonKey } from '../model/collections';
import { getDevice } from '../model/lookup';
import type { Device, Network } from '../model/network';
import { formatIpv4, formatPrefix, type Ipv4 } from '../net/ipv4';
import {
  deepEqual,
  type EvalContext,
  itemsWhere,
  resolveIface,
  runFlow,
  valueAt,
} from './evaluate';
import type { FlowSpec, IfRef, Predicate, Target } from './predicates';

/** Cómo terminó un flujo: llegó, o dónde y por qué se quedó. */
export type FlowOutcome =
  | 'ok'
  | 'filtered'
  | 'no-route'
  | 'blackhole'
  | 'arp-failed'
  | 'ttl-exceeded'
  | 'port-closed'
  | 'not-forwarding'
  | 'no-source'
  | 'loop'
  | 'no-reply'
  | 'no-target';

export type Evidence =
  | {
      readonly kind: 'address';
      readonly device: string;
      readonly iface: string;
      readonly addresses: readonly string[];
    }
  | {
      readonly kind: 'route';
      readonly device: string;
      readonly dst: string;
      readonly via: string | null;
    }
  | {
      readonly kind: 'flow';
      readonly from: string;
      readonly to: string;
      readonly protocol: 'icmp' | 'tcp' | 'udp';
      readonly port: number | null;
      readonly outcome: FlowOutcome;
      /** Equipo donde terminó (si no llegó). */
      readonly at: string | null;
      /** Origen con el que llegó al destino, tras NAT. */
      readonly seenAs: string | null;
    }
  | {
      readonly kind: 'lease';
      readonly server: string;
      readonly client: string;
      readonly ip: string | null;
    }
  | {
      readonly kind: 'wifi';
      readonly client: string;
      readonly ap: string;
      readonly ssid: string | null;
    }
  | {
      readonly kind: 'resolve';
      readonly from: string;
      readonly name: string;
      readonly address: string | null;
    }
  | { readonly kind: 'file'; readonly device: string; readonly files: readonly string[] }
  | {
      readonly kind: 'config';
      readonly device: string;
      readonly snapshot: string | null;
      readonly matches: boolean;
    }
  | {
      readonly kind: 'count';
      readonly device: string;
      readonly coll: CollectionKey;
      readonly count: number;
    }
  | {
      readonly kind: 'setting';
      readonly device: string;
      readonly key: SingletonKey;
      readonly field: string;
      readonly value: string;
    }
  | {
      readonly kind: 'interface';
      readonly device: string;
      readonly iface: string;
      readonly running: boolean;
    }
  | {
      readonly kind: 'neighbor';
      readonly device: string;
      readonly peer: string;
      readonly seen: boolean;
    };

function ifaceName(device: Device | undefined, ref: IfRef): string {
  if ('name' in ref) return ref.name;
  return device?.config.interfaces.find((i) => i.id === ref.id)?.name ?? '?';
}

function targetText(net: Network, target: Target): string {
  if ('ip' in target) return formatIpv4(target.ip);
  const first = addressesOf(net, target.device)[0];
  return first ? formatIpv4(first.address.ip) : target.device;
}

function flowEvidence(net: Network, spec: FlowSpec): Evidence {
  const base = {
    kind: 'flow' as const,
    from: spec.from,
    to: targetText(net, spec.to),
    protocol: spec.protocol,
    port: spec.port ?? null,
  };
  const result = runFlow(net, spec);
  if (!result) return { ...base, outcome: 'no-target', at: null, seenAs: null };
  if (result.ok) {
    // Solo interesa el origen visto si alguien lo tradujo (NAT).
    const src = result.delivered?.src;
    const own = src !== undefined && addressesOf(net, spec.from).some((a) => a.address.ip === src);
    return {
      ...base,
      outcome: 'ok',
      at: null,
      seenAs: src === undefined || own ? null : formatIpv4(src),
    };
  }
  // Si la ida llegó pero la vuelta no, el problema está en la vuelta.
  const end = result.forward.end.kind === 'delivered' ? result.reply?.end : result.forward.end;
  if (!end || end.kind === 'delivered')
    return { ...base, outcome: 'no-reply', at: null, seenAs: null };
  return { ...base, outcome: end.kind, at: 'device' in end ? end.device : null, seenAs: null };
}

function show(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isInteger(value) && value > 0xffff)
    return formatIpv4(value as Ipv4);
  if (typeof value === 'object' && 'ip' in value && 'len' in value) {
    return formatPrefix(value as Parameters<typeof formatPrefix>[0]);
  }
  if (Array.isArray(value)) return value.map(show).join(',');
  return String(value);
}

/** Evidencia de cada hoja del predicado, en orden. `not` y los compuestos se aplanan. */
export function evidence(predicate: Predicate, ctx: EvalContext): Evidence[] {
  const { net } = ctx;
  const device = (id: DeviceId) => getDevice(net, id);

  switch (predicate.kind) {
    case 'all':
    case 'any':
      return predicate.of.flatMap((p) => evidence(p, ctx));
    case 'not':
      return evidence(predicate.of, ctx);

    case 'hasAddress': {
      const d = device(predicate.device);
      const iface = d && resolveIface(d, predicate.iface);
      const addresses = addressesOf(net, predicate.device)
        .filter((a) => a.iface === iface)
        .map((a) => formatPrefix(a.address));
      return [
        {
          kind: 'address',
          device: predicate.device,
          iface: ifaceName(d, predicate.iface),
          addresses,
        },
      ];
    }

    case 'routeActive': {
      const d = device(predicate.device);
      const route = d?.oper.rib.find(
        (r) => r.active && formatPrefix(r.dst) === formatPrefix(predicate.dst),
      );
      const via = route
        ? route.gateway !== undefined
          ? formatIpv4(route.gateway)
          : (d?.config.interfaces.find((i) => i.id === route.iface)?.name ?? null)
        : null;
      return [
        {
          kind: 'route',
          device: predicate.device,
          dst: formatPrefix(predicate.dst),
          via: route ? via : null,
        },
      ];
    }

    case 'reachable':
    case 'blocked':
    case 'natSourceIs':
      return [flowEvidence(net, predicate)];

    case 'leaseBound': {
      const lease = device(predicate.server)?.oper.dhcpLeases.find(
        (l) => l.client.device === predicate.client,
      );
      return [
        {
          kind: 'lease',
          server: predicate.server,
          client: predicate.client,
          ip: lease ? formatIpv4(lease.ip) : null,
        },
      ];
    }

    case 'wifiAssociated': {
      const ap = device(predicate.ap);
      const reg = ap?.oper.wifiRegistrations.find((r) => r.client.device === predicate.client);
      const iface = reg && ap?.config.interfaces.find((i) => i.id === reg.iface);
      const ssid = iface && iface.kind === 'wireless' ? iface.ssid : null;
      return [
        { kind: 'wifi', client: predicate.client, ap: predicate.ap, ssid: reg ? ssid : null },
      ];
    }

    case 'resolves': {
      const result = resolveName(net, predicate.from, predicate.name);
      return [
        {
          kind: 'resolve',
          from: predicate.from,
          name: predicate.name,
          address:
            result.outcome === 'answered' && result.address !== undefined
              ? formatIpv4(result.address)
              : null,
        },
      ];
    }

    case 'fileExists': {
      const files = (device(predicate.device)?.storage.files ?? [])
        .filter((f) => f.payload.kind === predicate.type)
        .map((f) => f.name);
      return [{ kind: 'file', device: predicate.device, files }];
    }

    case 'configMatches': {
      const d = device(predicate.device);
      const snapshot = predicate.snapshot === 'startup' ? null : predicate.snapshot.file;
      let matches = false;
      if (d) {
        const file =
          snapshot === null ? undefined : d.storage.files.find((f) => f.name === snapshot);
        const reference =
          snapshot === null
            ? ctx.startup.get(d.id)
            : file?.payload.kind === 'backup'
              ? file.payload.config
              : undefined;
        matches = reference !== undefined && deepEqual(d.config, reference);
      }
      return [{ kind: 'config', device: predicate.device, snapshot, matches }];
    }

    case 'exists': {
      const d = device(predicate.device);
      const count = d ? itemsWhere(d, predicate.coll, predicate.where) : 0;
      return [{ kind: 'count', device: predicate.device, coll: predicate.coll, count }];
    }

    case 'setting': {
      const d = device(predicate.device);
      const values = d && {
        system: d.config.system,
        dns: d.config.dns,
        discovery: d.config.discovery,
        l2Access: d.config.l2Access,
      };
      const value = values ? valueAt(values[predicate.key], predicate.path) : undefined;
      return [
        {
          kind: 'setting',
          device: predicate.device,
          key: predicate.key,
          field: predicate.path.join('.'),
          value: show(value),
        },
      ];
    }

    case 'interfaceRunning': {
      const d = device(predicate.device);
      const iface = d && resolveIface(d, predicate.iface);
      const running = d?.oper.interfaces.some((i) => i.iface === iface && i.running) ?? false;
      return [
        {
          kind: 'interface',
          device: predicate.device,
          iface: ifaceName(d, predicate.iface),
          running,
        },
      ];
    }

    case 'neighborSeen': {
      const seen = (device(predicate.device)?.oper.neighbors ?? []).some(
        (n) => n.peer === predicate.peer,
      );
      return [{ kind: 'neighbor', device: predicate.device, peer: predicate.peer, seen }];
    }
  }
}
