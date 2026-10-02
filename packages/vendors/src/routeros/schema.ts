/**
 * Tipos con los que se describe cada menú de RouterOS de forma declarativa:
 * qué propiedades tiene, cómo se ven en `print`, cómo se traducen al modelo
 * neutral y qué comandos admite.
 */
import type {
  CollectionKey,
  Device,
  DeviceConfig,
  ItemId,
  LiveView,
  Network,
  Op,
  PlatformSpec,
  Result,
  SyntaxFault,
} from '@nos/core';
import type { RouterosSession } from './session';

export type Props = ReadonlyMap<string, string>;

/** Destinos de referencia por nombre. */
export type RefTarget =
  | 'interface'
  | 'bridge'
  | 'pool'
  | 'dhcp-server'
  | 'interface-list'
  | 'user'
  | 'file';

export type ValueType =
  | { readonly kind: 'string' }
  | { readonly kind: 'name' }
  | { readonly kind: 'bool' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'time' }
  | { readonly kind: 'kib' }
  | { readonly kind: 'ip' }
  | { readonly kind: 'prefix' }
  | { readonly kind: 'ip-list' }
  | { readonly kind: 'prefix-list' }
  | { readonly kind: 'range-list' }
  | { readonly kind: 'address' }
  | { readonly kind: 'mac' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'enum-list'; readonly values: readonly string[] }
  | { readonly kind: 'ref'; readonly target: RefTarget; readonly extra?: readonly string[] }
  | { readonly kind: 'ref-list'; readonly target: RefTarget }
  | { readonly kind: 'vlan-ids' }
  | { readonly kind: 'ports' }
  | { readonly kind: 'gateway' }
  | { readonly kind: 'protocol' }
  | { readonly kind: 'neg'; readonly inner: ValueType }
  | { readonly kind: 'flag' };

export interface PropDef {
  readonly name: string;
  readonly type: ValueType;
  /** Se puede escribir con add/set. */
  readonly writable: boolean;
  readonly required?: boolean;
  /** Valor por defecto (forma canónica): se usa en add y se omite en export. */
  readonly default?: string;
  /** Solo existe como argumento de add (por ejemplo `place-before`). */
  readonly addOnly?: boolean;
  /** No se exporta (contadores, contraseñas). */
  readonly noExport?: boolean;
  /** No se muestra en print detail (contraseñas, estadísticas). */
  readonly hidden?: boolean;
  /** Dato sensible: solo se exporta con show-sensitive. */
  readonly sensitive?: boolean;
  readonly help?: string;
}

export interface FlagDef {
  readonly letter: string;
  readonly name: string;
}

/** Grupo de flags excluyentes entre sí (ocupan la misma columna). */
export type FlagSlot = readonly FlagDef[];

export interface Row {
  /** Clave estable dentro del menú, para la numeración de print. */
  readonly key: string;
  /** Ítem de configuración que respalda la fila, si es editable. */
  readonly id?: ItemId;
  /** Las filas dinámicas de algunos menús (rutas) no llevan número. */
  readonly numbered: boolean;
  readonly props: Props;
  /** Letras de flags activas. */
  readonly flags: string;
  readonly comment?: string;
}

export interface MenuCtx {
  readonly net: Network;
  readonly device: Device;
  readonly platform: PlatformSpec;
  readonly user: string;
  readonly clockBase: number;
}

export type Fault = SyntaxFault;

export interface ActionCtx extends MenuCtx {
  readonly session: RouterosSession;
  /** Filas referidas por `numbers` (ya resueltas). */
  readonly rows: readonly Row[];
  readonly menu: MenuDef;
}

export interface ActionOutcome {
  readonly net?: Network;
  readonly session?: RouterosSession;
  readonly output?: string;
  readonly live?: LiveView;
  readonly closed?: boolean;
  /** Pregunta de confirmación: si el usuario responde `y`, se repite con `confirmed=yes`. */
  readonly confirm?: string;
  /** Operaciones de configuración que el driver aplica (con undo, safe mode y log). */
  readonly ops?: readonly Op[];
}

export interface ActionDef {
  readonly help: string;
  readonly args: readonly PropDef[];
  /** Nombre del argumento que se puede escribir sin `nombre=`. */
  readonly positional?: string;
  /** Admite `numbers` (filas del menú) como primer argumento sin nombre. */
  readonly takesNumbers?: boolean;
  run(args: Props, ctx: ActionCtx): Result<ActionOutcome, Fault>;
}

export type PrintStyle = 'table' | 'detail' | 'singleton' | 'lines' | 'none';

export interface ExportDef {
  /** Posición en el orden de export (las dependencias primero). */
  readonly order: number;
  /**
   * `add`: una línea `add` por ítem no dinámico.
   * `set`: una línea `set` con lo que difiere del valor por defecto (menús únicos).
   * `set-default-name`: `set [ find default-name=X ]` para interfaces físicas.
   * `set-name`: `set <nombre>` para ítems fijos con nombre (servicios).
   */
  readonly style: 'add' | 'set' | 'set-default-name' | 'set-name';
  /**
   * Valores de fábrica propios de cada fila, para omitirlos en export cuando
   * no dependen solo de la propiedad (el nombre de fábrica de una interfaz,
   * el puerto de cada servicio). Tienen prioridad sobre `PropDef.default`.
   */
  readonly rowDefaults?: (row: Row, ctx: MenuCtx) => Props;
}

export interface MenuDef {
  /** Ruta con `/`: `ip/address`. */
  readonly path: string;
  readonly help: string;
  readonly props: readonly PropDef[];
  readonly flags: readonly FlagSlot[];
  readonly style: PrintStyle;
  readonly columns: readonly string[];
  readonly statsColumns?: readonly string[];
  /** Propiedad por la que se puede nombrar un ítem en lugar de su número. */
  readonly nameProp?: string;
  /** Colección del modelo que respalda el menú (para logs y move). */
  readonly coll?: CollectionKey | 'system' | 'dns' | 'discovery';
  rows(ctx: MenuCtx): readonly Row[];
  /** add: recibe argumentos con los valores por defecto ya aplicados. */
  readonly add?: (props: Props, ctx: MenuCtx) => Result<readonly Op[], Fault>;
  /** set: recibe las propiedades completas tras el cambio. */
  readonly update?: (row: Row, props: Props, ctx: MenuCtx) => Result<readonly Op[], Fault>;
  readonly remove?: (row: Row, ctx: MenuCtx) => Result<readonly Op[], Fault>;
  /** Borrado que no es de configuración (archivos): devuelve el efecto directamente. */
  readonly removeOther?: (rows: readonly Row[], ctx: MenuCtx) => Result<ActionOutcome, Fault>;
  /** Admite `move` (reglas de firewall). */
  readonly movable?: boolean;
  readonly autoName?: (ctx: MenuCtx) => string;
  readonly actions?: Readonly<Record<string, ActionDef>>;
  readonly export?: ExportDef;
}

export const prop = (
  name: string,
  type: ValueType,
  options: Partial<Omit<PropDef, 'name' | 'type'>> = {},
): PropDef => ({ name, type, writable: true, ...options });

export const ro = (name: string, type: ValueType = T.string): PropDef => ({
  name,
  type,
  writable: false,
});

export const T = {
  string: { kind: 'string' },
  name: { kind: 'name' },
  bool: { kind: 'bool' },
  time: { kind: 'time' },
  kib: { kind: 'kib' },
  ip: { kind: 'ip' },
  prefix: { kind: 'prefix' },
  ipList: { kind: 'ip-list' },
  prefixList: { kind: 'prefix-list' },
  rangeList: { kind: 'range-list' },
  address: { kind: 'address' },
  mac: { kind: 'mac' },
  vlanIds: { kind: 'vlan-ids' },
  ports: { kind: 'ports' },
  gateway: { kind: 'gateway' },
  protocol: { kind: 'protocol' },
  flag: { kind: 'flag' },
  int: (min: number, max: number): ValueType => ({ kind: 'int', min, max }),
  enumOf: (...values: string[]): ValueType => ({ kind: 'enum', values }),
  enumList: (...values: string[]): ValueType => ({ kind: 'enum-list', values }),
  ref: (target: RefTarget, ...extra: string[]): ValueType => ({ kind: 'ref', target, extra }),
  refList: (target: RefTarget): ValueType => ({ kind: 'ref-list', target }),
  neg: (inner: ValueType): ValueType => ({ kind: 'neg', inner }),
} as const satisfies Record<string, ValueType | ((...args: never[]) => ValueType)>;

export const fault = (
  code: string,
  at?: number,
  detail?: Readonly<Record<string, string | number>>,
): Fault => ({
  code,
  ...(at === undefined ? {} : { at }),
  ...(detail === undefined ? {} : { detail }),
});

/** Configuración del dispositivo vista por un menú. */
export const cfg = (ctx: MenuCtx): DeviceConfig => ctx.device.config;
