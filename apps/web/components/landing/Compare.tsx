import { ConsoleQuote } from '@/components/ui/ConsoleQuote';
import { RichText } from '@/components/ui/RichText';
import type { Messages } from '@/lib/i18n';
import { COMPARE_ROWS } from '@/lib/landing/demo';

/**
 * "Lo que ya sabes de IOS": cada tarea con su versión en IOS y en RouterOS.
 * Los comandos van en superficies de consola (la mono no sale de ahí); la
 * tarea y la explicación, en la sans de la interfaz.
 */
export function Compare({ messages }: { readonly messages: Messages }) {
  const t = messages.landing.compare;
  return (
    <section aria-labelledby="compare-heading" className="border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <h2 id="compare-heading" className="text-lg font-semibold text-balance text-ink">
          {t.title}
        </h2>
        <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">{t.lead}</p>

        <ul className="mt-10 border-b border-rule">
          {COMPARE_ROWS.map((row) => (
            <li
              key={row.id}
              className="grid gap-x-6 gap-y-4 border-t border-rule py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,5fr)]"
            >
              <div className="min-w-0">
                <h3 className="font-medium text-ink text-pretty">{t.rows[row.id].task}</h3>
                <p className="mt-1.5 text-sm text-ink-muted text-pretty">
                  <RichText text={t.rows[row.id].note} />
                </p>
              </div>
              <ConsoleQuote label={t.ios} lines={row.ios} className="self-start" />
              <ConsoleQuote label={t.routeros} lines={row.routeros} className="self-start" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
