/**
 * Salida de `/ping` como la muestra RouterOS v7:
 *
 *   SEQ HOST                                     SIZE TTL TIME       STATUS
 *     0 8.8.8.8                                    56 117 14ms400us
 *     sent=1 received=1 packet-loss=0% min-rtt=14ms400us avg-rtt=14ms400us max-rtt=14ms400us
 */
import type { TraceResult } from '@nos/core';

export const PING_HEADER =
  '  SEQ HOST                                     SIZE TTL TIME       STATUS';

export function formatRtt(ms: number): string {
  const whole = Math.floor(ms);
  const micro = Math.round((ms - whole) * 1000);
  return micro === 0 ? `${whole}ms` : `${whole}ms${micro}us`;
}

/** Estado de un ping fallido según dónde y por qué se perdió. */
function failureStatus(result: TraceResult, origin: string): string {
  const end = result.forward.end;
  switch (end.kind) {
    case 'no-route':
      return end.device === origin ? 'no route to host' : 'net unreachable';
    case 'arp-failed':
      return 'host unreachable';
    case 'ttl-exceeded':
      return 'TTL exceeded';
    case 'filtered':
      return end.action === 'reject' ? 'admin prohibited' : 'timeout';
    default:
      return 'timeout';
  }
}

/** TTL con el que llega la respuesta: 64 en equipos simulados, ~118 desde "Internet". */
export function replyTtl(result: TraceResult): number {
  const emulated = result.forward.end.kind === 'delivered' && result.forward.end.emulated;
  const routers = Math.max(0, (result.reply?.hops.length ?? 1) - 1);
  return (emulated ? 118 : 64) - routers;
}

export function pingLine(
  seq: number,
  host: string,
  size: number,
  result: TraceResult,
  rtt: number | undefined,
  origin: string,
): string {
  const cells =
    result.ok && rtt !== undefined
      ? [
          String(size).padStart(4),
          String(replyTtl(result)).padStart(3),
          formatRtt(rtt).padEnd(10),
          '',
        ]
      : ['    ', '   ', '          ', failureStatus(result, origin)];
  return `${String(seq).padStart(5)} ${host.padEnd(40)} ${cells.join(' ')}`.trimEnd();
}

export function pingSummary(rtts: readonly (number | undefined)[]): string {
  const sent = rtts.length;
  const got = rtts.filter((r): r is number => r !== undefined);
  const loss = sent === 0 ? 0 : Math.round(((sent - got.length) / sent) * 100);
  let line = `    sent=${sent} received=${got.length} packet-loss=${loss}%`;
  if (got.length > 0) {
    const min = Math.min(...got);
    const max = Math.max(...got);
    const avg = got.reduce((a, b) => a + b, 0) / got.length;
    line += ` min-rtt=${formatRtt(min)} avg-rtt=${formatRtt(Math.round(avg * 10) / 10)} max-rtt=${formatRtt(max)}`;
  }
  return line;
}
