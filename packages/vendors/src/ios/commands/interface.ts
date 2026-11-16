/**
 * Interfaces: entrar en el modo de una interfaz, su dirección (`ip address`
 * con máscara A.B.C.D), `shutdown` / `no shutdown` y `description`, y los
 * `show ip interface brief` / `show interfaces`.
 *
 * En IOS los puertos del router salen apagados (`shutdown`, ver platform.ts);
 * una interfaz apagada es una interfaz neutral deshabilitada, así que el
 * enlace no sube y no pasa tráfico hasta el `no shutdown`.
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
  type Built,
  config,
  currentIface,
  dottedMask,
  fault,
  type InterfaceLine,
  ifaceByName,
  intent,
  listedInterfaces,
  noop,
  show,
} from '../area';
import { arg, type CmdCtx, type CommandSpec, canonicalIface, kw } from '../grammar';
import { EXEC_VIEWS } from '../session';
import { lenOfMaskText } from './shared';

const NO = kw('no', 'Negate a command or set its defaults');
const SHOW = kw('show', 'Show running system information');
const IP = kw('ip', 'Interface Internet Protocol config commands');
const ADDRESS = kw('address', 'Set the IP address of an interface');
const SHUTDOWN = kw('shutdown', 'Shutdown the selected interface');
const DESCRIPTION = kw('description', 'Interface specific description');

const addressesOf = (device: Device, iface: ItemId) =>
  device.config.addressing.addresses.filter((a) => a.iface === iface);

const commands: CommandSpec[] = [
  {
    views: ['config'],
    forms: [
      [
        kw('interface', 'Select an interface to configure'),
        arg('iface', { kind: 'iface' }, 'GigabitEthernet IEEE 802.3z'),
      ],
    ],
    build: (m, ctx) => {
      const name = canonicalIface(m.args['iface'] ?? '') ?? '';
      // Null0 existe siempre pero no tiene nada que configurar.
      if (name.toLowerCase() === 'null0') return noop();
      const iface = ifaceByName(ctx.device, name);
      if (!iface) return fault('invalid', m.argAt['iface']);
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
        arg('mask', { kind: 'mask' }, 'IP subnet mask'),
      ],
    ],
    build: (m, ctx) => setAddress(m.args['ip'] ?? '', m.args['mask'] ?? '', ctx),
  },
  {
    views: ['interface'],
    forms: [
      [NO, IP, ADDRESS],
      [
        NO,
        IP,
        ADDRESS,
        arg('ip', { kind: 'ipv4' }, 'IP address'),
        arg('mask', { kind: 'mask' }, 'IP subnet mask'),
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
                formatIpv4(a.address.ip) === ip &&
                a.address.len === lenOfMaskText(m.args['mask'] ?? ''),
            );
      if (ip !== undefined && targets.length === 0) return fault('address-not-found');
      return config(targets.map((a): Op => ({ op: 'remove', coll: 'addresses', id: a.id })));
    },
  },
  {
    views: ['interface'],
    forms: [[SHUTDOWN]],
    build: (_m, ctx) => setDisabled(ctx, true),
  },
  {
    views: ['interface'],
    forms: [[NO, SHUTDOWN]],
    build: (_m, ctx) => setDisabled(ctx, false),
  },
  {
    views: ['interface'],
    forms: [
      [
        DESCRIPTION,
        arg('text', { kind: 'text', max: 240 }, 'Up to 240 characters describing this interface'),
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
    forms: [[NO, DESCRIPTION]],
    build: (_m, ctx) => {
      const iface = currentIface(ctx);
      if (!iface?.comment) return noop();
      return config([
        { op: 'set', coll: 'interfaces', id: iface.id, patch: {}, unset: ['comment'] },
      ]);
    },
  },
  {
    // Lo que imprime `show running-config` en cada puerto; el simulador no negocia velocidad.
    views: ['interface'],
    forms: [
      [kw('duplex', 'Configure duplex operation'), kw('auto', 'Enable AUTO duplex configuration')],
      [kw('duplex', 'Configure duplex operation'), kw('full', 'Force full duplex operation')],
      [kw('speed', 'Configure speed operation'), kw('auto', 'Enable AUTO speed configuration')],
      [kw('speed', 'Configure speed operation'), kw('1000', 'Force 1000 Mbps operation')],
      [kw('speed', 'Configure speed operation'), kw('100', 'Force 100 Mbps operation')],
    ],
    build: () => noop(),
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [
        SHOW,
        kw('ip', 'IP information'),
        kw('interface', 'IP interface status and configuration'),
        kw('brief', 'Brief summary of IP status and configuration'),
      ],
    ],
    build: () => show('ip interface brief'),
  },
  {
    views: EXEC_VIEWS,
    forms: [
      [SHOW, kw('interfaces', 'Interface status and configuration')],
      [
        SHOW,
        kw('interfaces', 'Interface status and configuration'),
        arg('iface', { kind: 'iface' }, 'GigabitEthernet IEEE 802.3z'),
      ],
    ],
    build: (m, ctx) => {
      const text = m.args['iface'];
      if (text === undefined) return show('interfaces');
      const iface = ifaceByName(ctx.device, canonicalIface(text) ?? '');
      if (!iface) return fault('invalid', m.argAt['iface']);
      return show('interfaces', iface.name);
    },
  },
];

function setDisabled(ctx: CmdCtx, disabled: boolean): Built {
  const iface = currentIface(ctx);
  if (!iface || iface.disabled === disabled) return noop();
  return config([{ op: 'set', coll: 'interfaces', id: iface.id, patch: { disabled } }]);
}

/** `ip address`: la nueva dirección sustituye a la principal de la interfaz, como en IOS. */
function setAddress(ipText: string, maskText: string, ctx: CmdCtx): Built {
  const iface = currentIface(ctx);
  const ip = parseIpv4(ipText);
  if (!iface || ip === null) return noop();
  const len = lenOfMaskText(maskText);
  const address = { ip, len };
  // Ni la dirección de red ni la de difusión valen como dirección de una interfaz.
  if (len < 31 && (networkOf(address).ip === ip || broadcastOf(address) === ip)) {
    return fault('bad-mask', undefined, { len, ip: ipText });
  }
  const overlap = ctx.device.config.addressing.addresses.find((a) => {
    if (a.iface === iface.id) return false;
    const shorter = Math.min(a.address.len, len);
    return networkOf({ ip: a.address.ip, len: shorter }).ip === networkOf({ ip, len: shorter }).ip;
  });
  if (overlap) {
    const other = ctx.device.config.interfaces.find((i) => i.id === overlap.iface);
    return fault('address-overlap', undefined, {
      net: formatIpv4(networkOf(address).ip),
      iface: other?.name ?? '',
    });
  }
  const existing = addressesOf(ctx.device, iface.id);
  return config([
    ...existing.map((a): Op => ({ op: 'remove', coll: 'addresses', id: a.id })),
    { op: 'add', coll: 'addresses', item: { iface: iface.id, address, disabled: false } },
  ]);
}

// ── Show ────────────────────────────────────────────────────────────────────

/** Estado y protocolo como los imprime IOS. */
export function ifaceStates(
  device: Device,
  iface: Interface,
): { readonly status: string; readonly protocol: string } {
  if (iface.disabled) return { status: 'administratively down', protocol: 'down' };
  const running = device.oper.interfaces.find((o) => o.iface === iface.id)?.running === true;
  return running ? { status: 'up', protocol: 'up' } : { status: 'down', protocol: 'down' };
}

function showIpBrief(ctx: CmdCtx): string {
  const device = ctx.device;
  const header = `${'Interface'.padEnd(27)}${'IP-Address'.padEnd(16)}${'OK?'.padEnd(4)}${'Method'.padEnd(7)}${'Status'.padEnd(22)}Protocol`;
  const rows = listedInterfaces(device).map((iface) => {
    const addr = addressesOf(device, iface.id)[0];
    const s = ifaceStates(device, iface);
    const ip = addr ? formatIpv4(addr.address.ip) : 'unassigned';
    const method = addr ? 'manual' : 'unset';
    return `${iface.name.padEnd(27)}${ip.padEnd(16)}${'YES'.padEnd(4)}${method.padEnd(7)}${s.status.padEnd(22)}${s.protocol}`;
  });
  return [header, ...rows].join('\n');
}

/** MAC con el formato de IOS: tres grupos de cuatro cifras (`0050.56aa.0001`). */
export function ciscoMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

function interfaceDetail(device: Device, iface: Interface): string[] {
  const s = ifaceStates(device, iface);
  const oper = device.oper.interfaces.find((o) => o.iface === iface.id);
  const addr = addressesOf(device, iface.id)[0];
  const mac = ciscoMac(iface.mac);
  return [
    `${iface.name} is ${s.status}, line protocol is ${s.protocol}`,
    `  Hardware is Gigabit Ethernet, address is ${mac} (bia ${mac})`,
    ...(iface.comment ? [`  Description: ${iface.comment}`] : []),
    ...(addr ? [`  Internet address is ${formatIpv4(addr.address.ip)}/${addr.address.len}`] : []),
    `  MTU ${iface.mtu} bytes, BW 1000000 Kbit/sec, DLY 10 usec,`,
    '     reliability 255/255, txload 1/255, rxload 1/255',
    '  Encapsulation ARPA, loopback not set',
    s.protocol === 'up'
      ? '  Full Duplex, 1Gbps, media type is RJ45'
      : '  Auto-duplex, Auto Speed, media type is RJ45',
    `     ${oper?.rx.packets ?? 0} packets input, ${oper?.rx.bytes ?? 0} bytes`,
    `     ${oper?.tx.packets ?? 0} packets output, ${oper?.tx.bytes ?? 0} bytes`,
  ];
}

function showInterfaces(ctx: CmdCtx, name: string | undefined): string {
  const device = ctx.device;
  const list = listedInterfaces(device).filter((i) => name === undefined || i.name === name);
  return list.flatMap((i) => interfaceDetail(device, i)).join('\n');
}

/** Líneas propias de la interfaz en `show running-config`. */
function interfaceLines(device: Device, iface: Interface): readonly InterfaceLine[] {
  const lines: InterfaceLine[] = [];
  if (iface.comment) lines.push({ order: 10, line: ` description ${iface.comment}` });
  const addrs = addressesOf(device, iface.id);
  if (addrs.length === 0) lines.push({ order: 20, line: ' no ip address' });
  for (const a of addrs) {
    lines.push({
      order: 20,
      line: ` ip address ${formatIpv4(a.address.ip)} ${dottedMask(a.address.len)}`,
    });
  }
  if (iface.disabled) lines.push({ order: 40, line: ' shutdown' });
  if (iface.kind === 'ethernet') {
    lines.push({ order: 50, line: ' duplex auto' }, { order: 51, line: ' speed auto' });
  }
  return lines;
}

export const INTERFACE_AREA: Area = {
  commands,
  shows: {
    'ip interface brief': (ctx) => showIpBrief(ctx),
    interfaces: (ctx, name) => showInterfaces(ctx, name),
  },
  interfaceLines,
  messages: {
    'bad-mask': 'Bad mask /{len} for address {ip}',
    'address-overlap': '% {net} overlaps with {iface}',
    'address-not-found': '% Invalid address',
  },
};
