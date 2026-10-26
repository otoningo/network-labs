/**
 * Errores con la voz de VRP. Los de sintaxis llevan delante la línea con el `^`
 * debajo del punto exacto, alineada con lo que se tecleó tras el prompt.
 */
import type { CoreError, DriverError } from '@nos/core';
import { AREAS } from './commands';

/** Códigos que VRP señala con `^`. */
const CARET: Readonly<Record<string, string>> = {
  unrecognized: "Error: Unrecognized command found at '^' position.",
  'wrong-parameter': "Error: Wrong parameter found at '^' position.",
  incomplete: "Error: Incomplete command found at '^' position.",
  'too-many': "Error: Too many parameters found at '^' position.",
  ambiguous: "Error: Ambiguous command found at '^' position.",
};

const COMMON: Readonly<Record<string, string>> = {
  'invalid-address': 'Error: The specified IP address is invalid.',
  'address-overlap': 'Error: The specified address conflicts with another address.',
  'address-not-exist': 'Error: The address does not exist.',
  'no-permission':
    'Error: You do not have permission to run the command or the command is incomplete.',
  'unknown-host': 'Error: The host name is invalid or unreachable.',
};

const AREA_MESSAGES: Readonly<Record<string, string>> = Object.assign(
  {},
  ...AREAS.map((a) => a.messages ?? {}),
);

function messageFor(code: string): string {
  return (
    CARET[code] ?? COMMON[code] ?? AREA_MESSAGES[code] ?? 'Error: Failed to execute the command.'
  );
}

function coreMessage(error: CoreError): string {
  switch (error.code) {
    case 'duplicate':
      return 'Error: The configuration already exists.';
    case 'not-found':
      return 'Error: The specified object does not exist.';
    case 'in-use':
      return 'Error: The object is being used and cannot be deleted.';
    case 'out-of-range':
    case 'invalid-value':
      return 'Error: The parameter is invalid.';
    case 'missing-required':
      return 'Error: Incomplete configuration.';
    case 'conflict':
      return 'Error: The configuration conflicts with existing configuration.';
    case 'not-removable':
      return 'Error: The object cannot be deleted.';
  }
}

export function describeError(error: DriverError, prompt: string): string {
  switch (error.kind) {
    case 'syntax': {
      const { code, at } = error.fault;
      const text = messageFor(code);
      if (at === undefined || !(code in CARET || code === 'wrong-parameter')) return text;
      return `${' '.repeat(prompt.length + at)}^\n${text}`;
    }
    case 'vendor':
      return messageFor(error.code);
    case 'core':
      return coreMessage(error.error);
  }
}
