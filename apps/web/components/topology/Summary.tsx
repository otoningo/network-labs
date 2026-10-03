'use client';

import type { Network, PortRef } from '@nos/core';
import { useEffect, useRef, useState } from 'react';
import { fill } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/context';
import type { SceneWire } from '@/lib/lab/scene';
import type { Role } from '@/lib/lab/topology';
import { liveIdentity, type Wire } from '@/lib/lab/wiring';

export interface SummaryDevice {
  readonly id: string;
  readonly role: Role;
  readonly label: string | null;
  readonly active: boolean;
}

function portText(name: string | null, addresses: readonly string[]): string {
  const base = name ?? '?';
  return addresses.length > 0 ? `${base} (${addresses.join(', ')})` : base;
}

/**
 * Alternativa textual de la figura, oculta a la vista: cada equipo con sus
 * enlaces, direcciones y estado. Además anuncia, con cortesía, los enlaces que
 * se caen o se levantan tras un comando.
 */
export function Summary({
  devices,
  wires,
  net,
}: {
  readonly devices: readonly SummaryDevice[];
  readonly wires: readonly SceneWire[];
  readonly net: Network;
}) {
  const { messages } = useI18n();
  const t = messages.topology;

  const nameOf = (ref: PortRef, sw: SceneWire): string => {
    const { a } = sw.wire;
    const isA = ref.device === a.device && ref.iface === a.iface;
    return `${ref.device} ${(isA ? sw.names[0] : sw.names[1]) ?? ''}`.trim();
  };

  const stateText = (wire: Wire, sw: SceneWire): string => {
    if (wire.up || !wire.reason) return t.wireState.up;
    const { kind, port } = wire.reason;
    const portName = port ? nameOf(port, sw) : '';
    return `${t.wireState.down}, ${fill(t.downReason[kind], { port: portName })}`;
  };

  // Anuncio de los enlaces que cambian de estado (no en la primera pintura).
  const previous = useRef<Map<string, boolean> | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const now = new Map(wires.map((w) => [w.wire.id, w.wire.up]));
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const changed = wires.filter((w) => {
      const was = before.get(w.wire.id);
      return was !== undefined && was !== w.wire.up;
    });
    if (changed.length === 0) return;
    setAnnouncement(
      changed
        .map((w) =>
          fill(t.announce, {
            a: nameOf(w.wire.a, w),
            b: nameOf(w.wire.b, w),
            state: stateText(w.wire, w),
          }),
        )
        .join('. '),
    );
  });

  return (
    <div className="sr-only">
      <p id="topology-summary">{t.summary}</p>
      <ul aria-labelledby="topology-summary">
        {devices.map((device) => {
          const live = net.devices.find((d) => d.id === device.id);
          const identity = liveIdentity(live, device.id);
          const own = wires.filter(
            (w) => w.wire.a.device === device.id || w.wire.b.device === device.id,
          );
          const head = [
            fill(t.deviceLine, { device: device.id, role: t.roles[device.role] }),
            device.label,
            identity ? fill(t.identity, { identity }) : null,
            device.active ? t.activeConsole : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <li key={device.id}>
              {head}.
              {own.length === 0 ? (
                <p>{t.noLinks}</p>
              ) : (
                <ul aria-label={`${t.links} ${device.id}`}>
                  {own.map((sw) => {
                    const mine = sw.wire.a.device === device.id ? 0 : 1;
                    const peer = mine === 0 ? sw.wire.b : sw.wire.a;
                    const peerIndex = mine === 0 ? 1 : 0;
                    return (
                      <li key={sw.wire.id}>
                        {fill(t.linkLine, {
                          port: portText(sw.names[mine], sw.addresses[mine]),
                          peer: peer.device,
                          peerPort: portText(sw.names[peerIndex], sw.addresses[peerIndex]),
                          kind: t.wireKind[sw.wire.kind],
                          state: stateText(sw.wire, sw),
                        })}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite">{announcement}</p>
    </div>
  );
}
