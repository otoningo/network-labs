/**
 * Estado operativo de un dispositivo. Hay dos clases de datos:
 * - Derivados [D]: los recalcula `converge()` desde la configuración de toda la red.
 * - De ejecución [R]: se acumulan con el tiempo (contadores, caché DNS, conntrack, log).
 */
import type { Ipv4, Ipv4Prefix } from '../net/ipv4';
import type { Mac } from '../net/mac';
import type { DeviceId, ItemId, SimTime } from './brand';
import type { CollectionKey, SingletonKey } from './collections';
import type { ConnState, DiscoveryProtocol, DnsRecordType, IpProtocol, NatChain } from './config';
import type { OsId, PortRef } from './network';

export interface Counters {
  readonly packets: number;
  readonly bytes: number;
}

export const ZERO_COUNTERS: Counters = { packets: 0, bytes: 0 };

export interface InterfaceOper {
  readonly iface: ItemId;
  /** [D] */
  readonly linkUp: boolean;
  /** [D] La interfaz está operativa (flag R de RouterOS, "UP/UP" en otros). */
  readonly running: boolean;
  /** [D] En una estación wifi: punto de acceso al que está asociada. */
  readonly wifiAp?: PortRef;
  /** [R] */
  readonly rx: Counters;
  /** [R] */
  readonly tx: Counters;
  /** [R] Tasa actual según el tráfico de fondo. */
  readonly rateBps: { readonly rx: number; readonly tx: number };
}

/** [D] Dirección obtenida dinámicamente (por ahora solo DHCP). */
export interface DynamicAddress {
  readonly iface: ItemId;
  readonly address: Ipv4Prefix;
  readonly origin: 'dhcp';
  readonly client: ItemId;
}

export type RouteOrigin = 'connected' | 'static' | 'dhcp';

/** [D] Ruta candidata. Las activas forman la tabla de reenvío. */
export interface RibEntry {
  readonly dst: Ipv4Prefix;
  readonly gateway?: Ipv4;
  /** Interfaz de salida resuelta. */
  readonly iface?: ItemId;
  readonly origin: RouteOrigin;
  /** Ítem de configuración que la origina (dirección, ruta estática o cliente DHCP). */
  readonly source: ItemId;
  readonly distance: number;
  readonly prefSrc?: Ipv4;
  readonly blackhole: boolean;
  readonly reachable: boolean;
  readonly active: boolean;
}

export interface ArpEntry {
  readonly ip: Ipv4;
  readonly mac: Mac;
  readonly iface: ItemId;
  readonly origin: 'dynamic' | 'static';
  readonly complete: boolean;
}

export interface BridgeHost {
  readonly bridge: ItemId;
  readonly mac: Mac;
  readonly port: ItemId;
  /** null si el bridge no filtra VLANs. */
  readonly vlanId: number | null;
  readonly local: boolean;
}

/** [D] Membresía efectiva: la configurada más la dinámica que añade cada pvid. */
export interface VlanMembership {
  readonly bridge: ItemId;
  readonly vlanId: number;
  readonly tagged: readonly ItemId[];
  readonly untagged: readonly ItemId[];
  /** true si no hay ninguna entrada configurada para esta VLAN. */
  readonly dynamic: boolean;
}

export interface DhcpLease {
  readonly server: ItemId;
  readonly ip: Ipv4;
  readonly mac: Mac;
  readonly client: PortRef;
  readonly hostName: string;
  readonly status: 'bound';
  /** false si viene de un lease estático. */
  readonly dynamic: boolean;
  readonly boundAt: SimTime;
  readonly expiresAt: SimTime;
}

export interface DhcpClientStatus {
  readonly client: ItemId;
  readonly status: 'bound' | 'searching';
  readonly server?: PortRef;
  readonly address?: Ipv4Prefix;
  readonly gateway?: Ipv4;
  readonly dns: readonly Ipv4[];
  readonly expiresAt?: SimTime;
}

export interface Neighbor {
  readonly iface: ItemId;
  readonly peer: DeviceId;
  readonly peerIface: string;
  readonly identity: string;
  readonly address?: Ipv4;
  readonly mac: Mac;
  readonly os: OsId;
  readonly protocol: DiscoveryProtocol;
}

export interface WifiRegistration {
  /** Interfaz del punto de acceso. */
  readonly iface: ItemId;
  readonly client: PortRef;
  readonly mac: Mac;
  readonly signalDbm: number;
  readonly since: SimTime;
}

export type InvalidReason = 'dangling-ref' | 'slave-port';

export interface InvalidItem {
  readonly coll: CollectionKey;
  readonly id: ItemId;
  readonly reason: InvalidReason;
}

export interface DnsCacheEntry {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly data: string;
  readonly expiresAt: SimTime;
}

export interface Endpoint {
  readonly ip: Ipv4;
  readonly port?: number;
}

export interface Connection {
  readonly protocol: IpProtocol;
  readonly original: { readonly src: Endpoint; readonly dst: Endpoint };
  readonly reply: { readonly src: Endpoint; readonly dst: Endpoint };
  readonly srcNat: boolean;
  readonly dstNat: boolean;
  readonly expiresAt: SimTime;
  /** Flujo del escenario que la mantiene viva, si lo hay. */
  readonly flow?: string;
}

export interface RuleCounter {
  readonly rule: ItemId;
  readonly packets: number;
  readonly bytes: number;
}

export type LogEvent =
  | {
      readonly kind: 'firewall';
      readonly rule: ItemId;
      readonly chain: string;
      readonly prefix?: string;
      readonly protocol: IpProtocol;
      readonly src: Endpoint;
      readonly dst: Endpoint;
      readonly inIface?: ItemId;
      readonly outIface?: ItemId;
      /** Estado de conexión del paquete: la ida es new, la vuelta established. */
      readonly state: ConnState;
      /** Tipo ICMP (8 eco, 0 respuesta) cuando aplica. */
      readonly icmpType?: number;
      /** Longitud del paquete en bytes. */
      readonly len: number;
    }
  | { readonly kind: 'nat'; readonly rule: ItemId; readonly chain: NatChain }
  | {
      readonly kind: 'dhcp-assigned';
      readonly server: ItemId;
      readonly ip: Ipv4;
      readonly mac: Mac;
    }
  | {
      readonly kind: 'dhcp-pool-empty';
      readonly server: ItemId;
      readonly pool: ItemId;
    }
  | { readonly kind: 'backup-saved'; readonly file: string }
  | { readonly kind: 'backup-loaded'; readonly file: string }
  | {
      readonly kind: 'config-change';
      readonly scope: CollectionKey | SingletonKey;
      readonly action: 'added' | 'changed' | 'removed';
      readonly by: string;
    }
  | { readonly kind: 'session'; readonly action: 'login' | 'logout'; readonly user: string };

export interface LogEntry {
  readonly at: SimTime;
  readonly event: LogEvent;
}

export interface DeviceOper {
  readonly interfaces: readonly InterfaceOper[];
  readonly dynamicAddresses: readonly DynamicAddress[];
  readonly dynamicDnsServers: readonly Ipv4[];
  readonly rib: readonly RibEntry[];
  readonly arp: readonly ArpEntry[];
  readonly bridgeHosts: readonly BridgeHost[];
  readonly vlanMembership: readonly VlanMembership[];
  readonly dhcpLeases: readonly DhcpLease[];
  readonly dhcpClients: readonly DhcpClientStatus[];
  readonly neighbors: readonly Neighbor[];
  readonly wifiRegistrations: readonly WifiRegistration[];
  readonly invalid: readonly InvalidItem[];
  readonly dnsCache: readonly DnsCacheEntry[];
  readonly conntrack: readonly Connection[];
  readonly ruleCounters: readonly RuleCounter[];
  readonly log: readonly LogEntry[];
}

export function emptyOper(): DeviceOper {
  return {
    interfaces: [],
    dynamicAddresses: [],
    dynamicDnsServers: [],
    rib: [],
    arp: [],
    bridgeHosts: [],
    vlanMembership: [],
    dhcpLeases: [],
    dhcpClients: [],
    neighbors: [],
    wifiRegistrations: [],
    invalid: [],
    dnsCache: [],
    conntrack: [],
    ruleCounters: [],
    log: [],
  };
}

/** Máximo de entradas del log por dispositivo; se descartan las más antiguas. */
export const LOG_LIMIT = 1000;
