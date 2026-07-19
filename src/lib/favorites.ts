export const FAVORITES_KEY = 'studycn:favorites:v1'
export const FAVORITES_EVENT = 'studycn:favorites-changed'
export const MAX_COMPARE = 4

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : []
  } catch {
    return []
  }
}
