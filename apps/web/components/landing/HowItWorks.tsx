import { RichText } from '@/components/ui/RichText';
import type { Messages } from '@/lib/i18n';

type Zone = 'tasks' | 'figure' | 'console';
const ZONES: readonly Zone[] = ['tasks', 'figure', 'console'];

/**
 * Cómo es un lab, en un solo bloque: un esquema de la pantalla (Fig. 2) y,
 * al lado, sus tres zonas, las pistas y dónde se guarda el progreso.
 */
export function HowItWorks({ messages }: { readonly messages: Messages }) {
  const t = messages.landing.how;
  return (
    <section aria-labelledby="how-heading" className="border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <h2 id="how-heading" className="text-lg font-semibold text-balance text-ink">
          {t.title}
        </h2>

        <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <figure className="m-0 min-w-0">
            <Schematic labels={t.zones} />
            <figcaption className="mt-3 text-xs text-ink-faint text-pretty">
              <span className="font-medium text-ink-muted">{t.figure}</span> {t.caption}
            </figcaption>
          </figure>

          <div className="min-w-0">
            <dl className="border-b border-rule">
              {ZONES.map((zone) => (
                <div key={zone} className="border-t border-rule py-4">
                  <dt className="font-medium text-ink">{t.zones[zone].name}</dt>
                  <dd className="mt-1 max-w-[62ch] text-sm text-ink-muted text-pretty">
                    <RichText text={t.zones[zone].text} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-[62ch] text-ink text-pretty">{t.hints}</p>
            <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.progress}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Esquema de la pantalla de lab dibujado con filetes: hoja de tareas a la
 * izquierda, figura arriba a la derecha y consola debajo. Es decorativo: el
 * texto de al lado dice lo mismo.
 */
function Schematic({ labels }: { readonly labels: Messages['landing']['how']['zones'] }) {
  return (
    <div
      aria-hidden
      className="grid aspect-[16/10] grid-cols-[minmax(0,38fr)_minmax(0,62fr)] grid-rows-[minmax(0,40fr)_minmax(0,60fr)] overflow-hidden rounded-sm border border-rule-strong"
    >
      <div className="row-span-2 border-r border-rule-strong p-3 sm:p-4">
        <p className="text-2xs text-ink-faint">{labels.tasks.name}</p>
        <div className="mt-3 border-b border-rule">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2 border-t border-rule py-2 sm:py-2.5">
              <span className="w-3 text-right text-xs leading-none font-light text-ink-faint">
                {n}
              </span>
              <span className="h-1 flex-1 rounded-sm bg-rule-strong" />
              <span className="size-2.5 shrink-0 rounded-sm border border-control" />
            </div>
          ))}
        </div>
      </div>
      <div className="relative border-b border-rule-strong p-3 sm:p-4">
        <p className="text-2xs text-ink-faint">{labels.figure.name}</p>
        <div className="absolute inset-x-[18%] top-[58%] flex items-center">
          <span className="h-4 w-9 shrink-0 rounded-sm border border-control bg-sheet sm:h-5 sm:w-12" />
          <span className="h-px flex-1 bg-control" />
          <span className="h-4 w-8 shrink-0 rounded-sm border border-rule-strong bg-sheet sm:h-5 sm:w-10" />
        </div>
      </div>
      <div className="bg-console p-3 sm:p-4">
        <p className="text-2xs text-ink-faint">{labels.console.name}</p>
        <div className="mt-3 space-y-2">
          <span className="block h-1 w-3/5 rounded-sm bg-rule-strong" />
          <span className="block h-1 w-2/5 rounded-sm bg-rule-strong" />
          <span className="block h-2.5 w-1.5 bg-ink-muted" />
        </div>
      </div>
    </div>
  );
}
