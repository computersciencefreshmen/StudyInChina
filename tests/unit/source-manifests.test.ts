import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXPECTED_PILOT_INSTITUTION_IDS,
  INSTITUTION_HOST_ALLOWLISTS,
  SOURCE_CATEGORIES,
  loadPilotSourceManifestFiles,
  validatePilotSourceManifests,
  type LoadedPilotSourceManifest,
  type PilotSourceManifest,
} from '../../scripts/validate-source-manifests'

const RESERVED_USTC_ID =
  'uni-university-of-science-and-technology-of-china'

function clonedInputs(): LoadedPilotSourceManifest[] {
  return loadPilotSourceManifestFiles().map((input) => ({
    filePath: input.filePath,
    value: structuredClone(input.value),
  }))
}

function recordOf(input: LoadedPilotSourceManifest): PilotSourceManifest {
  return input.value as PilotSourceManifest
}

function findRecord(
  inputs: LoadedPilotSourceManifest[],
  institutionId: string,
): PilotSourceManifest {
  const record = inputs
    .map(recordOf)
    .find((candidate) => candidate.institutionId === institutionId)
  if (!record) throw new Error(`Missing fixture for ${institutionId}`)
  return record
}

describe('pilot source manifests', () => {
  it('validates the exact ten-school pilot and all sixteen coverage categories', () => {
    const records = validatePilotSourceManifests(clonedInputs())

    expect(records).toHaveLength(10)
    expect(records.map((record) => record.institutionId).sort()).toEqual(
      [...EXPECTED_PILOT_INSTITUTION_IDS].sort(),
    )
    for (const record of records) {
      expect(record.coverage.map((entry) => entry.sourceCategory).sort()).toEqual(
        [...SOURCE_CATEGORIES].sort(),
      )
    }
  })

  it('uses only HTTPS URLs and institution-scoped official host allowlists', () => {
    const records = validatePilotSourceManifests(clonedInputs())

    for (const record of records) {
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
        }
      }
    }
  })

  it('keeps source ids globally unique', () => {
    const records = validatePilotSourceManifests(clonedInputs())
    const ids = records.flatMap((record) =>
      record.sources.map((source) => source.id),
    )

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects an official URL and allowlist moved to an unapproved host', () => {
    const inputs = clonedInputs()
    const record = recordOf(inputs[0]!)
    record.sources[0]!.officialUrl = 'https://attacker.example/admissions'
    record.sources[0]!.allowedHosts = ['attacker.example']

    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /uses unapproved host attacker\.example/,
    )
  })

  it('rejects a source id reused across schools', () => {
    const inputs = clonedInputs()
    const first = recordOf(inputs[0]!)
    const second = recordOf(inputs[1]!)
    second.sources[0]!.id = first.sources[0]!.id

    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /duplicate source id/,
    )
  })

  it('rejects a school that drops any locked source category', () => {
    const inputs = clonedInputs()
    recordOf(inputs[0]!).coverage.pop()

    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /coverage: Too small|coverage: Array must contain exactly/,
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

    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /must be disabled while coverage is source_unavailable/,
    )
  })

  it('requires a confirmed official admissions home and application entrance', () => {
    const records = validatePilotSourceManifests(clonedInputs())
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

  it('locks USTC as the sole planned addition outside the existing 40 ids', () => {
    const records = validatePilotSourceManifests(clonedInputs())
    const planned = records.filter(
      (record) => record.catalogStatus === 'planned_addition',
    )
    const universities = JSON.parse(
      readFileSync(
        join(process.cwd(), 'content', 'data', 'universities.json'),
        'utf8',
      ),
    ) as Array<{ id: string }>

    expect(planned.map((record) => record.institutionId)).toEqual([
      RESERVED_USTC_ID,
    ])
    expect(universities).toHaveLength(40)
    expect(universities.some((university) => university.id === RESERVED_USTC_ID)).toBe(
      false,
    )

    const inputs = clonedInputs()
    findRecord(inputs, RESERVED_USTC_ID).catalogStatus = 'existing'
    expect(() => validatePilotSourceManifests(inputs)).toThrow(
      /catalogStatus must be planned_addition/,
    )
  })
})
