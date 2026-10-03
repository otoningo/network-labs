'use client';

import { useLayoutEffect, useRef } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { Role } from '@/lib/lab/topology';
import { placePopover, type Rect, type Size } from '@/lib/lab/viewport';
import type { IfaceSummary } from '@/lib/lab/wiring';

export const INSPECTOR_ID = 'topology-inspector';

/**
 * Detalle de un equipo junto a su forma: sus interfaces, si están activas o
 * deshabilitadas y sus direcciones. Se coloca a un lado y cambia de lado si no
 * cabe en el marco.
 */
export function Inspector({
  device,
  role,
  identity,
  interfaces,
  anchor,
  frame,
}: {
  readonly device: string;
  readonly role: Role;
  readonly identity: string | null;
  readonly interfaces: readonly IfaceSummary[];
  /** Rectángulo de la forma en píxeles del marco. */
  readonly anchor: Rect;
  readonly frame: Size;
}) {
  const { messages } = useI18n();
  const t = messages.topology;
  const ref = useRef<HTMLDivElement>(null);

  // Se mide ya dibujado y se coloca antes de pintar, para no verlo saltar.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const panel = { width: element.offsetWidth, height: element.offsetHeight };
    const { left, top } = placePopover(anchor, panel, frame);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = 'visible';
  });

  return (
    <div
      ref={ref}
      id={INSPECTOR_ID}
      role="tooltip"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
      className="pointer-events-none absolute z-10 w-max max-w-[min(22rem,calc(100%-1rem))] rounded-sm border border-rule-strong bg-sheet px-3 py-2 text-xs"
    >
      <p className="text-ink">
        <span className="font-semibold">{device}</span>{' '}
        <span className="text-ink-faint">{t.roles[role]}</span>
      </p>
      {identity && <p className="text-ink-muted">{fill(t.identity, { identity })}</p>}
      {interfaces.length === 0 ? (
        <p className="mt-1 text-ink-faint">{t.noInterfaces}</p>
      ) : (
        <table className="mt-1.5 border-t border-rule">
          <caption className="sr-only">{t.interfaces}</caption>
          <tbody>
            {interfaces.map((iface) => (
              <tr key={iface.id} className="align-baseline">
                <th scope="row" className="py-0.5 pr-3 text-left font-medium text-ink">
                  {iface.name}
                </th>
                <td
                  className={`py-0.5 pr-3 ${iface.state === 'running' ? 'text-ink-muted' : 'text-ink-faint'}`}
                >
                  {t.ifaceState[iface.state]}
                </td>
                <td className="py-0.5 text-ink-muted">
                  {iface.addresses.length > 0 ? (
                    iface.addresses.join(', ')
                  ) : (
                    <span className="text-ink-faint">{t.noAddress}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
