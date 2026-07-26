import { describe, expect, it } from 'vitest'

import {
  officialEntityInputDocuments,
} from '../../scripts/ingestion/official-entity-input-adapters'
import {
  buildOfficialEntityMaterialization,
} from '../../scripts/ingestion/materialize-official-entities'
import {
  TSINGHUA_CATALOG_QUERY_URL,
  TSINGHUA_MASTER_CATALOG_URL,
} from '../../scripts/ingestion/tsinghua-catalog-harvester'
import {
  adaptTsinghuaProgramDetails,
  summarizeTsinghuaDetails,
} from '../../scripts/ingestion/tsinghua-program-detail-adapter'
import {
  adaptEnrichedTsinghuaCatalog,
  looksLikeEnrichedTsinghuaCatalog,
} from '../../scripts/ingestion/tsinghua-official-entity-adapter'

type JsonRecord = Record<string, unknown>

const checkedAt = '2026-07-26T00:00:00.000Z'

function enrichedCatalog(): JsonRecord {
  const details = adaptTsinghuaProgramDetails({
    department: {
      zsyxsdm: '024',
      zsyxsmc: '计算机科学与技术系',
      zsyxsywmc: 'Department of Computer Science and Technology',
    },
    major: {
      zszydm: '081200',
      zszymc: '计算机科学与技术',
      zszyywmc: 'Computer Science and Technology',
      exportZsmlYxZyYjfxs: [
        {
          yjfxdm: '01',
          yjfxmc: '人工智能',
          yjfxywmc: 'Artificial Intelligence',
          xxfsmc: '全日制',
          xxfsywmc: 'Full-time',
          sfqywxmzw: '全英文项目',
          sfqywxmyw: 'English Program',
          zwhyyq: '无需中文成绩',
          ywhyyq: 'No Chinese-language score required',
          zwyyyq: '雅思 6.5',
          ywyyyq: 'IELTS 6.5',
          yjfxbz: '仅接受国际学生个人申请',
          bmjssjzw: '2026-05-31 17:00:00',
          bmjssjyw: '2026-05-31 17:00:00',
        },
        {
          yjfxdm: '02',
          yjfxmc: '软件系统',
          yjfxywmc: 'Software Systems',
          xxfsmc: '非全日制',
          xxfsywmc: 'Part-time',
          bmjssjzw: '2026-05-31 17:00:00',
          bmjssjyw: '2026-05-31 17:00:00',
        },
      ],
    },
    academicYear: '2026',
    catalogUrl: TSINGHUA_MASTER_CATALOG_URL,
    checkedAt,
    minimumPublishableDeadline: '2026-08-26',
  })
  const entity = {
    entityKey: 'tsinghua:master:024:081200',
    entityType: 'program',
    institutionId: 'uni-tsinghua-university',
    programType: 'degree',
    degreeLevel: 'master',
    majorCode: '081200',
    nameEn: 'Computer Science and Technology',
    nameZh: '计算机科学与技术',
    department: {
      code: '024',
      nameEn: 'Department of Computer Science and Technology',
      nameZh: '计算机科学与技术系',
    },
    degreeAwardType: 'academic',
    academicYear: '2026',
    researchDirectionCount: 2,
    officialUrl: TSINGHUA_MASTER_CATALOG_URL,
    officialEndpoint: TSINGHUA_CATALOG_QUERY_URL,
    sourceCheckedAt: checkedAt,
    evidence: {
      locator: 'json:datas.zsmlYxs[zsyxsdm=024].exportZsmlYxZys[zszydm=081200]',
      quote: '024 计算机科学与技术系 — 081200 Computer Science and Technology',
      officialUrl: TSINGHUA_MASTER_CATALOG_URL,
      checkedAt,
    },
    details,
  }
  return {
    catalogId: '2807549e-b29c-43a9-9be9-755383c88eb5',
    catalogUrl: TSINGHUA_MASTER_CATALOG_URL,
    checkedAt,
    degreeLevel: 'master',
    admissionType: '1',
    sourceMode: 'fixture',
    requestDelayMs: 5_000,
    departments: [entity.department],
    requestsPlanned: 1,
    minimumPublishableDeadline: '2026-08-26',
    entities: [entity],
    detailCoverage: summarizeTsinghuaDetails([entity]),
  }
}

describe('Tsinghua enriched official entity adapter', () => {
  it('materializes bilingual names, mixed attendance, and nullable track languages', () => {
    const input = enrichedCatalog()
    expect(looksLikeEnrichedTsinghuaCatalog(input)).toBe(true)

    const adapted = adaptEnrichedTsinghuaCatalog(input)
    const entity = (adapted.entities as JsonRecord[])[0]!
    const directions = entity.researchDirections as JsonRecord[]

    expect(entity).toMatchObject({
      entityKey: 'tsinghua:master:024:081200',
      nameZh: '计算机科学与技术',
      nameEn: 'Computer Science and Technology',
      attendanceMode: 'hybrid',
    })
    expect(entity).not.toHaveProperty('instructionLanguages')
    expect(directions).toHaveLength(2)
    expect(directions[0]).toMatchObject({
      code: '01',
      nameZh: '人工智能',
      nameEn: 'Artificial Intelligence',
      attendanceMode: 'full_time',
      instructionLanguages: ['English'],
      chineseLanguageRequirement: {
        zh: '无需中文成绩',
        en: 'No Chinese-language score required',
      },
      englishLanguageRequirement: {
        zh: '雅思 6.5',
        en: 'IELTS 6.5',
      },
      applicationRemarks: '仅接受国际学生个人申请',
    })
    expect(directions[1]).toMatchObject({
      code: '02',
      attendanceMode: 'part_time',
      instructionLanguages: null,
      chineseLanguageRequirement: null,
      englishLanguageRequirement: null,
      applicationRemarks: null,
    })
    expect((entity.evidence as JsonRecord[]).some((item) => (
      (item.fieldPaths as string[]).includes('research_directions')
    ))).toBe(true)

    expect(officialEntityInputDocuments(input)).toEqual([adapted])
    const materialized = buildOfficialEntityMaterialization(input)
    expect(materialized.manifest).toMatchObject({
      prerequisiteInstitutionIds: ['uni-tsinghua-university'],
      counts: {
        programs: 1,
        scholarships: 0,
        localizedContent: 2,
      },
    })
    expect(materialized.sql).toContain("'research_directions'")
    expect(materialized.sql).toContain("'attendance_mode'")
    expect(materialized.sql).toContain('Artificial Intelligence')
  })

  it('omits oversized research directions while retaining aggregate program facts', () => {
    const input = enrichedCatalog()
    const entity = (input.entities as JsonRecord[])[0]!
    const details = entity.details as JsonRecord
    const baseTrack = (details.tracks as JsonRecord[])[0]!
    details.tracks = Array.from({ length: 30 }, (_, index) => {
      const track = structuredClone(baseTrack)
      track.code = String(index + 1).padStart(3, '0')
      const name = track.name as JsonRecord
      name.value = {
        zh: `人工智能研究方向${index + 1}${'扩展说明'.repeat(20)}`,
        en: `Artificial Intelligence Research Direction ${index + 1} ${'Extended description '.repeat(20)}`,
      }
      return track
    })
    entity.researchDirectionCount = 30
    input.detailCoverage = summarizeTsinghuaDetails(
      input.entities as Parameters<typeof summarizeTsinghuaDetails>[0],
    )

    const adapted = adaptEnrichedTsinghuaCatalog(input)
    const adaptedEntity = (adapted.entities as JsonRecord[])[0]!
    const evidence = adaptedEntity.evidence as JsonRecord[]

    expect(adaptedEntity).toMatchObject({
      attendanceMode: 'full_time',
      instructionLanguages: ['English'],
    })
    expect(adaptedEntity).not.toHaveProperty('researchDirections')
    expect(evidence.some((item) => (
      (item.fieldPaths as string[]).includes('attendance_mode')
    ))).toBe(true)
    expect(evidence.some((item) => (
      (item.fieldPaths as string[]).includes('instruction_languages')
    ))).toBe(true)
    expect(evidence.some((item) => (
      (item.fieldPaths as string[]).includes('research_directions')
    ))).toBe(false)
  })
  it('fails closed when conflict or stale metadata carries a leaked value', () => {
    const input = enrichedCatalog()
    const entity = (input.entities as JsonRecord[])[0]!
    const details = entity.details as JsonRecord
    const tracks = details.tracks as JsonRecord[]
    const instructionLanguages = tracks[1]!.instructionLanguages as JsonRecord
    instructionLanguages.value = ['English']
    ;(instructionLanguages.fieldMeta as JsonRecord).status = 'conflict'

    expect(() => adaptEnrichedTsinghuaCatalog(input))
      .toThrow(/status conflict must have a null value/u)
  })

  it('rejects unregistered hosts and unreconciled coverage', () => {
    const wrongHost = enrichedCatalog()
    wrongHost.catalogUrl = 'https://example.com/catalog'
    expect(() => adaptEnrichedTsinghuaCatalog(wrongHost))
      .toThrow(/exact https:\/\/yzbm\.tsinghua\.edu\.cn host/u)

    const wrongCoverage = enrichedCatalog()
    ;(wrongCoverage.detailCoverage as JsonRecord).tracks = 99
    expect(() => adaptEnrichedTsinghuaCatalog(wrongCoverage))
      .toThrow(/does not reconcile/u)
  })
})
