/**
 * Formatos de valores de RouterOS: duraciones (1w2d3h4m5s), tamaños (2048KiB),
 * tasas (1.2Mbps), contadores con separador de miles y fechas del log.
 */

const UNITS: readonly [string, number][] = [
  ['w', 604800],
  ['d', 86400],
  ['h', 3600],
  ['m', 60],
  ['s', 1],
];

export function formatDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  if (rest === 0) return '0s';
  let out = '';
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      out += `${count}${unit}`;
      rest -= count * size;
    }
  }
  return out;
}

/** Acepta `1w2d3h4m5s` (cualquier subconjunto), `hh:mm:ss`, `Nd hh:mm:ss` y segundos sueltos. */
export function parseDuration(text: string): number | null {
  const value = text.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const clock = /^(?:(\d+)d\s*)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (clock) {
    const [, d = '0', h = '0', m = '0', s = '0'] = clock;
    return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (!/^(\d+[wdhms])+$/.test(value)) return null;
  let total = 0;
  for (const part of value.matchAll(/(\d+)([wdhms])/g)) {
    const size = UNITS.find(([u]) => u === part[2])?.[1] ?? 0;
    total += Number(part[1]) * size;
  }
  return total;
}

/** Tamaño en KiB: acepta `2048`, `2048KiB`, `2MiB`. */
export function parseKib(text: string): number | null {
  const match = /^(\d+)\s*(KiB|MiB|k|M)?$/i.exec(text.trim());
  if (!match?.[1]) return null;
  const unit = (match[2] ?? 'KiB').toLowerCase();
  return Number(match[1]) * (unit.startsWith('m') ? 1024 : 1);
}

export function formatKib(kib: number): string {
  return `${kib}KiB`;
}

/** Bytes en formato de listado de archivos (`13.5KiB`). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

/** Contadores con espacio como separador de miles (`3 162 108`). */
export function formatCount(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatRate(bps: number): string {
  if (bps < 1000) return `${Math.round(bps)}bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)}kbps`;
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)}Mbps`;
  return `${(bps / 1_000_000_000).toFixed(1)}Gbps`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Hora `HH:MM:SS` (UTC) de un instante simulado. */
export function formatClock(clockBase: number, seconds: number): string {
  const d = new Date(clockBase + seconds * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** Fecha y hora `YYYY-MM-DD HH:MM:SS` (UTC). */
export function formatDateTime(clockBase: number, seconds: number): string {
  const d = new Date(clockBase + seconds * 1000);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return `${date} ${formatClock(clockBase, seconds)}`;
}

/** Fecha compacta para nombres de backup (`20261002-1403`). */
export function formatStamp(clockBase: number, seconds: number): string {
  const d = new Date(clockBase + seconds * 1000);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}

/** Lista de VLAN compacta: 10,20,30-35. */
export function formatVlanIds(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    const start = sorted[i] as number;
    let end = start;
    while (sorted[i + 1] === end + 1) {
      end += 1;
      i += 1;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i += 1;
  }
  return parts.join(',');
}

export function parseVlanIds(text: string): number[] | null {
  const ids: number[] = [];
  for (const part of text.split(',')) {
    const match = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part.trim());
    if (!match?.[1]) return null;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from > to || to - from > 4094) return null;
    for (let id = from; id <= to; id++) ids.push(id);
  }
  return ids;
}

/**
 * Comillas al estilo de export/print cuando el valor tiene espacios o caracteres
 * especiales. `%` no cuenta: v7 muestra `immediate-gw=10.0.12.2%ether1` sin comillas.
 */
export function quote(value: string): string {
  if (value !== '' && /^[A-Za-z0-9_.,:/*!@+%-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
