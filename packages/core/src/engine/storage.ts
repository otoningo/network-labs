/**
 * Almacenamiento del dispositivo: backups (instantánea neutral de la
 * configuración) y scripts de texto (exportaciones en la sintaxis del driver).
 * El nombre de archivo lo decide el driver, extensión incluida.
 */
import type { SimTime } from '../model/brand';
import type { CoreError } from '../model/errors';
import type { Device, StoredFile } from '../model/network';
import { LOG_LIMIT } from '../model/oper';
import { err, ok, type Result } from '../model/result';
import { applyOp } from '../ops/apply';

function store(device: Device, file: StoredFile): Device {
  const files = [...device.storage.files.filter((f) => f.name !== file.name), file];
  return { ...device, storage: { files } };
}

function log(device: Device, at: SimTime, event: Device['oper']['log'][number]['event']): Device {
  return {
    ...device,
    oper: { ...device.oper, log: [...device.oper.log, { at, event }].slice(-LOG_LIMIT) },
  };
}

export function saveBackup(device: Device, name: string, now: SimTime): Device {
  const saved = store(device, {
    name,
    createdAt: now,
    payload: { kind: 'backup', config: device.config },
  });
  return log(saved, now, { kind: 'backup-saved', file: name });
}

export function loadBackup(device: Device, name: string, now: SimTime): Result<Device, CoreError> {
  const file = device.storage.files.find((f) => f.name === name);
  if (file?.payload.kind !== 'backup')
    return err({ code: 'not-found', scope: 'storage', ref: name });
  const restored = applyOp(device, { op: 'restore', config: file.payload.config });
  if (!restored.ok) return restored;
  return ok(log(restored.value.device, now, { kind: 'backup-loaded', file: name }));
}

export function saveScript(device: Device, name: string, text: string, now: SimTime): Device {
  return store(device, { name, createdAt: now, payload: { kind: 'script', text } });
}

export function readScript(device: Device, name: string): Result<string, CoreError> {
  const file = device.storage.files.find((f) => f.name === name);
  if (file?.payload.kind !== 'script')
    return err({ code: 'not-found', scope: 'storage', ref: name });
  return ok(file.payload.text);
}

export function removeFile(device: Device, name: string): Result<Device, CoreError> {
  if (!device.storage.files.some((f) => f.name === name)) {
    return err({ code: 'not-found', scope: 'storage', ref: name });
  }
  return ok({ ...device, storage: { files: device.storage.files.filter((f) => f.name !== name) } });
}

/** Tamaño aproximado en bytes, para listados de archivos. */
export function fileSize(file: StoredFile): number {
  return file.payload.kind === 'script'
    ? file.payload.text.length
    : JSON.stringify(file.payload.config).length;
}
