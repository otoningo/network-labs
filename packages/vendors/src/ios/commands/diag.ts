/**
 * Diagnóstico: `ping destino [repeat N] [size N] [source IP|interfaz]` y
 * `traceroute destino`, en los dos modos de EXEC. Las opciones van detrás del
 * destino y en cualquier orden, como en IOS.
 */
import { type Area, intent } from '../area';
import { arg, type CommandSpec, kw, type Node } from '../grammar';
import { EXEC_VIEWS } from '../session';

const HOST = arg('host', { kind: 'word', max: 255 }, 'Ping destination address or hostname');

const OPTIONS: Readonly<Record<string, readonly Node[]>> = {
  repeat: [
    kw('repeat', 'specify repeat count'),
    arg('count', { kind: 'int', min: 1, max: 2_147_483_647 }, 'Repeat count'),
  ],
  size: [
    kw('size', 'specify datagram size'),
    arg('size', { kind: 'int', min: 36, max: 18_024 }, 'Datagram size'),
  ],
  source: [
    kw('source', 'specify source address or name'),
    arg('src', { kind: 'word', max: 64 }, 'Source address or interface'),
  ],
};

/** Todas las ordenaciones de cualquier subconjunto de opciones. */
function pingForms(): Node[][] {
  const forms: Node[][] = [];
  const grow = (prefix: Node[], used: readonly string[]) => {
    forms.push(prefix);
    for (const [name, nodes] of Object.entries(OPTIONS)) {
      if (!used.includes(name)) grow([...prefix, ...nodes], [...used, name]);
    }
  };
  grow([kw('ping', 'Send echo messages'), HOST], []);
  return forms;
}

const commands: CommandSpec[] = [
  {
    views: EXEC_VIEWS,
    forms: pingForms(),
    build: (m) => {
      const src = m.args['src'];
      return intent({
        kind: 'vendor',
        action: {
          kind: 'ping',
          target: m.args['host'] ?? '',
          // El simulador corta en 100 respuestas: un ping no es una prueba de carga.
          count: Math.min(Number(m.args['count'] ?? 5), 100),
          size: Number(m.args['size'] ?? 100),
          ...(src === undefined ? {} : { src }),
        },
      });
    },
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [
        kw('traceroute', 'Trace route to destination'),
        arg('host', { kind: 'word', max: 255 }, 'Trace route to destination address or hostname'),
      ],
    ],
    build: (m) =>
      intent({ kind: 'vendor', action: { kind: 'traceroute', target: m.args['host'] ?? '' } }),
  },
];

export const DIAG_AREA: Area = { commands };
