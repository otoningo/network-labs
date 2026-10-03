import { describe, expect, it } from 'vitest';
import type { DeviceConfig } from '../model/config';
import { deviceIn, net } from '../testing/builder';
import { sameConfig } from './evaluate';

/** Misma configuración de un router con un bridge, creada en dos órdenes distintos de ids. */
const office = (extraFirst: boolean): DeviceConfig => {
  let builder = net().router('R1');
  // Un ítem creado y borrado consume un id: el resto queda con ids distintos.
  if (extraFirst) builder = builder.address('R1', 'ether5', '10.9.9.9/32');
  builder = builder
    .bridge('R1', 'bridge1', ['ether2', 'ether3'])
    .address('R1', 'bridge1', '192.168.88.1/24')
    .masquerade('R1', 'ether1');
  const config = deviceIn(builder.build(), 'R1').config;
  if (!extraFirst) return config;
  return {
    ...config,
    addressing: {
      ...config.addressing,
      addresses: config.addressing.addresses.filter((a) => a.address.len !== 32),
    },
  };
};

describe('sameConfig', () => {
  it('ignora los ids internos y sigue las referencias entre colecciones', () => {
    const a = office(false);
    const b = office(true);
    expect(a.interfaces.find((i) => i.name === 'bridge1')?.id).not.toBe(
      b.interfaces.find((i) => i.name === 'bridge1')?.id,
    );
    expect(sameConfig(a, b)).toBe(true);
    expect(sameConfig(a, b, ['addresses', 'natRules'])).toBe(true);
  });

  it('detecta un cambio de valor o de a qué ítem apunta una referencia', () => {
    const a = office(false);
    const moved: DeviceConfig = {
      ...a,
      addressing: {
        ...a.addressing,
        addresses: a.addressing.addresses.map((addr) => ({
          ...addr,
          iface: a.interfaces.find((i) => i.name === 'ether4')?.id ?? addr.iface,
        })),
      },
    };
    expect(sameConfig(a, moved)).toBe(false);
    expect(sameConfig(a, moved, ['natRules'])).toBe(true);
    expect(sameConfig(a, moved, ['addresses'])).toBe(false);
    expect(sameConfig(a, { ...a, system: { ...a.system, identity: 'otro' } })).toBe(false);
  });
});
