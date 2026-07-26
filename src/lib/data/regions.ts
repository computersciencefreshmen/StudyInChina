export const broadRegions = [
  'north',
  'northeast',
  'east',
  'south',
  'central',
  'southwest',
  'northwest',
] as const

export type BroadRegion = typeof broadRegions[number]

const subdivisionRegions: Record<string, BroadRegion> = {
  'CN-BJ': 'north',
  'CN-HE': 'north',
  'CN-NM': 'north',
  'CN-SX': 'north',
  'CN-TJ': 'north',
  'CN-HL': 'northeast',
  'CN-JL': 'northeast',
  'CN-LN': 'northeast',
  'CN-AH': 'east',
  'CN-FJ': 'east',
  'CN-JS': 'east',
  'CN-JX': 'east',
  'CN-SD': 'east',
  'CN-SH': 'east',
  'CN-TW': 'east',
  'CN-ZJ': 'east',
  'CN-GD': 'south',
  'CN-GX': 'south',
  'CN-HI': 'south',
  'CN-HK': 'south',
  'CN-MO': 'south',
  'CN-HA': 'central',
  'CN-HB': 'central',
  'CN-HN': 'central',
  'CN-CQ': 'southwest',
  'CN-GZ': 'southwest',
  'CN-SC': 'southwest',
  'CN-XZ': 'southwest',
  'CN-YN': 'southwest',
  'CN-GS': 'northwest',
  'CN-NX': 'northwest',
  'CN-QH': 'northwest',
  'CN-SN': 'northwest',
  'CN-XJ': 'northwest',
}

const broadRegionSet = new Set<string>(broadRegions)

export function normalizeRegionAlias(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (broadRegionSet.has(lower)) return lower
  return subdivisionRegions[trimmed.toUpperCase()] ?? value
}

export function toBroadRegion(value: string | null): BroadRegion | null {
  const normalized = normalizeRegionAlias(value)
  return typeof normalized === 'string' && broadRegionSet.has(normalized)
    ? normalized as BroadRegion
    : null
}
