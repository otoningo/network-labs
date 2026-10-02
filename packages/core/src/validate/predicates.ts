/**
 * Predicados de validación ya resueltos (con ids y direcciones parseadas).
 * Los labs los escriben en YAML con nombres legibles; el cargador los traduce.
 * Nunca se comparan comandos: todo se evalúa contra el estado de la red.
 */
import type { DeviceId, ItemId } from '../model/brand';
import type { CollectionKey, SingletonKey } from '../model/collections';
import type { IpProtocol } from '../model/config';
import type { Ipv4, Ipv4Prefix } from '../net/ipv4';

/** Interfaz por id (fijada al cargar el lab) o por nombre (resuelta al evaluar). */
export type IfRef = { readonly id: ItemId } | { readonly name: string };

export type Target = { readonly ip: Ipv4 } | { readonly device: DeviceId };

export type CountOp = '>=' | '<=' | '==' | '>' | '<';

export interface CountCmp {
  readonly op: CountOp;
  readonly n: number;
}

export type Matcher =
  | { readonly eq: string | number | boolean }
  | { readonly ip: Ipv4 }
  | { readonly prefix: Ipv4Prefix }
  | { readonly within: Ipv4Prefix }
  | { readonly iface: IfRef }
  | { readonly includes: string | number | { readonly ip: Ipv4 } | { readonly iface: IfRef } }
  | { readonly exists: boolean };

export interface WhereClause {
  readonly path: readonly string[];
  readonly match: Matcher;
}

export interface FlowSpec {
  readonly from: DeviceId;
  readonly to: Target;
  readonly protocol: IpProtocol;
  readonly port?: number;
}

export type Predicate =
  | { readonly kind: 'all'; readonly of: readonly Predicate[] }
  | { readonly kind: 'any'; readonly of: readonly Predicate[] }
  | { readonly kind: 'not'; readonly of: Predicate }
  | {
      readonly kind: 'hasAddress';
      readonly device: DeviceId;
      readonly iface: IfRef;
      readonly prefix?: Ipv4Prefix;
      readonly within?: Ipv4Prefix;
    }
  | {
      readonly kind: 'routeActive';
      readonly device: DeviceId;
      readonly dst: Ipv4Prefix;
      readonly via?: { readonly ip: Ipv4 } | { readonly iface: IfRef };
    }
  | ({ readonly kind: 'reachable' } & FlowSpec)
  | ({ readonly kind: 'blocked'; readonly by: 'firewall' | 'any' } & FlowSpec)
  | ({
      readonly kind: 'natSourceIs';
      readonly expect:
        | { readonly ip: Ipv4 }
        | { readonly addressOf: { readonly device: DeviceId; readonly iface: IfRef } };
    } & FlowSpec)
  | {
      readonly kind: 'leaseBound';
      readonly server: DeviceId;
      readonly client: DeviceId;
      readonly within?: Ipv4Prefix;
    }
  | {
      readonly kind: 'wifiAssociated';
      readonly client: DeviceId;
      readonly ap: DeviceId;
      readonly ssid?: string;
    }
  | {
      readonly kind: 'resolves';
      readonly from: DeviceId;
      readonly name: string;
      readonly to?: Ipv4;
      readonly via?: DeviceId;
    }
  | {
      readonly kind: 'fileExists';
      readonly device: DeviceId;
      readonly type: 'backup' | 'script';
      readonly name?: string;
    }
  | {
      readonly kind: 'configMatches';
      readonly device: DeviceId;
      readonly snapshot: 'startup' | { readonly file: string };
      readonly scope?: readonly CollectionKey[];
    }
  | {
      readonly kind: 'exists';
      readonly device: DeviceId;
      readonly coll: CollectionKey;
      readonly where: readonly WhereClause[];
      readonly count: CountCmp;
    }
  | {
      readonly kind: 'setting';
      readonly device: DeviceId;
      readonly key: SingletonKey;
      readonly path: readonly string[];
      readonly match: Matcher;
    }
  | { readonly kind: 'interfaceRunning'; readonly device: DeviceId; readonly iface: IfRef }
  | { readonly kind: 'neighborSeen'; readonly device: DeviceId; readonly peer: DeviceId };

export type PredicateKind = Predicate['kind'];
