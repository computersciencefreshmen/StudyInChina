import type { IngestionJob, SourceCategory } from './types'

export type InfrastructureCostMode =
  | 'normal'
  | 'warning'
  | 'constrained'
  | 'freeze_discovery'

export type InfrastructureCostPolicy = {
  mode: InfrastructureCostMode
  allowDiscovery: boolean
  allowBrowserFallback: boolean
  browserScope: 'all' | 'critical-only' | 'none'
}

const CRITICAL_BROWSER_CATEGORIES = new Set<SourceCategory>([
  'international_admissions_home',
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'current_guide',
  'dates_deadlines',
  'fees',
  'eligibility_language',
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
  'program_detail',
])

function parseForecast(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return 0
  const forecast = typeof value === 'number' ? value : Number(value.trim())
  return Number.isFinite(forecast) && forecast >= 0 ? forecast : null
}

/**
 * Converts the externally maintained monthly infrastructure forecast into a
 * deterministic runtime policy. A malformed configured value fails closed for
 * discovery and browser fallback; an omitted value represents a zero forecast.
 */
export function infrastructureCostPolicy(
  forecastCny: string | number | null | undefined,
): InfrastructureCostPolicy {
  const forecast = parseForecast(forecastCny)
  if (forecast === null || forecast >= 95) {
    return {
      mode: 'freeze_discovery',
      allowDiscovery: false,
      allowBrowserFallback: forecast !== null,
      browserScope: forecast === null ? 'none' : 'critical-only',
    }
  }
  if (forecast >= 80) {
    return {
      mode: 'constrained',
      allowDiscovery: true,
      allowBrowserFallback: true,
      browserScope: 'critical-only',
    }
  }
  if (forecast >= 60) {
    return {
      mode: 'warning',
      allowDiscovery: true,
      allowBrowserFallback: true,
      browserScope: 'all',
    }
  }
  return {
    mode: 'normal',
    allowDiscovery: true,
    allowBrowserFallback: true,
    browserScope: 'all',
  }
}

/** A catalog anchor is the registered seed for discovering additional pages. */
export function scheduledJobReason(
  sourceCategory: SourceCategory,
): Extract<IngestionJob['reason'], 'scheduled' | 'discovery'> {
  return sourceCategory === 'catalog_anchor' ? 'discovery' : 'scheduled'
}

export function permitsScheduledReason(
  policy: InfrastructureCostPolicy,
  reason: Extract<IngestionJob['reason'], 'scheduled' | 'discovery'>,
): boolean {
  return reason !== 'discovery' || policy.allowDiscovery
}

export function permitsBrowserForSource(
  policy: InfrastructureCostPolicy,
  sourceCategory: SourceCategory,
): boolean {
  if (policy.browserScope === 'none') return false
  return policy.browserScope === 'all' || CRITICAL_BROWSER_CATEGORIES.has(sourceCategory)
}
