import { describe, expect, it } from 'vitest'
import {
  adaptTsinghuaProgramDetails,
  enrichTsinghuaCatalogHarvest,
} from '../../scripts/ingestion/tsinghua-program-detail-adapter'

const catalogUrl =
  'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/2807549e-b29c-43a9-9be9-755383c88eb5/1'
const checkedAt = '2026-07-26T10:00:00.000Z'

const department = {
  zsyxsdm: '024',
  zsyxsmc: '计算机科学与技术系',
  zsyxsywmc: 'Department of Computer Science &amp; Technology',
  yxbz: '电话：+86-10-62700000',
  yxywbz: 'Tel: +86-10-62700000',
}

function major(deadline = '2026-03-01 17:00:00') {
  return {
    zszydm: '081200',
    zszymc: '计算机科学与技术',
    zszyywmc: 'Computer Science &amp; Technology',
    zybz: '项目中文备注',
    zyywbz: 'Program remarks',
    exportZsmlYxZyYjfxs: [
      {
        yjfxdm: '01',
        yjfxmc: '先进计算英文硕士项目',
        yjfxywmc: 'Master in Advanced Computing (English Program)',
        xxfsmc: '全日制',
        xxfsywmc: 'Full-time',
        sfqywxmzw: '本项目为全英文授课项目。',
        sfqywxmyw: 'This program takes English as the medium of instruction.',
        zwhyyq: '汉语水平要求：HSK四级195分。',
        ywhyyq: 'Chinese Proficiency Requirement: HSK 4, 195.',
        zwyyyq: '英语要求：IELTS 6.5或TOEFL 85。',
        ywyyyq: 'English Requirement: IELTS 6.5 or TOEFL 85.',
        yjfxbz: 'Portfolio is mandatory.',
        bmjssjzw: `报名截止时间：${deadline}`,
        bmjssjyw: `Application Deadline:${deadline}`,
        sflslpxmzw: '本项目为联合项目。',
        sflslpxmyw: 'This program is the joint program.',
      },
    ],
  }
}

describe('Tsinghua program detail adapter', () => {
  it('extracts official bilingual track details and quarantines an expired deadline', () => {
    const details = adaptTsinghuaProgramDetails({
      department,
      major: major(),
      academicYear: '2026',
      catalogUrl,
      checkedAt,
      minimumPublishableDeadline: '2026-08-26',
    })

    expect(details.localizations).toMatchObject({
      'zh-CN': { value: '计算机科学与技术', fieldMeta: { status: 'known' } },
      en: { value: 'Computer Science & Technology', fieldMeta: { status: 'known' } },
    })
    expect(details.departmentContact.value).toEqual({
      'zh-CN': '电话：+86-10-62700000',
      en: 'Tel: +86-10-62700000',
    })
    expect(details.tracks).toHaveLength(1)
    expect(details.tracks[0]).toMatchObject({
      code: '01',
      name: {
        value: {
          'zh-CN': '先进计算英文硕士项目',
          en: 'Master in Advanced Computing (English Program)',
        },
      },
      attendanceMode: { value: 'full_time', fieldMeta: { status: 'known' } },
      instructionLanguages: { value: ['English'], fieldMeta: { status: 'known' } },
      jointProgram: { value: true, fieldMeta: { status: 'known' } },
      applicationDeadline: { value: null, fieldMeta: { status: 'stale' } },
    })
    expect(details.tracks[0]!.applicationDeadline.fieldMeta).toMatchObject({
      officialUrl: catalogUrl,
      checkedAt,
      locator:
        'json:datas.zsmlYxs[zsyxsdm=024].exportZsmlYxZys[zszydm=081200]'
        + '.exportZsmlYxZyYjfxs[yjfxdm=01].{bmjssjzw,bmjssjyw}',
    })
    expect(details.tracks[0]!.applicationDeadline.fieldMeta.quote).toContain(
      '2026-03-01 17:00:00',
    )
    expect(details.publishableAdmissionCycles).toEqual([])
    expect(details.tuition).toMatchObject({
      value: null,
      fieldMeta: { status: 'officially_not_announced' },
    })
  })

  it('publishes only future official deadlines and leaves intake and tuition unknown', () => {
    const details = adaptTsinghuaProgramDetails({
      department,
      major: major('2026-09-30 17:00:00'),
      academicYear: '2027',
      catalogUrl,
      checkedAt,
      minimumPublishableDeadline: '2026-08-26',
    })

    expect(details.tracks[0]!.applicationDeadline).toMatchObject({
      value: '2026-09-30T17:00:00+08:00',
      fieldMeta: { status: 'known' },
    })
    expect(details.publishableAdmissionCycles).toHaveLength(1)
    expect(details.publishableAdmissionCycles[0]).toMatchObject({
      academicYear: { value: '2027', fieldMeta: { status: 'known' } },
      intakeSeason: { value: null, fieldMeta: { status: 'officially_not_announced' } },
      applicationDeadline: {
        value: '2026-09-30T17:00:00+08:00',
        fieldMeta: { status: 'known' },
      },
      applicableTrackCodes: ['01'],
      tuition: { value: null, fieldMeta: { status: 'officially_not_announced' } },
    })
  })

  it('does not publish conflicting bilingual deadline values', () => {
    const input = major('2026-09-30 17:00:00')
    input.exportZsmlYxZyYjfxs[0]!.bmjssjyw =
      'Application Deadline:2026-10-01 17:00:00'
    const details = adaptTsinghuaProgramDetails({
      department,
      major: input,
      academicYear: '2027',
      catalogUrl,
      checkedAt,
    })

    expect(details.tracks[0]!.applicationDeadline).toMatchObject({
      value: null,
      fieldMeta: { status: 'conflict' },
    })
    expect(details.publishableAdmissionCycles).toEqual([])
  })

  it('enriches an existing identity harvest from its exact official source bundle', () => {
    const responseBody = {
      code: 200,
      datas: {
        zsnd: '2026',
        zsmlYxs: [{
          ...department,
          exportZsmlYxZys: [major()],
        }],
      },
    }
    const harvest = {
      catalogId: '2807549e-b29c-43a9-9be9-755383c88eb5',
      catalogUrl,
      checkedAt,
      entities: [{
        entityKey: 'tsinghua:master:024:081200',
        majorCode: '081200',
        department: { code: '024' },
      }],
    }
    const sourceBundle = {
      format: 'studyinchina.tsinghua-source-bundle',
      formatVersion: 1,
      catalogUrl,
      checkedAt,
      responses: [{
        departmentCode: '024',
        httpStatus: 200,
        bodyBase64: Buffer.from(JSON.stringify(responseBody)).toString('base64'),
      }],
    }

    const enriched = enrichTsinghuaCatalogHarvest({
      harvest,
      sourceBundle,
      minimumPublishableDeadline: '2026-08-26',
    })

    expect(enriched.entities).toHaveLength(1)
    expect(enriched.detailCoverage).toEqual({
      programs: 1,
      tracks: 1,
      bilingualProgramNames: 1,
      bilingualTrackNames: 1,
      attendanceModeKnown: 1,
      instructionLanguageKnown: 1,
      chineseRequirementKnown: 1,
      englishRequirementKnown: 1,
      deadlineKnown: 0,
      deadlineStale: 1,
      deadlineConflict: 0,
      publishableCycles: 0,
      tuitionKnown: 0,
    })
  })

  it('rejects non-official hosts and incomplete catalog reconciliation', () => {
    expect(() => adaptTsinghuaProgramDetails({
      department,
      major: major(),
      academicYear: '2026',
      catalogUrl: 'https://example.com/catalog',
      checkedAt,
    })).toThrow('must use https://yzbm.tsinghua.edu.cn')

    const responseBody = {
      code: 200,
      datas: {
        zsnd: '2026',
        zsmlYxs: [{
          ...department,
          exportZsmlYxZys: [major(), { ...major(), zszydm: '085400' }],
        }],
      },
    }
    expect(() => enrichTsinghuaCatalogHarvest({
      harvest: {
        catalogUrl,
        checkedAt,
        entities: [{
          entityKey: 'tsinghua:master:024:081200',
          majorCode: '081200',
          department: { code: '024' },
        }],
      },
      sourceBundle: {
        format: 'studyinchina.tsinghua-source-bundle',
        formatVersion: 1,
        catalogUrl,
        checkedAt,
        responses: [{
          httpStatus: 200,
          bodyBase64: Buffer.from(JSON.stringify(responseBody)).toString('base64'),
        }],
      },
    })).toThrow('catalog reconciliation failed')
  })
})
