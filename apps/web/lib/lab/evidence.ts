/**
 * Lo que la red reporta sobre un objetivo, redactado en el idioma activo.
 * Se muestra bajo una tarea cumplida (o que dejó de cumplirse) como la línea
 * de verificación de una guía de prácticas.
 */
import { type Evidence, evidence, type FlowOutcome, type WhereFact } from '@nos/core';
import { fill, type Messages } from '../i18n';
import type { LabState } from './store';

export function evidenceOf(state: LabState, objectiveId: string): Evidence[] {
  const objective = state.runtime.objectives.find((o) => o.id === objectiveId);
  if (!objective) return [];
  return evidence(objective.check, { net: state.net, startup: state.runtime.startup });
}

type EvidenceMessages = Messages['lab']['evidence'];

function protocol(t: EvidenceMessages, e: Extract<Evidence, { kind: 'flow' }>): string {
  if (e.protocol === 'icmp') return t.ping;
  return e.port === null ? e.protocol : `${e.protocol}/${e.port}`;
}

const REASON: Record<Exclude<FlowOutcome, 'ok'>, keyof EvidenceMessages['reasons']> = {
  filtered: 'filtered',
  'no-route': 'noRoute',
  blackhole: 'noRoute',
  'arp-failed': 'arpFailed',
  'ttl-exceeded': 'noRoute',
  'port-closed': 'portClosed',
  'not-forwarding': 'notForwarding',
  'no-source': 'noSource',
  loop: 'noRoute',
  'no-reply': 'noReply',
  'no-target': 'noTarget',
};

/** Una condición de búsqueda con el campo traducido: "grupo read", "con contraseña". */
function describeFact(t: EvidenceMessages, w: WhereFact): string {
  const field = (t.fields as Record<string, string>)[w.field] ?? w.field;
  if (w.op === 'is' && w.value === 'true') return fill(t.where.exists, { field });
  if (w.op === 'is' && w.value === 'false') return fill(t.where.absent, { field });
  return fill(t.where[w.op], { field, value: w.value });
}

/** Una frase por evidencia: corta, con los datos tal como los muestra el equipo. */
export function describeEvidence(e: Evidence, messages: Messages): string {
  const t = messages.lab.evidence;
  switch (e.kind) {
    case 'address':
      return e.addresses.length > 0
        ? fill(t.address, { device: e.device, iface: e.iface, addresses: e.addresses.join(', ') })
        : fill(t.noAddress, { device: e.device, iface: e.iface });
    case 'route':
      return e.via === null
        ? fill(t.noRoute, { device: e.device, dst: e.dst })
        : fill(t.route, { device: e.device, dst: e.dst, via: e.via });
    case 'flow': {
      const vars = { proto: protocol(t, e), from: e.from, to: e.to };
      if (e.outcome === 'ok') {
        return e.seenAs === null
          ? fill(t.flowOk, vars)
          : fill(t.flowOkAs, { ...vars, seenAs: e.seenAs });
      }
      const reason = t.reasons[REASON[e.outcome]];
      return e.at === null
        ? fill(t.flowFail, { ...vars, reason })
        : fill(t.flowFailAt, { ...vars, reason, at: e.at });
    }
    case 'lease':
      return e.ip === null
        ? fill(t.noLease, { server: e.server, client: e.client })
        : fill(t.lease, { server: e.server, client: e.client, ip: e.ip });
    case 'wifi':
      return e.ssid === null
        ? fill(t.noWifi, { client: e.client, ap: e.ap })
        : fill(t.wifi, { client: e.client, ap: e.ap, ssid: e.ssid });
    case 'resolve':
      return e.address === null
        ? fill(t.noResolve, { from: e.from, name: e.name })
        : fill(t.resolve, { from: e.from, name: e.name, address: e.address });
    case 'file':
      return e.files.length > 0
        ? fill(t.files, { device: e.device, files: e.files.join(', ') })
        : fill(t.noFiles, { device: e.device });
    case 'config': {
      const snapshot = e.snapshot ?? t.startup;
      return fill(e.matches ? t.configSame : t.configDiffers, { device: e.device, snapshot });
    }
    case 'count': {
      const coll = (t.collections as Record<string, string>)[e.coll] ?? e.coll;
      const facts = e.where.map((w) => describeFact(t, w));
      const where = facts.length > 0 ? ` (${facts.join(', ')})` : '';
      return fill(t.count, { device: e.device, coll, where, count: e.count });
    }
    case 'setting':
      return fill(t.setting, { device: e.device, field: e.field, value: e.value || '""' });
    case 'interface':
      return fill(e.running ? t.ifaceUp : t.ifaceDown, { device: e.device, iface: e.iface });
    case 'neighbor':
      return fill(e.seen ? t.neighbor : t.noNeighbor, { device: e.device, peer: e.peer });
  }
}
