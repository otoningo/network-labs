/**
 * Ejecuta las líneas de una tarea de "Compara sintaxis" en el motor, con el
 * driver de su sistema, y devuelve lo que se ve en la consola: cada línea con
 * el prompt que tenía el equipo justo antes. Solo en el servidor, al compilar.
 */
import type { QuotedLine } from '@/components/ui/ConsoleQuote';
import { createLabStore } from '../lab/store';
import { type CompareTask, compareLab, type SimulatedOs } from './tasks';

export interface Simulation {
  readonly lines: readonly QuotedLine[];
  /** La tarea no se cumplía antes y se cumple después de la última línea. */
  readonly verified: boolean;
  /** Primera línea que el equipo rechazó, si alguna. */
  readonly failed?: { readonly line: string; readonly output: string };
}

export function simulate(task: CompareTask, os: SimulatedOs): Simulation {
  const store = createLabStore(compareLab(task, os));
  const before = store.getState().objectives[task.id];
  const lines: QuotedLine[] = [];
  for (const command of task.simulated[os]) {
    const prompt = store.getState().prompt();
    const result = store.getState().run(command);
    lines.push({ prompt, command });
    if (!result.ok)
      return { lines, verified: false, failed: { line: command, output: result.output } };
  }
  const after = store.getState().objectives[task.id];
  return { lines, verified: before === 'pending' && after === 'done' };
}
