import type { ItemId } from './brand';
import type { CollectionKey, SingletonKey } from './collections';

export type ErrorScope = CollectionKey | SingletonKey | 'storage';

/** Valores esperados en `invalid-value`. Los drivers los traducen a la voz de cada fabricante. */
export type ExpectedValue =
  | 'non-empty'
  | 'mac'
  | 'network-address'
  | 'bridge-interface'
  | 'non-bridge-interface'
  | 'ssid'
  | 'wifi-channel'
  | 'passphrase'
  | 'hostname'
  | 'custom-chain'
  | 'creatable-kind'
  | 'optional-field'
  | 'mutable-field'
  | 'ip-range';

/** Motivos de `conflict`, estables para que cada driver elija su mensaje. */
export type ConflictDetail =
  | 'self-reference'
  | 'tagged-and-untagged'
  | 'port-requires-tcp-udp'
  | 'action-chain-mismatch'
  | 'reserved-name';

export type CoreError =
  | {
      readonly code: 'not-found';
      readonly scope: ErrorScope;
      readonly field?: string;
      readonly ref: string;
    }
  | {
      readonly code: 'duplicate';
      readonly scope: ErrorScope;
      readonly field: string;
      readonly value: string;
    }
  | {
      readonly code: 'invalid-value';
      readonly scope: ErrorScope;
      readonly field: string;
      readonly value: string;
      readonly expected: ExpectedValue;
    }
  | {
      readonly code: 'out-of-range';
      readonly scope: ErrorScope;
      readonly field: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly code: 'in-use';
      readonly scope: ErrorScope;
      readonly id: ItemId;
      readonly usedBy: readonly { readonly coll: CollectionKey; readonly id: ItemId }[];
    }
  | { readonly code: 'missing-required'; readonly scope: ErrorScope; readonly field: string }
  | {
      readonly code: 'conflict';
      readonly scope: ErrorScope;
      readonly field?: string;
      readonly detail: ConflictDetail;
    }
  | { readonly code: 'not-removable'; readonly scope: ErrorScope; readonly id: ItemId };

export type CoreErrorCode = CoreError['code'];
