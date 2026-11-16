import type { Op, PlatformSpec } from '@nos/core';

/**
 * Cisco IOS en un router de sucursal clásico: puertos GigabitEthernet0/0..N,
 * nombre «Router» y todas las interfaces apagadas (`shutdown`) hasta que se
 * escribe `no shutdown`: es el despiste clásico de IOS y aquí cuenta en el
 * estado de la red, porque una interfaz apagada no levanta el enlace.
 *
 * Sin usuarios de fábrica. Telnet y SSH existen como servicios neutrales pero
 * salen deshabilitados: el driver los enciende cuando la línea vty y las claves
 * los hacen utilizables de verdad (ver commands/aaa.ts). El servicio DHCP sí
 * está encendido de fábrica (`service dhcp`).
 */
export const IOS_PLATFORM: PlatformSpec = {
  os: 'ios',
  traits: { forwards: true, poolAllocation: 'lowest', dhcpDnsFallback: false },
  defaultMtu: 1500,
  interfaceName: (port) =>
    port.kind === 'ethernet' ? `GigabitEthernet0/${port.index - 1}` : `Dot11Radio${port.index - 1}`,
  defaultIdentity: () => 'Router',
  factoryDefaults: (device): readonly Op[] => [
    ...device.config.interfaces
      .filter((i) => !i.disabled)
      .map((i): Op => ({ op: 'set', coll: 'interfaces', id: i.id, patch: { disabled: true } })),
    {
      op: 'add',
      coll: 'services',
      item: { name: 'telnet', port: 23, allowedFrom: [], disabled: true },
    },
    {
      op: 'add',
      coll: 'services',
      item: { name: 'ssh', port: 22, allowedFrom: [], disabled: true },
    },
    // Las marcas `ip nat inside` / `ip nat outside` son estas dos listas (ver commands/nat.ts).
    {
      op: 'add',
      coll: 'interfaceLists',
      item: { name: 'nat-inside', include: [], disabled: false },
    },
    {
      op: 'add',
      coll: 'interfaceLists',
      item: { name: 'nat-outside', include: [], disabled: false },
    },
    { op: 'setSingleton', key: 'dhcp', patch: { serverEnabled: true } },
  ],
};
