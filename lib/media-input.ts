const NUMERIC_MASK = /\$\{(-?\d+)-(-?\d+)}/;
const MAX_MASK_EXPANSION = 100;

export function expandMediaInput(input: string): string[] {
  return input
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap(expandNumericMask)
    .slice(0, MAX_MASK_EXPANSION);
}

function expandNumericMask(value: string): string[] {
  const match = NUMERIC_MASK.exec(value);
  if (!match) return [value];

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return [value];

  const direction = end >= start ? 1 : -1;
  const count = Math.min(Math.abs(end - start) + 1, MAX_MASK_EXPANSION);
  const expanded: string[] = [];

  for (let index = 0; index < count; index++) {
    const current = start + index * direction;
    expanded.push(value.replace(NUMERIC_MASK, String(current)));
  }

  return expanded;
}

export function extractYouTubePlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("youtube.com") && !host.includes("youtu.be")) {
      return null;
    }
    return parsed.searchParams.get("list");
  } catch {
    return null;
  }
}

export function extractStartPositionFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("t") || parsed.searchParams.get("start");
    if (!raw) return 0;
    return parseTimecode(raw);
  } catch {
    return 0;
  }
}

function parseTimecode(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);

  const hours = /(\d+)h/i.exec(raw)?.[1];
  const minutes = /(\d+)m/i.exec(raw)?.[1];
  const seconds = /(\d+)s/i.exec(raw)?.[1];

  const total =
    Number(hours || 0) * 3600 +
    Number(minutes || 0) * 60 +
    Number(seconds || 0);

  return Number.isFinite(total) ? total : 0;
}
