/**
 * El traductor de la portada (D-043): cuatro tareas de todos los días escritas
 * en Cisco IOS y en RouterOS v7. La parte de IOS es una cita; la de RouterOS se
 * ejecuta en el motor sobre el router de práctica de la referencia, y la tarea
 * se comprueba por lo que hace la red, como en cualquier lab.
 */
import { type LabDefinition, LabSchema } from '@nos/core';
import type { QuotedLine } from '@/components/ui/ConsoleQuote';

export type TranslationId = 'hostname' | 'address' | 'route' | 'nat';

export interface Translation {
  readonly id: TranslationId;
  /** Lo que ya está configurado en R1 antes de la tarea. */
  readonly setup: readonly string[];
  readonly ios: readonly QuotedLine[];
  /** La línea de RouterOS que se escribe en vivo. */
  readonly routeros: string;
  readonly objective: {
    readonly es: string;
    readonly en: string;
    readonly check: unknown;
  };
}

const IDENTITY = '/system identity set name=Oficina';
const LAN = '/ip address add address=192.168.88.1/24 interface=ether2';
const WAN = '/ip address add address=203.0.113.2/24 interface=ether1';
const ROUTE = '/ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1';
const NAT = '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade';

/** Destino de las tareas que salen a Internet: example.com, que el proveedor resuelve. */
export const INTERNET_HOST = '93.184.216.34';

/**
 * En orden: cada tarea parte de la configuración que dejan las anteriores, así
 * se leen como una oficina que se monta paso a paso. En IOS, GigabitEthernet0/0
 * es la WAN (ether1) y GigabitEthernet0/1 la LAN (ether2).
 */
export const TRANSLATIONS: readonly Translation[] = [
  {
    id: 'hostname',
    setup: [],
    ios: [
      { prompt: 'Router# ', command: 'configure terminal' },
      { prompt: 'Router(config)# ', command: 'hostname Oficina' },
    ],
    routeros: IDENTITY,
    objective: {
      es: 'El router se llama Oficina.',
      en: 'The router is named Oficina.',
      check: { setting: { device: 'R1', key: 'system', field: 'identity', is: 'Oficina' } },
    },
  },
  {
    id: 'address',
    setup: [IDENTITY],
    ios: [
      { prompt: 'Oficina(config)# ', command: 'interface GigabitEthernet0/1' },
      { prompt: 'Oficina(config-if)# ', command: 'ip address 192.168.88.1 255.255.255.0' },
      { prompt: 'Oficina(config-if)# ', command: 'no shutdown' },
    ],
    routeros: LAN,
    objective: {
      es: 'La PC de la oficina llega al router por la LAN.',
      en: 'The office PC reaches the router over the LAN.',
      check: { reachable: { from: 'PC1', to: '192.168.88.1' } },
    },
  },
  {
    id: 'route',
    setup: [IDENTITY, LAN, WAN],
    ios: [{ prompt: 'Oficina(config)# ', command: 'ip route 0.0.0.0 0.0.0.0 203.0.113.1' }],
    routeros: ROUTE,
    objective: {
      es: `El router llega a Internet (${INTERNET_HOST}).`,
      en: `The router reaches the Internet (${INTERNET_HOST}).`,
      check: { reachable: { from: 'R1', to: INTERNET_HOST } },
    },
  },
  {
    id: 'nat',
    setup: [IDENTITY, LAN, WAN, ROUTE],
    ios: [
      { prompt: 'Oficina(config)# ', command: 'interface GigabitEthernet0/0' },
      { prompt: 'Oficina(config-if)# ', command: 'ip nat outside' },
      { prompt: 'Oficina(config-if)# ', command: 'interface GigabitEthernet0/1' },
      { prompt: 'Oficina(config-if)# ', command: 'ip nat inside' },
      { prompt: 'Oficina(config-if)# ', command: 'exit' },
      { prompt: 'Oficina(config)# ', command: 'access-list 1 permit 192.168.88.0 0.0.0.255' },
      {
        prompt: 'Oficina(config)# ',
        command: 'ip nat inside source list 1 interface GigabitEthernet0/0 overload',
      },
    ],
    routeros: NAT,
    objective: {
      es: 'La PC de la oficina sale a Internet con la IP pública del router.',
      en: 'The office PC reaches the Internet with the router public IP.',
      check: {
        natSourceIs: {
          from: 'PC1',
          to: INTERNET_HOST,
          protocol: 'tcp',
          port: 443,
          expect: { addressOf: 'R1:ether1' },
        },
      },
    },
  },
];

/**
 * El lab de una traducción: el router de práctica con su configuración previa y
 * una sola tarea. Pasa por el esquema de labs, así que se valida igual que
 * cualquier lab publicado.
 */
export function translationLab(sandbox: LabDefinition, translation: Translation): LabDefinition {
  return LabSchema.parse({
    ...sandbox,
    id: `home-${translation.id}`,
    topology: {
      ...sandbox.topology,
      devices: sandbox.topology.devices.map((device) =>
        device.id === 'R1' && translation.setup.length > 0
          ? { ...device, startup: translation.setup.join('\n') }
          : device,
      ),
    },
    objectives: [
      {
        id: translation.id,
        text: { es: translation.objective.es, en: translation.objective.en },
        check: translation.objective.check,
        hints: [{ es: 'Escribe la línea de RouterOS.', en: 'Type the RouterOS line.' }],
      },
    ],
  });
}
