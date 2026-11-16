/**
 * Convierte los iconos de topología de Cisco (EPS de Illustrator, paquete
 * "PMS 3015 EPS" de https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html)
 * a SVG para la figura de los labs (D-045).
 *
 * Cisco permite usarlos libremente pero no alterarlos, así que esto solo
 * cambia el formato: interpreta los operadores de dibujo del EPS (trazados,
 * rellenos, trazos, grosores y colores, incluido el azul PANTONE 3015) y los
 * escribe tal cual como SVG, sin tocar formas ni colores. Si encuentra algo
 * que no sabe traducir (una imagen incrustada, un operador nuevo), falla en
 * vez de adivinar.
 *
 *   node apps/web/scripts/cisco-eps-to-svg.mjs <carpeta-con-los-eps> <carpeta-de-salida> nombre=archivo.eps ...
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fmt = (n) => Number(n.toFixed(3)).toString();

function tokenize(text) {
  const tokens = [];
  const re = /\(([^)]*)\)|<<|>>|\[|\]|\{|\}|\/[^\s/[\](){}<>%]*|[^\s/[\](){}<>%]+|%[^\n]*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const t = m[0];
    if (t.startsWith('%')) continue;
    if (t.startsWith('(')) tokens.push({ str: m[1] });
    else tokens.push(t);
  }
  return tokens;
}

/** Colores directos declarados en la cabecera: nombre → [r, g, b]. */
function customColors(text) {
  const map = new Map();
  for (const m of text.matchAll(/%%RGBCustomColor: ([\d.]+) ([\d.]+) ([\d.]+) \(([^)]+)\)/g)) {
    map.set(m[4], [Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return map;
}

const multiply = (a, b) => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex = ([r, g, b]) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const IGNORED = new Set([
  'begin',
  'end',
  'get',
  'exec',
  'ddf',
  'save',
  'restore',
  'scale',
  'translate',
  'path_rez',
  'add_csa',
  'newpath',
  'sadj',
  'sop',
  'true',
  'false',
  'null',
  'userdict',
  'known',
  'copy',
  'ifelse',
  'pop',
  'dup',
  'exch',
  'def',
  'bind',
  'load',
  'where',
  'not',
  'annotatepage',
]);

export function convert(text, name) {
  const start = text.indexOf('%%EndPageSetup');
  const end = text.indexOf('%%PageTrailer');
  if (start < 0 || end < 0) throw new Error(`${name}: sin página`);
  const box = /%%HiResBoundingBox: ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(text);
  if (!box) throw new Error(`${name}: sin caja`);
  const width = Number(box[3]) - Number(box[1]);
  const height = Number(box[4]) - Number(box[2]);
  const spots = customColors(text);
  const tokens = tokenize(text.slice(start, end));

  const stack = [];
  const csd = new Map(); // nombre de espacio (/0) → color directo
  let state = {
    ctm: [1, 0, 0, 1, 0, 0],
    color: [0, 0, 0],
    spot: null,
    lw: 1,
    lc: 0,
    lj: 0,
    ml: 4,
    dash: [],
  };
  const saved = [];
  let path = [];
  const out = [];
  const unknown = new Set();
  let skipDepth = 0;

  const num = () => {
    const v = stack.pop();
    if (typeof v !== 'number') throw new Error(`${name}: se esperaba un número`);
    return v;
  };
  const point = () => {
    const y = num();
    const x = num();
    return apply(state.ctm, x, y);
  };
  const paint = (kind) => {
    if (path.length === 0) return;
    const d = path.join(' ');
    const color = hex(state.color);
    if (kind === 'stroke') {
      const scale = Math.hypot(state.ctm[0], state.ctm[1]);
      const caps = ['butt', 'round', 'square'];
      const joins = ['miter', 'round', 'bevel'];
      out.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(state.lw * scale)}" stroke-linecap="${caps[state.lc]}" stroke-linejoin="${joins[state.lj]}" stroke-miterlimit="${fmt(state.ml)}"${state.dash.length ? ` stroke-dasharray="${state.dash.map(fmt).join(' ')}"` : ''}/>`,
      );
    } else {
      out.push(
        `<path d="${d}" fill="${color}"${kind === 'eofill' ? ' fill-rule="evenodd"' : ''}/>`,
      );
    }
    path = [];
  };

  for (const t of tokens) {
    // Los procedimientos { ... } no dibujan nada aquí: se saltan enteros.
    if (t === '{') {
      skipDepth++;
      continue;
    }
    if (t === '}') {
      skipDepth = Math.max(0, skipDepth - 1);
      stack.push({ proc: true });
      continue;
    }
    if (skipDepth > 0) continue;
    if (typeof t === 'object') {
      stack.push(t);
      continue;
    }
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) {
      stack.push(Number(t));
      continue;
    }
    if (t.startsWith('/')) {
      stack.push({ name: t.slice(1) });
      continue;
    }
    switch (t) {
      case 'true':
      case 'false':
      case 'null':
        stack.push({ literal: t });
        break;
      case '[':
      case '<<':
      case 'mark':
        stack.push({ mark: true });
        break;
      case ']': {
        const items = [];
        while (stack.length && !stack.at(-1)?.mark) items.unshift(stack.pop());
        stack.pop();
        stack.push({ array: items });
        break;
      }
      case '>>': {
        const items = [];
        while (stack.length && !stack.at(-1)?.mark) items.unshift(stack.pop());
        stack.pop();
        const dict = {};
        for (let i = 0; i + 1 < items.length; i += 2) dict[items[i]?.name] = items[i + 1];
        stack.push({ dict });
        break;
      }
      case 'cleartomark':
        while (stack.length && !stack.at(-1)?.mark) stack.pop();
        stack.pop();
        break;
      case 'mo': {
        const [x, y] = point();
        path.push(`M${fmt(x)} ${fmt(y)}`);
        break;
      }
      case 'li': {
        const [x, y] = point();
        path.push(`L${fmt(x)} ${fmt(y)}`);
        break;
      }
      case 'cv': {
        const p3 = point();
        const p2 = point();
        const p1 = point();
        path.push(
          `C${fmt(p1[0])} ${fmt(p1[1])} ${fmt(p2[0])} ${fmt(p2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`,
        );
        break;
      }
      case 'cp':
        path.push('Z');
        break;
      case 'clp':
      case 'eoclp':
        path = [];
        break;
      case 'f':
        paint('fill');
        break;
      case 'ef':
        paint('eofill');
        break;
      case 's':
        paint('stroke');
        break;
      case 'np':
        path = [];
        break;
      case 'gsave':
        saved.push(structuredClone(state));
        break;
      case 'grestore':
        state = saved.pop() ?? state;
        break;
      case 'concat': {
        const m = stack.pop()?.array;
        if (m?.length !== 6) throw new Error(`${name}: concat sin matriz`);
        state.ctm = multiply(m, state.ctm);
        break;
      }
      case 'lw':
        state.lw = num();
        break;
      case 'lc':
        state.lc = num();
        break;
      case 'lj':
        state.lj = num();
        break;
      case 'ml':
        state.ml = num();
        break;
      case 'dsh': {
        num();
        state.dash = stack.pop()?.array ?? [];
        break;
      }
      case 'rgb': {
        const b = num();
        const g = num();
        const r = num();
        state.color = [r, g, b];
        break;
      }
      case 'gry': {
        const g = num();
        state.color = [g, g, g];
        break;
      }
      case 'cmyk': {
        const k = num();
        const y = num();
        const m = num();
        const c = num();
        state.color = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
        break;
      }
      case 'add_csd': {
        const dict = stack.pop()?.dict;
        const key = stack.pop()?.name;
        const spot = dict?.Name?.str;
        if (key !== undefined && spot) csd.set(key, spot);
        break;
      }
      case 'get_csd': {
        const key = stack.pop()?.name;
        stack.pop();
        stack.push({ spot: csd.get(key) });
        break;
      }
      case 'sepcs': {
        state.spot = stack.pop()?.spot ?? null;
        break;
      }
      case 'sep': {
        const tint = num();
        const rgb = spots.get(state.spot);
        if (!rgb) throw new Error(`${name}: color directo desconocido ${state.spot}`);
        // Tinte aditivo: del blanco al color directo.
        state.color = rgb.map((v) => 1 - tint * (1 - v));
        break;
      }
      case 'image':
      case 'colorimage':
      case 'imagemask':
        throw new Error(`${name}: tiene una imagen incrustada`);
      default:
        // Los diccionarios de procedimientos de Illustrator (Adobe_AGM_Core...) no dibujan.
        if (!IGNORED.has(t) && !t.startsWith('Adobe_')) unknown.add(t);
        stack.length = 0;
    }
  }
  if (unknown.size > 0)
    throw new Error(`${name}: operadores sin traducir: ${[...unknown].join(', ')}`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}">`,
    `<!-- Cisco network topology icon (${name}), unaltered. Source: https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html -->`,
    ...out,
    '</svg>',
  ].join('\n');
}

const [, , inDir, outDir, ...pairs] = process.argv;
if (inDir && outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const pair of pairs) {
    const [id, file] = pair.split('=');
    const text = readFileSync(join(inDir, file), 'latin1');
    writeFileSync(join(outDir, `${id}.svg`), `${convert(text, file)}\n`);
    console.log(`${id}.svg ← ${file}`);
  }
}
