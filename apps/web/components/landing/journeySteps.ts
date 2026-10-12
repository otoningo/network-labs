/**
 * Los siete pasos del viaje del paquete, con su texto ya relleno con los datos
 * reales del motor. Los comparten la columna numerada del hero y el escenario
 * de plegado, que son el mismo diagrama visto en dos momentos.
 */
import { fill, type Messages } from '@/lib/i18n';
import type { Journey } from '@/lib/landing/journey';

export type StepId = 'write' | 'tcp' | 'ip' | 'ethernet' | 'nat' | 'isp' | 'delivered';

export interface JourneyStep {
  readonly id: StepId;
  readonly name: string;
  readonly text: string;
}

export const STEP_IDS: readonly StepId[] = [
  'write',
  'tcp',
  'ip',
  'ethernet',
  'nat',
  'isp',
  'delivered',
];

export function journeySteps(journey: Journey, messages: Messages): JourneyStep[] {
  const t = messages.landing.journey;
  const [client, router] = journey.hops;
  const target = journey.target;
  const vars: Record<StepId, Record<string, string | number>> = {
    write: { device: client?.device ?? 'PC1', name: target.name },
    tcp: { dstPort: client?.dstPort ?? target.port },
    ip: { src: client?.src ?? '', dst: client?.dst ?? target.ip },
    ethernet: { device: client?.device ?? 'PC1', out: client?.out ?? 'eth0' },
    nat: { device: router?.device ?? 'R1', from: router?.natFrom ?? '', to: router?.src ?? '' },
    isp: { name: target.name },
    delivered: { name: target.name, port: target.port },
  };
  return STEP_IDS.map((id) => ({
    id,
    name: fill(t.step[id].name, vars[id]),
    text: fill(t.step[id].text, vars[id]),
  }));
}
