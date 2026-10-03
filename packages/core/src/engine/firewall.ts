/**
 * Evaluación de reglas de filtrado y NAT. Semántica estándar de cadenas:
 * la primera regla que coincide decide; `passthrough` sigue; `jump` entra a una
 * cadena propia y `return` vuelve. Al final de una cadena incorporada se acepta.
 */
import type { ItemId } from '../model/brand';
import type {
  ConnNatState,
  ConnState,
  DeviceConfig,
  IpProtocol,
  Match,
  NatChain,
  NatRule,
  Neg,
} from '../model/config';
import { addressMatches, type Ipv4 } from '../net/ipv4';
import { portSetContains } from '../net/ports';
import { inInterfaceList } from './lists';

export interface PacketHeader {
  readonly src: Ipv4;
  readonly dst: Ipv4;
  readonly protocol: IpProtocol;
  readonly srcPort?: number;
  readonly dstPort?: number;
}

export interface MatchContext {
  readonly packet: PacketHeader;
  readonly inIface?: ItemId;
  readonly outIface?: ItemId;
  readonly state: ConnState;
  /** Traducciones que ya tiene la conexión en este equipo (vacío si ninguna). */
  readonly natState?: readonly ConnNatState[];
}

export type Verdict = 'accept' | 'drop' | 'reject';

export interface ChainVerdict {
  readonly chain: string;
  readonly verdict: Verdict;
  /** Regla que decidió; ausente si se llegó al final de la cadena. */
  readonly rule?: ItemId;
  /** Todas las reglas que coincidieron en el recorrido (para contadores). */
  readonly matched: readonly ItemId[];
  /** Reglas con log activado que coincidieron. */
  readonly logged: readonly ItemId[];
}

const PROTOCOL_NUMBERS: Readonly<Record<IpProtocol, number>> = { icmp: 1, tcp: 6, udp: 17 };
const MAX_JUMP_DEPTH = 16;

function holds<T>(cond: Neg<T> | undefined, test: (value: T) => boolean): boolean {
  if (!cond) return true;
  const result = test(cond.value);
  return cond.negate ? !result : result;
}

function inAddressList(config: DeviceConfig, list: string, ip: Ipv4): boolean {
  return config.firewall.addressLists.some(
    (e) => !e.disabled && e.list === list && addressMatches(e.address, ip),
  );
}

export function ruleMatches(config: DeviceConfig, match: Match, ctx: MatchContext): boolean {
  const p = ctx.packet;
  const port = (value: number | undefined) => (set: Parameters<typeof portSetContains>[0]) =>
    value !== undefined && portSetContains(set, value);
  const iface = (value: ItemId | undefined) => (id: ItemId) => value === id;
  const list = (value: ItemId | undefined) => (name: string) =>
    value !== undefined && inInterfaceList(config, name, value);
  return (
    holds(match.srcAddress, (a) => addressMatches(a, p.src)) &&
    holds(match.dstAddress, (a) => addressMatches(a, p.dst)) &&
    holds(match.srcAddressList, (l) => inAddressList(config, l, p.src)) &&
    holds(match.dstAddressList, (l) => inAddressList(config, l, p.dst)) &&
    holds(match.protocol, (proto) =>
      typeof proto === 'number' ? PROTOCOL_NUMBERS[p.protocol] === proto : p.protocol === proto,
    ) &&
    holds(match.srcPort, port(p.srcPort)) &&
    holds(match.dstPort, port(p.dstPort)) &&
    holds(match.inInterface, iface(ctx.inIface)) &&
    holds(match.outInterface, iface(ctx.outIface)) &&
    holds(match.inInterfaceList, list(ctx.inIface)) &&
    holds(match.outInterfaceList, list(ctx.outIface)) &&
    (match.connectionState === undefined || match.connectionState.includes(ctx.state)) &&
    holds(match.connectionNatState, (states) =>
      states.some((state) => ctx.natState?.includes(state) ?? false),
    )
  );
}

interface Accumulator {
  rule?: ItemId;
  readonly matched: ItemId[];
  readonly logged: ItemId[];
}

type Outcome = Verdict | 'return' | null;

function evalChain(
  config: DeviceConfig,
  chain: string,
  ctx: MatchContext,
  depth: number,
  acc: Accumulator,
): Outcome {
  for (const rule of config.firewall.filter) {
    if (rule.disabled || rule.chain !== chain || !ruleMatches(config, rule.match, ctx)) continue;
    acc.matched.push(rule.id);
    if (rule.log) acc.logged.push(rule.id);
    switch (rule.action.kind) {
      case 'accept':
      case 'fasttrack':
        acc.rule = rule.id;
        return 'accept';
      case 'drop':
        acc.rule = rule.id;
        return 'drop';
      case 'reject':
        acc.rule = rule.id;
        return 'reject';
      case 'passthrough':
        continue;
      case 'return':
        return 'return';
      case 'jump': {
        if (depth >= MAX_JUMP_DEPTH) continue;
        const inner = evalChain(config, rule.action.target, ctx, depth + 1, acc);
        if (inner === 'accept' || inner === 'drop' || inner === 'reject') return inner;
        continue;
      }
    }
  }
  return null;
}

export function runFilter(
  config: DeviceConfig,
  chain: 'input' | 'forward' | 'output',
  ctx: MatchContext,
): ChainVerdict {
  const acc: Accumulator = { matched: [], logged: [] };
  const outcome = evalChain(config, chain, ctx, 0, acc);
  const verdict: Verdict = outcome === 'drop' || outcome === 'reject' ? outcome : 'accept';
  return {
    chain,
    verdict,
    ...(acc.rule === undefined ? {} : { rule: acc.rule }),
    matched: acc.matched,
    logged: acc.logged,
  };
}

/** Primera regla NAT que coincide en la cadena; `accept` también detiene la búsqueda. */
export function firstNatRule(
  config: DeviceConfig,
  chain: NatChain,
  ctx: MatchContext,
): NatRule | undefined {
  return config.firewall.nat.find(
    (r) => !r.disabled && r.chain === chain && ruleMatches(config, r.match, ctx),
  );
}
