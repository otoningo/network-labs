export interface PortRange {
  readonly from: number;
  readonly to: number;
}

export type PortSet = readonly PortRange[];

/** Acepta `80`, `80,443` y `8000-8080` combinados. */
export function parsePortSet(text: string): PortSet | null {
  if (text.trim() === '') return null;
  const result: PortRange[] = [];
  for (const raw of text.split(',')) {
    const part = raw.trim();
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
    if (!match?.[1]) return null;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from > 65535 || to > 65535 || from > to) return null;
    result.push({ from, to });
  }
  return result;
}

export function formatPortSet(set: PortSet): string {
  return set.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(',');
}

export function portSetContains(set: PortSet, port: number): boolean {
  return set.some((r) => port >= r.from && port <= r.to);
}
