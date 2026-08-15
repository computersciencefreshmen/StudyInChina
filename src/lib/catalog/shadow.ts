import type { DataBundle } from '@/lib/data/types'
import {
  CATALOG_COLLECTIONS,
  CatalogRepositoryError,
  type CatalogBackendMode,
  type CatalogCollection,
  type CatalogInstitutionListPage,
  type CatalogInstitutionListQuery,
  type CatalogProgramListPage,
  type CatalogProgramListQuery,
  type CatalogRelease,
  type CatalogRepository,
  type CatalogScholarshipListPage,
  type CatalogScholarshipListQuery,
} from './types'
import {
  decodeShadowListCursor,
  encodeShadowListCursor,
} from './list-cursor'

export type CatalogShadowOperation =
  | 'getBundle'
  | 'getRelease'
  | 'comparePrograms'
  | 'listInstitutions'
  | 'listPrograms'
  | 'listScholarships'
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

function comparableListPage(
  page: CatalogInstitutionListPage | CatalogProgramListPage | CatalogScholarshipListPage,
): unknown {
  const facets = Object.fromEntries(
    Object.entries(page.facets).map(([name, values]) => [
      name,
      [...values].sort((left, right) => left.value.localeCompare(right.value)),
    ]),
  )
  return {
    items: page.items,
    total: page.total,
    facets,
  }
}

function compareListPage(
  scope: 'universities' | 'programs' | 'scholarships',
  primary: CatalogInstitutionListPage | CatalogProgramListPage | CatalogScholarshipListPage,
  shadow: CatalogInstitutionListPage | CatalogProgramListPage | CatalogScholarshipListPage,
  maxDifferences: number,
): DifferenceCollector {
  const collector = new DifferenceCollector(maxDifferences)
  compareValue(
    collector,
    scope,
    'page',
    '',
    comparableListPage(primary),
    comparableListPage(shadow),
  )
  return collector
}

function comparableProjection(value: unknown): unknown {
  return isObject(value) && Object.hasOwn(value, 'data') ? value.data : value
}

function compareProgramProjection(
  primary: unknown,
  shadow: unknown,
  maxDifferences: number,
): DifferenceCollector {
  const collector = new DifferenceCollector(maxDifferences)
  compareValue(
    collector,
    'programs',
    'compare',
    '',
    comparableProjection(primary),
    comparableProjection(shadow),
  )
  return collector
}

function cursorInputs(
  cursor: string | undefined,
  resource: 'institutions' | 'programs' | 'scholarships',
): { primary?: string; shadow?: string } {
  if (!cursor) return {}
  try {
    const decoded = decodeShadowListCursor(cursor, resource)
    return {
      ...(decoded.primary ? { primary: decoded.primary } : {}),
      ...(decoded.shadow ? { shadow: decoded.shadow } : {}),
    }
  } catch {
    // URLs created before shadow mode remain usable by the primary backend.
    return { primary: cursor }
  }
}

function combinedCursor(
  resource: 'institutions' | 'programs' | 'scholarships',
  primary: string | null,
  shadow: string | null,
): string | null {
  return primary ? encodeShadowListCursor(resource, primary, shadow) : null
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

  async getOperationalRelease(): Promise<CatalogRelease> {
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.getRelease(),
      this.shadow.getOperationalRelease
        ? this.shadow.getOperationalRelease()
        : this.shadow.getRelease(),
    ])
    if (primaryResult.status === 'fulfilled' && shadowResult.status === 'fulfilled') {
      await this.recordComparison(
        'getRelease',
        compareRelease(primaryResult.value, shadowResult.value, this.maxDifferences),
      )
    } else if (shadowResult.status === 'rejected') {
      await this.recordShadowError('getRelease', shadowResult.reason)
      if (primaryResult.status === 'rejected') throw primaryResult.reason
      return { ...primaryResult.value, catalogBackend: 'shadow' }
    }
    return { ...shadowResult.value, catalogBackend: 'shadow' }
  }

  async comparePrograms(ids: string[]): Promise<unknown> {
    const compare = (repository: CatalogRepository, role: 'primary' | 'shadow') => (
      repository.comparePrograms
        ? Promise.resolve().then(() => repository.comparePrograms!(ids))
        : Promise.reject(new CatalogRepositoryError(
            'COMPARE_UNAVAILABLE',
            `The ${role} catalog does not support lightweight program comparison.`,
          ))
    )
    const [primaryResult, shadowResult] = await Promise.allSettled([
      compare(this.primary, 'primary'),
      compare(this.shadow, 'shadow'),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason
    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('comparePrograms', shadowResult.reason)
      return primaryResult.value
    }
    await this.recordComparison(
      'comparePrograms',
      compareProgramProjection(primaryResult.value, shadowResult.value, this.maxDifferences),
    )
    return primaryResult.value
  }

  async listInstitutions(
    query: CatalogInstitutionListQuery = {},
  ): Promise<CatalogInstitutionListPage> {
    const cursors = cursorInputs(query.cursor, 'institutions')
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.listInstitutions({ ...query, cursor: cursors.primary }),
      this.shadow.listInstitutions({ ...query, cursor: cursors.shadow }),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason

    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('listInstitutions', shadowResult.reason)
      return {
        ...primaryResult.value,
        nextCursor: combinedCursor('institutions', primaryResult.value.nextCursor, null),
      }
    }

    await this.recordComparison(
      'listInstitutions',
      compareListPage('universities', primaryResult.value, shadowResult.value, this.maxDifferences),
    )
    return {
      ...primaryResult.value,
      nextCursor: combinedCursor(
        'institutions',
        primaryResult.value.nextCursor,
        shadowResult.value.nextCursor,
      ),
    }
  }


  async listPrograms(
    query: CatalogProgramListQuery = {},
  ): Promise<CatalogProgramListPage> {
    const cursors = cursorInputs(query.cursor, 'programs')
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.listPrograms({ ...query, cursor: cursors.primary }),
      this.shadow.listPrograms({ ...query, cursor: cursors.shadow }),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason

    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('listPrograms', shadowResult.reason)
      return {
        ...primaryResult.value,
        nextCursor: combinedCursor('programs', primaryResult.value.nextCursor, null),
      }
    }

    await this.recordComparison(
      'listPrograms',
      compareListPage('programs', primaryResult.value, shadowResult.value, this.maxDifferences),
    )
    return {
      ...primaryResult.value,
      nextCursor: combinedCursor(
        'programs',
        primaryResult.value.nextCursor,
        shadowResult.value.nextCursor,
      ),
    }
  }

  async listScholarships(
    query: CatalogScholarshipListQuery = {},
  ): Promise<CatalogScholarshipListPage> {
    const cursors = cursorInputs(query.cursor, 'scholarships')
    const [primaryResult, shadowResult] = await Promise.allSettled([
      this.primary.listScholarships({ ...query, cursor: cursors.primary }),
      this.shadow.listScholarships({ ...query, cursor: cursors.shadow }),
    ])
    if (primaryResult.status === 'rejected') throw primaryResult.reason

    if (shadowResult.status === 'rejected') {
      await this.recordShadowError('listScholarships', shadowResult.reason)
      return {
        ...primaryResult.value,
        nextCursor: combinedCursor('scholarships', primaryResult.value.nextCursor, null),
      }
    }

    await this.recordComparison(
      'listScholarships',
      compareListPage(
        'scholarships',
        primaryResult.value,
        shadowResult.value,
        this.maxDifferences,
      ),
    )
    return {
      ...primaryResult.value,
      nextCursor: combinedCursor(
        'scholarships',
        primaryResult.value.nextCursor,
        shadowResult.value.nextCursor,
      ),
    }
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
