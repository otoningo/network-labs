import { describe, expect, it } from 'vitest';
import { deviceId, simTime } from '../model/brand';
import { formatIpv4, ipv4, prefix } from '../net/ipv4';
import { deviceIn, ifaceIn, net } from '../testing/builder';
import { ping, recordTrace, resolveName, tick, torch } from './runtime';
import { fileSize, loadBackup, readScript, removeFile, saveBackup, saveScript } from './storage';
import { trace } from './trace';

const PC1 = deviceId('PC1');
const R1 = deviceId('R1');

const office = () =>
  net()
    .cloud('ISP')
    .router('R1')
    .host('PC1')
    .host('PC2')
    .link('ISP:eth0', 'R1:ether1')
    .link('R1:ether2', 'PC1:eth0')
    .link('R1:ether3', 'PC2:eth0')
    .address('ISP', 'eth0', '203.0.113.1/24')
    .internet('ISP', { dns: { 'example.com': '93.184.216.34' } })
    .address('R1', 'ether1', '203.0.113.2/24')
    .route('R1', '0.0.0.0/0', '203.0.113.1')
    .masquerade('R1', 'ether1')
    .bridge('R1', 'bridge1', ['ether2', 'ether3'])
    .address('R1', 'bridge1', '192.168.88.1/24')
    .dhcpServer('R1', {
      iface: 'bridge1',
      pool: '192.168.88.10-192.168.88.254',
      network: '192.168.88.0/24',
      gateway: '192.168.88.1',
      dns: ['192.168.88.1'],
    })
    .dhcpClient('PC1', 'eth0')
    .dhcpClient('PC2', 'eth0');

describe('ping', () => {
  it('devuelve respuestas con tiempo estable y suma contadores de reglas', () => {
    const n = office()
      .filter('R1', 'forward', { kind: 'accept' }, () => ({}), { log: true, comment: 'todo' })
      .build();
    const result = ping(n, PC1, ipv4('8.8.8.8'), { count: 3 });
    expect(result.replies.map((r) => r.ok)).toEqual([true, true, true]);
    expect(result.replies[0]?.rttMs).toBeGreaterThan(14);
    expect(result.replies[0]?.rttMs).not.toBe(result.replies[1]?.rttMs);
    const r1 = deviceIn(result.net, 'R1');
    const ruleId = r1.config.firewall.filter[0]?.id;
    expect(r1.oper.ruleCounters.find((c) => c.rule === ruleId)?.packets).toBe(6);
    expect(r1.oper.log.filter((l) => l.event.kind === 'firewall')).toHaveLength(6);
    expect(
      r1.oper.ruleCounters.find((c) => c.rule === r1.config.firewall.nat[0]?.id)?.packets,
    ).toBe(3);
  });

  it('marca como perdidos los paquetes sin respuesta', () => {
    const n = office().build();
    const result = ping(n, PC1, ipv4('10.99.99.99'), {
      count: 2,
      src: ipv4('192.168.88.10'),
      ttl: 5,
    });
    expect(result.replies).toEqual([
      { seq: 0, ok: false },
      { seq: 1, ok: false },
    ]);
  });

  it('registra el log con prefijo de una regla', () => {
    const n = office()
      .filter('R1', 'forward', { kind: 'drop' }, () => ({}), { log: true })
      .op('R1', (h) => ({
        op: 'set',
        coll: 'filterRules',
        id: h.find('filterRules', () => true),
        patch: { logPrefix: 'BLOQ' },
      }))
      .build();
    const after = recordTrace(n, trace(n, { from: PC1, dst: ipv4('8.8.8.8'), protocol: 'icmp' }));
    const entry = deviceIn(after, 'R1').oper.log.at(-1)?.event;
    expect(entry).toMatchObject({ kind: 'firewall', prefix: 'BLOQ', chain: 'forward' });
  });
});

describe('resolución DNS', () => {
  const resolver = () => office().dns('R1', ['1.1.1.1'], true);

  it('resuelve por la cadena real de servidores y guarda en caché', () => {
    const n = resolver().build();
    const first = resolveName(n, PC1, 'Example.com');
    expect(first.outcome).toBe('answered');
    expect(first.address && formatIpv4(first.address)).toBe('93.184.216.34');
    expect(first.chain).toEqual(['PC1', 'R1', 'ISP']);
    expect(deviceIn(first.net, 'R1').oper.dnsCache).toEqual([
      expect.objectContaining({ name: 'example.com', data: '93.184.216.34', expiresAt: 300 }),
    ]);
    const second = resolveName(first.net, PC1, 'example.com');
    expect(second.chain).toEqual(['PC1', 'R1']);
    expect(deviceIn(first.net, 'PC1').oper.dnsCache).toEqual([]);
  });

  it('distingue nombre inexistente, sin servidores y sin respuesta', () => {
    expect(resolveName(resolver().build(), PC1, 'no-existe.test').outcome).toBe('nxdomain');
    expect(resolveName(net().host('PC1').build(), PC1, 'example.com').outcome).toBe('no-servers');
    expect(resolveName(office().build(), PC1, 'example.com').outcome).toBe('timeout');
    expect(resolveName(office().build(), deviceId('NADIE'), 'example.com').outcome).toBe('timeout');
  });

  it('usa registros estáticos y CNAME del router', () => {
    const n = resolver()
      .add('R1', 'dnsStatic', () => ({
        name: 'router.lan',
        type: 'A',
        address: ipv4('192.168.88.1'),
        ttlS: 3600,
        disabled: false,
      }))
      .add('R1', 'dnsStatic', () => ({
        name: 'gw.lan',
        type: 'CNAME',
        cname: 'router.lan',
        ttlS: 3600,
        disabled: false,
      }))
      .build();
    const result = resolveName(n, PC1, 'gw.lan');
    expect(result.address && formatIpv4(result.address)).toBe('192.168.88.1');
    expect(result.chain).toEqual(['PC1', 'R1', 'R1']);
  });

  it('caduca la caché con el tiempo', () => {
    const cached = resolveName(resolver().build(), PC1, 'example.com').net;
    expect(deviceIn(tick(cached, 301), 'R1').oper.dnsCache).toEqual([]);
    expect(deviceIn(tick(cached, 10), 'R1').oper.dnsCache).toHaveLength(1);
  });
});

describe('tráfico de fondo', () => {
  const busy = () =>
    office()
      .flow({
        id: 'descarga',
        from: 'PC1',
        to: '93.184.216.34',
        protocol: 'tcp',
        dstPort: 443,
        bps: 200_000,
        replyBps: 5_000_000,
      })
      .flow({
        id: 'perdido',
        from: 'PC2',
        to: '10.200.0.1',
        protocol: 'udp',
        dstPort: 9,
        bps: 1000,
        replyBps: 0,
      });

  it('Torch muestra el tráfico por interfaz L3 y por puerto del bridge', () => {
    const n = busy().build();
    const wan = torch(n, R1, ifaceIn(n, 'R1', 'ether1'));
    // El flujo hacia una IP privada sale igual por la WAN aunque nadie responda.
    expect(wan).toEqual([
      expect.objectContaining({
        flow: 'descarga',
        txBps: 200_000,
        rxBps: 5_000_000,
        dstPort: 443,
        protocol: 'tcp',
      }),
      expect.objectContaining({ flow: 'perdido', txBps: 1000, rxBps: 0 }),
    ]);
    expect(formatIpv4(wan[0]?.src ?? (0 as never))).toBe('192.168.88.10');
    const port = torch(n, R1, ifaceIn(n, 'R1', 'ether2'));
    expect(port).toEqual([
      expect.objectContaining({ flow: 'descarga', rxBps: 200_000, txBps: 5_000_000 }),
    ]);
    expect(torch(n, R1, ifaceIn(n, 'R1', 'ether4'))).toEqual([]);
  });

  it('tick suma contadores, fija tasas y mantiene conexiones con NAT', () => {
    const n = busy().build();
    const later = tick(n, 10);
    expect(later.now).toBe(10);
    const r1 = deviceIn(later, 'R1');
    const wan = r1.oper.interfaces.find((i) => i.iface === ifaceIn(later, 'R1', 'ether1'));
    expect(wan?.rateBps).toEqual({ rx: 5_000_000, tx: 201_000 });
    expect(wan?.tx.bytes).toBe(251_250);
    expect(wan?.rx.bytes).toBe(6_250_000);
    expect(r1.oper.conntrack).toEqual([
      expect.objectContaining({
        flow: 'descarga',
        protocol: 'tcp',
        srcNat: true,
        dstNat: false,
        expiresAt: 86410,
      }),
    ]);
    const twice = tick(later, 10);
    expect(deviceIn(twice, 'R1').oper.conntrack).toHaveLength(1);
    expect(
      deviceIn(twice, 'R1').oper.interfaces.find((i) => i.iface === ifaceIn(twice, 'R1', 'ether1'))
        ?.tx.bytes,
    ).toBe(502_500);
  });

  it('las reglas cuentan bytes del tráfico de fondo', () => {
    const n = busy()
      .filter('R1', 'forward', { kind: 'accept' }, () => ({
        dstAddress: { value: prefix('93.184.216.34/32'), negate: false },
      }))
      .build();
    const r1 = deviceIn(tick(n, 8), 'R1');
    const rule = r1.config.firewall.filter[0]?.id;
    expect(r1.oper.ruleCounters.find((c) => c.rule === rule)?.bytes).toBe(200_000);
  });
});

describe('almacenamiento', () => {
  it('guarda y restaura backups, y maneja scripts', () => {
    const n = office().build();
    const r1 = deviceIn(n, 'R1');
    const saved = saveBackup(r1, 'antes.backup', simTime(5));
    expect(saved.oper.log.at(-1)?.event).toEqual({ kind: 'backup-saved', file: 'antes.backup' });
    const broken = {
      ...saved,
      config: { ...saved.config, addressing: { ...saved.config.addressing, addresses: [] } },
    };
    const restored = loadBackup(broken, 'antes.backup', simTime(9));
    expect(restored.ok && restored.value.config.addressing.addresses).toHaveLength(2);
    expect(loadBackup(broken, 'nada.backup', simTime(9)).ok).toBe(false);

    const withScript = saveScript(saved, 'conf.rsc', '# texto', simTime(6));
    expect(readScript(withScript, 'conf.rsc')).toEqual({ ok: true, value: '# texto' });
    expect(readScript(withScript, 'antes.backup').ok).toBe(false);
    expect(withScript.storage.files.map((f) => f.name)).toEqual(['antes.backup', 'conf.rsc']);
    expect(
      fileSize(withScript.storage.files[1] ?? withScript.storage.files[0] ?? (null as never)),
    ).toBe(7);
    expect(fileSize(withScript.storage.files[0] ?? (null as never))).toBeGreaterThan(100);
    const removed = removeFile(withScript, 'conf.rsc');
    expect(removed.ok && removed.value.storage.files).toHaveLength(1);
    expect(removeFile(withScript, 'x').ok).toBe(false);
    expect(saveScript(withScript, 'conf.rsc', 'nuevo', simTime(7)).storage.files).toHaveLength(2);
  });
});
