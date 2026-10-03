/**
 * Ayudantes para probar los labs de content/labs/routeros: cargar el YAML como
 * lo hace la web y conducir varias consolas sobre la misma red.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateObjectives, type LabRuntime, loadLab, type Network } from '@nos/core';
import { parseLabYaml } from '@nos/core/lab-yaml';
import { routerosStartup } from './driver';
import { ROUTEROS_PLATFORM } from './platform';
import { Terminal } from './terminal';

export const LABS_DIR = join(import.meta.dirname, '../../../../content/labs/routeros');

export const labFiles = (): string[] => readdirSync(LABS_DIR).filter((f) => f.endsWith('.yaml'));

export function loadLabFile(file: string): LabRuntime {
  const parsed = parseLabYaml(readFileSync(join(LABS_DIR, file), 'utf8'));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const runtime = loadLab(parsed.value, {
    platforms: { routeros: ROUTEROS_PLATFORM },
    runStartup: routerosStartup,
  });
  if (!runtime.ok) throw new Error(`${file}: ${JSON.stringify(runtime.error)}`);
  return runtime.value;
}

/** Objetivos sin cumplir, en el orden del lab. */
export const pendingOn = (runtime: LabRuntime, net: Network): string[] =>
  [...evaluateObjectives(runtime, net)].filter(([, done]) => !done).map(([id]) => id);

/**
 * Banco de trabajo: una consola por equipo, todas sobre la misma red, como en
 * la web al cambiar de equipo en el selector.
 */
export class Bench {
  net: Network;
  private readonly consoles = new Map<string, Terminal>();

  constructor(readonly runtime: LabRuntime) {
    this.net = runtime.net;
  }

  /** Consola del equipo, sincronizada con la red actual del banco. */
  on(id: string): Pick<Terminal, 'ok' | 'run' | 'key' | 'script'> & { readonly prompt: string } {
    let terminal = this.consoles.get(id);
    if (!terminal) {
      terminal = new Terminal(this.net, id);
      this.consoles.set(id, terminal);
    }
    const t = terminal;
    const bench = this;
    const sync = <T>(fn: () => T): T => {
      t.net = bench.net;
      const result = fn();
      bench.net = t.net;
      return result;
    };
    return {
      ok: (line: string) => sync(() => t.ok(line)),
      run: (line: string) => sync(() => t.run(line)),
      key: (chord: Parameters<Terminal['key']>[0]) => sync(() => t.key(chord)),
      script: (lines: readonly string[]) => {
        sync(() => t.script(lines));
        return t;
      },
      get prompt() {
        t.net = bench.net;
        return t.prompt;
      },
    };
  }

  pending(): string[] {
    return pendingOn(this.runtime, this.net);
  }
}
