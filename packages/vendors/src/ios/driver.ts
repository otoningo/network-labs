/** Driver de Cisco IOS ensamblado: cumple el contrato VendorDriver del núcleo. */
import {
  type Device,
  type DriverContext,
  err,
  type Network,
  ok,
  type Result,
  runScript,
  type StartupRunner,
  type SyntaxFault,
  simTime,
  type VendorDriver,
} from '@nos/core';
import { applyIntent, renderShow } from './apply';
import { commandsFor } from './commands';
import { describeError } from './errors';
import {
  type CommandSpec,
  completions,
  ctxOf,
  formatHelp,
  helpEntries,
  matchLine,
  tokenize,
} from './grammar';
import type { IosAction, IosIntent, IosSessionChange, IosView, OutputFilter } from './intent';
import { IOS_PLATFORM } from './platform';
import { type IosSession, isConfigView, newSession } from './session';

type Ctx = DriverContext<IosSession>;
type Parsed = Result<IosIntent, SyntaxFault>;

export function iosPrompt(ctx: Ctx): string {
  const { session, device } = ctx;
  if (session.pending) return '';
  const name = device.config.system.identity;
  switch (session.view.kind) {
    case 'user':
      return `${name}>`;
    case 'priv':
      return `${name}#`;
    case 'config':
      return `${name}(config)#`;
    case 'interface':
      return `${name}(config-if)#`;
    case 'dhcp':
      return `${name}(dhcp-config)#`;
    case 'line':
      return `${name}(config-line)#`;
  }
}

const available = (ctx: Ctx): readonly CommandSpec[] => commandsFor(ctx.session.view.kind);

const withView = (ctx: Ctx, kind: 'priv' | 'config'): Ctx => ({
  ...ctx,
  session: { ...ctx.session, view: { kind } },
});

/** Error de sintaxis desplazado `offset` columnas (lo que se comió `do `). */
function syntax(
  code: string,
  at: number | undefined,
  offset: number,
  detail?: SyntaxFault['detail'],
): Parsed {
  return err({
    code,
    ...(at === undefined ? {} : { at: at + offset }),
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * Intenta la línea como comando de configuración global desde un submodo; null
 * si tampoco es un comando de configuración global. Si lo es pero falla (un
 * nombre ilegal, por ejemplo), el error es el de ese comando.
 */
function fromGlobalConfig(input: string, ctx: Ctx): Parsed | null {
  const kind = ctx.session.view.kind;
  if (kind !== 'interface' && kind !== 'dhcp' && kind !== 'line') return null;
  const global = withView(ctx, 'config');
  const cmds = available(global);
  const matched = matchLine(cmds, input);
  const cmd = matched.ok ? cmds[matched.cmd] : undefined;
  if (!matched.ok || !cmd) return null;
  const built = cmd.build(matched.matched, ctxOf(global));
  if (!built.ok) {
    const { code, at, detail } = built.error;
    return syntax(code, at, 0, detail);
  }
  return ok({
    kind: 'sequence',
    steps: [{ kind: 'session', change: { kind: 'enter', view: { kind: 'config' } } }, built.value],
  });
}

const FILTERS: readonly OutputFilter['mode'][] = ['begin', 'exclude', 'include', 'section'];

/** Separa `comando | include texto`; el filtro es null si no hay `|`. */
function splitFilter(input: string): {
  readonly command: string;
  readonly filter: OutputFilter | null;
  readonly bad?: number;
} {
  const bar = input.indexOf('|');
  if (bar < 0) return { command: input, filter: null };
  const command = input.slice(0, bar);
  const rest = input.slice(bar + 1);
  const m = /^(\s*)(\S+)(?:\s+(.*))?$/.exec(rest);
  if (!m) return { command, filter: null, bad: input.length };
  const word = (m[2] ?? '').toLowerCase();
  const hits = FILTERS.filter((f) => f.startsWith(word));
  const at = bar + 1 + (m[1] ?? '').length;
  const pattern = (m[3] ?? '').trim();
  if (hits.length !== 1 || pattern === '') return { command, filter: null, bad: at };
  return { command, filter: { mode: hits[0] as OutputFilter['mode'], pattern } };
}

/** Empareja y construye una línea en el modo del contexto, con su `^` desplazado `offset`. */
function parseIn(input: string, ctx: Ctx, offset: number): Parsed {
  const { command, filter, bad } = splitFilter(input);
  if (bad !== undefined) return syntax('invalid', bad, offset);
  const cmds = available(ctx);
  const matched = matchLine(cmds, command);
  if (!matched.ok) {
    // En un submodo, un comando de configuración global sale a ella y se ejecuta,
    // como en IOS (así se pega también una configuración entera).
    const fallback = filter ? null : fromGlobalConfig(command, ctx);
    if (fallback) return fallback;
    if (matched.code === 'ambiguous') {
      return syntax('ambiguous', undefined, 0, { line: input.trim() });
    }
    if (matched.code === 'incomplete') return syntax('incomplete', undefined, 0);
    // En EXEC, una palabra que no es comando se toma por el nombre de un equipo.
    if (!isConfigView(ctx.session.view) && matched.token === 0) {
      const tokens = tokenize(command);
      const first = tokens[0];
      if (tokens.length === 1 && first) {
        return syntax('exec-unknown', undefined, 0, { word: first.text });
      }
      return syntax('invalid', tokens[1]?.at ?? matched.at, offset);
    }
    return syntax('invalid', matched.at, offset);
  }
  const cmd = cmds[matched.cmd];
  if (!cmd) return syntax('invalid', 0, offset);
  const built = cmd.build(matched.matched, ctxOf(ctx));
  if (!built.ok) {
    const { code, at, detail } = built.error;
    return syntax(code, at, offset, detail);
  }
  if (!filter) return ok(built.value);
  const value = built.value;
  if (value.kind !== 'show') return syntax('invalid', input.indexOf('|'), offset);
  return ok({ kind: 'show', view: { ...value.view, filter } });
}

/** `do` delante: el resto se ejecuta como en el EXEC privilegiado. */
function doCommand(input: string): { readonly rest: string; readonly offset: number } | null {
  const m = /^(\s*do\s+)(\S.*)$/i.exec(input);
  return m ? { rest: m[2] ?? '', offset: (m[1] ?? '').length } : null;
}

function parseLine(input: string, ctx: Ctx): Parsed {
  if (ctx.session.pending) {
    return ok<IosIntent>({ kind: 'session', change: { kind: 'answer', text: input } });
  }
  if (input.trim() === '') return ok<IosIntent>({ kind: 'noop' });
  if (isConfigView(ctx.session.view)) {
    const d = doCommand(input);
    if (d) return parseIn(d.rest, withView(ctx, 'priv'), d.offset);
  }
  return parseIn(input, ctx, 0);
}

/** Contexto y texto sobre los que responder a `?` y a Tab (con `do`, los del EXEC privilegiado). */
function helpTarget(
  input: string,
  ctx: Ctx,
): { readonly ctx: Ctx; readonly text: string; readonly offset: number } {
  if (isConfigView(ctx.session.view)) {
    const d = doCommand(input);
    if (d) return { ctx: withView(ctx, 'priv'), text: d.rest, offset: d.offset };
  }
  return { ctx, text: input, offset: 0 };
}

export const ios: VendorDriver<IosSession, IosView, IosSessionChange, IosAction> = {
  os: 'ios',
  platform: IOS_PLATFORM,
  session: (device, options) => newSession(device, options),
  banner: () => '\nPress RETURN to get started!\n',
  parse: (input, ctx) => parseLine(input, ctx),
  apply: (intent, ctx) => applyIntent(intent, ctx),
  render: (view, ctx) => renderShow(view, ctx),
  prompt: iosPrompt,
  complete: (input, cursor, ctx) => {
    const target = helpTarget(input.slice(0, cursor), ctx);
    const { replaceFrom, words } = completions(available(target.ctx), target.text);
    return {
      replaceFrom: replaceFrom + target.offset,
      candidates: words.map((text) => ({ text })),
    };
  },
  help: (input, ctx) => {
    const target = helpTarget(input, ctx);
    const entries = helpEntries(available(target.ctx), target.text);
    const partial = /\S$/.test(target.text);
    if (entries === null || entries.length === 0) {
      if (partial && tokenize(target.text).length <= 1) return '% Unrecognized command';
      const matched = matchLine(available(target.ctx), target.text.trimEnd() || ' ');
      const at = (matched.ok ? target.text.length : matched.at) + target.offset;
      return describeError(
        { kind: 'syntax', fault: { code: 'invalid', at } },
        iosPrompt(ctx),
        ctx.device,
      );
    }
    return formatHelp(entries, partial);
  },
  key: (chord, ctx) => {
    switch (chord) {
      case 'ctrl-z':
        return isConfigView(ctx.session.view) ? { kind: 'session', change: { kind: 'end' } } : null;
      case 'ctrl-c':
        return { kind: 'session', change: { kind: 'interrupt' } };
      case 'ctrl-d':
      case 'ctrl-x':
        return null;
    }
  },
  describeError: (error, ctx) => describeError(error, iosPrompt(ctx), ctx.device),
};

const INTERFACE_LINE = /^(\S+)\s+(\S.*)$/;

/** ¿Es la línea un `interface X` (también abreviado) de un puerto que se puede encender? */
function opensInterface(line: string): boolean {
  const m = INTERFACE_LINE.exec(line);
  const word = (m?.[1] ?? '').toLowerCase();
  if (word.length < 3 || !'interface'.startsWith(word)) return false;
  return !/^n/i.test(m?.[2] ?? '');
}

/**
 * Líneas de un script de arranque: sin comentarios `!`, sin `end`, sin
 * `version` ni la cabecera de `show running-config`, y sin líneas vacías.
 *
 * El script es la configuración con la que arranca el equipo, y en una
 * configuración de IOS una interfaz que no dice `shutdown` está encendida: por
 * eso tras cada `interface` va un `no shutdown` implícito, que un `shutdown`
 * escrito en su bloque vuelve a deshacer. Las interfaces que el script no
 * nombra siguen apagadas, como salen de fábrica.
 */
export function startupLines(script: string): string[] {
  return script
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l !== '' &&
        !l.startsWith('!') &&
        l !== 'end' &&
        !/^version\s/.test(l) &&
        l !== 'Building configuration...' &&
        !/^Current configuration\s*:/.test(l),
    )
    .flatMap((l) => (opensInterface(l) ? [l, 'no shutdown'] : [l]));
}

/**
 * Ejecuta el script de arranque de un lab (D-016) sobre un equipo aislado. El
 * script se escribe como la configuración de IOS: arranca en configuración
 * global, así que el `enable` y el `configure terminal` los pone el ejecutor.
 */
export const iosStartup: StartupRunner = (
  device: Device,
  script: string,
): Result<Device, string> => {
  const net: Network = { devices: [device], links: [], scenario: { flows: [] }, now: simTime(0) };
  const ran = runScript(ios, net, device.id, [
    'enable',
    'configure terminal',
    ...startupLines(script),
  ]);
  if (!ran.ok) return err(`line ${ran.error.line - 2}: ${ran.error.message}`);
  const result = ran.value.devices.find((d) => d.id === device.id);
  return result ? ok(result) : err('device lost');
};
