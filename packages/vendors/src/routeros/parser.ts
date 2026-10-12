/**
 * Parser de la consola de RouterOS: convierte una línea en una intención.
 * Resuelve la ruta de menús (absoluta, relativa, `..` y la forma v7 con `/`),
 * abreviaturas únicas, argumentos `nombre=valor`, números del último print,
 * nombres e ids internos, y subexpresiones `[find ...]`.
 */
import { type CollectionKey, err, type ItemId, type Op, ok, type Result } from '@nos/core';
import { matchPrefix, normalize } from './codec';
import { evalExpr, parseExpr } from './expr';
import type { ArgList, PrintMode, RosIntent } from './intent';
import { type LexedCommand, lexLine, type Token } from './lexer';
import { parseInternalId } from './refs';
import type { ActionDef, Fault, MenuCtx, MenuDef, PropDef, Row } from './schema';
import { fault } from './schema';
import type { RouterosSession } from './session';
import { GLOBAL_COMMANDS, menuAt, namesAt, pathKey } from './tree';

export interface ParseCtx {
  readonly menuCtx: MenuCtx;
  readonly session: RouterosSession;
}

interface Cmd {
  readonly line: string;
  readonly tokens: readonly Token[];
  /** Fin del comando dentro de la línea (para leer el texto de `where`). */
  readonly end: number;
}

// ── Argumentos ──────────────────────────────────────────────────────────────

interface Named {
  readonly value: string;
  readonly at: number;
  readonly token: Token;
}

interface Args {
  readonly named: Map<string, Named>;
  readonly positional: Token[];
}

/** Separa argumentos con nombre (resolviendo abreviaturas) de los posicionales. */
function splitArgs(tokens: readonly Token[], allowed: readonly PropDef[]): Result<Args, Fault> {
  const names = allowed.map((p) => p.name);
  const named = new Map<string, Named>();
  const positional: Token[] = [];
  for (const token of tokens) {
    if (token.eq < 0) {
      const flag = allowed.find(
        (p) =>
          p.type.kind === 'flag' &&
          (p.name === token.text || matchPrefix(token.text, [p.name]).match),
      );
      if (flag && token.text !== '') {
        named.set(flag.name, { value: 'yes', at: token.start, token });
      } else {
        positional.push(token);
      }
      continue;
    }
    const key = token.text.slice(0, token.eq);
    const { match, ambiguous } = matchPrefix(key, names);
    if (ambiguous) return err(fault('ambiguous', token.start, { name: key, what: 'argument' }));
    if (match === undefined) return err(fault('expected-end', token.start));
    named.set(match, {
      value: token.text.slice(token.eq + 1),
      at: token.start + token.eq + 1,
      token,
    });
  }
  return ok({ named, positional });
}

/** Normaliza los valores con nombre al formato canónico de cada propiedad. */
function normalizeNamed(
  args: Args,
  allowed: readonly PropDef[],
  ctx: MenuCtx,
): Result<Map<string, string>, Fault> {
  const out = new Map<string, string>();
  for (const [name, arg] of args.named) {
    const def = allowed.find((p) => p.name === name);
    if (!def) continue;
    const value = normalize(def.type, arg.value, name, arg.at, ctx);
    if (!value.ok) return value;
    out.set(name, value.value);
  }
  return ok(out);
}

// ── Filas: números, nombres, ids y [find] ───────────────────────────────────

function numberedKeys(menu: MenuDef, ctx: ParseCtx, rows: readonly Row[]): readonly string[] {
  return ctx.session.numbering[menu.path] ?? rows.filter((r) => r.numbered).map((r) => r.key);
}

/** Evalúa `[find ...]`: `find`, `find where <expr>` o `find prop=valor ...`. */
function findRows(
  inner: string,
  at: number,
  menu: MenuDef,
  rows: readonly Row[],
): Result<Row[], Fault> {
  const lexed = lexLine(inner);
  if (!lexed.ok) return err(fault('syntax', at));
  const tokens = lexed.value[0]?.tokens ?? [];
  let i = 0;
  while (i < tokens.length && tokens[i]?.text !== 'find') i += 1;
  if (i >= tokens.length) return err(fault('syntax', at));
  i += 1;
  const whereTok = tokens[i];
  if (whereTok?.text === 'where') {
    const expr = parseExpr(inner.slice(whereTok.end), at + whereTok.end + 1);
    if (!expr.ok) return expr;
    const e = expr.value;
    return ok(e === null ? [...rows] : rows.filter((r) => evalExpr(e, r, menu)));
  }
  const filters = tokens.slice(i);
  return ok(
    rows.filter((row) =>
      filters.every((t) => {
        if (t.eq < 0) return evalExpr({ kind: 'word', name: t.text }, row, menu);
        const key = t.text.slice(0, t.eq);
        const value = t.text.slice(t.eq + 1);
        const actual = key === 'comment' ? (row.comment ?? '') : row.props.get(key);
        return actual === value;
      }),
    ),
  );
}

export function resolveRows(token: Token, menu: MenuDef, ctx: ParseCtx): Result<Row[], Fault> {
  const rows = menu.rows(ctx.menuCtx);
  if (token.sub !== undefined && token.text.startsWith('['))
    return findRows(token.sub, token.start + 1, menu, rows);
  const keys = numberedKeys(menu, ctx, rows);
  const result: Row[] = [];
  for (const part of token.text.split(',')) {
    let row: Row | undefined;
    if (/^\d+$/.test(part)) {
      const key = keys[Number(part)];
      row = rows.find((r) => r.key === key);
    } else {
      const id = parseInternalId(part);
      if (id !== undefined) row = rows.find((r) => r.id === id);
      else if (menu.nameProp) row = rows.find((r) => r.props.get(menu.nameProp ?? '') === part);
    }
    if (!row) return err(fault('no-such-item'));
    result.push(row);
  }
  return ok(result);
}

// ── Comandos genéricos ──────────────────────────────────────────────────────

const writable = (menu: MenuDef, includeAddOnly: boolean): PropDef[] =>
  menu.props.filter((p) => p.writable && (includeAddOnly || !p.addOnly));

const config = (ops: readonly Op[]): RosIntent => ({ kind: 'config', ops });

function concat(results: readonly Result<readonly Op[], Fault>[]): Result<Op[], Fault> {
  const ops: Op[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    ops.push(...r.value);
  }
  return ok(ops);
}

function editable(row: Row): Fault | null {
  if (row.id !== undefined) return null;
  return fault('not-allowed', undefined, {
    reason: row.flags.includes('*') ? 'builtin' : 'dynamic',
  });
}

function parsePrint(cmd: Cmd, rest: readonly Token[], menu: MenuDef): Result<RosIntent, Fault> {
  let mode: PrintMode = 'table';
  for (const [index, token] of rest.entries()) {
    const word =
      token.eq < 0
        ? matchPrefix(token.text, [
            'detail',
            'terse',
            'count-only',
            'stats',
            'where',
            'without-paging',
            'brief',
          ]).match
        : undefined;
    if (word === 'where') {
      const expr = parseExpr(cmd.line.slice(token.end, cmd.end), token.end);
      if (!expr.ok) return expr;
      return ok({
        kind: 'show',
        view: { kind: 'print', path: menu.path, mode, where: expr.value },
      });
    }
    if (word === 'detail') mode = 'detail';
    else if (word === 'terse') mode = 'terse';
    else if (word === 'count-only') mode = 'count';
    else if (word === 'stats' && menu.statsColumns) mode = 'stats';
    else if (word !== 'without-paging' && word !== 'brief') {
      return err(fault('expected-end', rest[index]?.start ?? token.start));
    }
  }
  return ok({ kind: 'show', view: { kind: 'print', path: menu.path, mode, where: null } });
}

function parseAdd(rest: readonly Token[], menu: MenuDef, ctx: ParseCtx): Result<RosIntent, Fault> {
  const add = menu.add;
  if (!add) return err(fault('bad-command', undefined, { name: 'add' }));
  const allowed = writable(menu, true);
  const split = splitArgs(rest, allowed);
  if (!split.ok) return split;
  const extra = split.value.positional[0];
  if (extra) return err(fault('expected-end', extra.start));
  const values = normalizeNamed(split.value, allowed, ctx.menuCtx);
  if (!values.ok) return values;
  const props = new Map(values.value);

  const before = split.value.named.get('place-before');
  props.delete('place-before');
  if (before) {
    const rows = resolveRows(
      before.token.sub !== undefined ? before.token : { ...before.token, text: before.value },
      menu,
      ctx,
    );
    if (!rows.ok) return rows;
    const target = rows.value[0];
    if (target?.id !== undefined) props.set('__before', String(target.id));
  }
  for (const p of allowed) {
    if (!props.has(p.name) && p.default !== undefined && !p.addOnly) props.set(p.name, p.default);
  }
  if (menu.autoName && !props.get('name')) props.set('name', menu.autoName(ctx.menuCtx));
  const missing = allowed.filter((p) => p.required && !props.get(p.name)).map((p) => p.name);
  if (missing.length > 0) return err(fault('missing-args', undefined, { args: missing.join(',') }));

  const ops = add(props, ctx.menuCtx);
  return ops.ok ? ok(config(ops.value)) : ops;
}

type Edit = (row: Row, props: Map<string, string>) => Fault | null;

/** set/enable/disable/comment/unset: aplica un cambio a las propiedades completas de cada fila. */
function editRows(
  numbers: Token | undefined,
  menu: MenuDef,
  ctx: ParseCtx,
  edit: Edit,
): Result<RosIntent, Fault> {
  const update = menu.update;
  if (!update) return err(fault('bad-command', undefined, { name: 'set' }));
  if (menu.style === 'singleton') {
    const row = menu.rows(ctx.menuCtx)[0];
    if (!row) return err(fault('no-such-item'));
    const props = new Map(row.props);
    const problem = edit(row, props);
    if (problem) return err(problem);
    const ops = update(row, props, ctx.menuCtx);
    return ops.ok ? ok(config(ops.value)) : ops;
  }
  if (!numbers) return err(fault('missing-args', undefined, { args: 'numbers' }));
  const rows = resolveRows(numbers, menu, ctx);
  if (!rows.ok) return rows;
  const results: Result<readonly Op[], Fault>[] = [];
  for (const row of rows.value) {
    const blocked = editable(row);
    if (blocked) return err(blocked);
    const props = new Map(row.props);
    if (row.comment !== undefined) props.set('comment', row.comment);
    const problem = edit(row, props);
    if (problem) return err(problem);
    results.push(update(row, props, ctx.menuCtx));
  }
  const ops = concat(results);
  return ops.ok ? ok(config(ops.value)) : ops;
}

function parseSet(rest: readonly Token[], menu: MenuDef, ctx: ParseCtx): Result<RosIntent, Fault> {
  const allowed = writable(menu, false);
  const split = splitArgs(rest, [
    ...allowed,
    { name: 'numbers', type: { kind: 'string' }, writable: true },
  ]);
  if (!split.ok) return split;
  const numbersArg = split.value.named.get('numbers');
  split.value.named.delete('numbers');
  const positional = split.value.positional;
  const numbers = numbersArg ? { ...numbersArg.token, text: numbersArg.value } : positional[0];
  const extra = numbersArg ? positional[0] : positional[1];
  if (extra) return err(fault('expected-end', extra.start));
  const values = normalizeNamed(split.value, allowed, ctx.menuCtx);
  if (!values.ok) return values;
  return editRows(numbers, menu, ctx, (_row, props) => {
    for (const [k, v] of values.value) props.set(k, v);
    return null;
  });
}

function parseToggle(
  rest: readonly Token[],
  menu: MenuDef,
  ctx: ParseCtx,
  disabled: boolean,
): Result<RosIntent, Fault> {
  const [numbers, extra] = rest;
  if (extra) return err(fault('expected-end', extra.start));
  return editRows(numbers, menu, ctx, (_row, props) => {
    props.set('disabled', disabled ? 'yes' : 'no');
    return null;
  });
}

function parseComment(
  rest: readonly Token[],
  menu: MenuDef,
  ctx: ParseCtx,
): Result<RosIntent, Fault> {
  const split = splitArgs(rest, [{ name: 'comment', type: { kind: 'string' }, writable: true }]);
  if (!split.ok) return split;
  const [numbers, text] = split.value.positional;
  const comment = split.value.named.get('comment')?.value ?? text?.text ?? '';
  return editRows(numbers, menu, ctx, (_row, props) => {
    props.set('comment', comment);
    return null;
  });
}

function parseUnset(
  rest: readonly Token[],
  menu: MenuDef,
  ctx: ParseCtx,
): Result<RosIntent, Fault> {
  const split = splitArgs(rest, [{ name: 'value-name', type: { kind: 'string' }, writable: true }]);
  if (!split.ok) return split;
  const [numbers, nameTok] = split.value.positional;
  const name = split.value.named.get('value-name')?.value ?? nameTok?.text;
  const def = menu.props.find((p) => p.writable && !p.addOnly && p.name === name);
  if (!def) return err(fault('invalid-value', nameTok?.start, { arg: 'value-name' }));
  return editRows(numbers, menu, ctx, (_row, props) => {
    if (def.default === undefined) props.delete(def.name);
    else props.set(def.name, def.default);
    return null;
  });
}

function parseRemove(
  rest: readonly Token[],
  menu: MenuDef,
  ctx: ParseCtx,
): Result<RosIntent, Fault> {
  const [numbers, extra] = rest;
  if (extra) return err(fault('expected-end', extra.start));
  if (!numbers) return err(fault('missing-args', undefined, { args: 'numbers' }));
  const rows = resolveRows(numbers, menu, ctx);
  if (!rows.ok) return rows;
  if (menu.removeOther) {
    return ok({
      kind: 'vendor',
      action: { kind: 'remove-other', path: menu.path, rowKeys: rows.value.map((r) => r.key) },
    });
  }
  const remove = menu.remove;
  if (!remove) return err(fault('bad-command', undefined, { name: 'remove' }));
  const results: Result<readonly Op[], Fault>[] = [];
  for (const row of rows.value) {
    const blocked = editable(row);
    if (blocked) return err(blocked);
    results.push(remove(row, ctx.menuCtx));
  }
  const ops = concat(results);
  return ops.ok ? ok(config(ops.value)) : ops;
}

function parseMove(rest: readonly Token[], menu: MenuDef, ctx: ParseCtx): Result<RosIntent, Fault> {
  const split = splitArgs(rest, [
    { name: 'destination', type: { kind: 'string' }, writable: true },
  ]);
  if (!split.ok) return split;
  const [numbers, destTok] = split.value.positional;
  if (!numbers) return err(fault('missing-args', undefined, { args: 'numbers' }));
  const rows = resolveRows(numbers, menu, ctx);
  if (!rows.ok) return rows;
  const destText = split.value.named.get('destination')?.value ?? destTok?.text;
  let before: ItemId | null = null;
  const lastNumber = numberedKeys(menu, ctx, menu.rows(ctx.menuCtx)).length;
  // Un destino igual al número de ítems significa "al final".
  if (destText !== undefined && !(/^\d+$/.test(destText) && Number(destText) >= lastNumber)) {
    const dest = resolveRows({ ...(destTok ?? numbers), text: destText }, menu, ctx);
    if (!dest.ok) return dest;
    before = dest.value[0]?.id ?? null;
  }
  const coll = menu.coll as CollectionKey;
  const ops: Op[] = [];
  for (const row of rows.value) {
    if (row.id === undefined) return err(fault('not-allowed', undefined, { reason: 'dynamic' }));
    ops.push({ op: 'move', coll, id: row.id, before });
  }
  return ok(config(ops));
}

function parseAction(
  name: string,
  action: ActionDef,
  rest: readonly Token[],
  menu: MenuDef,
  ctx: ParseCtx,
): Result<RosIntent, Fault> {
  const split = splitArgs(rest, action.args);
  if (!split.ok) return split;
  const positional = [...split.value.positional];
  let rowKeys: string[] = [];
  if (action.takesNumbers) {
    const numbers = positional.shift();
    if (numbers) {
      const rows = resolveRows(numbers, menu, ctx);
      if (!rows.ok) return rows;
      rowKeys = rows.value.map((r) => r.key);
    }
  }
  if (action.positional && !split.value.named.has(action.positional)) {
    const value = positional.shift();
    if (value)
      split.value.named.set(action.positional, {
        value: value.text,
        at: value.start,
        token: value,
      });
  }
  const extra = positional[0];
  if (extra) return err(fault('expected-end', extra.start));
  const values = normalizeNamed(split.value, action.args, ctx.menuCtx);
  if (!values.ok) return values;
  const missing = action.args
    .filter((a) => a.required && !values.value.get(a.name))
    .map((a) => a.name);
  if (missing.length > 0) return err(fault('missing-args', undefined, { args: missing.join(',') }));
  const args: ArgList = [...values.value.entries()];
  return ok({
    kind: 'vendor',
    action: { kind: 'menu-action', path: menu.path, name, args, rowKeys },
  });
}

// ── Comandos globales y de script ───────────────────────────────────────────

const PING_ARGS: readonly PropDef[] = [
  { name: 'address', type: { kind: 'string' }, writable: true },
  { name: 'count', type: { kind: 'int', min: 1, max: 4294967295 }, writable: true },
  { name: 'size', type: { kind: 'int', min: 14, max: 65535 }, writable: true },
  { name: 'src-address', type: { kind: 'ip' }, writable: true },
  { name: 'interval', type: { kind: 'time' }, writable: true },
  { name: 'interface', type: { kind: 'ref', target: 'interface' }, writable: true },
];

function parseGlobal(
  name: string,
  rest: readonly Token[],
  path: string,
  ctx: ParseCtx,
): Result<RosIntent, Fault> {
  switch (name) {
    case 'quit':
      return ok({ kind: 'session', change: { kind: 'quit' } });
    case 'undo':
    case 'redo':
      return ok({ kind: 'vendor', action: { kind: name } });
    case 'ping': {
      const split = splitArgs(rest, PING_ARGS);
      if (!split.ok) return split;
      const values = normalizeNamed(split.value, PING_ARGS, ctx.menuCtx);
      if (!values.ok) return values;
      const named = values.value.get('address');
      const target = named ?? split.value.positional[0]?.text;
      if (!target) return err(fault('missing-args', undefined, { args: 'address' }));
      // Solo la dirección va sin nombre: cualquier otra palabra suelta ("repeat 3",
      // "count" sin valor) es un error, como en los menús.
      const extra = split.value.positional[named === undefined ? 1 : 0];
      if (extra) return err(fault('expected-end', extra.start));
      const count = values.value.get('count');
      const src = values.value.get('src-address');
      return ok({
        kind: 'vendor',
        action: {
          kind: 'ping',
          target,
          size: Number(values.value.get('size') ?? '56'),
          ...(count === undefined ? {} : { count: Number(count) }),
          ...(src === undefined ? {} : { src }),
        },
      });
    }
    case 'export': {
      let verbose = false;
      let showSensitive = false;
      let file: string | undefined;
      for (const token of rest) {
        if (token.eq >= 0 && token.text.slice(0, token.eq) === 'file') {
          file = token.text.slice(token.eq + 1);
          continue;
        }
        const word = matchPrefix(token.text, [
          'compact',
          'verbose',
          'terse',
          'show-sensitive',
          'hide-sensitive',
        ]).match;
        if (word === undefined) return err(fault('expected-end', token.start));
        if (word === 'verbose') verbose = true;
        if (word === 'show-sensitive') showSensitive = true;
      }
      return ok({
        kind: 'vendor',
        action: {
          kind: 'export',
          path,
          verbose,
          showSensitive,
          ...(file === undefined ? {} : { file }),
        },
      });
    }
    case 'import': {
      const named = rest.find((t) => t.eq >= 0 && t.text.slice(0, t.eq) === 'file-name');
      const file = named ? named.text.slice(named.eq + 1) : rest[0]?.text;
      if (!file) return err(fault('missing-args', undefined, { args: 'file-name' }));
      return ok({ kind: 'vendor', action: { kind: 'import', file } });
    }
    default:
      return err(fault('bad-command', undefined, { name }));
  }
}

function parseScripting(tokens: readonly Token[]): Result<RosIntent, Fault> {
  const [head, arg] = tokens;
  if (!head) return ok({ kind: 'noop' });
  const command = head.text.slice(1);
  if (command === 'resolve') {
    const name = arg?.eq !== undefined && arg.eq >= 0 ? arg.text.slice(arg.eq + 1) : arg?.text;
    if (!name) return err(fault('missing-args', undefined, { args: 'domain-name' }));
    return ok({ kind: 'vendor', action: { kind: 'resolve', name } });
  }
  if (command === 'put') {
    const sub = arg?.sub?.trim();
    if (sub?.startsWith(':resolve')) {
      const name = sub.slice(':resolve'.length).trim();
      return ok({ kind: 'vendor', action: { kind: 'resolve', name } });
    }
    return ok({ kind: 'vendor', action: { kind: 'put', text: arg?.text ?? '' } });
  }
  return err(fault('bad-command', head.start, { name: head.text }));
}

// ── Entrada ─────────────────────────────────────────────────────────────────

function parseCommand(cmd: Cmd, ctx: ParseCtx): Result<RosIntent, Fault> {
  const tokens = cmd.tokens;
  const first = tokens[0];
  if (!first) return ok({ kind: 'noop' });
  if (first.text.startsWith(':')) return parseScripting(tokens);

  const path = [...ctx.session.path];
  let moved = false;
  let command: string | undefined;
  let i = 0;
  for (; i < tokens.length && command === undefined; i++) {
    const token = tokens[i] as Token;
    if (token.eq >= 0 || token.sub !== undefined || token.quoted) break;
    let text = token.text;
    let at = token.start;
    if (text.startsWith('/')) {
      path.length = 0;
      moved = true;
      text = text.slice(1);
      at += 1;
    }
    const segments = text.split('/');
    for (const [index, segment] of segments.entries()) {
      if (segment === '') {
        at += 1;
        continue;
      }
      if (segment === '..') {
        path.pop();
        moved = true;
        at += 3;
        continue;
      }
      const { children, commands } = namesAt(pathKey(path));
      const options = [...children, ...commands.map((c) => c.name)];
      const { match, ambiguous } = matchPrefix(segment, options);
      if (ambiguous) return err(fault('ambiguous', at, { name: segment, what: 'command' }));
      if (match === undefined) return err(fault('bad-command', at, { name: segment }));
      if (children.includes(match)) {
        path.push(match);
        moved = true;
        at += segment.length + 1;
        continue;
      }
      command = match;
      if (index < segments.length - 1) return err(fault('expected-end', at + segment.length));
      break;
    }
  }

  const rest = tokens.slice(i);
  const key = pathKey(path);
  if (command === undefined) {
    const next = rest[0];
    if (next) return err(fault('expected-command', next.start));
    return moved ? ok({ kind: 'session', change: { kind: 'cd', path } }) : ok({ kind: 'noop' });
  }

  const menu = menuAt(key);
  const action = menu?.actions?.[command];
  if (menu && action) return parseAction(command, action, rest, menu, ctx);
  if (GLOBAL_COMMANDS.some((g) => g.name === command) && !(menu && command === 'print')) {
    return parseGlobal(command, rest, key, ctx);
  }
  if (!menu) return err(fault('bad-command', first.start, { name: command }));
  switch (command) {
    case 'print':
      return parsePrint(cmd, rest, menu);
    case 'add':
      return parseAdd(rest, menu, ctx);
    case 'set':
      return parseSet(rest, menu, ctx);
    case 'enable':
    case 'disable':
      return parseToggle(rest, menu, ctx, command === 'disable');
    case 'comment':
      return parseComment(rest, menu, ctx);
    case 'unset':
      return parseUnset(rest, menu, ctx);
    case 'remove':
      return parseRemove(rest, menu, ctx);
    case 'move':
      return parseMove(rest, menu, ctx);
    case 'find':
      return ok({ kind: 'noop' });
    default:
      return err(fault('bad-command', undefined, { name: command }));
  }
}

export function parseLine(input: string, ctx: ParseCtx): Result<RosIntent, Fault> {
  if (ctx.session.pending) {
    const answer = input.trim().toLowerCase();
    return ok({
      kind: 'session',
      change: { kind: 'confirm', yes: answer === 'y' || answer === 'yes' },
    });
  }
  const lexed = lexLine(input);
  if (!lexed.ok) return lexed;
  const commands: readonly LexedCommand[] = lexed.value;
  if (commands.length === 0) return ok({ kind: 'noop' });
  if (commands.length > 1) {
    return ok({
      kind: 'vendor',
      action: { kind: 'script', lines: commands.map((c) => c.source.trim()) },
    });
  }
  const only = commands[0] as LexedCommand;
  return parseCommand(
    { line: input, tokens: only.tokens, end: only.offset + only.source.length },
    ctx,
  );
}
