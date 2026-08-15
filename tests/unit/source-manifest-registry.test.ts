import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isCatalogReconciliationComplete,
  loadSourceManifestFiles,
  validateSourceManifests,
  type LoadedSourceManifest,
  type SourceManifestV2,
} from '../../scripts/source-manifest-registry'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function formalInputs(): LoadedSourceManifest[] {
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

function v2Fixture(): SourceManifestV2 {
  const formal = structuredClone(formalInputs()[0]!.value) as SourceManifestV2
  return {
    ...formal,
    manifestStatus: 'in_progress',
    catalogReconciliation: {
      scope: 'full_official_catalog',
      status: 'in_progress',
      entries: [{
        sourceId: formal.sources[0]!.id,
        officialKey: 'official-program-001',
        officialName: 'Official international programme',
        entityType: 'program',
        status: 'pending',
      }],
    },
  }
}

describe('recursive source manifest registry', () => {
  it('discovers nested school manifests and skips target registries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'source-manifest-registry-'))
    temporaryDirectories.push(directory)
    const nested = join(directory, 'cohort', 'schools')
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      join(directory, 'cohort', 'targets.v1.json'),
      JSON.stringify({ format: 'studyinchina.institution-target-registry', targets: [] }),
    )
    writeFileSync(
      join(nested, 'school.json'),
      JSON.stringify(formalInputs()[0]!.value),
    )

    const files = loadSourceManifestFiles(directory)

    expect(files).toHaveLength(1)
    expect(files[0]!.filePath.endsWith('school.json')).toBe(true)
  })

  it('does not require the old exact ten-school pilot set', () => {
    const records = validateSourceManifests(formalInputs().slice(0, 3))

    expect(records).toHaveLength(3)
    expect(records.every((record) => (
      record.version === 2 && record.manifestStatus === 'in_progress'
    ))).toBe(true)
    expect(records.every((record) => !isCatalogReconciliationComplete(record))).toBe(true)
  })

  it('still rejects institution and source identities reused across manifests', () => {
    const inputs = formalInputs().slice(0, 2)
    const first = inputs[0]!.value as SourceManifestV2
    const second = inputs[1]!.value as SourceManifestV2
    second.institutionId = first.institutionId
    for (const source of second.sources) source.institutionId = first.institutionId

    expect(() => validateSourceManifests(inputs)).toThrow(/duplicate institutionId/)
  })

  it('requires explicit, non-pending reconciliation before V2 is complete', () => {
    const incomplete = v2Fixture()
    incomplete.manifestStatus = 'complete'
    incomplete.catalogReconciliation.status = 'complete'

    expect(() => validateSourceManifests([{
      filePath: 'v2-incomplete.json',
      value: incomplete,
    }])).toThrow(/complete catalog reconciliation cannot contain pending entries/)

    const complete = v2Fixture()
    complete.manifestStatus = 'complete'
    complete.catalogReconciliation.status = 'complete'
    complete.catalogReconciliation.entries[0] = {
      ...complete.catalogReconciliation.entries[0]!,
      status: 'published',
      recordId: 'prog-official-001',
    }
    complete.coverage = complete.coverage.map((entry) => (
      entry.status === 'discovery_pending'
        ? { ...entry, status: 'officially_not_provided' as const }
        : entry
    ))

    const [validated] = validateSourceManifests([{
      filePath: 'v2-complete.json',
      value: complete,
    }])

    expect(validated).toBeDefined()
    expect(isCatalogReconciliationComplete(validated!)).toBe(true)

    const limited = structuredClone(complete)
    limited.catalogReconciliation.scope = 'limited_official_catalog'
    const [validatedLimited] = validateSourceManifests([{
      filePath: 'v2-limited-complete.json',
      value: limited,
    }])
    expect(isCatalogReconciliationComplete(validatedLimited!)).toBe(true)

    const representative = structuredClone(complete)
    representative.catalogReconciliation.scope = 'representative_international_programs'

    expect(isCatalogReconciliationComplete(representative)).toBe(false)
    expect(() => validateSourceManifests([{
      filePath: 'v2-representative-complete.json',
      value: representative,
    }])).toThrow(
      /representative_international_programs cannot claim complete catalog reconciliation/,
    )
  })
})
