import type { DeviceId } from '../model/brand';
import type { Device, DeviceTraits, HardwarePort, OsId } from '../model/network';
import type { Op } from '../ops/apply';

/**
 * Lo que una plataforma (un sistema operativo) aporta al crear un dispositivo:
 * nombres de interfaz, identidad por defecto, rasgos de comportamiento y la
 * configuración de fábrica. Los drivers de fabricante definen las suyas.
 */
export interface PlatformSpec {
  readonly os: OsId;
  readonly traits: DeviceTraits;
  readonly defaultMtu: number;
  interfaceName(port: HardwarePort): string;
  defaultIdentity(id: DeviceId): string;
  /** Operaciones que dejan el equipo como sale de fábrica (usuarios, servicios...). */
  factoryDefaults?(device: Device): readonly Op[];
}

/** Equipo final genérico (PC, portátil, servidor). No reenvía paquetes. */
export const HOST_PLATFORM: PlatformSpec = {
  os: 'host',
  traits: { forwards: false, poolAllocation: 'lowest', dhcpDnsFallback: false },
  defaultMtu: 1500,
  interfaceName: (port) =>
    port.kind === 'ethernet' ? `eth${port.index - 1}` : `wlan${port.index - 1}`,
  defaultIdentity: (id) => id,
};

/** "Internet": responde por las IPs públicas que el escenario indique. */
export const INTERNET_PLATFORM: PlatformSpec = {
  os: 'internet',
  traits: { forwards: false, poolAllocation: 'lowest', dhcpDnsFallback: false },
  defaultMtu: 1500,
  interfaceName: (port) => `eth${port.index - 1}`,
  defaultIdentity: () => 'internet',
};

export const BUILTIN_PLATFORMS: Readonly<Partial<Record<OsId, PlatformSpec>>> = {
  host: HOST_PLATFORM,
  internet: INTERNET_PLATFORM,
};
