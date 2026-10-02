/**
 * Utilidades compartidas por los menús y el constructor `collectionMenu`, que
 * convierte una colección del modelo en un menú de RouterOS a partir de dos
 * traducciones: ítem → propiedades y propiedades → ítem.
 */
import {
  type CollectionKey,
  err,
  type ItemBase,
  type ItemId,
  type ItemOf,
  type NewItem,
  type Op,
  ok,
  type Result,
  specOf,
} from '@nos/core';
import {
  type ActionDef,
  type ExportDef,
  type Fault,
  type FlagSlot,
  fault,
  type MenuCtx,
  type MenuDef,
  type PrintStyle,
  type PropDef,
  type Props,
  prop,
  type Row,
  T,
} from '../schema';

export const yn = (value: boolean): string => (value ? 'yes' : 'no');
export const isYes = (value: string | undefined): boolean => value === 'yes';
export const get = (props: Props, name: string): string => props.get(name) ?? '';
export const opt = (props: Props, name: string): string | undefined => {
  const value = props.get(name);
  return value === undefined || value === '' ? undefined : value;
};

/** Mapa ordenado de propiedades, sin las que no tienen valor. */
export function props(entries: readonly (readonly [string, string | undefined])[]): Props {
  const map = new Map<string, string>();
  for (const [key, value] of entries) if (value !== undefined) map.set(key, value);
  return map;
}

/** Campos comunes a todo ítem: comentario y deshabilitado. */
export function baseFrom(p: Props): { disabled: boolean; comment?: string } {
  const comment = opt(p, 'comment');
  return { disabled: isYes(p.get('disabled')), ...(comment === undefined ? {} : { comment }) };
}

export const baseProps = (item: ItemBase): (readonly [string, string | undefined])[] => [
  ['comment', item.comment],
  ['disabled', yn(item.disabled)],
];

export const COMMON_PROPS: readonly PropDef[] = [
  prop('comment', T.string),
  prop('disabled', T.bool, { default: 'no' }),
];

export const flags = (...pairs: readonly (readonly [string, boolean])[]): string =>
  pairs
    .filter(([, on]) => on)
    .map(([letter]) => letter)
    .join('');

export const F = {
  disabled: { letter: 'X', name: 'disabled' },
  invalid: { letter: 'I', name: 'invalid' },
  dynamic: { letter: 'D', name: 'dynamic' },
  running: { letter: 'R', name: 'running' },
  slave: { letter: 'S', name: 'slave' },
  inactive: { letter: 'I', name: 'inactive' },
  active: { letter: 'A', name: 'active' },
} as const;

export const isInvalid = (ctx: MenuCtx, coll: CollectionKey, id: ItemId): boolean =>
  ctx.device.oper.invalid.some((i) => i.coll === coll && i.id === id);

/** Siguiente nombre libre con prefijo: bridge1, bridge2... */
export function nextName(prefix: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
}

// ── Operaciones tipadas ─────────────────────────────────────────────────────

export function addOp<K extends CollectionKey>(coll: K, item: NewItem<K>, before?: ItemId): Op {
  // Las uniones correlacionadas de AddOp no se pueden comprobar con K genérico.
  return { op: 'add', coll, item, ...(before === undefined ? {} : { before }) } as unknown as Op;
}

function setOp<K extends CollectionKey>(coll: K, current: ItemOf<K>, next: NewItem<K>): Op {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next))
    if (key !== 'id' && key !== 'kind') patch[key] = value;
  const unset = Object.keys(current).filter(
    (key) => key !== 'id' && key !== 'kind' && !(key in next),
  );
  return {
    op: 'set',
    coll,
    id: current.id,
    patch,
    ...(unset.length > 0 ? { unset } : {}),
  } as unknown as Op;
}

/** Copia de un ítem sin su id: base para reconstruirlo con propiedades nuevas. */
export function withoutId<K extends CollectionKey>(item: ItemOf<K>): NewItem<K> {
  const { id: _id, ...rest } = item;
  return rest as unknown as NewItem<K>;
}

// ── Menús respaldados por una colección ─────────────────────────────────────

export interface CollectionMenuSpec<K extends CollectionKey> {
  readonly path: string;
  readonly help: string;
  readonly coll: K;
  readonly props: readonly PropDef[];
  readonly flags: readonly FlagSlot[];
  readonly style: PrintStyle;
  readonly columns: readonly string[];
  readonly statsColumns?: readonly string[];
  readonly nameProp?: string;
  readonly autoName?: (ctx: MenuCtx) => string;
  readonly actions?: Readonly<Record<string, ActionDef>>;
  readonly export?: ExportDef;
  readonly movable?: boolean;
  readonly creatable?: boolean;
  readonly removable?: boolean;
  readonly filter?: (item: ItemOf<K>, ctx: MenuCtx) => boolean;
  toProps(item: ItemOf<K>, ctx: MenuCtx): Props;
  flagsOf(item: ItemOf<K>, ctx: MenuCtx): string;
  fromProps(p: Props, ctx: MenuCtx, current: ItemOf<K> | undefined): Result<NewItem<K>, Fault>;
  /** Filas que no son ítems de configuración (dinámicas). */
  extraRows?(ctx: MenuCtx): readonly Row[];
}

export function itemRow<K extends CollectionKey>(
  spec: CollectionMenuSpec<K>,
  item: ItemOf<K>,
  ctx: MenuCtx,
): Row {
  return {
    key: `i${item.id}`,
    id: item.id,
    numbered: true,
    props: spec.toProps(item, ctx),
    flags: spec.flagsOf(item, ctx),
    ...(item.comment === undefined ? {} : { comment: item.comment }),
  };
}

export function collectionMenu<K extends CollectionKey>(spec: CollectionMenuSpec<K>): MenuDef {
  const items = (ctx: MenuCtx): readonly ItemOf<K>[] =>
    specOf(spec.coll)
      .get(ctx.device.config)
      .filter((item) => (spec.filter ? spec.filter(item, ctx) : true));
  const current = (row: Row, ctx: MenuCtx): ItemOf<K> | undefined =>
    row.id === undefined ? undefined : items(ctx).find((i) => i.id === row.id);

  const menu: MenuDef = {
    path: spec.path,
    help: spec.help,
    props: spec.props,
    flags: spec.flags,
    style: spec.style,
    columns: spec.columns,
    coll: spec.coll,
    ...(spec.statsColumns ? { statsColumns: spec.statsColumns } : {}),
    ...(spec.nameProp ? { nameProp: spec.nameProp } : {}),
    ...(spec.autoName ? { autoName: spec.autoName } : {}),
    ...(spec.actions ? { actions: spec.actions } : {}),
    ...(spec.export ? { export: spec.export } : {}),
    ...(spec.movable ? { movable: true } : {}),
    rows: (ctx) => [
      ...items(ctx).map((item) => itemRow(spec, item, ctx)),
      ...(spec.extraRows?.(ctx) ?? []),
    ],
    update: (row, p, ctx) => {
      const item = current(row, ctx);
      if (!item) return err(fault('not-allowed', undefined, { reason: 'dynamic' }));
      const next = spec.fromProps(p, ctx, item);
      return next.ok ? ok([setOp(spec.coll, item, next.value)]) : next;
    },
  };
  return {
    ...menu,
    ...(spec.creatable === false
      ? {}
      : {
          add: (p: Props, ctx: MenuCtx) => {
            const created = spec.fromProps(p, ctx, undefined);
            if (!created.ok) return created;
            const before = p.get('__before');
            return ok([
              addOp(
                spec.coll,
                created.value,
                before === undefined ? undefined : (Number(before) as ItemId),
              ),
            ]);
          },
        }),
    ...(spec.removable === false
      ? {}
      : {
          remove: (row: Row, ctx: MenuCtx) => {
            const item = current(row, ctx);
            if (!item) return err(fault('not-allowed', undefined, { reason: 'dynamic' }));
            return ok([{ op: 'remove', coll: spec.coll, id: item.id } as Op]);
          },
        }),
  };
}

/** Fila de solo lectura (datos operativos). */
export function dynamicRow(key: string, p: Props, flagLetters: string, numbered = true): Row {
  return { key, numbered, props: p, flags: flagLetters };
}
