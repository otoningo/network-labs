/**
 * Configuración neutral de un dispositivo. Nada aquí conoce la sintaxis de un
 * fabricante: los drivers traducen sus comandos a operaciones sobre estos tipos.
 * La configuración se agrupa por función, no por los menús de ningún sistema.
 */
import type { IpRange, Ipv4, Ipv4Prefix } from '../net/ipv4';
import type { Mac } from '../net/mac';
import type { PortSet } from '../net/ports';
import type { ItemId, SimTime } from './brand';

export interface ItemBase {
  readonly id: ItemId;
  readonly disabled: boolean;
  readonly comment?: string;
}

// ── Sistema y gestión ───────────────────────────────────────────────────────

export interface SystemSettings {
  readonly identity: string;
  readonly timezone: string;
}

export type UserGroup = 'full' | 'write' | 'read';

/** Nunca se guarda la contraseña tecleada; solo si existe (ver D-012). */
export interface User extends ItemBase {
  readonly name: string;
  readonly group: UserGroup;
  readonly hasPassword: boolean;
}

/** `native-gui` es la herramienta gráfica propia de cada sistema; el driver le pone nombre. */
export type ServiceName =
  | 'ssh'
  | 'telnet'
  | 'ftp'
  | 'http'
  | 'https'
  | 'api'
  | 'api-tls'
  | 'native-gui';

export interface MgmtService extends ItemBase {
  readonly name: ServiceName;
  readonly port: number;
  /** Vacío = cualquier origen. */
  readonly allowedFrom: readonly Ipv4Prefix[];
}

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface InterfaceBase extends ItemBase {
  readonly name: string;
  readonly mtu: number;
  readonly mac: Mac;
}

export interface EthernetInterface extends InterfaceBase {
  readonly kind: 'ethernet';
  /** Índice del puerto físico en `Device.hardware.ports`. */
  readonly port: number;
}

export type StpMode = 'none' | 'stp' | 'rstp' | 'mstp';

export interface BridgeInterface extends InterfaceBase {
  readonly kind: 'bridge';
  readonly vlanFiltering: boolean;
  readonly stp: StpMode;
  /** VLAN nativa del propio bridge (puerto hacia la CPU). */
  readonly pvid: number;
}

/**
 * Subinterfaz 802.1Q. Cubre la VLAN sobre bridge de RouterOS, la Vlanif de VRP,
 * la SVI o subinterfaz de IOS y la `vif` de VyOS.
 */
export interface VlanInterface extends InterfaceBase {
  readonly kind: 'vlan';
  readonly vlanId: number;
  readonly parent: ItemId;
}

export interface LoopbackInterface extends InterfaceBase {
  readonly kind: 'loopback';
}

export type WifiBand = '2ghz' | '5ghz';
export type WifiAuth = 'open' | 'wpa2-psk' | 'wpa3-psk';

export interface WifiSecurity {
  readonly auth: readonly WifiAuth[];
  /** La define el lab y hay que compararla, por eso se guarda (ver D-012). */
  readonly passphrase?: string;
}

export interface WirelessInterface extends InterfaceBase {
  readonly kind: 'wireless';
  readonly port: number;
  readonly mode: 'ap' | 'station';
  readonly ssid: string;
  readonly band: WifiBand;
  readonly channelMhz: number | 'auto';
  readonly security: WifiSecurity;
}

export type Interface =
  | EthernetInterface
  | BridgeInterface
  | VlanInterface
  | LoopbackInterface
  | WirelessInterface;

export type InterfaceKind = Interface['kind'];

/** Grupo de interfaces con nombre (listas de RouterOS, zonas, grupos de objetos). */
export interface InterfaceList extends ItemBase {
  readonly name: string;
  /** Otras listas incluidas, por nombre. */
  readonly include: readonly string[];
}

/** Pertenencia de una interfaz a una lista. Es un ítem propio: se puede deshabilitar o comentar. */
export interface InterfaceListMember extends ItemBase {
  readonly list: ItemId;
  readonly iface: ItemId;
}

// ── Capa 2: semántica 802.1Q ────────────────────────────────────────────────

export type FrameTypes = 'all' | 'untagged-only' | 'tagged-only';

export interface BridgePort extends ItemBase {
  readonly bridge: ItemId;
  readonly iface: ItemId;
  readonly pvid: number;
  readonly frameTypes: FrameTypes;
  readonly ingressFiltering: boolean;
}

/** Membresía configurada de puertos en VLANs (la dinámica por pvid la calcula el motor). */
export interface BridgeVlan extends ItemBase {
  readonly bridge: ItemId;
  readonly vlanIds: readonly number[];
  readonly tagged: readonly ItemId[];
  readonly untagged: readonly ItemId[];
}

// ── Capa 3 ──────────────────────────────────────────────────────────────────

export interface IpAddress extends ItemBase {
  readonly iface: ItemId;
  readonly address: Ipv4Prefix;
}

export interface StaticArp extends ItemBase {
  readonly iface: ItemId;
  readonly ip: Ipv4;
  readonly mac: Mac;
}

export interface DhcpClient extends ItemBase {
  readonly iface: ItemId;
  readonly addDefaultRoute: boolean;
  readonly routeDistance: number;
  readonly usePeerDns: boolean;
}

export type Gateway =
  | { readonly kind: 'ip'; readonly ip: Ipv4 }
  | { readonly kind: 'iface'; readonly iface: ItemId }
  | { readonly kind: 'ip-iface'; readonly ip: Ipv4; readonly iface: ItemId }
  | { readonly kind: 'blackhole' };

/**
 * Comprobación de que el gateway sigue vivo: con ella la ruta solo está activa
 * si el vecino responde de verdad en capa 2, no basta con que el enlace esté arriba.
 */
export type CheckGateway = 'ping' | 'arp';

export interface StaticRoute extends ItemBase {
  readonly dst: Ipv4Prefix;
  readonly gateway: Gateway;
  readonly distance: number;
  readonly table: string;
  readonly checkGateway?: CheckGateway;
}

// ── DHCP y DNS ──────────────────────────────────────────────────────────────

export interface Pool extends ItemBase {
  readonly name: string;
  readonly ranges: readonly IpRange[];
  readonly next?: ItemId;
}

export interface DhcpServer extends ItemBase {
  readonly name: string;
  readonly iface: ItemId;
  readonly pool: ItemId | 'static-only';
  readonly leaseTimeS: number;
  readonly authoritative: boolean;
}

export interface DhcpNetwork extends ItemBase {
  readonly prefix: Ipv4Prefix;
  readonly gateway?: Ipv4;
  readonly dnsServers: readonly Ipv4[];
  readonly domain?: string;
}

export interface StaticLease extends ItemBase {
  readonly server: ItemId | 'all';
  readonly mac: Mac;
  readonly ip: Ipv4;
}

export interface DnsSettings {
  readonly servers: readonly Ipv4[];
  readonly allowRemoteRequests: boolean;
  readonly cacheSizeKiB: number;
}

export type DnsRecordType = 'A' | 'CNAME';

export interface DnsStatic extends ItemBase {
  readonly name: string;
  readonly type: DnsRecordType;
  readonly address?: Ipv4;
  readonly cname?: string;
  readonly ttlS: number;
}

export interface DnsConfig extends DnsSettings {
  readonly static: readonly DnsStatic[];
}

// ── Firewall y NAT ──────────────────────────────────────────────────────────

/** Condición con negación opcional (el `!` de RouterOS, `not` en otros sistemas). */
export interface Neg<T> {
  readonly value: T;
  readonly negate: boolean;
}

export type IpProtocol = 'tcp' | 'udp' | 'icmp';
export type ConnState = 'new' | 'established' | 'related' | 'invalid' | 'untracked';
/** Traducciones que ya tiene la conexión del paquete. */
export type ConnNatState = 'srcnat' | 'dstnat';

export interface Match {
  readonly srcAddress?: Neg<Ipv4Prefix | IpRange>;
  readonly dstAddress?: Neg<Ipv4Prefix | IpRange>;
  readonly srcAddressList?: Neg<string>;
  readonly dstAddressList?: Neg<string>;
  readonly protocol?: Neg<IpProtocol | number>;
  readonly srcPort?: Neg<PortSet>;
  readonly dstPort?: Neg<PortSet>;
  readonly inInterface?: Neg<ItemId>;
  readonly outInterface?: Neg<ItemId>;
  readonly inInterfaceList?: Neg<string>;
  readonly outInterfaceList?: Neg<string>;
  readonly connectionState?: readonly ConnState[];
  /** Coincide si la conexión tiene alguna de estas traducciones (o ninguna, negado). */
  readonly connectionNatState?: Neg<readonly ConnNatState[]>;
}

export type RejectWith = 'icmp-port-unreachable' | 'icmp-admin-prohibited' | 'tcp-reset';

export type FilterAction =
  | { readonly kind: 'accept' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'reject'; readonly with: RejectWith }
  | { readonly kind: 'jump'; readonly target: string }
  | { readonly kind: 'return' }
  | { readonly kind: 'passthrough' }
  | { readonly kind: 'fasttrack' };

export const BUILTIN_FILTER_CHAINS = ['input', 'forward', 'output'] as const;

export interface FilterRule extends ItemBase {
  readonly chain: string;
  readonly match: Match;
  readonly action: FilterAction;
  readonly log: boolean;
  readonly logPrefix?: string;
  /** Pedir que la vía rápida (fasttrack) la haga el hardware si puede. */
  readonly hwOffload?: boolean;
}

export type NatAction =
  | { readonly kind: 'masquerade'; readonly toPorts?: PortSet }
  | { readonly kind: 'srcNat'; readonly to: IpRange; readonly toPorts?: PortSet }
  /** Sin `to` solo se traduce el puerto (el destino original se conserva). */
  | { readonly kind: 'dstNat'; readonly to?: IpRange; readonly toPorts?: PortSet }
  | { readonly kind: 'redirect'; readonly toPorts: PortSet }
  | { readonly kind: 'netmap'; readonly to: Ipv4Prefix }
  | { readonly kind: 'accept' };

export type NatChain = 'srcnat' | 'dstnat';

export interface NatRule extends ItemBase {
  readonly chain: NatChain;
  readonly match: Match;
  readonly action: NatAction;
}

export interface AddressListEntry extends ItemBase {
  readonly list: string;
  readonly address: Ipv4Prefix | IpRange;
  /** Con timeout la entrada es temporal: caduca `timeoutS` segundos después de `createdAt`. */
  readonly timeoutS?: number;
  readonly createdAt?: SimTime;
}

// ── Descubrimiento de vecinos ───────────────────────────────────────────────

export type DiscoveryProtocol = 'lldp' | 'cdp' | 'mndp';

/**
 * Acceso de gestión por capa 2 (por MAC, sin IP): consola y herramienta gráfica.
 * Cada campo es una lista de interfaces, o `all` / `none`.
 */
export interface L2AccessConfig {
  readonly cli: string;
  readonly gui: string;
}

export interface DiscoveryConfig {
  readonly protocols: readonly DiscoveryProtocol[];
  /** Nombre de una lista de interfaces, o `all` / `none`. */
  readonly interfaceList: string;
}

// ── Configuración completa ──────────────────────────────────────────────────

export interface DeviceConfig {
  readonly system: SystemSettings & { readonly users: readonly User[] };
  readonly services: readonly MgmtService[];
  readonly interfaces: readonly Interface[];
  readonly interfaceLists: readonly InterfaceList[];
  readonly interfaceListMembers: readonly InterfaceListMember[];
  readonly bridging: {
    readonly ports: readonly BridgePort[];
    readonly vlans: readonly BridgeVlan[];
  };
  readonly addressing: {
    readonly addresses: readonly IpAddress[];
    readonly staticArp: readonly StaticArp[];
    readonly dhcpClients: readonly DhcpClient[];
  };
  readonly routing: { readonly static: readonly StaticRoute[] };
  readonly dhcpServer: {
    readonly pools: readonly Pool[];
    readonly servers: readonly DhcpServer[];
    readonly networks: readonly DhcpNetwork[];
    readonly staticLeases: readonly StaticLease[];
  };
  readonly dns: DnsConfig;
  readonly firewall: {
    readonly filter: readonly FilterRule[];
    readonly nat: readonly NatRule[];
    readonly addressLists: readonly AddressListEntry[];
  };
  readonly discovery: DiscoveryConfig;
  readonly l2Access: L2AccessConfig;
}

export function emptyConfig(identity: string): DeviceConfig {
  return {
    system: { identity, timezone: 'UTC', users: [] },
    services: [],
    interfaces: [],
    interfaceLists: [],
    interfaceListMembers: [],
    bridging: { ports: [], vlans: [] },
    addressing: { addresses: [], staticArp: [], dhcpClients: [] },
    routing: { static: [] },
    dhcpServer: { pools: [], servers: [], networks: [], staticLeases: [] },
    dns: { servers: [], allowRemoteRequests: false, cacheSizeKiB: 2048, static: [] },
    firewall: { filter: [], nat: [], addressLists: [] },
    discovery: { protocols: [], interfaceList: 'none' },
    l2Access: { cli: 'all', gui: 'all' },
  };
}
