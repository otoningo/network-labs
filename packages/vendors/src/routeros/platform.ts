import type { Op, PlatformSpec, ServiceName } from '@nos/core';

/** Servicios de fábrica: nombre neutral, puerto y si sale deshabilitado. */
const SERVICES: readonly (readonly [ServiceName, number, boolean])[] = [
  ['telnet', 23, false],
  ['ftp', 21, false],
  ['http', 80, false],
  ['ssh', 22, false],
  ['https', 443, true],
  ['api', 8728, false],
  ['native-gui', 8291, false],
  ['api-tls', 8729, false],
];

/**
 * RouterOS v7: puertos ether1..N y radios wifi1..N (paquete `wifi`, ver D-021),
 * identidad "MikroTik", usuario admin sin contraseña y el pool DHCP repartido
 * desde la dirección más alta, como hace el equipo real.
 */
export const ROUTEROS_PLATFORM: PlatformSpec = {
  os: 'routeros',
  traits: { forwards: true, poolAllocation: 'highest' },
  defaultMtu: 1500,
  interfaceName: (port) => (port.kind === 'ethernet' ? `ether${port.index}` : `wifi${port.index}`),
  defaultIdentity: () => 'MikroTik',
  factoryDefaults: (): readonly Op[] => [
    {
      op: 'add',
      coll: 'users',
      item: { name: 'admin', group: 'full', hasPassword: false, disabled: false },
    },
    ...SERVICES.map(
      ([name, port, disabled]): Op => ({
        op: 'add',
        coll: 'services',
        item: { name, port, allowedFrom: [], disabled },
      }),
    ),
    {
      op: 'setSingleton',
      key: 'discovery',
      patch: { protocols: ['cdp', 'lldp', 'mndp'], interfaceList: 'all' },
    },
  ],
};
