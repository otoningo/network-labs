/**
 * Expresiones de `print where ...` y `[find where ...]`:
 * comparaciones (= != < > <= >= ~ in), flags por nombre, !, and/&&, or/|| y paréntesis.
 * Dos condiciones seguidas sin operador se combinan con and, como en RouterOS.
 */
import {
  err,
  ok,
  parseIpv4,
  parsePrefix,
  prefixContains,
  prefixCovers,
  type Result,
} from '@nos/core';
import { type Fault, fault, type MenuDef, type Row } from './schema';

export type CmpOp = '=' | '!=' | '<' | '>' | '<=' | '>=' | '~' | 'in';

export type Expr =
  | { readonly kind: 'and' | 'or'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'not'; readonly of: Expr }
  | { readonly kind: 'word'; readonly name: string }
  | { readonly kind: 'cmp'; readonly prop: string; readonly op: CmpOp; readonly value: string };

interface Tok {
  readonly kind: 'word' | 'string' | 'op' | 'lparen' | 'rparen' | 'not' | 'and' | 'or';
  readonly text: string;
  readonly at: number;
}

const OPS = ['!=', '<=', '>=', '=', '<', '>', '~'];

function tokenize(text: string, offset: number): Result<Tok[], Fault> {
  const toks: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    const at = offset + i;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      toks.push({ kind: ch === '(' ? 'lparen' : 'rparen', text: ch, at });
      i += 1;
      continue;
    }
    if (text.startsWith('&&', i) || text.startsWith('||', i)) {
      toks.push({ kind: ch === '&' ? 'and' : 'or', text: text.slice(i, i + 2), at });
      i += 2;
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (op) {
      toks.push({ kind: 'op', text: op, at });
      i += op.length;
      continue;
    }
    if (ch === '!') {
      toks.push({ kind: 'not', text: ch, at });
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) j += 1;
        value += text[j];
        j += 1;
      }
      if (j >= text.length) return err(fault('syntax', at));
      toks.push({ kind: 'string', text: value, at });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s()=!<>~"&|]/.test(text[j] as string)) j += 1;
    const word = text.slice(i, j);
    const lower = word.toLowerCase();
    if (lower === 'and' || lower === 'or' || lower === 'not')
      toks.push({ kind: lower, text: word, at });
    else if (lower === 'in') toks.push({ kind: 'op', text: 'in', at });
    else toks.push({ kind: 'word', text: word, at });
    i = j;
  }
  return ok(toks);
}

export function parseExpr(text: string, offset = 0): Result<Expr | null, Fault> {
  const lexed = tokenize(text, offset);
  if (!lexed.ok) return lexed;
  const toks = lexed.value;
  if (toks.length === 0) return ok(null);
  let pos = 0;
  const peek = () => toks[pos];
  const end = offset + text.length;

  function parseOr(): Result<Expr, Fault> {
    let left = parseAnd();
    while (left.ok && peek()?.kind === 'or') {
      pos += 1;
      const right = parseAnd();
      if (!right.ok) return right;
      left = ok({ kind: 'or', left: left.value, right: right.value });
    }
    return left;
  }

  function parseAnd(): Result<Expr, Fault> {
    let left = parseUnary();
    while (left.ok) {
      const next = peek();
      if (!next || next.kind === 'or' || next.kind === 'rparen') break;
      if (next.kind === 'and') pos += 1;
      const right = parseUnary();
      if (!right.ok) return right;
      left = ok({ kind: 'and', left: left.value, right: right.value });
    }
    return left;
  }

  function parseUnary(): Result<Expr, Fault> {
    const t = peek();
    if (t?.kind === 'not') {
      pos += 1;
      const inner = parseUnary();
      return inner.ok ? ok({ kind: 'not', of: inner.value }) : inner;
    }
    return parsePrimary();
  }

  function parsePrimary(): Result<Expr, Fault> {
    const t = peek();
    if (!t) return err(fault('syntax', end));
    if (t.kind === 'lparen') {
      pos += 1;
      const inner = parseOr();
      if (!inner.ok) return inner;
      if (peek()?.kind !== 'rparen') return err(fault('syntax', peek()?.at ?? end));
      pos += 1;
      return inner;
    }
    if (t.kind !== 'word') return err(fault('syntax', t.at));
    pos += 1;
    const op = peek();
    if (op?.kind !== 'op') return ok({ kind: 'word', name: t.text });
    pos += 1;
    const value = peek();
    if (!value || (value.kind !== 'word' && value.kind !== 'string')) {
      return err(fault('syntax', value?.at ?? end));
    }
    pos += 1;
    return ok({ kind: 'cmp', prop: t.text, op: op.text as CmpOp, value: value.text });
  }

  const result = parseOr();
  if (!result.ok) return result;
  const rest = peek();
  if (rest) return err(fault('syntax', rest.at));
  return ok(result.value);
}

function flagLetter(menu: MenuDef, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const slot of menu.flags) {
    for (const f of slot) if (f.name.toLowerCase() === lower) return f.letter;
  }
  return undefined;
}

function compare(actual: string, op: CmpOp, expected: string): boolean {
  switch (op) {
    case '=':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '~':
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    case 'in': {
      const outer = parsePrefix(expected);
      if (!outer) return false;
      const ip = parseIpv4(actual);
      if (ip !== null) return prefixContains(outer, ip);
      const inner = parsePrefix(actual);
      return inner !== null && prefixCovers(outer, inner);
    }
    default: {
      const a = Number(actual);
      const b = Number(expected);
      const numeric = actual !== '' && expected !== '' && !Number.isNaN(a) && !Number.isNaN(b);
      const [x, y] = numeric ? [a, b] : [actual, expected];
      if (op === '<') return x < y;
      if (op === '>') return x > y;
      if (op === '<=') return x <= y;
      return x >= y;
    }
  }
}

export function evalExpr(expr: Expr, row: Row, menu: MenuDef): boolean {
  switch (expr.kind) {
    case 'and':
      return evalExpr(expr.left, row, menu) && evalExpr(expr.right, row, menu);
    case 'or':
      return evalExpr(expr.left, row, menu) || evalExpr(expr.right, row, menu);
    case 'not':
      return !evalExpr(expr.of, row, menu);
    case 'word': {
      const letter = flagLetter(menu, expr.name);
      if (letter !== undefined) return row.flags.includes(letter);
      return row.props.get(expr.name) === 'yes';
    }
    case 'cmp': {
      const actual =
        expr.prop === 'comment' ? (row.comment ?? '') : (row.props.get(expr.prop) ?? '');
      return compare(actual, expr.op, expr.value);
    }
  }
}
