import { describe, expect, it } from 'vitest';
import {
  addToIpv4,
  broadcastOf,
  formatIpv4,
  formatPrefix,
  formatRange,
  ipv4,
  isHostAddress,
  isNetworkAligned,
  isPrivateIpv4,
  lenOfMask,
  maskOf,
  networkOf,
  parseIpv4,
  parsePrefix,
  parseRange,
  prefix,
  prefixContains,
  prefixCovers,
  range,
  rangeContains,
  rangeSize,
  sameNetwork,
  usableHosts,
} from './ipv4';
import { deterministicMac, parseMac } from './mac';
import { formatPortSet, parsePortSet, portSetContains } from './ports';

describe('IPv4', () => {
  it.each([
    ['0.0.0.0', 0],
    ['192.168.88.1', 0xc0a85801],
    ['255.255.255.255', 0xffffffff],
  ])('parsea %s', (text, value) => {
    expect(parseIpv4(text)).toBe(value);
    expect(formatIpv4(ipv4(text))).toBe(text);
  });

  it.each(['256.0.0.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-1', '', 'a.b.c.d', '1..2.3'])(
    'rechaza %s',
    (text) => {
      expect(parseIpv4(text)).toBeNull();
    },
  );

  it('lanza con texto inválido solo en el helper de fixtures', () => {
    expect(() => ipv4('300.1.1.1')).toThrow();
  });

  it('calcula máscaras en los extremos', () => {
    expect(maskOf(0)).toBe(0);
    expect(maskOf(24)).toBe(0xffffff00);
    expect(maskOf(32)).toBe(0xffffffff);
    expect(lenOfMask(ipv4('255.255.255.252'))).toBe(30);
    expect(lenOfMask(ipv4('0.0.0.0'))).toBe(0);
    expect(lenOfMask(ipv4('255.0.255.0'))).toBeNull();
  });

  it('parsea prefijos en notación CIDR, de máscara y sin longitud', () => {
    expect(formatPrefix(prefix('10.0.0.1/8'))).toBe('10.0.0.1/8');
    expect(parsePrefix('10.0.0.1/255.255.0.0')).toEqual({ ip: ipv4('10.0.0.1'), len: 16 });
    expect(parsePrefix('10.0.0.1')).toEqual({ ip: ipv4('10.0.0.1'), len: 32 });
    expect(parsePrefix('10.0.0.1/33')).toBeNull();
    expect(parsePrefix('10.0.0.1/255.0.255.0')).toBeNull();
    expect(parsePrefix('10.0.0.300/8')).toBeNull();
    expect(parsePrefix('10.0.0.1/x')).toBeNull();
    expect(() => prefix('nope')).toThrow();
  });

  it('obtiene red y broadcast', () => {
    const p = prefix('192.168.88.77/24');
    expect(formatPrefix(networkOf(p))).toBe('192.168.88.0/24');
    expect(formatIpv4(broadcastOf(p))).toBe('192.168.88.255');
    expect(formatPrefix(networkOf(prefix('8.8.8.8/0')))).toBe('0.0.0.0/0');
    expect(isNetworkAligned(prefix('192.168.88.0/24'))).toBe(true);
    expect(isNetworkAligned(prefix('192.168.88.1/24'))).toBe(false);
  });

  it('comprueba pertenencia y cobertura', () => {
    const lan = prefix('192.168.88.0/24');
    expect(prefixContains(lan, ipv4('192.168.88.200'))).toBe(true);
    expect(prefixContains(lan, ipv4('192.168.89.1'))).toBe(false);
    expect(prefixContains(prefix('0.0.0.0/0'), ipv4('1.1.1.1'))).toBe(true);
    expect(prefixCovers(prefix('10.0.0.0/8'), prefix('10.1.0.0/16'))).toBe(true);
    expect(prefixCovers(prefix('10.1.0.0/16'), prefix('10.0.0.0/8'))).toBe(false);
    expect(sameNetwork(prefix('10.0.0.1/24'), prefix('10.0.0.200/24'))).toBe(true);
  });

  it('respeta las reglas de /31 y /32 para hosts', () => {
    expect(formatRange(usableHosts(prefix('10.0.0.0/30')))).toBe('10.0.0.1-10.0.0.2');
    expect(formatRange(usableHosts(prefix('10.0.0.0/31')))).toBe('10.0.0.0-10.0.0.1');
    expect(formatRange(usableHosts(prefix('10.0.0.9/32')))).toBe('10.0.0.9');
    expect(isHostAddress(prefix('10.0.0.0/24'))).toBe(false);
    expect(isHostAddress(prefix('10.0.0.255/24'))).toBe(false);
    expect(isHostAddress(prefix('10.0.0.0/31'))).toBe(true);
    expect(isHostAddress(prefix('10.0.0.5/24'))).toBe(true);
  });

  it('parsea rangos en sus tres formas', () => {
    const r = range('192.168.88.10-192.168.88.254');
    expect(rangeSize(r)).toBe(245);
    expect(rangeContains(r, ipv4('192.168.88.10'))).toBe(true);
    expect(rangeContains(r, ipv4('192.168.88.9'))).toBe(false);
    expect(formatRange(range('10.0.0.5'))).toBe('10.0.0.5');
    expect(formatRange(range('10.0.0.0/30'))).toBe('10.0.0.0-10.0.0.3');
    expect(parseRange('10.0.0.9-10.0.0.1')).toBeNull();
    expect(parseRange('10.0.0.1-x')).toBeNull();
    expect(parseRange('nope')).toBeNull();
    expect(() => range('nope')).toThrow();
  });

  it('suma con control de desbordamiento', () => {
    expect(addToIpv4(ipv4('10.0.0.255'), 1)).toBe(ipv4('10.0.1.0'));
    expect(addToIpv4(ipv4('255.255.255.255'), 1)).toBeNull();
    expect(addToIpv4(ipv4('0.0.0.0'), -1)).toBeNull();
  });

  it('reconoce direcciones privadas', () => {
    expect(isPrivateIpv4(ipv4('192.168.1.1'))).toBe(true);
    expect(isPrivateIpv4(ipv4('100.64.3.2'))).toBe(true);
    expect(isPrivateIpv4(ipv4('8.8.8.8'))).toBe(false);
  });
});

describe('MAC', () => {
  it.each([
    'aa:bb:cc:dd:ee:ff',
    'AA-BB-CC-DD-EE-FF',
    'aabb.ccdd.eeff',
    'aabb-ccdd-eeff',
    'aabbccddeeff',
  ])('normaliza %s', (text) => {
    expect(parseMac(text)).toBe('AA:BB:CC:DD:EE:FF');
  });

  it.each(['aa:bb:cc:dd:ee', 'aa:bb-cc:dd:ee:ff', 'aabbc:cdd:ee:ff', 'gg:bb:cc:dd:ee:ff'])(
    'rechaza %s',
    (text) => {
      expect(parseMac(text)).toBeNull();
    },
  );

  it('genera MACs deterministas y de administración local', () => {
    const a = deterministicMac('R1', 1);
    expect(a).toBe(deterministicMac('R1', 1));
    expect(a).not.toBe(deterministicMac('R1', 2));
    expect(a).not.toBe(deterministicMac('R2', 1));
    expect(a.startsWith('02:')).toBe(true);
    expect(parseMac(a)).toBe(a);
  });
});

describe('puertos', () => {
  it('parsea y formatea conjuntos', () => {
    const set = parsePortSet('22, 80,8000-8080');
    expect(set).not.toBeNull();
    if (!set) return;
    expect(formatPortSet(set)).toBe('22,80,8000-8080');
    expect(portSetContains(set, 8042)).toBe(true);
    expect(portSetContains(set, 443)).toBe(false);
  });

  it.each(['', '70000', '80-20', 'http', '1,,2'])('rechaza %s', (text) => {
    expect(parsePortSet(text)).toBeNull();
  });
});
