/**
 * Sistemas que se practican en la web, en el orden en que se ofrecen (D-046).
 * Aprender, Practicar y la portada dejan elegir entre ellos; el nombre visible
 * sale de i18n (`systems`).
 */
import type { LabDefinition } from '@nos/core';
import type { Messages } from './i18n';

export const SYSTEMS = ['routeros', 'vrp', 'ios'] as const;
export type SystemId = (typeof SYSTEMS)[number];

export const DEFAULT_SYSTEM: SystemId = 'routeros';

export const isSystem = (value: string): value is SystemId =>
  (SYSTEMS as readonly string[]).includes(value);

/** Posición de un sistema en la lista; los que no se practican van al final. */
export const systemRank = (os: LabDefinition['vendor']): number => {
  const index = (SYSTEMS as readonly string[]).indexOf(os);
  return index < 0 ? SYSTEMS.length : index;
};

/** Dirección de un tema de la referencia: cada sistema tiene los suyos. */
export const topicHref = (locale: string, system: string, topic: string): string =>
  `/${locale}/referencia/${system}/${topic}`;

/** Nombre visible de un sistema; si no se practica, su id. */
export const systemName = (messages: Messages, system: string): string =>
  isSystem(system) ? messages.systems.names[system] : system;
