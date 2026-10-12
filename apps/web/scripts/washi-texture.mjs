/**
 * Genera las placas de papel de la portada (D-041), que se repiten sin
 * costuras: fibra de kozo de largo, grosor y curvatura variados, con alguna
 * fibra quebrada, sobre una nube de formación muy suave. Todo es transparente
 * salvo la fibra, así que va encima del color.
 *
 * - public/landing/washi.png: para el bermellón. Fibra clara muy tenue (el
 *   texto blanco encima sigue por encima de 4.5:1) y alguna mota de corteza.
 * - public/landing/washi-cream.png: para la crema. Solo vetas más claras que el
 *   fondo, sin motas oscuras, para que no parezca polvo junto al texto.
 *
 *   node apps/web/scripts/washi-texture.mjs
 *
 * Determinista: la misma semilla produce siempre el mismo archivo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 320;
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public/landing');

/** Color de la fibra clara y de las motas de corteza. */
const LIGHT = [255, 246, 236];
const DARK = [52, 14, 8];

const PLATES = [
  {
    file: 'washi.png',
    seed: 0x0d600ff5,
    long: { count: 34, alpha: [0.018, 0.03] },
    mid: { count: 200, alpha: [0.014, 0.024] },
    fuzz: { count: 700, alpha: [0.012, 0.02] },
    specks: 40,
    cloud: 0.015,
  },
  {
    file: 'washi-cream.png',
    seed: 0x0ebe3d3,
    long: { count: 30, alpha: [0.08, 0.14] },
    mid: { count: 180, alpha: [0.06, 0.1] },
    fuzz: { count: 500, alpha: [0.05, 0.08] },
    specks: 0,
    cloud: 0.12,
  },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (v) => ((v % SIZE) + SIZE) % SIZE;
const smooth = (t) => t * t * (3 - 2 * t);

/** Deposita alfa en un punto con reparto bilineal, envolviendo los bordes. */
function splat(map, x, y, a) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const put = (px, py, w) => {
    const i = wrap(py) * SIZE + wrap(px);
    map[i] = Math.min(1, map[i] + a * w);
  };
  put(x0, y0, (1 - fx) * (1 - fy));
  put(x0 + 1, y0, fx * (1 - fy));
  put(x0, y0 + 1, (1 - fx) * fy);
  put(x0 + 1, y0 + 1, fx * fy);
}

function plate(spec) {
  const rand = mulberry32(spec.seed);
  const between = ([lo, hi]) => lo + rand() * (hi - lo);
  const light = new Float32Array(SIZE * SIZE);
  const dark = new Float32Array(SIZE * SIZE);

  /**
   * Una fibra: casi recta o algo curva según la fibra, a veces quebrada, más
   * fina en las puntas y con un grosor que varía a lo largo.
   */
  const fiber = (map, length, strength, maxWidth) => {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    let angle = rand() * Math.PI * 2;
    const limit = 0.0004 + rand() ** 2 * 0.004;
    let bend = (rand() - 0.5) * limit;
    const width = 0.6 + rand() * (maxWidth - 0.6);
    for (let s = 0; s < length; s += 0.5) {
      const taper = Math.sin((s / length) * Math.PI);
      const a = strength * taper * (0.7 + rand() * 0.3);
      splat(map, x, y, a);
      if (width > 1) {
        const side = (width - 1) * 0.9;
        splat(
          map,
          x + Math.cos(angle + Math.PI / 2) * side,
          y + Math.sin(angle + Math.PI / 2) * side,
          a * 0.55,
        );
      }
      bend = Math.max(-limit, Math.min(limit, bend + (rand() - 0.5) * limit * 0.3));
      angle += bend;
      // Un quiebro de vez en cuando: la fibra se dobló al secar.
      if (rand() < 0.003) angle += (rand() - 0.5) * 0.7;
      x += Math.cos(angle) * 0.5;
      y += Math.sin(angle) * 0.5;
    }
  };

  for (let i = 0; i < spec.long.count; i += 1)
    fiber(light, 80 + rand() * 180, between(spec.long.alpha), 2.2);
  for (let i = 0; i < spec.mid.count; i += 1)
    fiber(light, 14 + rand() * 50, between(spec.mid.alpha), 1.6);
  for (let i = 0; i < spec.fuzz.count; i += 1)
    fiber(light, 2 + rand() * 8, between(spec.fuzz.alpha), 1);
  for (let i = 0; i < spec.specks; i += 1)
    fiber(dark, 1 + rand() * 3, 0.1 + rand() * 0.1, rand() > 0.7 ? 1.6 : 1);

  // Nube de formación: ruido de valor periódico, a muy baja intensidad.
  const CELLS = 5;
  const grid = Array.from({ length: CELLS * CELLS }, () => rand());
  const at = (cx, cy) =>
    grid[(((cy % CELLS) + CELLS) % CELLS) * CELLS + (((cx % CELLS) + CELLS) % CELLS)];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const gx = (x / SIZE) * CELLS;
      const gy = (y / SIZE) * CELLS;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const tx = smooth(gx - ix);
      const ty = smooth(gy - iy);
      const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      const i = y * SIZE + x;
      light[i] = Math.min(1, light[i] + (top * (1 - ty) + bottom * ty) * spec.cloud);
    }
  }

  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const l = light[i];
      const d = dark[i];
      const total = l + d;
      const o = row + 1 + x * 4;
      for (let c = 0; c < 3; c += 1) {
        raw[o + c] = total > 0 ? Math.round((LIGHT[c] * l + DARK[c] * d) / total) : 0;
      }
      raw[o + 3] = Math.round(Math.min(1, total) * 255);
    }
  }
  return encodePng(raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(PUBLIC, { recursive: true });
for (const spec of PLATES) {
  const out = resolve(PUBLIC, spec.file);
  const png = plate(spec);
  writeFileSync(out, png);
  console.log(`${out} (${png.length} bytes)`);
}
