import type { Ipv4, Ipv4Prefix } from '../net/ipv4';
import type { DeviceId, ItemId, SimTime } from './brand';
import type { DeviceConfig, IpProtocol, WifiBand } from './config';
import type { DeviceOper } from './oper';

/** Qué driver maneja el dispositivo. Es metadato, no sintaxis. */
export type OsId = 'routeros' | 'vrp' | 'vyos' | 'ios' | 'host' | 'internet';

export type HardwarePort =
  | { readonly kind: 'ethernet'; readonly index: number }
  | { readonly kind: 'wireless'; readonly index: number; readonly band: WifiBand };

/** Placa genérica; nunca un modelo comercial real (ver D-011). */
export interface Hardware {
  readonly board: string;
  readonly ports: readonly HardwarePort[];
}

/** Rasgos de comportamiento que fija la plataforma al crear el dispositivo (ver D-015). */
export interface DeviceTraits {
  /** ¿Reenvía paquetes entre interfaces? Los hosts no. */
  readonly forwards: boolean;
  /** Orden en que un pool DHCP entrega direcciones. */
  readonly poolAllocation: 'lowest' | 'highest';
}

export interface StoredFile {
  readonly name: string;
  readonly createdAt: SimTime;
  readonly payload:
    | { readonly kind: 'backup'; readonly config: DeviceConfig }
    | { readonly kind: 'script'; readonly text: string };
}

export interface Device {
  readonly id: DeviceId;
  readonly os: OsId;
  readonly hardware: Hardware;
  readonly traits: DeviceTraits;
  readonly config: DeviceConfig;
  readonly oper: DeviceOper;
  readonly storage: { readonly files: readonly StoredFile[] };
  /** Próximo ItemId libre en este dispositivo. */
  readonly nextId: number;
}

export interface PortRef {
  readonly device: DeviceId;
  readonly iface: ItemId;
}

/** Cable ethernet. El wifi no se cablea: se asocia (lo resuelve `converge`). */
export interface Link {
  readonly id: string;
  readonly a: PortRef;
  readonly b: PortRef;
  readonly up: boolean;
}

/** Tráfico de fondo del escenario: lo ve Torch y suma en los contadores. */
export interface Flow {
  readonly id: string;
  readonly from: DeviceId;
  readonly to: Ipv4;
  readonly protocol: IpProtocol;
  readonly dstPort?: number;
  readonly srcPort?: number;
  /** Bits por segundo en el sentido de la conexión (subida). */
  readonly bps: number;
  /** Bits por segundo en el sentido de la respuesta (bajada). */
  readonly replyBps: number;
}

/** Un dispositivo que representa "Internet": responde por cualquier IP pública. */
export interface InternetEmulation {
  readonly device: DeviceId;
  readonly answers: readonly Ipv4Prefix[];
  readonly tcpPorts: readonly number[];
  readonly dns: readonly { readonly name: string; readonly address: Ipv4 }[];
}

export interface Scenario {
  readonly flows: readonly Flow[];
  readonly internet?: InternetEmulation;
}

/** Estado completo de un lab en ejecución. */
export interface Network {
  readonly devices: readonly Device[];
  readonly links: readonly Link[];
  readonly scenario: Scenario;
  readonly now: SimTime;
}
