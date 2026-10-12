import type { ReactNode } from 'react';

/** Una línea de consola citada: el prompt va en tinta tenue y el comando en tinta. */
export interface QuotedLine {
  readonly prompt: string;
  readonly command: string;
}

/**
 * Un bloque de consola citado: franja con lo que es (el sistema, "Sintaxis",
 * "Error típico") y las líneas con su prompt. La mono no sale de aquí. La
 * franja admite una acción a la derecha, como "Probar".
 */
export function ConsoleQuote({
  label,
  lines,
  action,
  commandId,
  className = '',
}: {
  readonly label: ReactNode;
  readonly lines: readonly QuotedLine[];
  readonly action?: ReactNode;
  /** Id del comando de la primera línea, para que una acción lo nombre (aria-describedby). */
  readonly commandId?: string;
  readonly className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-sm bg-console ${className}`}>
      <div className="flex min-h-7 items-center justify-between gap-3 border-b border-rule px-3">
        <p className="py-1.5 text-2xs text-ink-faint">{label}</p>
        {action}
      </div>
      <pre className="m-0 px-3 py-2.5 font-mono text-[13.5px] leading-[1.45] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: líneas citadas, estáticas y en orden fijo
          <span key={index} className="block">
            {line.prompt !== '' && <span className="text-ink-faint">{line.prompt}</span>}
            {index === 0 && commandId ? <span id={commandId}>{line.command}</span> : line.command}
          </span>
        ))}
      </pre>
    </div>
  );
}
