import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isCatalogReconciliationComplete,
  loadSourceManifestFiles,
  validateSourceManifests,
  type LoadedSourceManifest,
  type SourceManifestV2,
} from '../../scripts/source-manifest-registry'
import {
  EXPECTED_PILOT_INSTITUTION_IDS,
  INSTITUTION_HOST_ALLOWLISTS,
  SOURCE_CATEGORIES,
} from '../../scripts/validate-source-manifests'

const RESERVED_USTC_ID =
  'uni-university-of-science-and-technology-of-china'

function clonedInputs(): LoadedSourceManifest[] {
  return loadSourceManifestFiles(join(
    process.cwd(),
    'content',
    'source-manifests',
    'pilot',
  )).map((input) => ({
    filePath: input.filePath,
    value: structuredClone(input.value),
  }))
}

function recordOf(input: LoadedSourceManifest): SourceManifestV2 {
  return input.value as SourceManifestV2
}

function findRecord(
  inputs: LoadedSourceManifest[],
  institutionId: string,
): SourceManifestV2 {
  const record = inputs
    .map(recordOf)
    .find((candidate) => candidate.institutionId === institutionId)
  if (!record) throw new Error(`Missing fixture for ${institutionId}`)
  return record
}

describe('pilot source manifests', () => {
  it('validates ten fail-closed V2 pilot manifests and all source categories', () => {
    const records = validateSourceManifests(clonedInputs())

    expect(records).toHaveLength(10)
    expect(records.map((record) => record.institutionId).sort()).toEqual(
      [...EXPECTED_PILOT_INSTITUTION_IDS].sort(),
    )
    for (const record of records) {
      expect(record.version).toBe(2)
      if (record.version !== 2) throw new Error('Expected a V2 pilot manifest')
      expect(record.manifestStatus).toBe('in_progress')
      expect(record.catalogReconciliation.status).toBe('in_progress')
      expect(record.catalogReconciliation.entries.length).toBeGreaterThan(0)
      expect(record.catalogReconciliation.entries.every(
        (entry) => entry.status === 'pending',
      )).toBe(true)
      expect(isCatalogReconciliationComplete(record)).toBe(false)
      expect(record.coverage.map((entry) => entry.sourceCategory).sort()).toEqual(
        [...SOURCE_CATEGORIES].sort(),
      )
    }
  })

  it('uses only HTTPS URLs and institution-scoped official host allowlists', () => {
    const records = validateSourceManifests(clonedInputs())

    for (const record of records) {
      expect(record.version).toBe(2)
      if (record.version !== 2) throw new Error('Expected a V2 pilot manifest')
      const approvedHosts = new Set(
        INSTITUTION_HOST_ALLOWLISTS[
          record.institutionId as keyof typeof INSTITUTION_HOST_ALLOWLISTS
        ],
      )
      for (const source of record.sources) {
        const url = new URL(source.officialUrl)
        expect(url.protocol).toBe('https:')
        expect(approvedHosts.has(url.hostname)).toBe(true)
        for (const host of [
          ...source.allowedHosts,
          ...(source.allowedRedirectHosts ?? []),
        ]) {
          expect(approvedHosts.has(host)).toBe(true)
          expect(record.officialHosts).toContain(host)
        }
      }
    }
  })

  it('keeps source ids globally unique', () => {
    const records = validateSourceManifests(clonedInputs())
    const ids = records.flatMap((record) =>
      record.sources.map((source) => source.id),
    )

    expect(ids).toHaveLength(100)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects an official URL and allowlist moved to an unapproved host', () => {
    const inputs = clonedInputs()
    const record = recordOf(inputs[0]!)
    record.sources[0]!.officialUrl = 'https://attacker.example/admissions'
    record.sources[0]!.allowedHosts = ['attacker.example']

    expect(() => validateSourceManifests(inputs)).toThrow(
      /uses undeclared official host attacker\.example/,
    )
  })

  it('rejects a source id reused across schools', () => {
    const inputs = clonedInputs()
    const first = recordOf(inputs[0]!)
    const second = recordOf(inputs[1]!)
    second.sources[0]!.id = first.sources[0]!.id

    expect(() => validateSourceManifests(inputs)).toThrow(
      /duplicate source id/,
    )
  })

  it('rejects a school that drops any locked source category', () => {
    const inputs = clonedInputs()
    recordOf(inputs[0]!).coverage.pop()

    expect(() => validateSourceManifests(inputs)).toThrow(
      /coverage/,
    )
  })

  it('requires disabled manifests for parser-pending or unavailable sources', () => {
    const inputs = clonedInputs()
    const peking = findRecord(inputs, 'uni-peking-university')
    const unavailableSource = peking.sources.find(
      (source) => source.id === 'pku-application-portal',
    )
    if (!unavailableSource) throw new Error('Missing Peking unavailable source fixture')
    unavailableSource.enabled = true

    expect(() => validateSourceManifests(inputs)).toThrow(
      /must be disabled while coverage is source_unavailable/,
    )
  })

  it('requires a confirmed official admissions home and application entrance', () => {
    const records = validateSourceManifests(clonedInputs())
    const knownStatuses = new Set([
      'registered',
      'parser_pending',
      'source_unavailable',
    ])

    for (const record of records) {
      for (const category of [
        'international_admissions_home',
        'application_portal',
      ] as const) {
        const coverage = record.coverage.find(
          (entry) => entry.sourceCategory === category,
        )
        expect(coverage).toBeDefined()
        expect(knownStatuses.has(coverage!.status)).toBe(true)
        expect(coverage!.sourceIds?.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every pilot institution in the expanded catalog', () => {
    const records = validateSourceManifests(clonedInputs())
    const planned = records.filter(
      (record) => record.catalogStatus === 'planned_addition',
    )
    const universities = JSON.parse(
      readFileSync(
        join(process.cwd(), 'content', 'data', 'universities.json'),
        'utf8',
      ),
    ) as Array<{ id: string }>

    expect(planned).toHaveLength(0)
    expect(universities.length).toBeGreaterThanOrEqual(120)
    expect(universities.some((university) => university.id === RESERVED_USTC_ID)).toBe(
      true,
    )

    const inputs = clonedInputs()
    findRecord(inputs, RESERVED_USTC_ID).catalogStatus = 'planned_addition'
    expect(() => validateSourceManifests(inputs)).toThrow(
      /planned institution already exists/,
    )
  })
})
