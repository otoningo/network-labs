import { describe, expect, it } from 'vitest';
import { commandAnchor, splitSummary } from './text';

describe('resumen de un comando', () => {
  it('la primera frase hace de título, sin el punto', () => {
    expect(
      splitSummary('Añade una dirección a una interfaz. La red y el broadcast se calculan solos.'),
    ).toEqual({
      lead: 'Añade una dirección a una interfaz',
      rest: 'La red y el broadcast se calculan solos.',
    });
  });

  it('una sola frase no deja resto', () => {
    expect(splitSummary('Borra una dirección.')).toEqual({ lead: 'Borra una dirección', rest: '' });
    expect(splitSummary('Sin punto final')).toEqual({ lead: 'Sin punto final', rest: '' });
  });

  it('no corta en una dirección ni dentro de código', () => {
    expect(splitSummary('Usa 192.168.88.1 como puerta. Luego prueba.').lead).toBe(
      'Usa 192.168.88.1 como puerta',
    );
    expect(splitSummary('Con `print. detail` se ve todo. Y más.').lead).toBe(
      'Con `print. detail` se ve todo',
    );
  });

  it('conserva la interrogación', () => {
    expect(splitSummary('¿Qué hay? Mira la tabla.')).toEqual({
      lead: '¿Qué hay?',
      rest: 'Mira la tabla.',
    });
  });

  it('ancla estable por comando', () => {
    expect(commandAnchor('add-errors')).toBe('cmd-add-errors');
  });
});
