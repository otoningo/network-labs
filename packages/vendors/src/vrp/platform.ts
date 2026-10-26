import type { Op, PlatformSpec, ServiceName } from '@nos/core';

/** Servicios de fábrica: nombre neutral, puerto y si sale deshabilitado (D-044). */
const SERVICES: readonly (readonly [ServiceName, number, boolean])[] = [
  ['telnet', 23, false],
  ['ssh', 22, true],
  ['http', 80, false],
  ['https', 443, true],
];

/**
 * Huawei VRP en un router de acceso: puertos GigabitEthernet0/0/0..N (el
 * primero es el 0, como en el equipo real), identidad "Huawei", usuario admin
 * con contraseña y Telnet activo de fábrica, para que el lab de acceso pueda
 * pedir apagarlo. El servicio DHCP sale apagado: hace falta `dhcp enable`.
 * Las radios no tienen equivalente en esta versión del driver.
 */
export const VRP_PLATFORM: PlatformSpec = {
  os: 'vrp',
  traits: { forwards: true, poolAllocation: 'lowest', dhcpDnsFallback: false },
  defaultMtu: 1500,
  interfaceName: (port) =>
    port.kind === 'ethernet'
      ? `GigabitEthernet0/0/${port.index - 1}`
      : `Wlan-Radio0/0/${port.index - 1}`,
  defaultIdentity: () => 'Huawei',
  factoryDefaults: (): readonly Op[] => [
    {
      op: 'add',
      coll: 'users',
      item: { name: 'admin', group: 'full', hasPassword: true, disabled: false },
    },
    ...SERVICES.map(
      ([name, port, disabled]): Op => ({
        op: 'add',
        coll: 'services',
        item: { name, port, allowedFrom: [], disabled },
      }),
    ),
    { op: 'setSingleton', key: 'dhcp', patch: { serverEnabled: false } },
  ],
};
