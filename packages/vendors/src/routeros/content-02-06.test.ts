/**
 * Labs 2 a 6 de "MikroTik desde cero" tal como se publican en content/labs/routeros:
 * cada uno se resuelve por la CLI, objetivo a objetivo, y los errores típicos
 * del alumno no cuentan como resueltos. Se valida el estado de la red, nunca
 * las cadenas de comandos.
 */
import { describe, expect, it } from 'vitest';
import { Bench, loadLabFile } from './content-kit';

const bench = (file: string): Bench => new Bench(loadLabFile(file));

/** MAC de la primera interfaz de un equipo, como la vería el alumno en los leases. */
const macOf = (b: Bench, id: string): string =>
  b.net.devices.find((d) => d.id === id)?.config.interfaces[0]?.mac ?? '';

// ── Lab 2: interfaces y direcciones IP ──────────────────────────────────────

describe('lab 2: interfaces y direcciones IP', () => {
  const FILE = '02-interfaces-direcciones.yaml';

  it('arranca con el trabajo a medias del técnico anterior', () => {
    const r1 = bench(FILE).on('R1');
    expect(r1.ok('/ip address print')).toContain('192.168.10.1/32');
    expect(r1.ok('/interface print')).toMatch(/X +ether3/);
  });

  it('cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['wan-name', 'wan-ip', 'pc1', 'pc2', 'cleanup']);

    r1.ok('/interface set ether1 name=ether1-wan');
    expect(b.pending()).toContain('wan-name');
    r1.ok('/interface comment ether1-wan comment="Enlace al ISP"');
    expect(b.pending()).toEqual(['wan-ip', 'pc1', 'pc2', 'cleanup']);

    r1.ok('/ip address add address=203.0.113.2/24 interface=ether1-wan');
    expect(r1.ok('/ping 203.0.113.1 count=1')).toContain('received=1');
    expect(b.pending()).toEqual(['pc1', 'pc2', 'cleanup']);

    r1.ok('/ip address set [find address="192.168.10.1/32"] address=192.168.10.1/24');
    expect(b.pending()).toEqual(['pc2', 'cleanup']);

    r1.ok('/interface enable ether3');
    expect(b.pending()).toEqual(['pc2', 'cleanup']);
    r1.ok('/ip address add address=192.168.20.1/24 interface=ether3');
    expect(b.pending()).toEqual(['cleanup']);

    r1.ok('/ip address remove [find interface=ether4]');
    expect(b.pending()).toEqual([]);
  });

  it('mover la dirección de ether4 a ether3 resuelve dos objetivos a la vez', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/interface enable ether3');
    r1.ok('/ip address set [find interface=ether4] interface=ether3');
    expect(b.pending()).toEqual(['wan-name', 'wan-ip', 'pc1']);
  });

  it('error típico: volver a escribir la dirección sin máscara no arregla nada', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip address remove [find interface=ether2]');
    r1.ok('/ip address add address=192.168.10.1 interface=ether2');
    expect(b.pending()).toContain('pc1');
    r1.ok('/ip address add address=203.0.113.2 interface=ether1');
    expect(b.pending()).toContain('wan-ip');
  });

  it('error típico: dirección correcta con el puerto todavía deshabilitado', () => {
    const b = bench(FILE);
    b.on('R1').ok('/ip address add address=192.168.20.1/24 interface=ether3');
    expect(b.pending()).toContain('pc2');
  });

  it('deshabilitar la dirección sobrante no es quitarla; renombrar sin comentario no basta', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip address disable [find interface=ether4]');
    r1.ok('/interface set ether1 name=ether1-wan');
    expect(b.pending()).toEqual(['wan-name', 'wan-ip', 'pc1', 'pc2', 'cleanup']);
  });
});

// ── Lab 3: rutas estáticas ──────────────────────────────────────────────────

describe('lab 3: rutas estáticas', () => {
  const FILE = '03-rutas-estaticas.yaml';

  it('cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    const r2 = b.on('R2');
    expect(b.pending()).toEqual(['sedes', 'salida', 'defecto']);

    r1.ok('/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2');
    expect(b.pending()).toEqual(['sedes', 'salida', 'defecto']);
    r2.ok('/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1');
    expect(b.pending()).toEqual(['salida', 'defecto']);

    r2.ok('/ip route add gateway=203.0.113.1');
    expect(r2.ok('/ping 8.8.8.8 count=1')).toContain('received=1');
    expect(b.pending()).toEqual(['defecto']);

    r1.ok('/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.2');
    expect(b.pending()).toEqual([]);
    // La ruta específica ya sobra: la por defecto también lleva a la sede B.
    r1.ok('/ip route remove [find dst-address=192.168.2.0/24]');
    expect(b.pending()).toEqual([]);
  });

  it('error típico: la ruta solo en un sentido no cuenta', () => {
    const b = bench(FILE);
    b.on('R1').ok('/ip route add dst-address=192.168.2.0/24 gateway=10.0.12.2');
    b.on('R1').ok('/ip route add gateway=10.0.12.2');
    expect(b.pending()).toEqual(['sedes', 'salida', 'defecto']);
  });

  it('error típico: un gateway mal escrito deja la ruta por defecto inactiva', () => {
    const b = bench(FILE);
    b.on('R2').ok('/ip route add dst-address=192.168.1.0/24 gateway=10.0.12.1');
    b.on('R2').ok('/ip route add gateway=203.0.113.1');
    b.on('R1').ok('/ip route add gateway=10.0.21.2');
    expect(b.pending()).toEqual(['sedes', 'defecto']);
  });
});

// ── Lab 4: bridge y VLANs ───────────────────────────────────────────────────

describe('lab 4: bridge y VLANs', () => {
  const FILE = '04-bridge-vlans.yaml';

  it('cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['vlan10', 'vlan20', 'gw10', 'inter-vlan']);

    r1.ok('/interface bridge add name=bridge1');
    r1.ok('/interface bridge port add bridge=bridge1 interface=ether2 pvid=10');
    r1.ok('/interface bridge port add bridge=bridge1 interface=ether3 pvid=20');
    r1.ok('/interface bridge port add bridge=bridge1 interface=ether5');
    r1.ok('/interface bridge vlan add bridge=bridge1 vlan-ids=10 tagged=ether5');
    expect(b.pending()).toEqual(['vlan10', 'vlan20', 'gw10', 'inter-vlan']);
    r1.ok('/interface bridge set bridge1 vlan-filtering=yes');
    expect(b.pending()).toEqual(['vlan20', 'gw10', 'inter-vlan']);

    r1.ok('/interface bridge vlan add bridge=bridge1 vlan-ids=20 tagged=ether5');
    expect(b.pending()).toEqual(['gw10', 'inter-vlan']);

    r1.ok('/interface vlan add name=vlan10 vlan-id=10 interface=bridge1');
    r1.ok('/ip address add address=10.0.10.1/24 interface=vlan10');
    expect(b.pending()).toEqual(['gw10', 'inter-vlan']);
    r1.ok('/interface bridge vlan set [find vlan-ids=10] tagged=bridge1,ether5');
    expect(b.pending()).toEqual(['inter-vlan']);

    r1.ok('/interface vlan add name=vlan20 vlan-id=20 interface=bridge1');
    r1.ok('/ip address add address=10.0.20.1/24 interface=vlan20');
    r1.ok('/interface bridge vlan set [find vlan-ids=20] tagged=bridge1,ether5');
    expect(b.pending()).toEqual([]);
  });

  it('error típico: un bridge sin vlan-filtering no lleva las VLAN por el troncal', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2 pvid=10',
      '/interface bridge port add bridge=bridge1 interface=ether3 pvid=20',
      '/interface bridge port add bridge=bridge1 interface=ether5',
      '/interface bridge vlan add bridge=bridge1 vlan-ids=10,20 tagged=bridge1,ether5',
      '/interface vlan add name=vlan10 vlan-id=10 interface=bridge1',
      '/ip address add address=10.0.10.1/24 interface=vlan10',
    ]);
    expect(b.pending()).toEqual(['vlan10', 'vlan20', 'gw10', 'inter-vlan']);
  });

  it('error típico: la dirección en un puerto del bridge en vez de en la VLAN', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/interface bridge add name=bridge1',
      '/interface bridge port add bridge=bridge1 interface=ether2 pvid=10',
      '/interface bridge port add bridge=bridge1 interface=ether5',
      '/interface bridge vlan add bridge=bridge1 vlan-ids=10 tagged=bridge1,ether5',
      '/interface bridge set bridge1 vlan-filtering=yes',
      '/ip address add address=10.0.10.1/24 interface=ether2',
    ]);
    expect(b.pending()).toEqual(['vlan20', 'gw10', 'inter-vlan']);
  });
});

// ── Lab 5: servidor DHCP ────────────────────────────────────────────────────

describe('lab 5: servidor DHCP', () => {
  const FILE = '05-dhcp-server.yaml';

  it('cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['lease', 'gateway', 'dns', 'reserva']);

    r1.ok('/ip pool add name=pool-lan ranges=192.168.88.100-192.168.88.199');
    r1.ok('/ip dhcp-server add interface=bridge1 address-pool=pool-lan');
    expect(b.pending()).toEqual(['gateway', 'dns', 'reserva']);

    r1.ok('/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1');
    expect(b.pending()).toEqual(['dns', 'reserva']);
    r1.ok('/ip dhcp-server network set [find address=192.168.88.0/24] dns-server=192.168.88.1');
    expect(b.pending()).toEqual(['reserva']);

    r1.ok('/ip dhcp-server lease print');
    r1.ok(`/ip dhcp-server lease make-static [find mac-address=${macOf(b, 'IMP')}]`);
    expect(b.pending()).toEqual(['reserva']);
    r1.ok(`/ip dhcp-server lease set [find mac-address=${macOf(b, 'IMP')}] address=192.168.88.50`);
    expect(b.pending()).toEqual([]);
  });

  it('una reserva creada a mano con la MAC también vale', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/ip pool add name=pool-lan ranges=192.168.88.100-192.168.88.199',
      '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
      `/ip dhcp-server lease add address=192.168.88.50 mac-address=${macOf(b, 'IMP')}`,
    ]);
    expect(b.pending()).toEqual(['gateway', 'dns']);
  });

  it('error típico: sin /ip dhcp-server network hay lease pero no gateway', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/ip pool add name=pool-lan ranges=192.168.88.100-192.168.88.199',
      '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
    ]);
    expect(b.pending()).toEqual(['gateway', 'dns', 'reserva']);
  });

  it('error típico: el servidor en un puerto del bridge no entrega nada', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/ip pool add name=pool-lan ranges=192.168.88.100-192.168.88.199',
      '/ip dhcp-server add interface=ether2 address-pool=pool-lan',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1',
    ]);
    expect(b.pending()).toEqual(['lease', 'gateway', 'reserva']);
  });

  it('error típico: un gateway que no es el router no saca a la PC de la LAN', () => {
    const b = bench(FILE);
    b.on('R1').script([
      '/ip pool add name=pool-lan ranges=192.168.88.100-192.168.88.199',
      '/ip dhcp-server add interface=bridge1 address-pool=pool-lan',
      '/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.254 dns-server=192.168.88.1',
    ]);
    expect(b.pending()).toEqual(['gateway', 'reserva']);
  });
});

// ── Lab 6: NAT y masquerade ─────────────────────────────────────────────────

describe('lab 6: NAT y masquerade', () => {
  const FILE = '06-nat-masquerade.yaml';

  it('cada objetivo se cumple por el estado, en el orden en que se resuelve', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['wan', 'oficina', 'invitados']);

    r1.ok('/ip dhcp-client add interface=ether1');
    expect(r1.ok('/ip dhcp-client print')).toMatch(/bound\s+203\.0\.113\.\d+\/24/);
    expect(b.pending()).toEqual(['oficina', 'invitados']);

    r1.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    expect(b.pending()).toEqual([]);
  });

  it('con una regla por LAN, cada una se cumple por separado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip dhcp-client add interface=ether1');
    r1.ok(
      '/ip firewall nat add chain=srcnat src-address=192.168.88.0/24 out-interface=ether1 action=masquerade',
    );
    expect(b.pending()).toEqual(['invitados']);
    r1.ok(
      '/ip firewall nat add chain=srcnat src-address=192.168.90.0/24 out-interface=ether1 action=masquerade',
    );
    expect(b.pending()).toEqual([]);
  });

  it('error típico: masquerade en la interfaz de la LAN', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip dhcp-client add interface=ether1');
    r1.ok('/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade');
    expect(b.pending()).toEqual(['oficina', 'invitados']);
  });

  it('error típico: masquerade sin out-interface traduce también entre las LANs', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip dhcp-client add interface=ether1');
    r1.ok('/ip firewall nat add chain=srcnat action=masquerade');
    expect(b.pending()).toEqual(['oficina']);
  });

  it('error típico: NAT sin WAN no lleva a ningún sitio', () => {
    const b = bench(FILE);
    b.on('R1').ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    expect(b.pending()).toEqual(['wan', 'oficina', 'invitados']);
  });
});
