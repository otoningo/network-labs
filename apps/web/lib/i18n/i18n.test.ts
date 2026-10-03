import { describe, expect, it } from 'vitest';
import { fill, messagesFor, negotiateLocale, plural } from './index';

describe('i18n', () => {
  it('elige el idioma por Accept-Language con pesos y cae al español', () => {
    expect(negotiateLocale('en-US,en;q=0.9,es;q=0.8')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9,es;q=0.5,en;q=0.4')).toBe('es');
    expect(negotiateLocale('de')).toBe('es');
    expect(negotiateLocale(null)).toBe('es');
  });

  it('rellena huecos y deja a la vista los que faltan', () => {
    expect(fill('Lab {n}: {title}', { n: 1 })).toBe('Lab 1: {title}');
  });

  it('usa las reglas de plural de cada idioma', () => {
    const es = messagesFor('es').lab.progress;
    const en = messagesFor('en').lab.progress;
    expect(plural('es', es, 1, { done: 0, total: 1 })).toBe('0 de 1 tarea');
    expect(plural('es', es, 4, { done: 2, total: 4 })).toBe('2 de 4 tareas');
    expect(plural('en', en, 4, { done: 4, total: 4 })).toBe('4 of 4 tasks');
  });

  it('los dos diccionarios tienen exactamente las mismas claves', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(messagesFor('en')).sort()).toEqual(keys(messagesFor('es')).sort());
  });
});
