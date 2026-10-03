'use client';

import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useI18n } from '@/lib/i18n/context';
import { useLab } from '@/lib/lab/context';
import { useMediaQuery } from '@/lib/ui/useMediaQuery';
import { Console } from '../terminal/Console';
import { Topology as Figure } from '../topology/Topology';
import { Worksheet } from './Worksheet';

/**
 * Las tres zonas: hoja de tareas a la izquierda, figura arriba a la derecha y
 * consola abajo a la derecha. Por debajo de 1024px pasan a pestañas.
 */
export function Workbench() {
  const wide = useMediaQuery('(min-width: 1024px)');
  if (wide === null) return <div aria-hidden className="bg-ground" />;
  return wide ? <Panels /> : <Tabs />;
}

function Handle({ label, orientation }: { label: string; orientation: 'vertical' | 'horizontal' }) {
  // El separador es la línea de 1px; la zona sensible es más ancha que la línea.
  const line =
    orientation === 'vertical'
      ? 'w-px bg-rule data-[separator=hover]:bg-rule-strong data-[separator=active]:bg-ink-faint'
      : 'h-px bg-rule data-[separator=hover]:bg-rule-strong data-[separator=active]:bg-ink-faint';
  return (
    <Separator
      aria-label={label}
      className={`${line} transition-colors focus-visible:bg-ink focus-visible:outline-none`}
    />
  );
}

function Panels() {
  const { messages } = useI18n();
  return (
    <Group orientation="horizontal" className="min-h-0">
      <Panel id="tasks" defaultSize="400px" minSize="300px" maxSize="55%">
        <section aria-labelledby="lab-tasks-heading" className="h-full overflow-y-auto bg-ground">
          <Worksheet />
        </section>
      </Panel>
      <Handle label={messages.lab.resizeTasks} orientation="vertical" />
      <Panel id="work" minSize="40%">
        <Group orientation="vertical">
          <Panel id="figure" defaultSize="38%" minSize="120px" collapsible collapsedSize="0px">
            <section aria-label={messages.lab.views.figure} className="h-full bg-ground">
              <Figure />
            </section>
          </Panel>
          <Handle label={messages.lab.resizeFigure} orientation="horizontal" />
          <Panel id="console" minSize="160px">
            <Console />
          </Panel>
        </Group>
      </Panel>
    </Group>
  );
}

type View = 'tasks' | 'figure' | 'console';
const VIEWS: readonly View[] = ['tasks', 'figure', 'console'];

function Tabs() {
  const { messages } = useI18n();
  const t = messages.lab;
  const [view, setView] = useState<View>('tasks');
  const tabs = useRef(new Map<View, HTMLButtonElement>());
  const objectives = useLab((s) => s.objectives);
  const states = Object.values(objectives);
  const done = states.filter((s) => s === 'done').length;

  const select = (next: View) => {
    setView(next);
    tabs.current.get(next)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = VIEWS.indexOf(view);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      select(VIEWS[(index + step + VIEWS.length) % VIEWS.length] ?? 'tasks');
    } else if (event.key === 'Home') {
      event.preventDefault();
      select('tasks');
    } else if (event.key === 'End') {
      event.preventDefault();
      select('console');
    }
  };

  const panel = (id: View, children: ReactNode, className: string) => (
    <div
      role="tabpanel"
      id={`lab-view-${id}`}
      aria-labelledby={`lab-tab-${id}`}
      hidden={view !== id}
      className={`min-h-0 ${className}`}
    >
      {children}
    </div>
  );

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div role="tablist" aria-label={t.viewsLabel} className="flex border-b border-rule px-2">
        {VIEWS.map((id) => (
          <button
            key={id}
            ref={(el) => {
              if (el) tabs.current.set(id, el);
            }}
            type="button"
            role="tab"
            id={`lab-tab-${id}`}
            aria-selected={view === id}
            aria-controls={`lab-view-${id}`}
            tabIndex={view === id ? 0 : -1}
            onClick={() => setView(id)}
            onKeyDown={onKeyDown}
            className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm ${
              view === id
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.views[id]}
            {id === 'tasks' && (
              <span className="text-ink-faint">
                {done}/{states.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {panel(
        'tasks',
        <section aria-labelledby="lab-tasks-heading">
          <Worksheet />
        </section>,
        'overflow-y-auto',
      )}
      {panel('figure', <Figure />, 'h-full')}
      {/* La consola sigue montada aunque su pestaña no esté visible: conserva el historial. */}
      <div
        role="tabpanel"
        id="lab-view-console"
        aria-labelledby="lab-tab-console"
        className={`min-h-0 ${view === 'console' ? 'h-full' : 'invisible absolute h-0 overflow-hidden'}`}
        aria-hidden={view !== 'console'}
      >
        <Console />
      </div>
    </div>
  );
}
