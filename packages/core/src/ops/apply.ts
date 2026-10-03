/**
 * Las operaciones (`Op`) son la única forma de cambiar la configuración de un
 * dispositivo. Los drivers traducen comandos a operaciones; el núcleo comprueba
 * integridad referencial, unicidad y rangos, y devuelve errores tipados que cada
 * driver redacta con la voz de su fabricante.
 */
import type { ItemId } from '../model/brand';
import {
  COLLECTION_KEYS,
  type CollectionKey,
  type ItemOf,
  type ItemPatch,
  type NewItem,
  type SingletonItems,
  type SingletonKey,
} from '../model/collections';
import type { DeviceConfig } from '../model/config';
import type { CoreError } from '../model/errors';
import type { Device } from '../model/network';
import { err, ok, type Result } from '../model/result';
import { type CollectionSpec, type ItemRef, specOf } from './registry';

export type AddOp<K extends CollectionKey = CollectionKey> = {
  [P in K]: {
    readonly op: 'add';
    readonly coll: P;
    readonly item: NewItem<P>;
    /** Insertar antes de este ítem; si falta, al final. */
    readonly before?: ItemId;
  };
}[K];

export type SetOp<K extends CollectionKey = CollectionKey> = {
  [P in K]: {
    readonly op: 'set';
    readonly coll: P;
    readonly id: ItemId;
    readonly patch: ItemPatch<P>;
    /** Campos opcionales que se quitan. */
    readonly unset?: readonly string[];
  };
}[K];

export interface RemoveOp {
  readonly op: 'remove';
  readonly coll: CollectionKey;
  readonly id: ItemId;
}

export interface MoveOp {
  readonly op: 'move';
  readonly coll: CollectionKey;
  readonly id: ItemId;
  /** null = mover al final. */
  readonly before: ItemId | null;
}

export type SetSingletonOp<K extends SingletonKey = SingletonKey> = {
  [P in K]: {
    readonly op: 'setSingleton';
    readonly key: P;
    readonly patch: Partial<SingletonItems[P]>;
  };
}[K];

/** Reemplaza la configuración completa: restaurar un backup o volver a fábrica. */
export interface RestoreOp {
  readonly op: 'restore';
  readonly config: DeviceConfig;
}

export type Op = AddOp | SetOp | RemoveOp | MoveOp | SetSingletonOp | RestoreOp;

export interface ApplyPolicy {
  /** Qué pasa al borrar algo que otros ítems referencian (ver D-009). */
  readonly danglingRefs: 'reject' | 'orphan';
}

export const DEFAULT_POLICY: ApplyPolicy = { danglingRefs: 'reject' };

export interface Applied {
  readonly device: Device;
  /** Id asignado cuando la operación fue un `add`. */
  readonly created?: ItemId;
}

// ── Consultas ───────────────────────────────────────────────────────────────

export function findItem<K extends CollectionKey>(
  config: DeviceConfig,
  coll: K,
  id: ItemId,
): ItemOf<K> | undefined {
  return specOf(coll)
    .get(config)
    .find((item) => item.id === id);
}

function exists(config: DeviceConfig, coll: CollectionKey, id: ItemId): boolean {
  return specOf(coll)
    .get(config)
    .some((item) => item.id === id);
}

/** Ítems de cualquier colección que referencian a `coll`/`id`. */
export function referrersOf(
  config: DeviceConfig,
  coll: CollectionKey,
  id: ItemId,
): { coll: CollectionKey; id: ItemId }[] {
  const usedBy: { coll: CollectionKey; id: ItemId }[] = [];
  for (const key of COLLECTION_KEYS) {
    const spec: CollectionSpec<CollectionKey> = specOf(key);
    for (const item of spec.get(config)) {
      if (spec.refs(item).some((r) => r.coll === coll && r.id === id)) {
        usedBy.push({ coll: key, id: item.id });
      }
    }
  }
  return usedBy;
}

export function maxItemId(config: DeviceConfig): number {
  let max = 0;
  for (const key of COLLECTION_KEYS) {
    for (const item of specOf(key).get(config)) max = Math.max(max, item.id);
  }
  return max;
}

// ── Validación de un ítem completo ──────────────────────────────────────────

const sameRef = (a: ItemRef, b: ItemRef): boolean =>
  a.field === b.field && a.coll === b.coll && a.id === b.id;

function validate<K extends CollectionKey>(
  spec: CollectionSpec<K>,
  item: ItemOf<K>,
  config: DeviceConfig,
  previous: ItemOf<K> | undefined,
): CoreError | null {
  // Al editar, una referencia que ya estaba colgada no impide cambiar otros campos.
  const before = previous ? spec.refs(previous) : [];
  for (const ref of spec.refs(item)) {
    if (before.some((b) => sameRef(b, ref))) continue;
    // Una referencia a sí mismo la reporta `check` como conflicto, no como inexistente.
    if (ref.coll === spec.key && ref.id === item.id) continue;
    if (!exists(config, ref.coll, ref.id)) {
      return { code: 'not-found', scope: ref.coll, field: ref.field, ref: String(ref.id) };
    }
  }
  const problem = spec.check(item, config);
  if (problem) return problem;
  const others = spec.get(config).filter((other) => other.id !== item.id);
  for (const key of spec.uniques(item)) {
    const clash = others.some((other) =>
      spec.uniques(other).some((k) => k.field === key.field && k.value === key.value),
    );
    if (clash) return { code: 'duplicate', scope: spec.key, field: key.field, value: key.value };
  }
  return null;
}

// ── Operaciones sobre colecciones ───────────────────────────────────────────

function insertBefore<T extends { readonly id: ItemId }>(
  items: readonly T[],
  item: T,
  before: ItemId | null | undefined,
): T[] | null {
  if (before === undefined || before === null) return [...items, item];
  const index = items.findIndex((i) => i.id === before);
  if (index === -1) return null;
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function addItem<K extends CollectionKey>(
  device: Device,
  op: AddOp<K>,
): Result<Applied, CoreError> {
  const spec = specOf(op.coll);
  if (!spec.creatable(op.item)) {
    const kind = 'kind' in op.item ? String(op.item.kind) : op.coll;
    return err({
      code: 'invalid-value',
      scope: op.coll,
      field: 'kind',
      value: kind,
      expected: 'creatable-kind',
    });
  }
  const id = device.nextId as ItemId;
  // NewItem<K> + id es exactamente ItemOf<K>; TypeScript no lo deduce con genéricos.
  const item = { ...op.item, id } as unknown as ItemOf<K>;
  const problem = validate(spec, item, device.config, undefined);
  if (problem) return err(problem);
  const items = insertBefore(spec.get(device.config), item, op.before);
  if (!items)
    return err({ code: 'not-found', scope: op.coll, field: 'before', ref: String(op.before) });
  return ok({
    device: { ...device, config: spec.put(device.config, items), nextId: device.nextId + 1 },
    created: id,
  });
}

function setItem<K extends CollectionKey>(
  device: Device,
  op: SetOp<K>,
): Result<Applied, CoreError> {
  const spec = specOf(op.coll);
  const items = spec.get(device.config);
  const index = items.findIndex((i) => i.id === op.id);
  const current = items[index];
  if (!current) return err({ code: 'not-found', scope: op.coll, ref: String(op.id) });
  for (const field of ['id', 'kind']) {
    if (field in op.patch) {
      return err({
        code: 'invalid-value',
        scope: op.coll,
        field,
        value: '',
        expected: 'mutable-field',
      });
    }
  }
  const merged: Record<string, unknown> = { ...current, ...op.patch };
  for (const field of op.unset ?? []) {
    if (!spec.optional.includes(field)) {
      return err({
        code: 'invalid-value',
        scope: op.coll,
        field,
        value: '',
        expected: 'optional-field',
      });
    }
    delete merged[field];
  }
  const next = merged as unknown as ItemOf<K>;
  const problem = validate(spec, next, device.config, current);
  if (problem) return err(problem);
  const updated = items.map((i) => (i.id === op.id ? next : i));
  return ok({ device: { ...device, config: spec.put(device.config, updated) } });
}

function removeItem(device: Device, op: RemoveOp, policy: ApplyPolicy): Result<Applied, CoreError> {
  const spec: CollectionSpec<CollectionKey> = specOf(op.coll);
  const items = spec.get(device.config);
  const current = items.find((i) => i.id === op.id);
  if (!current) return err({ code: 'not-found', scope: op.coll, ref: String(op.id) });
  if (!spec.removable(current)) return err({ code: 'not-removable', scope: op.coll, id: op.id });
  const usedBy = referrersOf(device.config, op.coll, op.id);
  if (usedBy.length > 0 && policy.danglingRefs === 'reject') {
    return err({ code: 'in-use', scope: op.coll, id: op.id, usedBy });
  }
  const remaining = items.filter((i) => i.id !== op.id);
  return ok({ device: { ...device, config: spec.put(device.config, remaining) } });
}

function moveItem(device: Device, op: MoveOp): Result<Applied, CoreError> {
  const spec: CollectionSpec<CollectionKey> = specOf(op.coll);
  const items = spec.get(device.config);
  const current = items.find((i) => i.id === op.id);
  if (!current) return err({ code: 'not-found', scope: op.coll, ref: String(op.id) });
  if (op.before === op.id) return ok({ device });
  const rest = items.filter((i) => i.id !== op.id);
  const moved = insertBefore(rest, current, op.before);
  if (!moved)
    return err({ code: 'not-found', scope: op.coll, field: 'before', ref: String(op.before) });
  return ok({ device: { ...device, config: spec.put(device.config, moved) } });
}

// ── Ajustes únicos ──────────────────────────────────────────────────────────

function setSingleton(device: Device, op: SetSingletonOp): Result<Applied, CoreError> {
  const config = device.config;
  switch (op.key) {
    case 'system': {
      const system = { ...config.system, ...op.patch };
      if (system.identity.trim() === '') {
        return err({ code: 'missing-required', scope: 'system', field: 'identity' });
      }
      if (system.timezone.trim() === '') {
        return err({ code: 'missing-required', scope: 'system', field: 'timezone' });
      }
      return ok({ device: { ...device, config: { ...config, system } } });
    }
    case 'dns': {
      const dns = { ...config.dns, ...op.patch };
      const size = dns.cacheSizeKiB;
      if (!Number.isInteger(size) || size < 64 || size > 1_048_576) {
        return err({
          code: 'out-of-range',
          scope: 'dns',
          field: 'cacheSizeKiB',
          value: size,
          min: 64,
          max: 1_048_576,
        });
      }
      return ok({ device: { ...device, config: { ...config, dns } } });
    }
    case 'discovery': {
      const discovery = { ...config.discovery, ...op.patch };
      const name = discovery.interfaceList;
      const known =
        name === 'all' || name === 'none' || config.interfaceLists.some((l) => l.name === name);
      if (!known)
        return err({ code: 'not-found', scope: 'discovery', field: 'interfaceList', ref: name });
      return ok({ device: { ...device, config: { ...config, discovery } } });
    }
    case 'l2Access': {
      const l2Access = { ...config.l2Access, ...op.patch };
      for (const field of ['cli', 'gui'] as const) {
        const name = l2Access[field];
        const known =
          name === 'all' || name === 'none' || config.interfaceLists.some((l) => l.name === name);
        if (!known) return err({ code: 'not-found', scope: 'l2Access', field, ref: name });
      }
      return ok({ device: { ...device, config: { ...config, l2Access } } });
    }
  }
}

// ── Punto de entrada ────────────────────────────────────────────────────────

export function applyOp(
  device: Device,
  op: Op,
  policy: ApplyPolicy = DEFAULT_POLICY,
): Result<Applied, CoreError> {
  switch (op.op) {
    case 'add':
      return addItem(device, op);
    case 'set':
      return setItem(device, op);
    case 'remove':
      return removeItem(device, op, policy);
    case 'move':
      return moveItem(device, op);
    case 'setSingleton':
      return setSingleton(device, op);
    case 'restore':
      return ok({
        device: {
          ...device,
          config: op.config,
          nextId: Math.max(device.nextId, maxItemId(op.config) + 1),
        },
      });
  }
}

export interface BatchError {
  /** Posición de la operación que falló. */
  readonly index: number;
  readonly error: CoreError;
}

/** Aplica varias operaciones de forma atómica: o todas o ninguna. */
export function applyOps(
  device: Device,
  ops: readonly Op[],
  policy: ApplyPolicy = DEFAULT_POLICY,
): Result<{ device: Device; created: readonly ItemId[] }, BatchError> {
  let current = device;
  const created: ItemId[] = [];
  for (const [index, op] of ops.entries()) {
    const result = applyOp(current, op, policy);
    if (!result.ok) return err({ index, error: result.error });
    current = result.value.device;
    if (result.value.created !== undefined) created.push(result.value.created);
  }
  return ok({ device: current, created });
}
