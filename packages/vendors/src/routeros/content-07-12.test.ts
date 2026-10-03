/**
 * Labs 7–12 de "MikroTik desde cero" publicados en content/labs/routeros: cada
 * uno se resuelve por la CLI con el banco de trabajo y los objetivos se cumplen
 * por el estado de la red, en el orden en que los resolvería un alumno. Cada
 * lab tiene además al menos un error típico que deja objetivos pendientes.
 */
import { describe, expect, it } from 'vitest';
import { Bench, loadLabFile } from './content-kit';

const bench = (file: string) => new Bench(loadLabFile(file));

/** Celdas de la fila de una tabla cuyo primer campo es `first`. */
function cells(output: string, first: string): string[] {
  const line = output.split('\n').find((l) => l.trim().split(/\s+/)[0] === first);
  return line?.trim().split(/\s+/) ?? [];
}

// ── Lab 7 ───────────────────────────────────────────────────────────────────

describe('lab 7 · firewall de filtrado', () => {
  const FILE = '07-firewall-filter.yaml';
  const ALL = ['estado', 'wan-cerrada', 'sin-encerrarte', 'router-sale', 'camara'];

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(ALL);
    r1.ok('/ip firewall filter add chain=input action=accept connection-state=established,related');
    r1.ok('/ip firewall filter add chain=input action=drop connection-state=invalid');
    expect(b.pending()).toEqual(['wan-cerrada', 'sin-encerrarte', 'router-sale', 'camara']);
    r1.ok('/ip firewall filter add chain=input action=accept in-interface=bridge1');
    // Sin el drop final todo sigue abierto: no hay deny implícito.
    expect(b.pending()).toEqual(['wan-cerrada', 'sin-encerrarte', 'router-sale', 'camara']);
    r1.ok('/ip firewall filter add chain=input action=drop');
    expect(b.pending()).toEqual(['camara']);
    expect(r1.ok('/ping 8.8.8.8 count=1')).toContain('packet-loss=0%');
    r1.ok('/ip firewall filter add chain=forward action=drop src-address=192.168.88.20');
    expect(b.pending()).toEqual([]);
  });

  it('error típico: el drop de input arriba de los accept deja fuera a la LAN y al router', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip firewall filter add chain=input action=drop');
    r1.ok('/ip firewall filter add chain=input action=accept connection-state=established,related');
    r1.ok('/ip firewall filter add chain=input action=drop connection-state=invalid');
    r1.ok('/ip firewall filter add chain=input action=accept in-interface=bridge1');
    // Internet queda cerrado, pero también la PC del técnico y las respuestas del router.
    expect(b.pending()).toEqual(['sin-encerrarte', 'router-sale', 'camara']);
    expect(r1.ok('/ping 8.8.8.8 count=1')).toContain('packet-loss=100%');
    // Arreglo: bajar el drop al final.
    r1.ok('/ip firewall filter print');
    r1.ok('/ip firewall filter move 0 4');
    expect(b.pending()).toEqual(['camara']);
  });

  it('error típico: drop desde la WAN sin aceptar lo establecido deja al router sin respuestas', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip firewall filter add chain=input action=drop in-interface=ether1');
    expect(b.pending()).toEqual(['estado', 'router-sale', 'camara']);
  });

  it('error típico: bloquear la cámara en input no le corta Internet', () => {
    const b = bench(FILE);
    b.on('R1').ok('/ip firewall filter add chain=input action=drop src-address=192.168.88.20');
    expect(b.pending()).toContain('camara');
  });
});

// ── Lab 8 ───────────────────────────────────────────────────────────────────

describe('lab 8 · wireless básico', () => {
  const FILE = '08-wireless-basico.yaml';

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['radio', 'asociada', 'lan', 'internet']);
    r1.ok('/interface wifi set wifi1 configuration.ssid=Oficina disabled=no');
    expect(b.pending()).toEqual(['asociada', 'lan', 'internet']);
    r1.ok(
      '/interface wifi set wifi1 security.authentication-types=wpa2-psk security.passphrase=Bienvenidos2026',
    );
    expect(b.pending()).toEqual(['lan', 'internet']);
    expect(r1.ok('/interface wifi registration-table print count-only')).toBe('1');
    r1.ok('/interface bridge port add bridge=bridge1 interface=wifi1');
    expect(b.pending()).toEqual([]);
  });

  it('error típico: una contraseña distinta no asocia; al corregirla sí', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok(
      '/interface wifi set wifi1 configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=bienvenidos2026 disabled=no',
    );
    expect(b.pending()).toEqual(['asociada', 'lan', 'internet']);
    r1.ok('/interface wifi set wifi1 security.passphrase=Bienvenidos2026');
    expect(b.pending()).toEqual(['lan', 'internet']);
  });

  it('error típico: asociada pero fuera del bridge no recibe dirección ni navega', () => {
    const b = bench(FILE);
    b.on('R1').ok(
      '/interface wifi set wifi1 configuration.ssid=Oficina security.authentication-types=wpa2-psk security.passphrase=Bienvenidos2026 disabled=no',
    );
    expect(b.pending()).toEqual(['lan', 'internet']);
  });

  it('error típico: con la radio sin habilitar no cuenta', () => {
    const b = bench(FILE);
    b.on('R1').ok('/interface wifi set wifi1 configuration.ssid=Oficina');
    expect(b.pending()).toEqual(['radio', 'asociada', 'lan', 'internet']);
  });
});

// ── Lab 9 ───────────────────────────────────────────────────────────────────

describe('lab 9 · DNS y caché', () => {
  const FILE = '09-dns-cache.yaml';

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['router-resuelve', 'lan-resuelve', 'impresora', 'no-abierto']);
    expect(r1.run(':resolve example.com')).toContain('failure');
    r1.ok('/ip dns set servers=1.1.1.1,9.9.9.9');
    expect(r1.ok(':resolve example.com')).toBe('93.184.216.34');
    expect(b.pending()).toEqual(['lan-resuelve', 'impresora', 'no-abierto']);
    r1.ok('/ip dns set allow-remote-requests=yes');
    expect(b.pending()).toEqual(['impresora', 'no-abierto']);
    r1.ok('/ip dns static add name=impresora.lan address=192.168.88.50');
    expect(b.pending()).toEqual(['no-abierto']);
    r1.ok(
      '/ip firewall filter add chain=input action=drop in-interface=ether1 protocol=udp dst-port=53',
    );
    expect(b.pending()).toEqual([]);
    expect(r1.ok('/ip dns cache print')).toContain('example.com');
  });

  it('error típico: sin allow-remote-requests el router resuelve pero la LAN no', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip dns set servers=1.1.1.1');
    r1.ok('/ip dns static add name=impresora.lan address=192.168.88.50');
    expect(r1.ok(':resolve impresora.lan')).toBe('192.168.88.50');
    expect(b.pending()).toEqual(['lan-resuelve', 'impresora', 'no-abierto']);
  });

  it('error típico: descartar todo lo que entra por ether1 rompe la resolución del router', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/ip dns set servers=1.1.1.1 allow-remote-requests=yes');
    r1.ok('/ip dns static add name=impresora.lan address=192.168.88.50');
    r1.ok('/ip firewall filter add chain=input action=drop in-interface=ether1');
    // La impresora sale de la entrada estática; example.com necesita al servidor de Internet.
    expect(b.pending()).toEqual(['router-resuelve', 'lan-resuelve', 'no-abierto']);
  });
});

// ── Lab 10 ──────────────────────────────────────────────────────────────────

describe('lab 10 · respaldo y restauración', () => {
  const FILE = '10-respaldo-restauracion.yaml';

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['respaldo', 'export', 'reset', 'restaurado']);
    expect(r1.ok('/file print')).toContain('instalacion.backup');
    r1.ok('/system backup save name=oficina');
    expect(b.pending()).toEqual(['export', 'reset', 'restaurado']);
    r1.ok('/export file=oficina');
    expect(b.pending()).toEqual(['reset', 'restaurado']);
    expect(r1.ok('/system reset-configuration no-defaults=yes')).toBe(
      'Dangerous! Reset anyway? [y/N]:',
    );
    r1.ok('y');
    expect(b.pending()).toEqual(['restaurado']);
    const again = b.on('R1');
    expect(again.ok('/system backup load name=oficina.backup')).toBe('Restore and reboot? [y/N]:');
    again.ok('y');
    expect(b.pending()).toEqual([]);
    expect(b.on('R1').prompt).toBe('[admin@R1-Oficina] > ');
  });

  it('error típico: restaurar el respaldo equivocado no devuelve la oficina', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/system backup save name=oficina');
    r1.ok('/export file=oficina');
    r1.ok('/system reset-configuration no-defaults=yes');
    r1.ok('y');
    r1.ok('/system backup load name=instalacion.backup');
    r1.ok('y');
    expect(b.pending()).toEqual(['restaurado']);
    // El respaldo del instalador no tiene DHCP ni NAT.
    expect(b.on('R1').ok('/ip dhcp-server print count-only')).toBe('0');
  });

  it('error típico: cargar sin la extensión .backup falla y nada cambia', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/system backup save name=oficina');
    r1.ok('/system reset-configuration no-defaults=yes');
    r1.ok('y');
    r1.run('/system backup load name=oficina');
    expect(b.pending()).toEqual(['export', 'restaurado']);
  });

  // configMatches ignora los ids internos: importar el .rsc tras el reset deja la misma
  // configuración que el .backup aunque cada ítem reciba ids nuevos.
  it('importar el export tras el reset también cuenta como restaurado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/system backup save name=oficina');
    r1.ok('/export file=oficina');
    r1.ok('/system reset-configuration no-defaults=yes keep-users=yes');
    r1.ok('y');
    expect(b.on('R1').ok('/import oficina.rsc')).toBe(
      'Script file loaded and executed successfully',
    );
    expect(b.pending()).toEqual([]);
  });

  it('error típico: guardar el respaldo después del desastre', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok('/system reset-configuration no-defaults=yes');
    r1.ok('y');
    r1.ok('/system backup save name=oficina');
    // El respaldo coincide con un router vacío: la LAN no recibe dirección.
    expect(b.pending()).toEqual(['export', 'restaurado']);
  });
});

// ── Lab 11 ──────────────────────────────────────────────────────────────────

describe('lab 11 · monitoreo con Torch', () => {
  const FILE = '11-torch.yaml';
  const HEAVY = '192.168.88.11';

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['culpable', 'bloqueo', 'resto']);
    // En la WAN el masquerade esconde a los PCs; en el bridge se ven.
    expect(r1.ok('/tool torch interface=ether1 src-address=0.0.0.0/0 duration=1s')).not.toContain(
      HEAVY,
    );
    const out = r1.ok('/tool torch interface=bridge1 src-address=0.0.0.0/0 duration=1s');
    const download = (ip: string) => cells(out, ip)[1];
    expect(download(HEAVY)).toBe('9.0Mbps');
    expect(download('192.168.88.10')).toBe('150.0kbps');
    expect(download('192.168.88.12')).toBe('90.0kbps');
    r1.ok(`/ip firewall address-list add list=consumo-alto address=${HEAVY}`);
    expect(b.pending()).toEqual(['bloqueo', 'resto']);
    r1.ok('/ip firewall filter add chain=forward action=drop src-address-list=consumo-alto');
    expect(b.pending()).toEqual([]);
    const after = r1.ok('/tool torch interface=bridge1 src-address=0.0.0.0/0 duration=1s');
    expect(cells(after, HEAVY)[1]).toBe('0bps');
  });

  it('error típico: bloquear al equipo equivocado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    // En ether1 no se ve quién es: el alumno adivina y bloquea a recepción.
    r1.ok('/ip firewall address-list add list=consumo-alto address=192.168.88.10');
    r1.ok('/ip firewall filter add chain=forward action=drop src-address-list=consumo-alto');
    expect(b.pending()).toEqual(['culpable', 'bloqueo', 'resto']);
  });

  it('error típico: meter toda la LAN en la lista corta a todos', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok(`/ip firewall address-list add list=consumo-alto address=${HEAVY}`);
    r1.ok('/ip firewall address-list add list=consumo-alto address=192.168.88.10');
    r1.ok('/ip firewall filter add chain=forward action=drop src-address-list=consumo-alto');
    expect(b.pending()).toEqual(['culpable', 'resto']);
  });

  it('error típico: un drop de forward sin origen deja sin Internet a toda la oficina', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.ok(`/ip firewall address-list add list=consumo-alto address=${HEAVY}`);
    r1.ok('/ip firewall filter add chain=forward action=drop');
    expect(b.pending()).toEqual(['resto']);
  });
});

// ── Lab 12 ──────────────────────────────────────────────────────────────────

describe('lab 12 · oficina pequeña de principio a fin', () => {
  const FILE = '12-oficina-final.yaml';
  const LAN: readonly string[] = [
    '/interface bridge add name=bridge-lan',
    '/interface bridge port add bridge=bridge-lan interface=ether2',
    '/interface bridge port add bridge=bridge-lan interface=ether3',
    '/ip address add address=192.168.10.1/24 interface=bridge-lan',
    '/ip pool add name=pool-lan ranges=192.168.10.100-192.168.10.199',
    '/ip dhcp-server add name=dhcp-lan interface=bridge-lan address-pool=pool-lan',
  ];
  const FIREWALL: readonly string[] = [
    '/ip firewall filter add chain=input action=accept connection-state=established,related',
    '/ip firewall filter add chain=input action=drop connection-state=invalid',
    '/ip firewall filter add chain=input action=accept in-interface=bridge-lan',
    '/ip firewall filter add chain=input action=drop',
  ];

  it('se resuelve por la CLI y cada objetivo se cumple por el estado', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    expect(b.pending()).toEqual(['identidad', 'wan', 'lan', 'navegacion', 'firewall']);
    r1.ok('/system identity set name=GW-Oficina');
    expect(b.pending()).toEqual(['wan', 'lan', 'navegacion', 'firewall']);
    r1.ok('/ip dhcp-client add interface=ether1');
    expect(r1.ok('/ip dhcp-client print')).toContain('203.0.113.10/24');
    expect(b.pending()).toEqual(['lan', 'navegacion', 'firewall']);
    r1.script(LAN);
    // Como en RouterOS real, el servidor reparte aunque falte la red DHCP; sin ella los PCs
    // no reciben puerta de enlace ni DNS y no pueden salir.
    expect(b.pending()).toEqual(['navegacion', 'firewall']);
    r1.ok('/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade');
    expect(b.pending()).toEqual(['navegacion', 'firewall']);
    r1.ok(
      '/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=192.168.10.1',
    );
    expect(b.pending()).toEqual(['navegacion', 'firewall']);
    r1.ok('/ip dns set allow-remote-requests=yes');
    expect(b.pending()).toEqual(['firewall']);
    r1.script(FIREWALL);
    expect(b.pending()).toEqual([]);
    expect(r1.prompt).toBe('[admin@GW-Oficina] > ');
  });

  it('error típico: sin dns-server en la red DHCP los PCs no resuelven a través del router', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.script([
      '/system identity set name=GW-Oficina',
      '/ip dhcp-client add interface=ether1',
      ...LAN,
      '/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1',
      '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
      '/ip dns set allow-remote-requests=yes',
      ...FIREWALL,
    ]);
    expect(b.pending()).toEqual(['navegacion', 'firewall']);
  });

  it('error típico: el drop de input antes de aceptar la LAN deja al técnico fuera', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.script([
      '/system identity set name=GW-Oficina',
      '/ip dhcp-client add interface=ether1',
      ...LAN,
      '/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=192.168.10.1',
      '/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade',
      '/ip dns set allow-remote-requests=yes',
      '/ip firewall filter add chain=input action=accept connection-state=established,related',
      '/ip firewall filter add chain=input action=drop',
      '/ip firewall filter add chain=input action=accept in-interface=bridge-lan',
    ]);
    // Los PCs siguen con su concesión, pero el router ya no les contesta: ni ping, ni DNS,
    // ni Winbox.
    expect(b.pending()).toEqual(['lan', 'navegacion', 'firewall']);
  });

  it('error típico: NAT con out-interface de la LAN no traduce la salida', () => {
    const b = bench(FILE);
    const r1 = b.on('R1');
    r1.script([
      '/system identity set name=GW-Oficina',
      '/ip dhcp-client add interface=ether1',
      ...LAN,
      '/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=192.168.10.1',
      '/ip firewall nat add chain=srcnat out-interface=bridge-lan action=masquerade',
      '/ip dns set allow-remote-requests=yes',
    ]);
    expect(b.pending()).toEqual(['navegacion', 'firewall']);
  });
});
