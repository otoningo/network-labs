/**
 * Tabla de rutas (RIB): rutas conectadas, estáticas y las que instala un cliente
 * DHCP. Por cada destino gana la de menor distancia entre las alcanzables.
 *
 * El gateway de una ruta se resuelve solo contra rutas conectadas, que es el
 * comportamiento por defecto de la mayoría de sistemas sin ajustar alcances.
 */
import type { ItemId } from '../model/brand';
import type { StaticRoute } from '../model/config';
import type { RibEntry } from '../model/oper';
import { formatPrefix, type Ipv4, type Ipv4Prefix, networkOf, prefixContains } from '../net/ipv4';

export interface IfaceAddress {
  readonly iface: ItemId;
  readonly address: Ipv4Prefix;
  /** Dirección configurada o, si es dinámica, el cliente DHCP que la obtuvo. */
  readonly source: ItemId;
  readonly dynamic: boolean;
}

export interface DhcpRoute {
  readonly client: ItemId;
  readonly gateway: Ipv4;
  readonly distance: number;
}

export interface RibInput {
  readonly addresses: readonly IfaceAddress[];
  readonly routes: readonly StaticRoute[];
  readonly dhcpRoutes: readonly DhcpRoute[];
  isRunning(iface: ItemId): boolean;
}

type Candidate = Omit<RibEntry, 'active'>;

const DEFAULT_ROUTE: Ipv4Prefix = { ip: 0 as Ipv4, len: 0 };

function resolveVia(connected: readonly Candidate[], gateway: Ipv4): Candidate | undefined {
  let best: Candidate | undefined;
  for (const route of connected) {
    if (!route.reachable || !prefixContains(route.dst, gateway)) continue;
    if (!best || route.dst.len > best.dst.len) best = route;
  }
  return best;
}

export function computeRib(input: RibInput): RibEntry[] {
  const connected: Candidate[] = input.addresses.map((a) => ({
    dst: networkOf(a.address),
    iface: a.iface,
    origin: 'connected',
    source: a.source,
    distance: 0,
    prefSrc: a.address.ip,
    blackhole: false,
    reachable: input.isRunning(a.iface),
  }));

  const statics: Candidate[] = [];
  for (const route of input.routes) {
    if (route.disabled) continue;
    const base = {
      dst: route.dst,
      origin: 'static' as const,
      source: route.id,
      distance: route.distance,
    };
    const gw = route.gateway;
    switch (gw.kind) {
      case 'blackhole':
        statics.push({ ...base, blackhole: true, reachable: true });
        break;
      case 'iface':
        statics.push({
          ...base,
          iface: gw.iface,
          blackhole: false,
          reachable: input.isRunning(gw.iface),
        });
        break;
      case 'ip-iface':
        statics.push({
          ...base,
          gateway: gw.ip,
          iface: gw.iface,
          blackhole: false,
          reachable: input.isRunning(gw.iface),
        });
        break;
      case 'ip': {
        const via = resolveVia(connected, gw.ip);
        statics.push({
          ...base,
          gateway: gw.ip,
          ...(via?.iface === undefined ? {} : { iface: via.iface }),
          blackhole: false,
          reachable: via !== undefined,
        });
        break;
      }
    }
  }

  const dynamic: Candidate[] = input.dhcpRoutes.map((r) => {
    const via = resolveVia(connected, r.gateway);
    return {
      dst: DEFAULT_ROUTE,
      gateway: r.gateway,
      ...(via?.iface === undefined ? {} : { iface: via.iface }),
      origin: 'dhcp',
      source: r.client,
      distance: r.distance,
      blackhole: false,
      reachable: via !== undefined,
    };
  });

  const all = [...connected, ...statics, ...dynamic];
  const winners = new Map<string, Candidate>();
  for (const route of all) {
    if (!route.reachable) continue;
    const key = formatPrefix(route.dst);
    const current = winners.get(key);
    if (!current || route.distance < current.distance) winners.set(key, route);
  }
  const chosen = new Set(winners.values());
  return all.map((route) => ({ ...route, active: chosen.has(route) }));
}

/** Búsqueda por prefijo más largo entre las rutas activas. */
export function lookupRoute(rib: readonly RibEntry[], dst: Ipv4): RibEntry | undefined {
  let best: RibEntry | undefined;
  for (const route of rib) {
    if (!route.active || !prefixContains(route.dst, dst)) continue;
    if (!best || route.dst.len > best.dst.len) best = route;
  }
  return best;
}
