import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import medicineFastpack from '../../quality/official-gap-wave-2026-07-30/wave4-depth-medicine-fastpack.json'
import northEast from '../../quality/official-gap-wave-2026-07-30/wave4-depth-north-east.json'
import secondFastpack from '../../quality/official-gap-wave-2026-07-30/wave4-depth-second-fastpack.json'
import southWest from '../../quality/official-gap-wave-2026-07-30/wave4-depth-south-west.json'
import specialist from '../../quality/official-gap-wave-2026-07-30/wave4-depth-specialist.json'
import { bundleSchema } from '../../src/lib/data/schema'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { DataBundle } from '../../src/lib/data/types'

const TODAY = '2026-07-30'

type CandidateCycle = {
  applicationDeadline?: string | null
  displayAsOpen?: boolean
}

type Wave4Pack = {
  programCandidates: Array<{
    cycles?: CandidateCycle[]
  }>
}

function loadDataBundle(): DataBundle {
  return bundleSchema.parse({
    admissionCycles,
    cities,
    programs,
    scholarships,
    sources,
    universities,
  })
}

function isTrilingual(value: Partial<Record<'en' | 'zh' | 'ru', string>>): boolean {
  return (['en', 'zh', 'ru'] as const).every((locale) =>
    Boolean(value[locale]?.trim()))
}

const data = loadDataBundle()
const published = selectPublishedData(data, TODAY)
const wavePrograms = data.programs.filter((program) =>
  program.id.startsWith('prog-gap-wave4-'))
const wavePacks = [
  medicineFastpack,
  northEast,
  secondFastpack,
  southWest,
  specialist,
] as unknown as Wave4Pack[]

describe('official coverage wave 4 on 2026-07-30', () => {
  it('deepens the thirteen target universities to their verified public counts', () => {
    const expected = new Map([
      ['beijing-forestry-university', 4],
      ['chengdu-university-of-technology', 4],
      ['chongqing-medical-university', 4],
      ['university-of-jinan', 4],
      ['qingdao-university', 4],
      ['shanxi-university-of-chinese-medicine', 4],
      ['tianjin-normal-university', 4],
      ['wenzhou-university', 4],
      ['southwest-petroleum-university', 4],
      ['zhejiang-normal-university', 4],
      ['heilongjiang-university', 3],
      ['liaoning-university', 3],
      ['shenyang-pharmaceutical-university', 3],
    ])

    for (const [slug, count] of expected) {
      const university = published.universities.find((item) => item.slug === slug)
      expect(university, slug).toBeDefined()
      expect(
        published.programs.filter((item) => item.universityId === university?.id),
        slug,
      ).toHaveLength(count)
    }
  })

  it('keeps every wave-4 program trilingual with resolvable evidence', () => {
    const sourceIds = new Set(data.sources.map((source) => source.id))
    expect(wavePrograms.length).toBeGreaterThan(0)

    for (const program of wavePrograms) {
      expect(isTrilingual(program.name), program.id).toBe(true)
      expect(program.sourceIds.length, program.id).toBeGreaterThan(0)
      for (const sourceId of program.sourceIds) {
        expect(sourceIds.has(sourceId), `${program.id}:${sourceId}`).toBe(true)
      }
    }
  })

  it('never marks an expired wave-4 candidate cycle as open', () => {
    const cycles = wavePacks.flatMap((pack) =>
      pack.programCandidates.flatMap((program) => program.cycles ?? []))
    const expiredCycles = cycles.filter((cycle) =>
      cycle.applicationDeadline && cycle.applicationDeadline < TODAY)

    expect(expiredCycles.length).toBeGreaterThan(0)
    expect(expiredCycles.filter((cycle) => cycle.displayAsOpen)).toEqual([])
  })

  it('preserves QDU program bindings without over-scoping the BJFU scholarship', () => {
    const programById = new Map(data.programs.map((program) => [program.id, program]))
    const qdu = data.scholarships.find((item) =>
      item.id === 'sch-gap-wave4-depth-qdu-csc-silk-road-2026')
    expect(qdu).toBeDefined()
    expect(qdu?.programIds.length).toBeGreaterThan(0)
    for (const programId of qdu?.programIds ?? []) {
      expect(programById.get(programId)?.universityId, programId)
        .toBe('uni-qingdao-university')
    }

    const bjfu = data.scholarships.find((item) =>
      item.id === 'sch-gap-wave4-depth-bjfu-beijing-government-scholarship-2026')
    const bjfuCandidate = specialist.scholarshipCandidates.find((item) =>
      item.candidateId === 'wave4-depth-bjfu-beijing-government-scholarship-2026')
    const providerId = bjfu?.universityIds[0]
    expect(bjfu).toBeDefined()
    expect(providerId).toBe('uni-beijing-forestry-university')
    expect(bjfuCandidate?.applicableLevels).toContain('bachelor')
    expect(bjfu?.programIds).toEqual([])
  })

  it('classifies the Chengdu municipal Belt and Road scholarship as city-provided', () => {
    const scholarship = data.scholarships.find((item) =>
      item.id === 'sch-gap-wave4-sch-swpu-chengdu-belt-and-road')
    expect(scholarship).toBeDefined()
    expect(scholarship?.providerType).toBe('city')
  })
})
