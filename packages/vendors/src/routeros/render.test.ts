import { type Device, type Network, simTime } from '@nos/core';
import { deviceIn, net } from '@nos/core/testing';
import { describe, expect, it } from 'vitest';
import type { PrintMode } from './intent';
import { bridgeMenu } from './menus/interface';
import { addressMenu, dnsMenu, filterMenu, routeMenu } from './menus/ip';
import { identityMenu, logMenu } from './menus/system';
import { ROUTEROS_PLATFORM } from './platform';
import { renderPrint } from './render';
import type { MenuCtx, MenuDef, Row } from './schema';
import { DEFAULT_CLOCK_BASE } from './session';

const ctxOf = (n: Network, device: Device = deviceIn(n, 'R1')): MenuCtx => ({
  net: n,
  device,
  platform: ROUTEROS_PLATFORM,
  user: 'admin',
  clockBase: DEFAULT_CLOCK_BASE,
});

const print = (menu: MenuDef, ctx: MenuCtx, mode: PrintMode = 'table') =>
  renderPrint(menu, menu.rows(ctx), mode);

const text = (...lines: string[]): string => lines.join('\n');

const router = () => net().router('R1', 'sim-r5w', ROUTEROS_PLATFORM);

/** R1 recibe 10.0.0.5/24 por DHCP de R2 en ether1 y tiene 192.168.88.1/24 en bridge1. */
const dhcpLab = () =>
  router()
    .router('R2', 'sim-r5w', ROUTEROS_PLATFORM)
    .link('R1:ether1', 'R2:ether1')
    .address('R2', 'ether1', '10.0.0.1/24')
    .dhcpServer('R2', {
      iface: 'ether1',
      pool: '10.0.0.5-10.0.0.5',
      network: '10.0.0.0/24',
      gateway: '10.0.0.1',
    })
    .dhcpClient('R1', 'ether1')
    .bridge('R1', 'bridge1', [])
    .address('R1', 'bridge1', '192.168.88.1/24')
    .build();

const firewallLab = () =>
  router()
    .filter(
      'R1',
      'input',
      { kind: 'accept' },
      () => ({ connectionState: ['established', 'related'] }),
      { comment: 'defconf: accept established,related' },
    )
    .filter('R1', 'input', { kind: 'drop' }, (h) => ({
      inInterface: { value: h.iface('ether1'), negate: true },
    }))
    .add('R1', 'filterRules', () => ({
      chain: 'forward',
      match: {},
      action: { kind: 'drop' },
      log: false,
      disabled: true,
    }))
    .build();

describe('print en tabla', () => {
  it('ip address: leyenda, columnas y fila dinámica numerada', () => {
    const ctx = ctxOf(dhcpLab());
    const rows = addressMenu.rows(ctx);
    const result = renderPrint(addressMenu, rows, 'table');
    expect(result.text).toBe(
      text(
        'Flags: D - DYNAMIC',
        'Columns: ADDRESS, NETWORK, INTERFACE',
        '#   ADDRESS          NETWORK       INTERFACE',
        '0   192.168.88.1/24  192.168.88.0  bridge1',
        '1 D 10.0.0.5/24      10.0.0.0      ether1',
      ),
    );
    expect(result.numbered).toEqual(rows.map((r) => r.key));
  });

  it('ip route: las dinámicas no llevan número y las flags se alinean a la derecha', () => {
    const ctx = ctxOf(
      router()
        .router('ISP', 'sim-r5w', ROUTEROS_PLATFORM)
        .link('R1:ether1', 'ISP:ether1')
        .address('ISP', 'ether1', '203.0.113.1/30')
        .address('R1', 'ether1', '203.0.113.2/30')
        .bridge('R1', 'bridge1', [])
        .address('R1', 'bridge1', '192.168.88.1/24')
        .route('R1', '0.0.0.0/0', '203.0.113.1')
        .build(),
    );
    const rows = routeMenu.rows(ctx);
    const result = renderPrint(routeMenu, rows, 'table');
    expect(result.text).toBe(
      text(
        'Flags: D - DYNAMIC; A - ACTIVE; c - CONNECT, s - STATIC',
        'Columns: DST-ADDRESS, GATEWAY, DISTANCE',
        '#     DST-ADDRESS      GATEWAY      DISTANCE',
        '0  As 0.0.0.0/0        203.0.113.1         1',
        '  DAc 203.0.113.0/30   ether1              0',
        '  DAc 192.168.88.0/24  bridge1             0',
      ),
    );
    expect(result.numbered).toEqual([rows[0]?.key]);
  });

  it('ordena las flags según las columnas del menú, venga como venga la fila', () => {
    const row: Row = {
      key: 'x',
      numbered: false,
      props: new Map([
        ['dst-address', '10.0.0.0/8'],
        ['gateway', 'ether1'],
        ['distance', '0'],
      ]),
      flags: 'cAD',
    };
    expect(renderPrint(routeMenu, [row], 'table').text).toBe(
      text(
        'Flags: D - DYNAMIC; A - ACTIVE; c - CONNECT',
        'Columns: DST-ADDRESS, GATEWAY, DISTANCE',
        '#     DST-ADDRESS  GATEWAY  DISTANCE',
        '  DAc 10.0.0.0/8   ether1          0',
      ),
    );
  });
});

describe('print detail y terse', () => {
  it('firewall filter: comentario, flags y líneas partidas a 79 columnas', () => {
    const result = print(filterMenu, ctxOf(firewallLab()));
    expect(result.text).toBe(
      text(
        'Flags: X - DISABLED',
        ' 0   ;;; defconf: accept established,related',
        '     chain=input action=accept connection-state=established,related log=no',
        '     log-prefix=""',
        '',
        ' 1   chain=input action=drop in-interface=!ether1 log=no log-prefix=""',
        '',
        ' 2 X chain=forward action=drop log=no log-prefix=""',
      ),
    );
    expect(result.numbered).toHaveLength(3);
    for (const line of result.text.split('\n')) expect(line.length).toBeLessThanOrEqual(79);
  });

  it('un menú de tabla se puede ver en detail', () => {
    expect(print(addressMenu, ctxOf(dhcpLab()), 'detail').text).toBe(
      text(
        'Flags: D - DYNAMIC',
        ' 0   address=192.168.88.1/24 network=192.168.88.0 interface=bridge1',
        '     actual-interface=bridge1',
        '',
        ' 1 D address=10.0.0.5/24 network=10.0.0.0 interface=ether1',
        '     actual-interface=ether1',
      ),
    );
  });

  it('terse: una línea por fila, sin partir', () => {
    expect(print(addressMenu, ctxOf(dhcpLab()), 'terse').text).toBe(
      text(
        ' 0  address=192.168.88.1/24 network=192.168.88.0 interface=bridge1 actual-interface=bridge1',
        ' 1 D address=10.0.0.5/24 network=10.0.0.0 interface=ether1 actual-interface=ether1',
      ),
    );
    expect(print(filterMenu, ctxOf(firewallLab()), 'terse').text).toBe(
      text(
        ' 0  comment="defconf: accept established,related" chain=input action=accept connection-state=established,related log=no log-prefix=""',
        ' 1  chain=input action=drop in-interface=!ether1 log=no log-prefix=""',
        ' 2 X chain=forward action=drop log=no log-prefix=""',
      ),
    );
  });
});

describe('print stats y count', () => {
  it('stats usa las columnas de estadísticas, con contadores alineados a la derecha', () => {
    const n = firewallLab();
    const device = deviceIn(n, 'R1');
    const ids = filterMenu.rows(ctxOf(n)).flatMap((r) => (r.id === undefined ? [] : [r.id]));
    const ruleCounters = ids.slice(0, 1).map((rule) => ({ rule, packets: 1234, bytes: 3162108 }));
    const ctx = ctxOf(n, { ...device, oper: { ...device.oper, ruleCounters } });
    expect(print(filterMenu, ctx, 'stats').text).toBe(
      text(
        'Flags: X - DISABLED',
        'Columns: CHAIN, ACTION, BYTES, PACKETS',
        '#   CHAIN    ACTION      BYTES  PACKETS',
        ';;; defconf: accept established,related',
        '0   input    accept  3 162 108    1 234',
        '1   input    drop            0        0',
        '2 X forward  drop            0        0',
      ),
    );
  });

  it('stats sin columnas propias usa las de la tabla', () => {
    const ctx = ctxOf(router().bridge('R1', 'bridge1', []).build());
    expect(print(bridgeMenu, ctx, 'stats').text).toBe(
      text('Flags: R - RUNNING', 'Columns: NAME', '#   NAME', '0 R bridge1'),
    );
  });

  it('count devuelve el número de filas, también sin filas', () => {
    const ctx = ctxOf(dhcpLab());
    expect(print(addressMenu, ctx, 'count')).toEqual({
      text: '2',
      numbered: addressMenu.rows(ctx).map((r) => r.key),
    });
    expect(renderPrint(addressMenu, [], 'count').text).toBe('0');
    expect(renderPrint(addressMenu, [], 'table')).toEqual({ text: '', numbered: [] });
    expect(renderPrint(filterMenu, [], 'detail').text).toBe('');
  });
});

describe('menús únicos y log', () => {
  it('ip dns: clave alineada a la derecha y valor', () => {
    const ctx = ctxOf(router().dns('R1', ['1.1.1.1', '8.8.8.8'], true).build());
    const expected = text(
      '                servers: 1.1.1.1,8.8.8.8',
      '        dynamic-servers:',
      '  allow-remote-requests: yes',
      '             cache-size: 2048KiB',
      '          cache-max-ttl: 1w',
      '             cache-used: 0KiB',
    );
    expect(print(dnsMenu, ctx).text).toBe(expected);
    expect(print(dnsMenu, ctx, 'detail').text).toBe(expected);
    expect(print(identityMenu, ctx).text).toBe('  name: MikroTik');
  });

  it('log: hora, temas y mensaje', () => {
    const n = router().build();
    const device = deviceIn(n, 'R1');
    const log = [
      {
        at: simTime(1),
        event: {
          kind: 'config-change',
          scope: 'addresses',
          action: 'added',
          by: 'admin',
        } as const,
      },
      { at: simTime(65), event: { kind: 'session', action: 'logout', user: 'admin' } as const },
    ];
    const ctx = ctxOf(n, { ...device, oper: { ...device.oper, log } });
    expect(print(logMenu, ctx).text).toBe(
      text(
        ' 09:00:01 system,info address added by admin',
        ' 09:01:05 system,info,account user admin logged out from 127.0.0.1 via local',
      ),
    );
    expect(print(logMenu, ctx, 'count').text).toBe('2');
  });
});
