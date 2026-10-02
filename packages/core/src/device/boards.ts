import type { Hardware, HardwarePort } from '../model/network';

function ethernet(count: number): HardwarePort[] {
  return Array.from({ length: count }, (_, i) => ({ kind: 'ethernet' as const, index: i + 1 }));
}

/** Placas genéricas. Nunca usamos modelos comerciales reales (ver D-011). */
export const BOARDS: Readonly<Record<string, Hardware>> = {
  'sim-r5': { board: 'sim-r5', ports: ethernet(5) },
  'sim-r5w': {
    board: 'sim-r5w',
    ports: [...ethernet(5), { kind: 'wireless', index: 1, band: '2ghz' }],
  },
  'sim-r10': { board: 'sim-r10', ports: ethernet(10) },
  'sim-host': { board: 'sim-host', ports: ethernet(1) },
  'sim-host-w': { board: 'sim-host-w', ports: [{ kind: 'wireless', index: 1, band: '2ghz' }] },
  'sim-cloud': { board: 'sim-cloud', ports: ethernet(1) },
};

export type BoardName = keyof typeof BOARDS;
