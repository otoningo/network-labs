/**
 * Errores con la voz de IOS. Los de sintaxis llevan delante la línea con el `^`
 * debajo del punto exacto, alineada con lo que se tecleó tras el prompt.
 */
import { type CoreError, type Device, type DriverError, formatIpv4 } from '@nos/core';
import { AREAS } from './commands';
import { metaOf } from './meta';

const INVALID = "% Invalid input detected at '^' marker.";

const COMMON: Readonly<Record<string, string>> = {
  incomplete: '% Incomplete command.',
  ambiguous: '% Ambiguous command:  "{line}"',
  'unknown-host': '% Unrecognized host or address, or protocol not running.',
  'bad-source': '% Invalid source address- IP address not on any of our up interfaces',
};

const AREA_MESSAGES: Readonly<Record<string, string>> = Object.assign(
  {},
  ...AREAS.map((a) => a.messages ?? {}),
);

/** Sustituye `{clave}` por el detalle del error. */
function fill(template: string, detail: Readonly<Record<string, string | number>> | undefined) {
  return template.replace(/\{(\w+)\}/g, (_all, key: string) => String(detail?.[key] ?? ''));
}

/**
 * Una palabra suelta que no es un comando en EXEC: IOS cree que es el nombre de
 * un equipo al que abrir Telnet, intenta resolverlo y se rinde.
 */
function unknownCommand(word: string, device: Device): string {
  const meta = metaOf(device);
  const servers = device.config.dns.servers;
  const translating = meta.domainLookup
    ? `Translating "${word}"...domain server (${servers.length > 0 ? servers.map(formatIpv4).join(' ') : '255.255.255.255'})`
    : `Translating "${word}"`;
  return [
    translating,
    '% Unknown command or computer name, or unable to find computer address',
  ].join('\n');
}

function coreMessage(error: CoreError): string {
  switch (error.code) {
    case 'duplicate':
      return '% Entry already exists';
    case 'not-found':
      return '% Entry not found';
    case 'in-use':
      return '% Entry is in use';
    case 'out-of-range':
    case 'invalid-value':
      return '% Invalid value';
    case 'missing-required':
      return '% Incomplete command.';
    case 'conflict':
      return '% Conflicting configuration';
    case 'not-removable':
      return '% Entry cannot be removed';
  }
}

export function describeError(error: DriverError, prompt: string, device: Device): string {
  switch (error.kind) {
    case 'syntax': {
      const { code, at, detail } = error.fault;
      if (code === 'invalid') {
        return at === undefined ? INVALID : `${' '.repeat(prompt.length + at)}^\n${INVALID}`;
      }
      if (code === 'exec-unknown') return unknownCommand(String(detail?.['word'] ?? ''), device);
      const template = COMMON[code] ?? AREA_MESSAGES[code];
      return template === undefined ? INVALID : fill(template, detail);
    }
    case 'vendor':
      return fill(COMMON[error.code] ?? AREA_MESSAGES[error.code] ?? INVALID, undefined);
    case 'core':
      return coreMessage(error.error);
  }
}
