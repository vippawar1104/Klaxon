const UNITS: [limit: number, seconds: number, label: string][] = [
  [60, 1, 's'],
  [3600, 60, 'm'],
  [86400, 3600, 'h'],
  [2592000, 86400, 'd'],
]

export function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  for (const [limit, divisor, label] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${label} ago`
  }
  return `${Math.floor(seconds / 2592000)}mo ago`
}

/** Full timestamp for tooltips — "8 minutes ago" is useless when triaging. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
}

export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
