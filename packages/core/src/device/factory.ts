import type { DeviceId, ItemId } from '../model/brand';
import { emptyConfig, type Interface } from '../model/config';
import type { Device, Hardware } from '../model/network';
import { emptyOper } from '../model/oper';
import { err, ok, type Result } from '../model/result';
import { deterministicMac } from '../net/mac';
import { applyOps, type BatchError } from '../ops/apply';
import type { PlatformSpec } from './platform';

/**
 * Crea un dispositivo recién salido de fábrica: una interfaz por puerto físico
 * (con el nombre que dicta la plataforma y una MAC determinista) y la
 * configuración de fábrica de esa plataforma.
 */
export function createDevice(
  id: DeviceId,
  hardware: Hardware,
  platform: PlatformSpec,
): Result<Device, BatchError> {
  const interfaces: Interface[] = hardware.ports.map((port, index) => {
    const base = {
      id: (index + 1) as ItemId,
      name: platform.interfaceName(port),
      mtu: platform.defaultMtu,
      mac: deterministicMac(id, index + 1),
      disabled: false,
    };
    if (port.kind === 'ethernet') return { ...base, kind: 'ethernet', port: index };
    return {
      ...base,
      kind: 'wireless',
      port: index,
      // Las radios salen apagadas y sin SSID, como en la mayoría de equipos.
      disabled: true,
      mode: 'ap',
      ssid: '',
      band: port.band,
      channelMhz: 'auto',
      security: { auth: ['wpa2-psk'] },
    };
  });

  const device: Device = {
    id,
    os: platform.os,
    hardware,
    traits: platform.traits,
    config: { ...emptyConfig(platform.defaultIdentity(id)), interfaces },
    oper: emptyOper(),
    storage: { files: [] },
    nextId: interfaces.length + 1,
  };

  const defaults = platform.factoryDefaults?.(device) ?? [];
  const applied = applyOps(device, defaults);
  if (!applied.ok) return err(applied.error);
  return ok(applied.value.device);
}
