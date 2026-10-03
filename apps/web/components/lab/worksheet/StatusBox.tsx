'use client';

import { Check, type IconWeight, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ObjectiveState } from '@/lib/lab/store';

/** Un solo peso de icono en toda la hoja; en 14px el trazo fino no se lee sobre color. */
export const ICON_WEIGHT: IconWeight = 'bold';

/**
 * La casilla de estado de una tarea: el único elemento de la hoja que lleva
 * color de estado. Es decorativa; el estado se dice en texto en la fila.
 */
export function StatusBox({
  state,
  live,
}: {
  readonly state: ObjectiveState;
  /** La sesión ya está en marcha: un cambio a cumplida se anima. */
  readonly live: boolean;
}) {
  return (
    <span
      aria-hidden
      className="relative mt-[3px] block size-[18px] shrink-0 rounded-sm border border-rule-strong"
    >
      {/* La key remonta el relleno al cambiar de estado: así cada marca nueva entra con su gesto. */}
      {state !== 'pending' && <Fill key={state} state={state} animate={live && state === 'done'} />}
    </span>
  );
}

function Fill({
  state,
  animate,
}: {
  readonly state: Exclude<ObjectiveState, 'pending'>;
  readonly animate: boolean;
}) {
  // Se decide al montar: lo que ya venía cumplido (progreso restaurado) aparece quieto.
  // Al terminar el gesto se quitan las clases para que no se repita al volver a mostrar
  // la pestaña de tareas en móvil (@starting-style se aplica cada vez que pasa de oculto a visible).
  const [fresh, setFresh] = useState(animate);
  const Icon = state === 'done' ? Check : Warning;
  return (
    <span
      onTransitionEnd={() => setFresh(false)}
      className={`absolute -inset-px grid place-items-center rounded-sm text-ground ${
        state === 'done' ? 'bg-done' : 'bg-warn'
      } ${
        fresh
          ? 'transition-[scale,opacity] duration-[260ms] ease-(--ease-out) starting:scale-60 starting:opacity-0'
          : ''
      }`}
    >
      <Icon size={13} weight={ICON_WEIGHT} />
    </span>
  );
}
