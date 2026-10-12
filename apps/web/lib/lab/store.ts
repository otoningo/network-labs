/**
 * Estado de un lab abierto (Zustand, D-033). Un store por pantalla de lab:
 * la red simulada, las consolas, el estado de cada objetivo y las pistas.
 * Los objetivos se evalúan contra la red tras cada comando, nunca contra el
 * texto escrito.
 */
import {
  type Completion,
  type DeviceId,
  deviceId,
  evaluateObjectives,
  type KeyChord,
  type LabDefinition,
  type LabRuntime,
  loadLab,
  type Network,
  tick,
} from '@nos/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { LabProgress, LoggedCommand } from '../progress/repository';
import { type ConsoleResult, consoleFor, type DeviceConsole, LAB_ENVIRONMENT } from './console';

export type ObjectiveState = 'pending' | 'done' | 'regressed';

export interface LabState {
  readonly runtime: LabRuntime;
  readonly net: Network;
  /** Equipos con CLI, en el orden de la topología. */
  readonly consoleDevices: readonly DeviceId[];
  readonly activeDevice: DeviceId;
  readonly objectives: Readonly<Record<string, ObjectiveState>>;
  readonly hints: Readonly<Record<string, number>>;
  readonly completed: Readonly<Record<string, string>>;
  readonly finishedAt: string | null;
  readonly log: readonly LoggedCommand[];
  /** Comandos que se volvieron a ejecutar al restaurar la sesión guardada. */
  readonly restoredCount: number;
  /** Ya se leyó (o se descartó) el progreso guardado. */
  readonly hydrated: boolean;
  /** Cambia con cada reinicio del lab; la terminal lo usa para limpiar la pantalla. */
  readonly epoch: number;
  /**
   * Línea propuesta para la consola (el botón "Probar" de la referencia). La
   * consola la escribe en el prompt sin ejecutarla; `seq` distingue dos
   * propuestas iguales seguidas.
   */
  readonly draft: { readonly text: string; readonly seq: number } | null;

  run(line: string): ConsoleResult;
  key(chord: KeyChord): ConsoleResult;
  complete(input: string, cursor: number): Completion;
  help(input: string): string;
  prompt(): string;
  banner(): string;
  /** Sesión nueva en la consola activa (tras `quit`). */
  reconnect(): void;
  /** Avanza el reloj simulado; lo usan las vistas en vivo como Torch. */
  advance(seconds: number): void;
  revealHint(objectiveId: string): void;
  setActiveDevice(id: DeviceId): void;
  hydrate(progress: LabProgress | null): void;
  reset(): void;
  /** Propone una línea a la consola activa, sin ejecutarla. */
  suggest(text: string): void;
  snapshot(): LabProgress;
}

export type LabStore = StoreApi<LabState>;

export class LabLoadFailure extends Error {
  constructor(readonly detail: string) {
    super(detail);
  }
}

function boot(lab: LabDefinition): LabRuntime {
  const loaded = loadLab(lab, LAB_ENVIRONMENT);
  if (!loaded.ok) throw new LabLoadFailure(JSON.stringify(loaded.error));
  return loaded.value;
}

function openConsoles(net: Network): Map<DeviceId, DeviceConsole> {
  const consoles = new Map<DeviceId, DeviceConsole>();
  for (const device of net.devices) {
    const opened = consoleFor(net, device.id);
    if (opened) consoles.set(device.id, opened);
  }
  return consoles;
}

function statusOf(
  runtime: LabRuntime,
  net: Network,
  completed: Readonly<Record<string, string>>,
): Record<string, ObjectiveState> {
  const status: Record<string, ObjectiveState> = {};
  for (const [id, holds] of evaluateObjectives(runtime, net)) {
    status[id] = holds ? 'done' : completed[id] ? 'regressed' : 'pending';
  }
  return status;
}

const now = (): string => new Date().toISOString();

export function createLabStore(lab: LabDefinition): LabStore {
  let runtime = boot(lab);
  let consoles = openConsoles(runtime.net);

  return createStore<LabState>()((set, get) => {
    const active = (): DeviceConsole => {
      const found = consoles.get(get().activeDevice);
      if (!found) throw new Error('el lab no tiene equipos con consola');
      return found;
    };

    /** Aplica el resultado de un comando: red nueva, objetivos y registro. */
    const commit = (result: ConsoleResult, entry: LoggedCommand | null): ConsoleResult => {
      const state = get();
      if (result.net === state.net && entry === null) return result;
      const objectives = statusOf(state.runtime, result.net, state.completed);
      const completed = { ...state.completed };
      for (const [id, value] of Object.entries(objectives)) {
        if (value === 'done' && !completed[id]) completed[id] = now();
      }
      const allDone = Object.values(objectives).every((v) => v === 'done');
      set({
        net: result.net,
        objectives,
        completed,
        finishedAt: state.finishedAt ?? (allDone ? now() : null),
        log: entry ? [...state.log, entry] : state.log,
      });
      return result;
    };

    const initial = (): Pick<
      LabState,
      | 'runtime'
      | 'net'
      | 'consoleDevices'
      | 'activeDevice'
      | 'objectives'
      | 'hints'
      | 'completed'
      | 'finishedAt'
      | 'log'
      | 'restoredCount'
    > => {
      const consoleDevices = [...consoles.keys()];
      const first = consoleDevices[0];
      if (first === undefined) throw new LabLoadFailure('no console device');
      return {
        runtime,
        net: runtime.net,
        consoleDevices,
        activeDevice: first,
        objectives: statusOf(runtime, runtime.net, {}),
        hints: {},
        completed: {},
        finishedAt: null,
        log: [],
        restoredCount: 0,
      };
    };

    return {
      ...initial(),
      hydrated: false,
      epoch: 0,
      draft: null,

      run: (line) => {
        const device = get().activeDevice;
        const result = active().run(get().net, line);
        return commit(result, line.trim() === '' ? null : { device, line });
      },
      key: (chord) => commit(active().key(get().net, chord), null),
      complete: (input, cursor) => active().complete(get().net, input, cursor),
      help: (input) => active().help(get().net, input),
      prompt: () => active().prompt(get().net),
      banner: () => active().banner(get().net),
      reconnect: () => active().reopen(get().net),
      suggest: (text) => set({ draft: { text, seq: (get().draft?.seq ?? 0) + 1 } }),
      advance: (seconds) => set({ net: tick(get().net, seconds) }),

      revealHint: (objectiveId) => {
        const objective = get().runtime.lab.objectives.find((o) => o.id === objectiveId);
        if (!objective) return;
        const shown = get().hints[objectiveId] ?? 0;
        if (shown >= objective.hints.length) return;
        set({ hints: { ...get().hints, [objectiveId]: shown + 1 } });
      },

      setActiveDevice: (id) => {
        if (consoles.has(id)) set({ activeDevice: id });
      },

      hydrate: (progress) => {
        if (!progress || get().hydrated) {
          set({ hydrated: true });
          return;
        }
        // Se vuelve a ejecutar lo que escribió el estudiante; una línea que ya no
        // es válida (por un cambio del motor) se salta sin romper la restauración.
        let net = get().net;
        let restored = 0;
        for (const entry of progress.log) {
          const target = consoles.get(deviceId(entry.device));
          if (!target) continue;
          const result = target.run(net, entry.line);
          net = result.net;
          if (result.closed) target.reopen(net);
          restored += 1;
        }
        const completed = progress.completed;
        const objectives = statusOf(get().runtime, net, completed);
        set({
          net,
          objectives,
          completed,
          hints: progress.hints,
          finishedAt: progress.finishedAt ?? null,
          log: progress.log,
          restoredCount: restored,
          hydrated: true,
        });
      },

      reset: () => {
        runtime = boot(lab);
        consoles = openConsoles(runtime.net);
        set({ ...initial(), hydrated: true, epoch: get().epoch + 1 });
      },

      snapshot: () => {
        const state = get();
        return {
          version: 1,
          labId: state.runtime.lab.id,
          log: state.log,
          hints: state.hints,
          completed: state.completed,
          ...(state.finishedAt ? { finishedAt: state.finishedAt } : {}),
          updatedAt: now(),
        };
      },
    };
  });
}
