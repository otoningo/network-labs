/**
 * Datos de la portada que tocan el motor: la demostración del lab 1 y la
 * comparación IOS frente a RouterOS. Viven aquí, y no en los componentes,
 * para que las pruebas comprueben que el simulador los acepta de verdad.
 */

/** Tarea del lab 1 que resuelve la demostración y el comando que la resuelve. */
export const DEMO_OBJECTIVE = 'identity';
export const DEMO_COMMAND = '/system identity set name=R1-Oficina';

/** Una línea de consola citada: el prompt va en tinta tenue y el comando en tinta. */
export interface QuotedLine {
  readonly prompt: string;
  readonly command: string;
}

export type CompareTask = 'hostname' | 'address' | 'route' | 'table';

export interface CompareRow {
  readonly id: CompareTask;
  readonly ios: readonly QuotedLine[];
  readonly routeros: readonly QuotedLine[];
}

const ros = (command: string): QuotedLine => ({ prompt: '[admin@R1] > ', command });

/**
 * Tareas de todos los días en Cisco IOS y en RouterOS v7, escritas a mano.
 * En IOS se muestra el modo en el prompt porque es justo lo que cambia.
 */
export const COMPARE_ROWS: readonly CompareRow[] = [
  {
    id: 'hostname',
    ios: [
      { prompt: 'Router# ', command: 'configure terminal' },
      { prompt: 'Router(config)# ', command: 'hostname R1' },
    ],
    routeros: [{ prompt: '[admin@MikroTik] > ', command: '/system identity set name=R1' }],
  },
  {
    id: 'address',
    ios: [
      { prompt: 'R1(config)# ', command: 'interface GigabitEthernet0/1' },
      { prompt: 'R1(config-if)# ', command: 'ip address 192.168.88.1 255.255.255.0' },
      { prompt: 'R1(config-if)# ', command: 'no shutdown' },
    ],
    routeros: [ros('/ip address add address=192.168.88.1/24 interface=ether2')],
  },
  {
    id: 'route',
    ios: [{ prompt: 'R1(config)# ', command: 'ip route 0.0.0.0 0.0.0.0 203.0.113.1' }],
    routeros: [ros('/ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1')],
  },
  {
    id: 'table',
    ios: [{ prompt: 'R1# ', command: 'show ip route' }],
    routeros: [ros('/ip route print')],
  },
];
