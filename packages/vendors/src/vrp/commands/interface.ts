/**
 * Interfaces: entrar en la vista de una interfaz, su dirección (`ip address`
 * con máscara X.X.X.X o longitud), `shutdown` y `description`, y los
 * `display ip interface brief` / `display interface brief`.
 */
import {
  broadcastOf,
  type Device,
  formatIpv4,
  type Interface,
  type ItemId,
  networkOf,
  type Op,
  parseIpv4,
} from '@nos/core';
import {
  type Area,
  config,
  currentIface,
  dottedMask,
  fault,
  ifaceByName,
  intent,
  lenOf,
  noop,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, canonicalIface, kw } from '../grammar';

const UNDO = kw('undo', 'Negate a command or set its default');
const DISPLAY = kw('display', 'Display information');
const IP = kw('ip', 'Specify IP configurations');
const ADDRESS = kw('address', 'Assign an IP address to this interface');

const addressesOf = (device: Device, iface: ItemId) =>
  device.config.addressing.addresses.filter((a) => a.iface === iface);

const commands: CommandSpec[] = [
  {
    views: ['system'],
    forms: [
      [
        kw('interface', 'Specify the interface configuration view'),
        arg('iface', { kind: 'iface' }, 'GigabitEthernet interface'),
      ],
    ],
    build: (m, ctx) => {
      const name = canonicalIface(m.args['iface'] ?? '') ?? '';
      // NULL0 existe siempre pero no se configura: aceptarla deja recargar una
      // configuración guardada, que siempre la lista.
      if (name === 'NULL0') return noop();
      const iface = ifaceByName(ctx.device, name);
      if (!iface) return fault('wrong-parameter', m.argAt['iface']);
      return intent({
        kind: 'session',
        change: { kind: 'enter', view: { kind: 'interface', iface: iface.id } },
      });
    },
  },
  {
    views: ['interface'],
    forms: [
      [
        IP,
        ADDRESS,
        arg('ip', { kind: 'ipv4' }, 'IP address'),
        arg('mask', { kind: 'mask-or-len' }, 'IP mask or mask length'),
      ],
    ],
    build: (m, ctx) =>
      setAddress(m.args['ip'] ?? '', m.args['mask'] ?? '', m.argAt['ip'] ?? 0, ctx),
  },
  {
    views: ['interface'],
    forms: [
      [UNDO, IP, ADDRESS],
      [
        UNDO,
        IP,
        ADDRESS,
        arg('ip', { kind: 'ipv4' }, 'IP address'),
        arg('mask', { kind: 'mask-or-len' }, 'IP mask or mask length'),
      ],
    ],
    build: (m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      const current = addressesOf(ctx.device, iface.id);
      const ip = m.args['ip'];
      const targets =
        ip === undefined
          ? current
          : current.filter(
              (a) =>
                formatIpv4(a.address.ip) === ip && a.address.len === lenOf(m.args['mask'] ?? ''),
            );
      if (ip !== undefined && targets.length === 0) return fault('address-not-exist');
      return config(targets.map((a): Op => ({ op: 'remove', coll: 'addresses', id: a.id })));
    },
  },
  {
    views: ['interface'],
    forms: [[kw('shutdown', 'Shut down this interface')]],
    build: (_m, ctx) => setDisabled(ctx, true),
  },
  {
    views: ['interface'],
    forms: [[UNDO, kw('shutdown', 'Shut down this interface')]],
    build: (_m, ctx) => setDisabled(ctx, false),
  },
  {
    views: ['interface'],
    forms: [
      [
        kw('description', 'Describe the interface'),
        arg('text', { kind: 'text', max: 242 }, 'Description of the interface'),
      ],
    ],
    build: (m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      return config([
        { op: 'set', coll: 'interfaces', id: iface.id, patch: { comment: m.args['text'] ?? '' } },
      ]);
    },
  },
  {
    views: ['interface'],
    forms: [[UNDO, kw('description', 'Describe the interface')]],
    build: (_m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface) return noop();
      return config([
        { op: 'set', coll: 'interfaces', id: iface.id, patch: {}, unset: ['comment'] },
      ]);
    },
  },
  {
    views: ['user', 'system', 'interface', 'pool', 'acl', 'aaa'],
    forms: [
      [
        DISPLAY,
        kw('ip', 'IP information'),
        kw('interface', 'Interface information'),
        kw('brief', 'Brief information'),
      ],
      [DISPLAY, kw('interface', 'Interface information'), kw('brief', 'Brief information')],
    ],
    build: (m) =>
      intent({
        kind: 'show',
        view: { kind: 'display', what: m.has('ip') ? 'ip interface brief' : 'interface brief' },
      }),
  },
];

function setDisabled(ctx: CmdCtx, disabled: boolean) {
  const iface = currentIface(ctx);
  if (!iface) return noop();
  if (iface.disabled === disabled) return noop();
  return config([{ op: 'set', coll: 'interfaces', id: iface.id, patch: { disabled } }]);
}

/** `ip address`: la nueva dirección sustituye a la principal de la interfaz, como en VRP. */
function setAddress(ipText: string, maskText: string, at: number, ctx: CmdCtx) {
  const iface = currentIface(ctx);
  const ip = parseIpv4(ipText);
  if (!iface || ip === null) return noop();
  const len = lenOf(maskText);
  const address = { ip, len };
  // Ni la dirección de red ni la de difusión valen como dirección de una interfaz.
  if (len < 31 && (networkOf(address).ip === ip || broadcastOf(address) === ip)) {
    return fault('invalid-address', at);
  }
  const overlap = ctx.device.config.addressing.addresses.find((a) => {
    if (a.iface === iface.id) return false;
    const shorter = Math.min(a.address.len, len);
    return networkOf({ ip: a.address.ip, len: shorter }).ip === networkOf({ ip, len: shorter }).ip;
  });
  if (overlap) return fault('address-overlap', at);
  const existing = addressesOf(ctx.device, iface.id);
  return config([
    ...existing.map((a): Op => ({ op: 'remove', coll: 'addresses', id: a.id })),
    { op: 'add', coll: 'addresses', item: { iface: iface.id, address, disabled: false } },
  ]);
}

// ── Display ─────────────────────────────────────────────────────────────────

/** Estado físico y de protocolo como los imprime VRP. */
function states(device: Device, iface: Interface): { physical: string; protocol: string } {
  const oper = device.oper.interfaces.find((o) => o.iface === iface.id);
  if (iface.disabled) return { physical: '*down', protocol: 'down' };
  const up = oper?.running === true;
  const hasIp = addressesOf(device, iface.id).length > 0;
  return { physical: up ? 'up' : 'down', protocol: up && hasIp ? 'up' : 'down' };
}

const LEGEND = [
  '*down: administratively down',
  '^down: standby',
  '(l): loopback',
  '(s): spoofing',
  '(E): E-Trunk down',
];

function displayIpBrief(ctx: CmdCtx): string {
  const device = ctx.device;
  const ifaces = device.config.interfaces.filter(
    (i) => i.kind === 'ethernet' || i.kind === 'vlan' || i.kind === 'loopback',
  );
  const rows = ifaces.map((iface) => {
    const addr = addressesOf(device, iface.id)[0];
    const s = states(device, iface);
    const text = addr ? `${formatIpv4(addr.address.ip)}/${addr.address.len}` : 'unassigned';
    return { name: iface.name, addr: text, ...s };
  });
  // NULL0 existe siempre y siempre está arriba.
  rows.push({ name: 'NULL0', addr: 'unassigned', physical: 'up', protocol: 'up(s)' });
  const count = (field: 'physical' | 'protocol', up: boolean) =>
    rows.filter((r) => r[field].startsWith('up') === up).length;
  return [
    ...LEGEND,
    `The number of interface that is UP in Physical is ${count('physical', true)}`,
    `The number of interface that is DOWN in Physical is ${count('physical', false)}`,
    `The number of interface that is UP in Protocol is ${count('protocol', true)}`,
    `The number of interface that is DOWN in Protocol is ${count('protocol', false)}`,
    '',
    `${'Interface'.padEnd(34)}${'IP Address/Mask'.padEnd(21)}${'Physical'.padEnd(11)}Protocol  `,
    ...rows.map(
      (r) =>
        `${r.name.padEnd(34)}${r.addr.padEnd(21)}${r.physical.padEnd(11)}${r.protocol.padEnd(10)}`,
    ),
  ].join('\n');
}

function displayBrief(ctx: CmdCtx): string {
  const device = ctx.device;
  const rows = device.config.interfaces
    .filter((i) => i.kind === 'ethernet')
    .map((iface) => {
      const s = states(device, iface);
      return `${iface.name.padEnd(28)}${s.physical.padEnd(9)}${s.protocol.padEnd(9)}0%     0%          0        0`;
    });
  return [
    'PHY: Physical',
    '*down: administratively down',
    '^down: standby',
    '(l): loopback',
    '(s): spoofing',
    '(b): BFD down',
    '(e): ETHOAM down',
    '(dl): DLDP down',
    '(d): Dampening Suppressed',
    'InUti/OutUti: input utility/output utility',
    `${'Interface'.padEnd(28)}${'PHY'.padEnd(9)}${'Protocol'.padEnd(9)}InUti OutUti   inErrors  outErrors`,
    ...rows,
    `${'NULL0'.padEnd(28)}${'up'.padEnd(9)}${'up(s)'.padEnd(9)}0%     0%          0        0`,
  ].join('\n');
}

/** Líneas propias de la interfaz en `display current-configuration`. */
function interfaceLines(device: Device, iface: Interface): readonly string[] {
  const lines: string[] = [];
  if (iface.comment) lines.push(` description ${iface.comment}`);
  if (iface.disabled) lines.push(' shutdown');
  for (const a of addressesOf(device, iface.id)) {
    lines.push(` ip address ${formatIpv4(a.address.ip)} ${dottedMask(a.address.len)}`);
  }
  return lines;
}

export const INTERFACE_AREA: Area = {
  commands,
  displays: {
    'ip interface brief': (ctx) => displayIpBrief(ctx),
    'interface brief': (ctx) => displayBrief(ctx),
  },
  interfaceLines,
};
