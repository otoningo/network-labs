import type { PlatformSpec } from '../device/platform';

/**
 * Plataforma de router para pruebas del núcleo. No imita a ningún fabricante:
 * solo da nombres de interfaz legibles (ether1, wlan1) y reenvía paquetes.
 */
export const TEST_ROUTER_PLATFORM: PlatformSpec = {
  os: 'routeros',
  traits: { forwards: true, poolAllocation: 'lowest', dhcpDnsFallback: false },
  defaultMtu: 1500,
  interfaceName: (port) => (port.kind === 'ethernet' ? `ether${port.index}` : `wlan${port.index}`),
  defaultIdentity: (id) => id,
};
