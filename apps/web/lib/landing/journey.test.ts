import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { describe, expect, it } from 'vitest';
import { computeJourney } from './journey';

const sandbox = () => {
  const file = join(import.meta.dirname, '../../../../content/sandbox/routeros.yaml');
  const parsed = parseLabYaml(readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe('viaje del paquete de la portada', () => {
  it('sale de PC1, el router lo traduce y llega a example.com', () => {
    const journey = computeJourney(sandbox());
    expect(journey.delivered).toBe(true);
    expect(journey.hops.map((h) => h.device)).toEqual(['PC1', 'R1', 'ISP']);
    const [pc, router] = journey.hops;
    expect(pc).toMatchObject({ src: '192.168.88.10', dst: '93.184.216.34', dstPort: 443 });
    expect(router).toMatchObject({
      in: 'ether2',
      out: 'ether1',
      src: '203.0.113.2',
      natFrom: '192.168.88.10',
    });
  });
});
