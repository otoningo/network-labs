/**
 * Diagnóstico: `ping [-c N] [-s N] [-a IP] destino` y `tracert destino`, en
 * cualquier vista. Las opciones van antes del destino, como en VRP.
 */
import { type Area, intent } from '../area';
import { arg, type CommandSpec, kw, type Node } from '../grammar';
import type { ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];

const OPTIONS: readonly (readonly [string, Node])[] = [
  ['-a', arg('src', { kind: 'ipv4' }, 'Source IP address')],
  ['-c', arg('count', { kind: 'int', min: 1, max: 4_294_967_295 }, 'Number of echo requests')],
  ['-s', arg('size', { kind: 'int', min: 20, max: 9600 }, 'Size of packets')],
];

const HELP: Readonly<Record<string, string>> = {
  '-a': 'Select source IP address',
  '-c': 'Specify the number of echo requests',
  '-s': 'Specify the length of an echo request (in bytes)',
};

/** Todas las combinaciones de opciones, en el orden fijo -a, -c, -s. */
function pingForms(): Node[][] {
  const forms: Node[][] = [];
  for (let mask = 0; mask < 1 << OPTIONS.length; mask++) {
    const nodes: Node[] = [kw('ping', 'Ping function')];
    OPTIONS.forEach(([flag, value], i) => {
      if (mask & (1 << i)) nodes.push(kw(flag, HELP[flag] ?? ''), value);
    });
    nodes.push(
      arg('host', { kind: 'word', max: 255 }, 'IP address or hostname of a remote system'),
    );
    forms.push(nodes);
  }
  return forms;
}

const commands: CommandSpec[] = [
  {
    views: ALL_VIEWS,
    forms: pingForms(),
    build: (m) => {
      const count = Number(m.args['count'] ?? 5);
      const size = Number(m.args['size'] ?? 56);
      const src = m.args['src'];
      return intent({
        kind: 'vendor',
        action: {
          kind: 'ping',
          target: m.args['host'] ?? '',
          // El simulador corta en 100 respuestas: un ping no es una prueba de carga.
          count: Math.min(count, 100),
          size,
          ...(src === undefined ? {} : { src }),
        },
      });
    },
  },
  {
    views: ALL_VIEWS,
    forms: [
      [
        kw('tracert', 'Trace route function'),
        arg('host', { kind: 'word', max: 255 }, 'IP address or hostname of a remote system'),
      ],
    ],
    build: (m) =>
      intent({ kind: 'vendor', action: { kind: 'tracert', target: m.args['host'] ?? '' } }),
  },
];

export const DIAG_AREA: Area = { commands };
