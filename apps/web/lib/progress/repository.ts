/**
 * Progreso del estudiante detrás de una interfaz asíncrona (D-032): hoy
 * localStorage, mañana Supabase sin tocar a quien la usa.
 *
 * No se guarda la red: se guarda lo que escribió el estudiante y se vuelve a
 * ejecutar al abrir el lab. Así el progreso sobrevive a cambios del motor.
 */

export interface LoggedCommand {
  readonly device: string;
  readonly line: string;
}

export interface LabProgress {
  readonly version: 1;
  readonly labId: string;
  /** Líneas en el orden en que se ejecutaron, por equipo. */
  readonly log: readonly LoggedCommand[];
  /** Pistas reveladas por objetivo. */
  readonly hints: Readonly<Record<string, number>>;
  /** Primera vez que cada objetivo se cumplió (ISO 8601). */
  readonly completed: Readonly<Record<string, string>>;
  readonly finishedAt?: string;
  readonly updatedAt: string;
}

export interface ProgressRepository {
  load(labId: string): Promise<LabProgress | null>;
  save(progress: LabProgress): Promise<void>;
  list(): Promise<readonly LabProgress[]>;
  clear(labId: string): Promise<void>;
}

/** Tope de líneas guardadas por lab: más que suficiente para un lab y acotado para el almacenamiento. */
export const MAX_LOGGED_COMMANDS = 2000;

export function emptyProgress(labId: string): LabProgress {
  return {
    version: 1,
    labId,
    log: [],
    hints: {},
    completed: {},
    updatedAt: new Date(0).toISOString(),
  };
}

// ── Validación de lo leído (el almacenamiento es entrada no confiable) ──────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRecordOf = <T>(value: unknown, item: (v: unknown) => v is T): value is Record<string, T> =>
  isRecord(value) && Object.values(value).every(item);

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isString = (v: unknown): v is string => typeof v === 'string';

const isCommand = (v: unknown): v is LoggedCommand =>
  isRecord(v) && isString(v['device']) && isString(v['line']);

export function parseProgress(value: unknown): LabProgress | null {
  if (!isRecord(value) || value['version'] !== 1) return null;
  const { labId, log, hints, completed, finishedAt, updatedAt } = value;
  if (!isString(labId) || !isString(updatedAt)) return null;
  if (!Array.isArray(log) || !log.every(isCommand)) return null;
  if (!isRecordOf(hints, isNumber) || !isRecordOf(completed, isString)) return null;
  if (finishedAt !== undefined && !isString(finishedAt)) return null;
  return {
    version: 1,
    labId,
    log: log.slice(-MAX_LOGGED_COMMANDS),
    hints,
    completed,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    updatedAt,
  };
}

// ── localStorage ────────────────────────────────────────────────────────────

const PREFIX = 'nos-labs:progress:v1:';

/** Almacén mínimo que cumple localStorage; permite pruebas con un mapa en memoria. */
export type KeyValueStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export class LocalProgressRepository implements ProgressRepository {
  constructor(private readonly storage: KeyValueStorage | null) {}

  async load(labId: string): Promise<LabProgress | null> {
    const raw = this.read(PREFIX + labId);
    if (raw === null) return null;
    try {
      return parseProgress(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(progress: LabProgress): Promise<void> {
    const trimmed: LabProgress = { ...progress, log: progress.log.slice(-MAX_LOGGED_COMMANDS) };
    try {
      this.storage?.setItem(PREFIX + progress.labId, JSON.stringify(trimmed));
    } catch {
      // Cuota llena o almacenamiento bloqueado: el lab sigue funcionando sin guardar.
    }
  }

  async list(): Promise<readonly LabProgress[]> {
    const found: LabProgress[] = [];
    const storage = this.storage;
    if (!storage) return found;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) {
        const progress = await this.load(key.slice(PREFIX.length));
        if (progress) found.push(progress);
      }
    }
    return found;
  }

  async clear(labId: string): Promise<void> {
    try {
      this.storage?.removeItem(PREFIX + labId);
    } catch {
      // Igual que en save: sin almacenamiento no hay nada que borrar.
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

/** Repositorio del navegador; en el servidor (o con el almacenamiento bloqueado) no guarda nada. */
export function browserRepository(): ProgressRepository {
  let storage: KeyValueStorage | null = null;
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    storage = null;
  }
  return new LocalProgressRepository(storage);
}
