/**
 * El viaje del paquete de la portada, calculado con el motor real al compilar:
 * la PC de la oficina abre una conexión HTTPS a example.com a través de un
 * router con NAT. Cada salto, sus interfaces y la traducción de dirección
 * salen del trazado del simulador; nada de esto se escribe a mano.
 */
import {
  deviceId,
  formatIpv4,
  ipv4,
  type LabDefinition,
  LabSchema,
  loadLab,
  type Network,
  runScript,
  trace,
} from '@nos/core';
import { routeros } from '@nos/vendors/routeros';
import { LAB_ENVIRONMENT } from '../lab/console';
import { DEMO_COMMAND, DEMO_OBJECTIVE } from './demo';

/** Oficina a medias: LAN, WAN y ruta por defecto. Falta el NAT, que es la demostración. */
export const OFFICE_SETUP = [
  '/ip address add address=192.168.88.1/24 interface=ether2',
  '/ip address add address=203.0.113.2/24 interface=ether1',
  '/ip route add dst-address=0.0.0.0/0 gateway=203.0.113.1',
] as const;

/** La oficina completa: la de arriba más la línea que se escribe en la portada. */
export const JOURNEY_SCRIPT = [...OFFICE_SETUP, DEMO_COMMAND] as const;

export const JOURNEY_TARGET = { name: 'example.com', ip: '93.184.216.34', port: 443 } as const;

export interface JourneyHop {
  readonly device: string;
  /** Interfaz por la que entró y por la que salió, si las hay. */
  readonly in: string | null;
  readonly out: string | null;
  /** Remite y destino tal como sale de este equipo. */
  readonly src: string;
  readonly dst: string;
  readonly srcPort: number | null;
  readonly dstPort: number | null;
  /** Remite antes de que este equipo lo traduzca (NAT), si lo tradujo. */
  readonly natFrom: string | null;
}

export interface Journey {
  readonly protocol: 'tcp';
  readonly target: typeof JOURNEY_TARGET;
  readonly hops: readonly JourneyHop[];
  readonly delivered: boolean;
}

function ifaceName(net: Network, device: string, id: unknown): string | null {
  if (id === undefined) return null;
  const found = net.devices.find((d) => d.id === device);
  return found?.config.interfaces.find((i) => i.id === id)?.name ?? null;
}

/** Recorre la red de práctica con la oficina configurada y devuelve el viaje real. */
export function computeJourney(sandbox: LabDefinition): Journey {
  const loaded = loadLab(sandbox, LAB_ENVIRONMENT);
  if (!loaded.ok) throw new Error(`router de práctica: ${JSON.stringify(loaded.error)}`);
  const configured = runScript(routeros, loaded.value.net, deviceId('R1'), [...JOURNEY_SCRIPT]);
  if (!configured.ok) throw new Error(`viaje: ${configured.error.message}`);
  const net = configured.value;
  const result = trace(net, {
    from: deviceId('PC1'),
    dst: ipv4(JOURNEY_TARGET.ip),
    protocol: 'tcp',
    dstPort: JOURNEY_TARGET.port,
  });
  const hops = result.forward.hops.map((hop): JourneyHop => {
    const header = hop.sent ?? hop.received;
    const nat = hop.nat.find((n) => !n.reverse);
    return {
      device: hop.device,
      in: ifaceName(net, hop.device, hop.inIface),
      out: ifaceName(net, hop.device, hop.outIface),
      src: formatIpv4(header.src),
      dst: formatIpv4(header.dst),
      srcPort: header.srcPort ?? null,
      dstPort: header.dstPort ?? null,
      natFrom: nat && nat.before.src !== nat.after.src ? formatIpv4(nat.before.src) : null,
    };
  });
  return { protocol: 'tcp', target: JOURNEY_TARGET, hops, delivered: result.ok };
}

/**
 * Lab de la demostración: el router de práctica con la oficina a medias y una
 * sola tarea, salir a Internet con la IP pública. Pasa por el esquema de labs,
 * así que se valida igual que cualquier lab publicado.
 */
export function demoLab(sandbox: LabDefinition): LabDefinition {
  return LabSchema.parse({
    ...sandbox,
    id: 'landing-demo',
    topology: {
      ...sandbox.topology,
      devices: sandbox.topology.devices.map((device) =>
        device.id === 'R1' ? { ...device, startup: OFFICE_SETUP.join('\n') } : device,
      ),
    },
    objectives: [
      {
        id: DEMO_OBJECTIVE,
        text: {
          es: 'La PC de la oficina sale a Internet con la IP pública del router.',
          en: 'The office PC reaches the Internet with the router public IP.',
        },
        check: {
          natSourceIs: {
            from: 'PC1',
            to: JOURNEY_TARGET.ip,
            protocol: 'tcp',
            port: JOURNEY_TARGET.port,
            expect: { addressOf: 'R1:ether1' },
          },
        },
        hints: [
          {
            es: 'Falta traducir el remite en la salida.',
            en: 'The sender is not translated on the way out yet.',
          },
        ],
      },
    ],
  });
}
