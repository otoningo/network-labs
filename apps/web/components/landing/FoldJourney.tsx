'use client';

import { Cloud, Desktop, HardDrives, type Icon, Network } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { Journey } from '@/lib/landing/journey';
import { type JourneyStep, journeySteps } from './journeySteps';
import { StepList } from './StepList';

/**
 * El viaje del paquete (D-041): al bajar, una hoja bermellón se pliega capa a
 * capa (TCP, IP, Ethernet) sobre la PC, recorre la red real que calculó el
 * motor parando en cada equipo, el router le reescribe el remite con la regla
 * de NAT del hero y en el destino se despliega. El scroll mueve variables CSS
 * directamente; React solo se entera del paso activo. Con movimiento reducido
 * o una pantalla muy baja, el CSS muestra en su lugar la lista quieta.
 */

/** Tramos del scroll (0 a 1) para cada fase. */
const PHASE = {
  flat: [0, 0.08],
  f1: [0.08, 0.2],
  f2: [0.2, 0.32],
  f3: [0.32, 0.44],
  toRouter: [0.44, 0.54],
  nat: [0.56, 0.66],
  toIsp: [0.66, 0.72],
  toTarget: [0.75, 0.8],
  unfold: [0.8, 0.96],
} as const;

/** Paso de la columna (0 a 6) según el progreso. */
function stepAt(p: number): number {
  if (p < PHASE.f1[0]) return 0;
  if (p < PHASE.f2[0]) return 1;
  if (p < PHASE.f3[0]) return 2;
  // Ethernet narra también el trayecto hasta R1; la traducción empieza cuando el router la hace.
  if (p < PHASE.nat[0]) return 3;
  if (p < PHASE.toIsp[0]) return 4;
  if (p < PHASE.unfold[0]) return 5;
  return 6;
}

/** Inicio de cada paso, para saltar a él desde la columna. */
const STEP_START = [
  0,
  PHASE.f1[0],
  PHASE.f2[0],
  PHASE.f3[0],
  PHASE.nat[0],
  PHASE.toIsp[0],
  PHASE.unfold[0] + 0.06,
];

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const within = (p: number, [a, b]: readonly [number, number]) => clamp((p - a) / (b - a));
/** Arranque y llegada suaves: cada fase ocupa todo su tramo de scroll. */
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Paso desde el que cada estación cuenta como alcanzada. */
const REACHED_AT = [0, 4, 5, 6] as const;

/** Estaciones del recorrido, en fracción del ancho del escenario. */
const STATIONS = [0.12, 0.38, 0.6, 0.8] as const;
const NARROW_STATIONS = [0.13, 0.37, 0.61, 0.85] as const;

/** Ancho mínimo de la pieza plegada mientras viaja, para que su rótulo se lea. */
const MIN_PIECE = 96;
const NARROW_MIN_PIECE = 64;

const DEVICE_ICON: readonly Icon[] = [Desktop, Network, Cloud, HardDrives];

/** Lleva el scroll al punto del viaje donde ocurre un paso (también desde el hero). */
export function jumpToStep(index: number): void {
  const smoothScroll = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animated = document.getElementById('viaje');
  if (!animated || animated.offsetParent === null) {
    document
      .getElementById('viaje-pasos')
      ?.scrollIntoView({ behavior: smoothScroll ? 'smooth' : 'auto' });
    return;
  }
  const travel = Math.max(0, animated.offsetHeight - window.innerHeight);
  const top = animated.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({
    top: top + travel * (STEP_START[index] ?? 0) + 1,
    behavior: smoothScroll ? 'smooth' : 'auto',
  });
}

export function FoldJourney({ journey }: { readonly journey: Journey }) {
  const { messages } = useI18n();
  const steps = journeySteps(journey, messages);
  return (
    <>
      <AnimatedJourney journey={journey} steps={steps} />
      <StaticJourney journey={journey} steps={steps} />
    </>
  );
}

function AnimatedJourney({
  journey,
  steps,
}: {
  readonly journey: Journey;
  readonly steps: readonly JourneyStep[];
}) {
  const { messages } = useI18n();
  const t = messages.landing.journey;
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const intro = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = section.current;
    const box = stage.current;
    if (!root || !box) return;
    let frame = 0;
    let lastStep = -1;

    const paint = () => {
      frame = 0;
      // Oculto por el CSS (movimiento reducido, pantalla baja): no hay nada que mover.
      if (root.offsetParent === null) return;
      const rect = root.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp(-rect.top / travel) : 0;
      const w = box.clientWidth;
      const h = box.clientHeight;
      const narrow = w < 640;
      const routeY = h * (narrow ? 0.66 : 0.78);
      const xs = (narrow ? NARROW_STATIONS : STATIONS).map((f) => f * w);
      const markHalf = narrow ? 17 : 24;
      const x0 = xs[0] ?? 0;
      const x1 = xs[1] ?? 0;
      const x2 = xs[2] ?? 0;
      const x3 = xs[3] ?? w;

      // La hoja cabe entre el texto de arriba y la red.
      const introBottom = intro.current ? intro.current.offsetTop + intro.current.offsetHeight : 0;
      const room = routeY - markHalf - 16 - introBottom - 16;
      const size = clamp(Math.min(room, w * (narrow ? 0.62 : 0.3), 360), 120, 360);

      // Plegado y despliegue: tres pliegues que se deshacen en orden inverso al llegar.
      const u = within(p, PHASE.unfold);
      const f1 = smooth(within(p, PHASE.f1)) * (1 - smooth(clamp((u - 0.66) * 3)));
      const f2 = smooth(within(p, PHASE.f2)) * (1 - smooth(clamp((u - 0.33) * 3)));
      const f3 = smooth(within(p, PHASE.f3)) * (1 - smooth(clamp(u * 3)));
      // Al terminar de desplegarse vuelve a ser la hoja de datos, entera.
      let stageNo = 0;
      if (u >= 0.99) stageNo = 0;
      else if (u > 0) stageNo = u < 0.33 ? 3 : u < 0.66 ? 2 : 1;
      else if (f3 > 0) stageNo = 3;
      else if (f2 > 0) stageNo = 2;
      else if (f1 > 0) stageNo = 1;

      // La pieza plegada es el cuarto inferior izquierdo de la hoja: nace sobre la PC.
      const pieceW = size / 4;
      const travelScale = Math.max(1, (narrow ? NARROW_MIN_PIECE : MIN_PIECE) / pieceW);
      const restY = routeY - markHalf - 14; // borde inferior de la pieza, posada sobre el equipo
      const a = smooth(within(p, PHASE.toRouter));
      const b = smooth(within(p, PHASE.toIsp));
      const c = smooth(within(p, PHASE.toTarget));
      // Crece al echar a andar, hasta que su rótulo se lee.
      const scale = lerp(1, travelScale, a);
      let cx = x0;
      if (p >= PHASE.toRouter[0]) cx = lerp(x0, x1, a);
      if (p >= PHASE.toIsp[0]) cx = lerp(x1, x2, b);
      if (p >= PHASE.toTarget[0]) cx = lerp(x2, x3, c);
      // Un saltito entre equipos: la pieza se levanta y se posa.
      const hop = Math.sin(a * Math.PI) + Math.sin(b * Math.PI) + Math.sin(c * Math.PI);
      let tx = cx - (pieceW / 2) * scale;
      let ty = restY - size * scale - hop * 18;

      // En el destino se despliega posada sobre el servidor y vuelve a ser la hoja entera.
      if (u > 0) {
        const g = smooth(u);
        const full = Math.min(size, room + size * 0.1, w - 24);
        const fullScale = full / size;
        const fx = clamp(x3 - full / 2, 12, w - 12 - full);
        const fy = restY - full;
        const s = lerp(scale, fullScale, g);
        // Mientras se abre, la hoja se levanta un poco y se asienta.
        const lift = Math.sin(g * Math.PI) * 16;
        tx = lerp(tx, fx, g);
        ty = lerp(ty, fy, g) - lift;
        box.style.setProperty('--scale', s.toFixed(4));
      } else {
        box.style.setProperty('--scale', scale.toFixed(4));
      }

      const nat = smooth(within(p, PHASE.nat));
      const slip = p >= PHASE.f3[1] - 0.02 && u < 0.2 ? 1 : 0;
      box.style.setProperty('--size', `${size}px`);
      box.style.setProperty('--f1', f1.toFixed(4));
      box.style.setProperty('--f2', f2.toFixed(4));
      box.style.setProperty('--f3', f3.toFixed(4));
      box.style.setProperty('--tx', `${tx.toFixed(1)}px`);
      box.style.setProperty('--ty', `${ty.toFixed(1)}px`);
      box.style.setProperty('--nat', nat.toFixed(4));
      box.style.setProperty('--slip', String(slip));
      box.style.setProperty('--route-y', `${routeY}px`);
      box.style.setProperty('--ink-x', `${(u > 0 ? x3 : cx).toFixed(1)}px`);

      // La etiqueta va al lado de la pieza: a su derecha si cabe, si no a su izquierda.
      const slipW = slipRef.current?.offsetWidth ?? 160;
      const slipH = slipRef.current?.offsetHeight ?? 80;
      const right = cx + (pieceW / 2) * scale + 12;
      const slipX = right + slipW <= w - 12 ? right : cx - (pieceW / 2) * scale - 12 - slipW;
      const slipY = restY - slipH - hop * 18;
      box.style.setProperty('--px', `${clamp(slipX, 12, w - 12 - slipW).toFixed(1)}px`);
      box.style.setProperty('--py', `${slipY.toFixed(1)}px`);
      box.dataset['stage'] = String(stageNo);
      for (const [i, x] of xs.entries()) box.style.setProperty(`--x${i}`, `${x}px`);

      const step = stepAt(p);
      if (step !== lastStep) {
        lastStep = step;
        setActive(step);
      }
    };

    const request = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    return () => {
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const jump = useCallback((index: number) => jumpToStep(index), []);

  const [client, router, isp] = journey.hops;
  const current = steps[active];
  const deviceName = (id: string) => (t.device as Record<string, string>)[id] ?? id;

  return (
    <section
      ref={section}
      id="viaje"
      aria-labelledby="journey-heading"
      className="journey-animated on-sumi relative h-[640vh]"
    >
      <div className="sticky top-0 grid h-dvh grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div ref={stage} className="fold-stage relative min-h-0 overflow-hidden" data-stage="0">
          <div ref={intro} className="relative z-10 max-w-[34rem] px-4 pt-16 sm:px-8 lg:pt-24">
            <h2
              id="journey-heading"
              className="font-display text-[clamp(1.75rem,1.2rem+2vw,2.75rem)] leading-[1.1] font-light text-balance"
            >
              {t.title}
            </h2>
            <p className="sr-only max-w-[48ch] text-ink-muted text-pretty sm:not-sr-only sm:mt-4 sm:block">
              {fill(t.lead, { name: journey.target.name })}
            </p>
          </div>

          {/* Para lectores de pantalla, el viaje entero en orden; lo visual se oculta. */}
          <ol className="sr-only">
            {steps.map((step) => (
              <li key={step.id}>
                {step.name}. {step.text}
              </li>
            ))}
          </ol>

          {/* La red: un cable con sus cuatro equipos. */}
          <div aria-hidden className="fold-route">
            {[client?.device ?? 'PC1', router?.device ?? 'R1', isp?.device ?? 'ISP', 'target'].map(
              (device, i) => {
                const DeviceIcon = DEVICE_ICON[i] ?? Desktop;
                return (
                  <div
                    key={device}
                    className={`fold-station ${active >= (REACHED_AT[i] ?? 0) ? 'is-reached' : ''}`}
                    style={{ left: `var(--x${i})` }}
                  >
                    <span className="fold-station-mark">
                      <DeviceIcon weight="light" className="size-[62%]" />
                    </span>
                    <span className="fold-label mt-2.5 block whitespace-nowrap">
                      {device === 'target' ? journey.target.name : device}
                    </span>
                    <span className="mt-1 hidden text-xs whitespace-nowrap text-ink-faint sm:block">
                      {deviceName(device)}
                    </span>
                  </div>
                );
              },
            )}
            {router?.in && (
              <span className="fold-iface" style={{ left: 'calc(var(--x1) - 4.75rem)' }}>
                {router.in}
              </span>
            )}
            {router?.out && (
              <span className="fold-iface" style={{ left: 'calc(var(--x1) + 2rem)' }}>
                {router.out}
              </span>
            )}
          </div>

          {/* La hoja: cada etapa muestra la pila ya plegada y la solapa que se está plegando. */}
          <div aria-hidden className="fold-sheet">
            <div className="fold-piece fold-s0">
              <span className="fold-label">{t.layers.data}</span>
              <span className="mt-2 block font-display text-lg font-light">
                https://{journey.target.name}
              </span>
            </div>

            <div className="fold-piece fold-s1-base" />
            <div className="fold-flap fold-s1-flap">
              <span className="fold-face" />
              <span className="fold-face is-back is-flipped">
                <span className="fold-label">{t.layers.tcp}</span>
                <span className="mt-1 block text-sm tabular-nums">
                  :{client?.dstPort ?? journey.target.port}
                </span>
              </span>
            </div>

            <div className="fold-piece fold-s2-base is-back">
              <span className="fold-label">{t.layers.tcp}</span>
            </div>
            <div className="fold-flap fold-s2-flap">
              <span className="fold-face is-back" />
              <span className="fold-face is-flipped">
                <span className="fold-label">{t.layers.ip}</span>
              </span>
            </div>

            <div className="fold-piece fold-s3-base">
              <span className="fold-label">{t.layers.ip}</span>
            </div>
            <div className="fold-flap fold-s3-flap">
              <span className="fold-face" />
              <span className="fold-face is-back is-flipped">
                <span className="fold-label">{t.layers.ethernet}</span>
              </span>
            </div>
          </div>

          {/* La etiqueta del paquete: el remite cambia en el router. */}
          <div ref={slipRef} aria-hidden className="fold-slip">
            <span className="fold-label block">{t.layers.ip}</span>
            <span className="mt-1 block text-sm tabular-nums">
              <span className="fold-slip-old">{client?.src}</span>
              <span className="fold-slip-new">{router?.src}</span>
            </span>
            <span className="block text-xs tabular-nums opacity-70">→ {client?.dst}</span>
          </div>

          {/* El paso actual en palabras; la lista de arriba ya lo cuenta a los lectores de pantalla. */}
          <div
            aria-hidden
            className="absolute right-4 bottom-6 left-4 z-10 sm:left-8 lg:right-auto lg:max-w-[32rem]"
          >
            <p className="fold-label text-ink-muted">{String(active + 1).padStart(2, '0')} / 07</p>
            {current && (
              <p className="mt-1 text-md text-pretty">
                <span className="font-semibold">{current.name}.</span> {current.text}
              </p>
            )}
          </div>
        </div>

        <aside className="hidden items-center border-l border-rule px-6 lg:flex">
          <StepList steps={steps} active={active} onSelect={jump} />
        </aside>
      </div>
    </section>
  );
}

/** Sin animación: el mismo viaje como lista ordenada. El CSS decide cuándo se muestra. */
function StaticJourney({
  journey,
  steps,
}: {
  readonly journey: Journey;
  readonly steps: readonly JourneyStep[];
}) {
  const { messages } = useI18n();
  const t = messages.landing.journey;
  return (
    <section
      id="viaje-pasos"
      aria-labelledby="journey-static-heading"
      className="journey-static on-sumi"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
        <h2
          id="journey-static-heading"
          className="font-display text-[clamp(1.75rem,1.2rem+2vw,2.75rem)] leading-[1.1] font-light text-balance"
        >
          {t.title}
        </h2>
        <p className="mt-4 max-w-[52ch] text-ink-muted text-pretty">
          {fill(t.lead, { name: journey.target.name })}
        </p>
        <p className="sr-only">{t.reduced}</p>
        <ol className="mt-10 grid gap-x-10 border-t border-rule sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.id} className="border-b border-rule py-5">
              <span className="font-display text-sm text-ink-faint tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-1 text-pretty">
                <span className="font-semibold">{step.name}.</span> {step.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
