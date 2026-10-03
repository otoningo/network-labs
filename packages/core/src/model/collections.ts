import type {
  AddressListEntry,
  BridgePort,
  BridgeVlan,
  DhcpClient,
  DhcpNetwork,
  DhcpServer,
  DiscoveryConfig,
  DnsSettings,
  DnsStatic,
  FilterRule,
  Interface,
  InterfaceList,
  InterfaceListMember,
  IpAddress,
  L2AccessConfig,
  MgmtService,
  NatRule,
  Pool,
  StaticArp,
  StaticLease,
  StaticRoute,
  SystemSettings,
  User,
} from './config';

/** Todas las colecciones editables de la configuración y el tipo de sus ítems. */
export interface CollectionItems {
  interfaces: Interface;
  interfaceLists: InterfaceList;
  interfaceListMembers: InterfaceListMember;
  bridgePorts: BridgePort;
  bridgeVlans: BridgeVlan;
  addresses: IpAddress;
  staticArp: StaticArp;
  dhcpClients: DhcpClient;
  routes: StaticRoute;
  pools: Pool;
  dhcpServers: DhcpServer;
  dhcpNetworks: DhcpNetwork;
  staticLeases: StaticLease;
  dnsStatic: DnsStatic;
  filterRules: FilterRule;
  natRules: NatRule;
  addressLists: AddressListEntry;
  users: User;
  services: MgmtService;
}

export type CollectionKey = keyof CollectionItems;
export type ItemOf<K extends CollectionKey> = CollectionItems[K];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Ítem nuevo: el id lo asigna el núcleo. */
export type NewItem<K extends CollectionKey> = DistributiveOmit<ItemOf<K>, 'id'>;

/** Cambio parcial. Ni el id ni el tipo de interfaz se pueden cambiar. */
export type ItemPatch<K extends CollectionKey> = Partial<
  DistributiveOmit<ItemOf<K>, 'id' | 'kind'>
>;

/** Ajustes de un solo valor (no son listas). */
export interface SingletonItems {
  system: SystemSettings;
  dns: DnsSettings;
  discovery: DiscoveryConfig;
  l2Access: L2AccessConfig;
}

export type SingletonKey = keyof SingletonItems;

export const COLLECTION_KEYS: readonly CollectionKey[] = [
  'interfaces',
  'interfaceLists',
  'interfaceListMembers',
  'bridgePorts',
  'bridgeVlans',
  'addresses',
  'staticArp',
  'dhcpClients',
  'routes',
  'pools',
  'dhcpServers',
  'dhcpNetworks',
  'staticLeases',
  'dnsStatic',
  'filterRules',
  'natRules',
  'addressLists',
  'users',
  'services',
];
