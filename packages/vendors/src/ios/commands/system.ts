/**
 * Sistema: cambiar de modo (`enable`, `disable`, `configure terminal`, `exit`,
 * `end`, `logout`), el nombre del equipo (`hostname`), guardar (`write`,
 * `copy running-config startup-config`), borrar lo guardado (`erase
 * startup-config`) y los `show` que no son de ningún área: versión y
 * configuraciones. También acepta, sin efecto, las líneas fijas que imprime
 * `show running-config` (`ip cef`, `boot-start-marker`...), para que una
 * configuración copiada entera se pueda volver a pegar.
 */
import type { Device } from '@nos/core';
import { type Area, type ConfigBlock, config, fault, intent, noop, show } from '../area';
import { arg, type CommandSpec, kw } from '../grammar';
import { metaOf, metaOps } from '../meta';
import { CONFIG_VIEWS, EXEC_VIEWS } from '../session';

const NO = kw('no', 'Negate a command or set its defaults');
const SHOW = kw('show', 'Show running system information');

/** Nombre válido para IOS: empieza por letra, termina en letra o número y solo lleva letras, números y guiones. */
const HOSTNAME = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const commands: CommandSpec[] = [
  // ── Modos ──
  {
    views: ['user'],
    forms: [[kw('enable', 'Turn on privileged commands')]],
    build: () => intent({ kind: 'session', change: { kind: 'enter', view: { kind: 'priv' } } }),
  },
  {
    views: ['priv'],
    forms: [[kw('disable', 'Turn off privileged commands')]],
    build: () => intent({ kind: 'session', change: { kind: 'enter', view: { kind: 'user' } } }),
  },
  {
    views: EXEC_VIEWS,
    forms: [[kw('exit', 'Exit from the EXEC')], [kw('logout', 'Exit from the EXEC')]],
    build: () => intent({ kind: 'session', change: { kind: 'logout' } }),
  },
  {
    views: CONFIG_VIEWS,
    forms: [[kw('exit', 'Exit from the current mode')]],
    build: () => intent({ kind: 'session', change: { kind: 'exit' } }),
  },
  {
    views: CONFIG_VIEWS,
    forms: [[kw('end', 'Exit to privileged EXEC mode')]],
    build: () => intent({ kind: 'session', change: { kind: 'end' } }),
  },
  {
    views: ['priv'],
    forms: [
      [kw('configure', 'Enter configuration mode'), kw('terminal', 'Configure from the terminal')],
    ],
    build: () =>
      intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'vendor',
            action: {
              kind: 'message',
              text: 'Enter configuration commands, one per line.  End with CNTL/Z.',
            },
          },
          { kind: 'session', change: { kind: 'enter', view: { kind: 'config' } } },
        ],
      }),
  },
  {
    views: ['priv'],
    forms: [[kw('configure', 'Enter configuration mode')]],
    build: () =>
      intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'vendor',
            action: {
              kind: 'message',
              text: 'Configuring from terminal, memory, or network [terminal]? ',
            },
          },
          { kind: 'session', change: { kind: 'ask', pending: { kind: 'configure' } } },
        ],
      }),
  },

  {
    // El driver ejecuta `do ...` antes de llegar aquí; esta forma solo sirve a `?` y a Tab.
    views: CONFIG_VIEWS,
    forms: [
      [
        kw('do', 'To run exec commands in config mode'),
        arg('cmd', { kind: 'text', max: 255 }, 'Exec Command'),
      ],
    ],
    build: () => noop(),
  },

  // ── Nombre ──
  {
    views: ['config'],
    forms: [
      [
        kw('hostname', 'Set system network name'),
        arg('name', { kind: 'word', max: 63 }, "This system's network name"),
      ],
    ],
    build: (m) => {
      const name = m.args['name'] ?? '';
      if (!HOSTNAME.test(name)) return fault('bad-hostname');
      return config([{ op: 'setSingleton', key: 'system', patch: { identity: name } }]);
    },
  },
  {
    views: ['config'],
    forms: [[NO, kw('hostname', 'Set system network name')]],
    build: () => config([{ op: 'setSingleton', key: 'system', patch: { identity: 'Router' } }]),
  },

  // ── Guardar ──
  {
    views: ['priv'],
    forms: [
      [kw('write', 'Write running configuration to memory, network, or terminal')],
      [
        kw('write', 'Write running configuration to memory, network, or terminal'),
        kw('memory', 'Write to NV memory'),
      ],
    ],
    build: () => intent({ kind: 'vendor', action: { kind: 'save' } }),
  },
  {
    views: ['priv'],
    forms: [
      [
        kw('copy', 'Copy from one file to another'),
        kw('running-config', 'Copy from current system configuration'),
        kw('startup-config', 'Copy to startup configuration'),
      ],
    ],
    build: () =>
      intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'vendor',
            action: { kind: 'message', text: 'Destination filename [startup-config]? ' },
          },
          { kind: 'session', change: { kind: 'ask', pending: { kind: 'copy' } } },
        ],
      }),
  },
  {
    views: ['priv'],
    forms: [
      [
        kw('erase', 'Erase a filesystem'),
        kw('startup-config', 'Erase contents of configuration memory'),
      ],
      [
        kw('write', 'Write running configuration to memory, network, or terminal'),
        kw('erase', 'Erase NV memory'),
      ],
    ],
    build: () =>
      intent({
        kind: 'sequence',
        steps: [
          {
            kind: 'vendor',
            action: {
              kind: 'message',
              text: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]',
            },
          },
          { kind: 'session', change: { kind: 'ask', pending: { kind: 'erase' } } },
        ],
      }),
  },

  // ── Show ──
  {
    views: EXEC_VIEWS,
    forms: [[SHOW, kw('version', 'System hardware and software status')]],
    build: () => show('version'),
  },
  {
    views: ['priv'],
    forms: [
      [SHOW, kw('running-config', 'Current operating configuration')],
      [SHOW, kw('startup-config', 'Contents of startup configuration')],
    ],
    build: (m) => show(m.has('running-config') ? 'running-config' : 'startup-config'),
  },

  // ── Líneas fijas de `show running-config` ──
  {
    views: ['config'],
    forms: [
      [kw('version', 'Version'), arg('v', { kind: 'word', max: 20 }, 'Version number')],
      [kw('boot-start-marker', 'Boot start marker')],
      [kw('boot-end-marker', 'Boot end marker')],
      [kw('ip', 'Global IP configuration subcommands'), kw('cef', 'Cisco Express Forwarding')],
      [NO, kw('ipv6', 'Global IPv6 configuration commands'), kw('cef', 'Cisco Express Forwarding')],
      [
        NO,
        kw('aaa', 'Authentication, Authorization and Accounting'),
        kw('new-model', 'Enable NEW access control commands and functions'),
      ],
      [
        kw('ip', 'Global IP configuration subcommands'),
        kw('forward-protocol', 'Controls forwarding of physical and directed IP broadcasts'),
        kw('nd', "Sun's Network Disk protocol"),
      ],
      [
        NO,
        kw('ip', 'Global IP configuration subcommands'),
        kw('http', 'HTTP server configuration'),
        kw('server', 'Enable HTTP server'),
      ],
      [
        NO,
        kw('ip', 'Global IP configuration subcommands'),
        kw('http', 'HTTP server configuration'),
        kw('secure-server', 'Enable HTTP secure server'),
      ],
      [kw('control-plane', 'Configure control plane services')],
      [
        kw('service', 'Modify use of network based services'),
        kw('timestamps', 'Timestamp debug/log messages'),
        arg('which', { kind: 'text', max: 80 }, 'debug or log'),
      ],
      [
        kw('scheduler', 'Scheduler parameters'),
        kw('allocate', 'Guarantee CPU time for processes'),
        arg('rest', { kind: 'text', max: 40 }, 'Time values'),
      ],
    ],
    build: () => noop(),
  },
  {
    views: ['config'],
    forms: [
      [
        kw('service', 'Modify use of network based services'),
        kw('password-encryption', 'Encrypt system passwords'),
      ],
      [
        NO,
        kw('service', 'Modify use of network based services'),
        kw('password-encryption', 'Encrypt system passwords'),
      ],
    ],
    build: (m, ctx) =>
      config(metaOps(ctx.device, (meta) => ({ ...meta, passwordEncryption: !m.has('no') }))),
  },
];

/** Cabecera de la configuración: versión, servicios fijos, nombre y marcadores de arranque. */
function blocks(device: Device): readonly ConfigBlock[] {
  const meta = metaOf(device);
  return [
    {
      order: 10,
      lines: [
        'version 15.1',
        'service timestamps debug datetime msec',
        'service timestamps log datetime msec',
        meta.passwordEncryption ? 'service password-encryption' : 'no service password-encryption',
      ],
    },
    { order: 20, lines: [`hostname ${device.config.system.identity}`] },
    { order: 25, lines: ['boot-start-marker', 'boot-end-marker'] },
    { order: 55, lines: ['ip cef', 'no ipv6 cef'] },
    { order: 110, lines: ['ip forward-protocol nd'] },
    { order: 111, lines: ['no ip http server'] },
    { order: 160, lines: ['control-plane'] },
  ];
}

export const SYSTEM_AREA: Area = {
  commands,
  blocks,
  messages: { 'bad-hostname': '% Hostname contains one or more illegal characters.' },
};
