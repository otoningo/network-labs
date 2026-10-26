/**
 * Sistema: cambiar de vista (`system-view`, `quit`, `return`), el nombre del
 * equipo (`sysname`), guardar (`save`) y los `display` que no son de ningún
 * área: versión, configuración actual y la vista actual (`display this`).
 */
import type { Device } from '@nos/core';
import { type Area, type ConfigBlock, config, fault, intent } from '../area';
import { arg, type CommandSpec, kw } from '../grammar';
import type { ViewKind } from '../session';

const ALL_VIEWS: readonly ViewKind[] = ['user', 'system', 'interface', 'pool', 'acl', 'aaa'];
const SUB_VIEWS: readonly ViewKind[] = ['system', 'interface', 'pool', 'acl', 'aaa'];

const commands: CommandSpec[] = [
  {
    views: ['user'],
    forms: [[kw('system-view', 'Enter the system view')]],
    build: () => intent({ kind: 'session', change: { kind: 'enter', view: { kind: 'system' } } }),
  },
  {
    views: ALL_VIEWS,
    forms: [[kw('quit', 'Exit from current mode and enter prior mode')]],
    build: () => intent({ kind: 'session', change: { kind: 'quit' } }),
  },
  {
    views: SUB_VIEWS,
    forms: [[kw('return', 'Enter the privileged mode')]],
    build: () => intent({ kind: 'session', change: { kind: 'return' } }),
  },
  {
    views: ['system'],
    forms: [
      [kw('sysname', 'Set the host name'), arg('name', { kind: 'text', max: 246 }, 'Host name')],
    ],
    build: (m) => {
      const name = m.args['name'] ?? '';
      if (/\s/.test(name))
        return fault('wrong-parameter', (m.argAt['name'] ?? 0) + name.search(/\s/));
      return config([{ op: 'setSingleton', key: 'system', patch: { identity: name } }]);
    },
  },
  {
    views: ['system'],
    forms: [
      [kw('undo', 'Negate a command or set its default'), kw('sysname', 'Set the host name')],
    ],
    build: () => config([{ op: 'setSingleton', key: 'system', patch: { identity: 'Huawei' } }]),
  },
  {
    views: ['user'],
    forms: [[kw('save', 'Save the current configuration to the configuration file')]],
    build: () => intent({ kind: 'vendor', action: { kind: 'save' } }),
  },
  {
    views: ALL_VIEWS,
    forms: [
      [kw('display', 'Display information'), kw('version', 'Display version information')],
      [kw('display', 'Display information'), kw('current-configuration', 'Current configuration')],
      [kw('display', 'Display information'), kw('this', 'Current view running configuration')],
      [kw('display', 'Display information'), kw('saved-configuration', 'Saved configuration')],
    ],
    build: (m) => {
      const what = m.words[1] ?? 'version';
      return intent({ kind: 'show', view: { kind: 'display', what } });
    },
  },
];

/** `sysname` en su propio bloque: VRP lo imprime siempre. */
function blocks(device: Device): readonly ConfigBlock[] {
  return [{ order: 10, lines: [` sysname ${device.config.system.identity}`] }];
}

export const SYSTEM_AREA: Area = { commands, blocks };
