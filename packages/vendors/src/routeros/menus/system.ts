import {
  addressesOf,
  type CollectionKey,
  converge,
  createDevice,
  type Device,
  err,
  fileSize,
  formatIpv4,
  type LogEvent,
  loadBackup,
  type Network,
  ok,
  parseIpv4,
  type SingletonKey,
  saveBackup,
  trace,
} from '@nos/core';
import { ifaceName, refName } from '../refs';
import {
  type ActionDef,
  fault,
  type MenuCtx,
  type MenuDef,
  type Props,
  prop,
  ro,
  T,
} from '../schema';
import { formatClock, formatDateTime, formatDuration, formatSize, formatStamp } from '../values';
import {
  baseFrom,
  baseProps,
  COMMON_PROPS,
  collectionMenu,
  dynamicRow,
  F,
  flags,
  get,
  isYes,
  opt,
  props,
} from './common';
import { torchView } from './interface';

// ── Ayudantes ───────────────────────────────────────────────────────────────

export function replaceDevice(net: Network, device: Device): Network {
  return { ...net, devices: net.devices.map((d) => (d.id === device.id ? device : d)) };
}

/** Un reinicio vacía lo que vive en memoria: conexiones, caché DNS y contadores. */
export function rebooted(device: Device): Device {
  return {
    ...device,
    oper: {
      ...device.oper,
      conntrack: [],
      dnsCache: [],
      ruleCounters: [],
      interfaces: device.oper.interfaces.map((i) => ({
        ...i,
        rx: { packets: 0, bytes: 0 },
        tx: { packets: 0, bytes: 0 },
        rateBps: { rx: 0, tx: 0 },
      })),
    },
  };
}

const NOUNS: Readonly<Record<CollectionKey | SingletonKey, string>> = {
  interfaces: 'interface',
  interfaceLists: 'interface list',
  interfaceListMembers: 'interface list member',
  bridgePorts: 'bridge port',
  bridgeVlans: 'bridge vlan',
  addresses: 'address',
  staticArp: 'arp entry',
  dhcpClients: 'dhcp client',
  routes: 'route',
  pools: 'pool',
  dhcpServers: 'dhcp server',
  dhcpNetworks: 'dhcp network',
  staticLeases: 'dhcp lease',
  dnsStatic: 'static dns entry',
  filterRules: 'filter rule',
  natRules: 'nat rule',
  addressLists: 'address list entry',
  users: 'user',
  services: 'service',
  system: 'system identity',
  dns: 'dns settings',
  discovery: 'neighbor discovery settings',
};

function protoText(event: Extract<LogEvent, { kind: 'firewall' }>): string {
  if (event.protocol === 'icmp') return `ICMP (type ${event.icmpType ?? 8}, code 0)`;
  if (event.protocol === 'tcp') return event.state === 'new' ? 'TCP (SYN)' : 'TCP (ACK)';
  return 'UDP';
}

export function logLine(event: LogEvent, ctx: MenuCtx): { topics: string; message: string } {
  switch (event.kind) {
    case 'config-change':
      return {
        topics: 'system,info',
        message: `${NOUNS[event.scope]} ${event.action} by ${event.by}`,
      };
    case 'dhcp-assigned': {
      const lease = ctx.device.oper.dhcpLeases.find((l) => l.ip === event.ip);
      const host = lease?.hostName ? ` ${lease.hostName}` : '';
      return {
        topics: 'dhcp,info',
        message: `${refName(ctx, 'dhcp-server', event.server)} assigned ${formatIpv4(event.ip)} for ${event.mac}${host}`,
      };
    }
    case 'firewall': {
      const ep = (e: { ip: Parameters<typeof formatIpv4>[0]; port?: number }) =>
        e.port === undefined ? formatIpv4(e.ip) : `${formatIpv4(e.ip)}:${e.port}`;
      const inIf = event.inIface === undefined ? '(unknown 0)' : ifaceName(ctx, event.inIface);
      const outIf = event.outIface === undefined ? '(unknown 0)' : ifaceName(ctx, event.outIface);
      const prefix = event.prefix ? `${event.prefix} ` : '';
      return {
        topics: 'firewall,info',
        message: `${prefix}${event.chain}: in:${inIf} out:${outIf}, connection-state:${event.state} proto ${protoText(event)}, ${ep(event.src)}->${ep(event.dst)}, len ${event.len}`,
      };
    }
    case 'nat':
      return { topics: 'firewall,info', message: `nat ${event.chain}` };
    case 'dhcp-pool-empty':
      return {
        topics: 'dhcp,warning',
        message: `${refName(ctx, 'dhcp-server', event.server)} failed to give out IP address: pool <${refName(ctx, 'pool', event.pool)}> is empty`,
      };
    case 'backup-saved':
      return { topics: 'system,info', message: 'configuration backup saved' };
    case 'backup-loaded':
      return { topics: 'system,info,critical', message: 'configuration backup loaded' };
    case 'session':
      return {
        topics: 'system,info,account',
        message: `user ${event.user} ${event.action === 'login' ? 'logged in from 127.0.0.1 via local' : 'logged out from 127.0.0.1 via local'}`,
      };
  }
}

const confirmArg = prop('confirmed', T.bool);

// ── /system ─────────────────────────────────────────────────────────────────

const reboot: ActionDef = {
  help: 'Reboot the router',
  args: [confirmArg],
  run: (args, ctx) => {
    if (!isYes(args.get('confirmed'))) return ok({ confirm: 'Reboot, yes? [y/N]:' });
    return ok({
      net: converge(replaceDevice(ctx.net, rebooted(ctx.device))),
      output: 'system will reboot shortly',
      closed: true,
    });
  },
};

const resetConfiguration: ActionDef = {
  help: 'Reset the configuration to factory defaults',
  args: [
    prop('no-defaults', T.bool),
    prop('keep-users', T.bool),
    prop('skip-backup', T.bool),
    confirmArg,
  ],
  run: (args, ctx) => {
    if (!isYes(args.get('confirmed'))) return ok({ confirm: 'Dangerous! Reset anyway? [y/N]:' });
    const fresh = createDevice(ctx.device.id, ctx.device.hardware, ctx.platform);
    if (!fresh.ok) return err(fault('not-allowed'));
    const users = isYes(args.get('keep-users'))
      ? ctx.device.config.system.users
      : fresh.value.config.system.users;
    const config = { ...fresh.value.config, system: { ...fresh.value.config.system, users } };
    const device = rebooted({
      ...ctx.device,
      config,
      nextId: Math.max(ctx.device.nextId, fresh.value.nextId),
    });
    return ok({
      net: converge(replaceDevice(ctx.net, device)),
      output: 'system configuration will be reset',
      closed: true,
    });
  },
};

export const systemMenu: MenuDef = {
  path: 'system',
  help: 'System information and utilities',
  props: [],
  flags: [],
  style: 'none',
  columns: [],
  rows: () => [],
  actions: { reboot, 'reset-configuration': resetConfiguration },
};

export const identityMenu: MenuDef = {
  path: 'system/identity',
  help: 'System identity',
  coll: 'system',
  props: [prop('name', T.name, { default: 'MikroTik' })],
  flags: [],
  style: 'singleton',
  columns: [],
  export: { order: 99, style: 'set' },
  rows: (ctx) => [
    dynamicRow('singleton', props([['name', ctx.device.config.system.identity]]), ''),
  ],
  update: (_row, p) =>
    ok([{ op: 'setSingleton', key: 'system', patch: { identity: get(p, 'name') } }]),
};

export const resourceMenu: MenuDef = {
  path: 'system/resource',
  help: 'System resources',
  props: [
    ro('uptime'),
    ro('version'),
    ro('free-memory'),
    ro('total-memory'),
    ro('cpu'),
    ro('cpu-count'),
    ro('cpu-load'),
    ro('free-hdd-space'),
    ro('total-hdd-space'),
    ro('architecture-name'),
    ro('board-name'),
    ro('platform'),
  ],
  flags: [],
  style: 'singleton',
  columns: [],
  rows: (ctx) => [
    dynamicRow(
      'singleton',
      props([
        ['uptime', formatDuration(ctx.net.now)],
        ['version', '7 (simulated)'],
        ['free-memory', '201.4MiB'],
        ['total-memory', '256.0MiB'],
        ['cpu', 'ARM'],
        ['cpu-count', '4'],
        ['cpu-load', '1%'],
        ['free-hdd-space', '92.1MiB'],
        ['total-hdd-space', '128.0MiB'],
        ['architecture-name', 'arm'],
        ['board-name', ctx.device.hardware.board],
        ['platform', 'MikroTik'],
      ]),
      '',
    ),
  ],
};

const backupName = (name: string): string => (name.endsWith('.backup') ? name : `${name}.backup`);

export const backupMenu: MenuDef = {
  path: 'system/backup',
  help: 'Binary configuration backups',
  props: [],
  flags: [],
  style: 'none',
  columns: [],
  rows: () => [],
  actions: {
    save: {
      help: 'Save a configuration backup',
      args: [prop('name', T.name), prop('password', T.string), prop('dont-encrypt', T.bool)],
      run: (args, ctx) => {
        const name = backupName(
          opt(args, 'name') ??
            `${ctx.device.config.system.identity}-${formatStamp(ctx.clockBase, ctx.net.now)}`,
        );
        const device = saveBackup(ctx.device, name, ctx.net.now);
        return ok({ net: replaceDevice(ctx.net, device), output: 'Configuration backup saved' });
      },
    },
    load: {
      help: 'Restore a configuration backup and reboot',
      args: [
        prop('name', T.ref('file'), { required: true }),
        prop('password', T.string),
        confirmArg,
      ],
      run: (args, ctx) => {
        if (!isYes(args.get('confirmed'))) return ok({ confirm: 'Restore and reboot? [y/N]:' });
        const loaded = loadBackup(ctx.device, get(args, 'name'), ctx.net.now);
        if (!loaded.ok) return err(fault('no-such-item'));
        return ok({
          net: converge(replaceDevice(ctx.net, rebooted(loaded.value))),
          output: 'Restoring system configuration\nSystem configuration restored, rebooting now',
          closed: true,
        });
      },
    },
  },
};

// ── /user ───────────────────────────────────────────────────────────────────

/** Marca interna: "la contraseña no cambia". Nunca guardamos la contraseña real (D-012). */
const KEEP_PASSWORD = '\u0000keep';

export const userMenu: MenuDef = collectionMenu({
  path: 'user',
  help: 'User management',
  coll: 'users',
  props: [
    prop('name', T.name, { required: true }),
    prop('group', T.enumOf('full', 'write', 'read'), { default: 'read' }),
    prop('password', T.string, { default: '', hidden: true, noExport: true }),
    ro('last-logged-in'),
    ...COMMON_PROPS,
  ],
  flags: [[F.disabled]],
  style: 'table',
  columns: ['name', 'group', 'last-logged-in'],
  nameProp: 'name',
  toProps: (u) =>
    props([
      ['name', u.name],
      ['group', u.group],
      ['password', u.hasPassword ? KEEP_PASSWORD : ''],
      ['last-logged-in', ''],
      ...baseProps(u),
    ]),
  flagsOf: (u) => flags(['X', u.disabled]),
  fromProps: (p) =>
    ok({
      name: get(p, 'name'),
      group: get(p, 'group') as 'full' | 'write' | 'read',
      hasPassword: get(p, 'password') !== '',
      ...baseFrom(p),
    }),
});

// ── /file ───────────────────────────────────────────────────────────────────

export const fileMenu: MenuDef = {
  path: 'file',
  help: 'Files stored on the router',
  props: [ro('name'), ro('type'), ro('size'), ro('last-modified')],
  flags: [],
  style: 'table',
  columns: ['name', 'type', 'size', 'last-modified'],
  nameProp: 'name',
  rows: (ctx) =>
    ctx.device.storage.files.map((f) =>
      dynamicRow(
        `f${f.name}`,
        props([
          ['name', f.name],
          ['type', f.payload.kind === 'backup' ? 'backup' : 'script'],
          ['size', formatSize(fileSize(f))],
          ['last-modified', formatDateTime(ctx.clockBase, f.createdAt)],
        ]),
        '',
      ),
    ),
  removeOther: (rows, ctx) => {
    const names = new Set(rows.map((r) => get(r.props, 'name')));
    const device = {
      ...ctx.device,
      storage: { files: ctx.device.storage.files.filter((f) => !names.has(f.name)) },
    };
    return ok({ net: replaceDevice(ctx.net, device) });
  },
};

// ── /log ────────────────────────────────────────────────────────────────────

export const logMenu: MenuDef = {
  path: 'log',
  help: 'System logs',
  props: [ro('time'), ro('topics'), ro('message')],
  flags: [],
  style: 'lines',
  columns: ['time', 'topics', 'message'],
  rows: (ctx) =>
    ctx.device.oper.log.map((entry, i) => {
      const { topics, message } = logLine(entry.event, ctx);
      return dynamicRow(
        `g${i}`,
        props([
          ['time', formatClock(ctx.clockBase, entry.at)],
          ['topics', topics],
          ['message', message],
        ]),
        '',
      );
    }),
};

// ── /tool ───────────────────────────────────────────────────────────────────

const torchAction: ActionDef = {
  help: 'Traffic monitor',
  positional: 'interface',
  args: [
    prop('interface', T.ref('interface'), { required: true }),
    prop('src-address', T.prefix),
    prop('dst-address', T.prefix),
    prop('port', T.string),
    prop('ip-protocol', T.string),
    prop('duration', T.time),
  ],
  run: (args, ctx) => {
    const view = torchView(ctx, args);
    if (args.has('duration')) return ok({ output: view(ctx.net) });
    return ok({ live: { mode: 'replace', frame: (n: Network) => view(n) } });
  },
};

function traceroute(args: Props, ctx: MenuCtx): string {
  const dst = parseIpv4(get(args, 'address'));
  if (dst === null) return '';
  const rows: string[][] = [];
  for (let ttl = 1; ttl <= 30; ttl++) {
    const result = trace(ctx.net, { from: ctx.device.id, dst, protocol: 'icmp', ttl });
    const end = result.forward.end;
    const ms = `${(0.4 * ttl + (end.kind === 'delivered' && end.emulated ? 14 : 0)).toFixed(1)}ms`;
    if (end.kind === 'ttl-exceeded') {
      const hop = result.forward.hops.at(-1);
      const address = addressesOf(ctx.net, end.device).find((a) => a.iface === hop?.inIface)
        ?.address.ip;
      rows.push([String(ttl), address === undefined ? '' : formatIpv4(address), '0%', '3', ms]);
      continue;
    }
    if (result.ok) {
      rows.push([String(ttl), formatIpv4(dst), '0%', '3', ms]);
    } else {
      rows.push([String(ttl), '', '100%', '3', 'timeout']);
    }
    break;
  }
  const header = ['#', 'ADDRESS', 'LOSS', 'SENT', 'LAST'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === 2 || i === 3 ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd();
  return ['Columns: ADDRESS, LOSS, SENT, LAST', fmt(header), ...rows.map(fmt)].join('\n');
}

export const toolMenu: MenuDef = {
  path: 'tool',
  help: 'Diagnostic tools',
  props: [],
  flags: [],
  style: 'none',
  columns: [],
  rows: () => [],
  actions: {
    torch: torchAction,
    traceroute: {
      help: 'Traceroute',
      positional: 'address',
      args: [prop('address', T.ip, { required: true }), prop('count', T.int(1, 100))],
      run: (args, ctx) => ok({ output: traceroute(args, ctx) }),
    },
  },
};

export const SYSTEM_MENUS: readonly MenuDef[] = [
  systemMenu,
  identityMenu,
  resourceMenu,
  backupMenu,
  userMenu,
  fileMenu,
  logMenu,
  toolMenu,
];
