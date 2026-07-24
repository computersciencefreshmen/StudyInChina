import type { DataBundle } from '@/lib/data/types'
import {
  CATALOG_COLLECTIONS,
  type CatalogBackendMode,
  type CatalogCollection,
  type CatalogRelease,
  type CatalogRepository,
} from './types'

export type CatalogShadowOperation = 'getBundle' | 'getRelease'
export type CatalogShadowStatus = 'match' | 'different' | 'shadow-error'
export type CatalogShadowDifferenceKind = 'missing-in-shadow' | 'extra-in-shadow' | 'value-mismatch'
export type CatalogShadowScope = CatalogCollection | 'release'

export type CatalogShadowDifference = {
  scope: CatalogShadowScope
  recordId: string
  path: string
  kind: CatalogShadowDifferenceKind
  primaryPresent: boolean
  shadowPresent: boolean
  primaryValue?: unknown
  shadowValue?: unknown
}

export type CatalogShadowReport = {
  operation: CatalogShadowOperation
  checkedAt: string
  status: CatalogShadowStatus
  matches: boolean
  primaryMode: CatalogBackendMode
  shadowMode: CatalogBackendMode
  summary: {
    differenceCount: number
    storedDifferenceCount: number
    truncated: boolean
    byKind: Partial<Record<CatalogShadowDifferenceKind, number>>
    byScope: Partial<Record<CatalogShadowScope, number>>
  }
  differences: CatalogShadowDifference[]
  shadowError?: {
    name: string
    message: string
  }
}

export type ShadowCatalogRepositoryOptions = {
  primary: CatalogRepository
  shadow: CatalogRepository
  onReport?: (report: CatalogShadowReport) => void | Promise<void>
  maxDifferences?: number
  now?: () => Date
}

type DifferenceSummary = CatalogShadowReport['summary']

class DifferenceCollector {
  readonly differences: CatalogShadowDifference[] = []
  readonly summary: DifferenceSummary = {
    differenceCount: 0,
    storedDifferenceCount: 0,
    truncated: false,
    byKind: {},
    byScope: {},
  }

  constructor(private readonly limit: number) {}

  add(difference: CatalogShadowDifference): void {
    this.summary.differenceCount += 1
    this.summary.byKind[difference.kind] = (this.summary.byKind[difference.kind] ?? 0) + 1
    this.summary.byScope[difference.scope] = (this.summary.byScope[difference.scope] ?? 0) + 1

    if (this.differences.length < this.limit) this.differences.push(difference)
    else this.summary.truncated = true
    this.summary.storedDifferenceCount = this.differences.length
  }
}

function pointerSegment(value: string | number): string {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(path: string, key: string | number): string {
  return `${path}/${pointerSegment(key)}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function addValueDifference(
  collector: DifferenceCollector,
  scope: CatalogShadowScope,
  recordId: string,
  path: string,
  primaryValue: unknown,
  shadowValue: unknown,
  primaryPresent: boolean,
  shadowPresent: boolean,
): void {
  collector.add({
    scope,
    recordId,
    path: path || '/',
    kind: 'value-mismatch',
    primaryPresent,
    shadowPresent,
    ...(primaryPresent ? { primaryValue } : {}),
    ...(shadowPresent ? { shadowValue } : {}),
  })
}

function compareValue(
  collector: DifferenceCollector,
  scope: CatalogShadowScope,
  recordId: string,
  path: string,
  primaryValue: unknown,
  shadowValue: unknown,
  primaryPresent = true,
  shadowPresent = true,
): void {
  if (!primaryPresent || !shadowPresent) {
    addValueDifference(
      collector,
      scope,
      recordId,
      path,
      primaryValue,
      shadowValue,
      primaryPresent,
      shadowPresent,
    )
    return
  }
  if (Object.is(primaryValue, shadowValue)) return

  if (Array.isArray(primaryValue) && Array.isArray(shadowValue)) {
    const length = Math.max(primaryValue.length, shadowValue.length)
    for (let index = 0; index < length; index += 1) {
      compareValue(
        collector,
        scope,
        recordId,
        childPath(path, index),
        primaryValue[index],
        shadowValue[index],
        index < primaryValue.length,
        index < shadowValue.length,
      )
    }
    return
  }

  if (isObject(primaryValue) && isObject(shadowValue)) {
    const keys = new Set([...Object.keys(primaryValue), ...Object.keys(shadowValue)])
    for (const key of [...keys].sort()) {
      compareValue(
        collector,
        scope,
        recordId,
        childPath(path, key),
        primaryValue[key],
        shadowValue[key],
        Object.hasOwn(primaryValue, key),
        Object.hasOwn(shadowValue, key),
      )
    }
    return
  }

  addValueDifference(
    collector,
    scope,
    recordId,
    path,
    primaryValue,
    shadowValue,
    true,
    true,
  )
}

function compareBundle(
  primary: DataBundle,
  shadow: DataBundle,
  maxDifferences: number,
): DifferenceCollector {
  const collector = new DifferenceCollector(maxDifferences)

  for (const collection of CATALOG_COLLECTIONS) {
    const primaryRecords = primary[collection] as Array<{ id: string }>
    const shadowRecords = shadow[collection] as Array<{ id: string }>
    const primaryById = new Map(primaryRecords.map((record) => [record.id, record]))
    const shadowById = new Map(shadowRecords.map((record) => [record.id, record]))
    const recordIds = new Set([...primaryById.keys(), ...shadowById.keys()])

    for (const recordId of [...recordIds].sort()) {
      const primaryRecord = primaryById.get(recordId)
      const shadowRecord = shadowById.get(recordId)
      if (!primaryRecord) {
        collector.add({
          scope: collection,
          recordId,
          path: '/',
          kind: 'extra-in-shadow',
          primaryPresent: false,
          shadowPresent: true,
          shadowValue: shadowRecord,
        })
      } else if (!shadowRecord) {
        collector.add({
          scope: collection,
          recordId,
          path: '/',
          kind: 'missing-in-shadow',
          primaryPresent: true,
          shadowPresent: false,
          primaryValue: primaryRecord,
        })
      } else {
        compareValue(collector, collection, recordId, '', primaryRecord, shadowRecord)
      }
    }
  }

  return collector
}

function compareRelease(
  primary: CatalogRelease,
  shadow: CatalogRelease,
  maxDifferences: number,
): DifferenceCollector {
  const collector = new DifferenceCollector(maxDifferences)
  compareValue(collector, 'release', primary.id, '', primary, shadow)
  return collector
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}

export class ShadowCatalogRepository implements CatalogRepository {
  readonly mode = 'shadow' as const
  private readonly primary: CatalogRepository
  private readonly shadow: CatalogRepository
  private readonly onReport: ShadowCatalogRepositoryOptions['onReport']
  private readonly maxDifferences: number
  private readonly now: () => Date
  private lastReport: CatalogShadowReport | undefined

  constructor(options: ShadowCatalogRepositoryOptions) {
    this.primary = options.primary
    this.shadow = options.shadow
    this.onReport = options.onReport
    this.maxDifferences = Math.max(0, options.maxDifferences ?? 500)
    this.now = options.now ?? (() => new Date())
  }

  getLastReport(): CatalogShadowReport | undefined {
    return this.lastReport
  }

  async getBundle(): Promise<DataBundle> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.getBundle(),
      this.shadow.getBundle(),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason

    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('getBundle', shadowResult.reason)
      return primaryResult.value
    }

    await this.recordComparison(
      'getBundle',
      compareBundle(primaryResult.value, shadowResult.value, this.maxDifferences),
    )
    return primaryResult.value
  }

  async getRelease(): Promise<CatalogRelease> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.getRelease(),
      this.shadow.getRelease(),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason

    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('getRelease', shadowResult.reason)
      return primaryResult.value
    }

    await this.recordComparison(
      'getRelease',
      compareRelease(primaryResult.value, shadowResult.value, this.maxDifferences),
    )
    return primaryResult.value
  }

  private async recordComparison(
    operation: CatalogShadowOperation,
    collector: DifferenceCollector,
  ): Promise<void> {
    const status = collector.summary.differenceCount === 0 ? 'match' : 'different'
    await this.emit({
      operation,
      checkedAt: this.now().toISOString(),
      status,
      matches: status === 'match',
      primaryMode: this.primary.mode,
      shadowMode: this.shadow.mode,
      summary: collector.summary,
      differences: collector.differences,
    })
  }

  private async recordShadowError(operation: CatalogShadowOperation, error: unknown): Promise<void> {
    await this.emit({
      operation,
      checkedAt: this.now().toISOString(),
      status: 'shadow-error',
      matches: false,
      primaryMode: this.primary.mode,
      shadowMode: this.shadow.mode,
      summary: {
        differenceCount: 0,
        storedDifferenceCount: 0,
        truncated: false,
        byKind: {},
        byScope: {},
      },
      differences: [],
      shadowError: serializeError(error),
    })
  }

  private async emit(report: CatalogShadowReport): Promise<void> {
    this.lastReport = report
    if (!this.onReport) return
    try {
      await this.onReport(report)
    } catch {
      // Shadow diagnostics must never make the primary catalog unavailable.
    }
  }
}

export function createShadowCatalogRepository(
  options: ShadowCatalogRepositoryOptions,
): ShadowCatalogRepository {
  return new ShadowCatalogRepository(options)
}
