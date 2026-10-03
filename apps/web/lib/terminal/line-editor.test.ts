import { describe, expect, it } from 'vitest';
import {
  applyCompletion,
  backspace,
  commonPrefix,
  deleteForward,
  EMPTY_LINE,
  formatColumns,
  History,
  insert,
  insideQuotes,
  killToEnd,
  killToStart,
  killWordBack,
  lineOf,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  paintLine,
  rowAfterWriting,
  rowsOf,
  splitPaste,
  toTerminal,
  visibleLength,
  wordLeft,
  wordRight,
} from './line-editor';

describe('edición de la línea', () => {
  it('inserta en el cursor y lo deja detrás de lo insertado', () => {
    const line = insert(lineOf('/ip print', 4), 'address ');
    expect(line).toEqual({ text: '/ip address print', cursor: 12 });
    expect(insert(EMPTY_LINE, '')).toBe(EMPTY_LINE);
  });

  it('Backspace y Supr borran a cada lado del cursor y no salen de los bordes', () => {
    expect(backspace(lineOf('abc', 2))).toEqual({ text: 'ac', cursor: 1 });
    expect(backspace(lineOf('abc', 0))).toEqual({ text: 'abc', cursor: 0 });
    expect(deleteForward(lineOf('abc', 1))).toEqual({ text: 'ac', cursor: 1 });
    expect(deleteForward(lineOf('abc'))).toEqual({ text: 'abc', cursor: 3 });
  });

  it('mueve el cursor sin salir de la línea', () => {
    expect(moveLeft(lineOf('ab', 0)).cursor).toBe(0);
    expect(moveRight(lineOf('ab')).cursor).toBe(2);
    expect(moveHome(lineOf('ab')).cursor).toBe(0);
    expect(moveEnd(lineOf('ab', 0)).cursor).toBe(2);
    expect(lineOf('ab', 9).cursor).toBe(2);
  });

  it('salta por palabras', () => {
    const text = '/ip address  add';
    expect(wordLeft(lineOf(text)).cursor).toBe(13);
    expect(wordLeft(lineOf(text, 13)).cursor).toBe(4);
    expect(wordRight(lineOf(text, 0)).cursor).toBe(3);
    expect(wordRight(lineOf(text, 3)).cursor).toBe(11);
  });

  it('Ctrl+U, Ctrl+K y Ctrl+W cortan como en readline', () => {
    const line = lineOf('/system identity set', 8);
    expect(killToStart(line)).toEqual({ text: 'identity set', cursor: 0 });
    expect(killToEnd(line)).toEqual({ text: '/system ', cursor: 8 });
    expect(killWordBack(lineOf('/system identity  '))).toEqual({ text: '/system ', cursor: 8 });
    expect(killWordBack(lineOf('a b', 0))).toEqual({ text: 'a b', cursor: 0 });
  });

  it('sabe si el cursor está dentro de comillas', () => {
    expect(insideQuotes('set comment="hola', 17)).toBe(true);
    expect(insideQuotes('set comment="hola"', 18)).toBe(false);
    expect(insideQuotes('set comment="di \\"no', 20)).toBe(true);
    expect(insideQuotes('set comment="x" ', 16)).toBe(false);
  });
});

describe('historial', () => {
  it('salta las líneas en blanco y las repetidas seguidas', () => {
    const history = new History();
    for (const line of ['/ip address print', '  ', '/ip address print', '/', '/ip address print']) {
      history.push(line);
    }
    expect(history.size).toBe(3);
    expect(history.previous('')).toBe('/ip address print');
    expect(history.previous('')).toBe('/');
    expect(history.previous('')).toBe('/ip address print');
    expect(history.previous('')).toBeNull();
  });

  it('conserva el borrador al recorrerlo y vuelve a él al bajar', () => {
    const history = new History();
    history.push('uno');
    history.push('dos');
    expect(history.next()).toBeNull();
    expect(history.previous('a medias')).toBe('dos');
    expect(history.previous('dos')).toBe('uno');
    expect(history.next()).toBe('dos');
    expect(history.next()).toBe('a medias');
    expect(history.next()).toBeNull();
  });

  it('al añadir una línea vuelve al final', () => {
    const history = new History();
    history.push('uno');
    history.push('dos');
    history.previous('');
    history.push('tres');
    expect(history.previous('')).toBe('tres');
  });
});

describe('Tab', () => {
  it('un candidato se acepta con un espacio detrás', () => {
    const out = applyCompletion(lineOf('/ip addr'), {
      replaceFrom: 4,
      candidates: [{ text: 'address', description: 'Address management' }],
    });
    expect(out).toEqual({ line: { text: '/ip address ', cursor: 12 }, listing: null });
  });

  it('sin espacio si el candidato termina en / o =', () => {
    const out = applyCompletion(lineOf('/system identity set n'), {
      replaceFrom: 21,
      candidates: [{ text: 'name=' }],
    });
    expect(out.line.text).toBe('/system identity set name=');
  });

  it('respeta lo que hay detrás del cursor', () => {
    const out = applyCompletion(lineOf('/ip addr print', 8), {
      replaceFrom: 4,
      candidates: [{ text: 'address' }],
    });
    expect(out.line).toEqual({ text: '/ip address  print', cursor: 12 });
  });

  it('varios candidatos completan el prefijo común si aporta algo', () => {
    const out = applyCompletion(lineOf('/ip d'), {
      replaceFrom: 4,
      candidates: [{ text: 'dhcp-client' }, { text: 'dhcp-server' }, { text: 'dns' }],
    });
    expect(out).toEqual({ line: lineOf('/ip d'), listing: ['dhcp-client', 'dhcp-server', 'dns'] });
    const narrower = applyCompletion(lineOf('/ip dh'), {
      replaceFrom: 4,
      candidates: [{ text: 'dhcp-client' }, { text: 'dhcp-server' }],
    });
    expect(narrower).toEqual({ line: lineOf('/ip dhcp-'), listing: null });
  });

  it('sin candidatos no cambia nada', () => {
    const line = lineOf('/foo');
    expect(applyCompletion(line, { replaceFrom: 1, candidates: [] })).toEqual({
      line,
      listing: null,
    });
  });

  it('prefijo común', () => {
    expect(commonPrefix([])).toBe('');
    expect(commonPrefix(['address', 'arp'])).toBe('a');
    expect(commonPrefix(['dns'])).toBe('dns');
  });

  it('lista en columnas que caben en el ancho', () => {
    const items = ['address', 'arp', 'dhcp-client', 'dhcp-server', 'dns'];
    expect(formatColumns(items, 30)).toEqual([
      'address      arp',
      'dhcp-client  dhcp-server',
      'dns',
    ]);
    expect(formatColumns(items, 5)).toHaveLength(5);
    expect(formatColumns([], 80)).toEqual([]);
  });
});

describe('pegado', () => {
  it('separa líneas completas de lo que queda a medias', () => {
    expect(splitPaste('/ip address print\r\n/interface print\r\n')).toEqual({
      lines: ['/ip address print', '/interface print'],
      tail: '',
    });
    expect(splitPaste('uno\rdos')).toEqual({ lines: ['uno'], tail: 'dos' });
    expect(splitPaste('sin salto')).toEqual({ lines: [], tail: 'sin salto' });
  });

  it('quita caracteres de control y cambia tabuladores por espacios', () => {
    expect(splitPaste('a\tb\u0007c')).toEqual({ lines: [], tail: 'a bc' });
  });

  it('une las líneas partidas con \\ como en un export', () => {
    const text = '/ip address\nadd address=10.0.0.1/24 \\\n    interface=ether2\n';
    expect(splitPaste(text).lines).toEqual([
      '/ip address',
      'add address=10.0.0.1/24 interface=ether2',
    ]);
    expect(splitPaste('add a=1 \\\n').tail).toBe('add a=1');
  });
});

describe('pintado', () => {
  it('cuenta columnas visibles y filas con salto de línea', () => {
    expect(visibleLength('\x1b[90mhola\x1b[39m')).toBe(4);
    expect(rowsOf('abcd\n\nabcdefghi', 4)).toBe(1 + 1 + 3);
    expect(rowsOf('', 80)).toBe(1);
    expect(toTerminal('a\nb\r\nc')).toBe('a\r\nb\r\nc');
  });

  it('repinta en una fila y deja el cursor en su columna', () => {
    const painted = paintLine('> ', lineOf('abcd', 1), 80, 0);
    expect(painted.sequence).toBe('\r\x1b[J> abcd\r\x1b[3C');
    expect(painted.cursorRow).toBe(0);
  });

  it('con líneas largas sube a la primera fila antes de borrar', () => {
    // prompt (2) + 10 = 12 columnas en una terminal de 5: filas 0, 1 y 2.
    const painted = paintLine('> ', lineOf('0123456789', 4), 5, 2);
    expect(painted.sequence).toBe('\x1b[2A\r\x1b[J> 0123456789\x1b[1A\r\x1b[1C');
    expect(painted.cursorRow).toBe(1);
  });

  it('si la línea llena justo la fila, baja el cursor antes de colocarlo', () => {
    const painted = paintLine('> ', lineOf('abc'), 5, 0);
    expect(painted.sequence).toBe('\r\x1b[J> abc \r\r');
    expect(painted.cursorRow).toBe(1);
  });

  it('fila del cursor al escribir de corrido', () => {
    expect(rowAfterWriting(4, 5)).toBe(0);
    expect(rowAfterWriting(5, 5)).toBe(0);
    expect(rowAfterWriting(6, 5)).toBe(1);
    expect(rowAfterWriting(0, 5)).toBe(0);
  });
});
