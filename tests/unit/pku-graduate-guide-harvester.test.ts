import { describe, expect, it, vi } from 'vitest'

import {
  parsePkuGraduateGuideText,
} from '../../scripts/ingestion/pku-graduate-guide-harvester'

const guideLayout = [
  '北京大学 2026 年外国留学生研究生招生简章（校本部）',
  '硕士研究生的学制为 2 年或 3 年，博士研究生的学制为 4 年或 5 年。',
  '1. 非中国籍公民，持有效外国护照。',
  '2. 身心健康，品行端正，无违法犯罪记录。',
  '3. 申请攻读硕士学位研究生应具有中国教育部认可院校授予的学士或以上学位。',
  '申请攻读博士学位研究生应具有中国教育部认可院校授予的硕士或以上学位。',
  '四、申请时间（北京时间）',
  '2025 年 10 月 20 日至 2025 年 12 月 23 日',
  '\f五、申请办法',
  '登录系统（网址：http://www.studyatpku.com）填写申请并上传以下申请材料：',
  '1. 学位证书原件及学位认证报告。',
  '2. 毕业院校的正式成绩单。',
  '3. 个人陈述原件。',
  '4. 个人简历及申请承诺书。',
  '5. 两封所申请专业领域的教授或副教授推荐信。',
  '6. 语言（汉语或英语）考试成绩单原件：',
  '理工类专业 6 级 200 分以上 不低于 65 分',
  '人文社科类专业 6 级 210 分以上 不低于 65 分',
  '英文授课申请人需提交 TOEFL（iBT，100 分以上）或 GRE（315 分以上）。',
  '7. 护照首页。',
  '8. 个人研究成果。',
  '9. 院系要求提交的其它补充文件。',
  '六、申请费用',
  '每个志愿的申请费为 800 元人民币。申请费不予退还。',
].join('\n')

const options = {
  officialUrl: 'https://admission.pku.edu.cn/docs/20251020095346239221.pdf',
  checkedAt: '2026-07-26T06:05:00.000Z',
  minimumOpenDeadline: '2026-08-26',
  tuitionSourceUrl:
    'https://isd.pku.edu.cn/userfiles/editor/202512011607206111.pdf',
}

describe('PKU graduate guide harvester', () => {
  it('extracts official shared rules and archives deadlines before the cutoff', () => {
    const result = parsePkuGraduateGuideText(guideLayout, options)

    expect(result).toMatchObject({
      parserVersion: 'pku-graduate-guide-v1',
      institutionId: 'uni-peking-university',
      intakeYear: 2026,
      durationRules: [
        {
          degreeLevel: 'master',
          durationMin: 2,
          durationMax: 3,
          hasProgramExceptions: true,
        },
        {
          degreeLevel: 'doctorate',
          durationMin: 4,
          durationMax: 5,
          hasProgramExceptions: true,
        },
      ],
      applicationRoute: {
        applicationUrl: 'https://www.studyatpku.com/',
        sourceUrlScheme: 'http',
      },
      applicationWindows: {
        publishable: [],
        historical: [
          {
            opensOn: '2025-10-20',
            closesOn: '2025-12-23',
            publicationStatus: 'archived',
          },
        ],
      },
      applicationFee: {
        status: 'known',
        value: {
          amountMinor: 80_000,
          currencyCode: 'CNY',
          currencyExponent: 2,
          refundable: false,
        },
      },
      reconciliation: {
        requiredFacts: 14,
        extractedFacts: 14,
        publishableWindows: 0,
        archivedWindows: 1,
        missingFacts: [],
      },
    })
    expect(result.requirements).toHaveLength(8)
    expect(result.requiredDocuments).toHaveLength(10)
    expect(result.requiredDocuments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentType: 'recommendation',
        required: true,
        copies: 2,
      }),
      expect.objectContaining({
        documentType: 'research_achievements',
        required: false,
      }),
    ]))
    expect(result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirementType: 'language_test',
        appliesTo: ['chinese_taught_science'],
        rule: expect.objectContaining({ minimumScore: 200 }),
      }),
      expect.objectContaining({
        requirementType: 'language_test',
        appliesTo: ['english_taught_non_native_english'],
      }),
    ]))
    for (const rule of [...result.durationRules, ...result.requirements]) {
      expect(rule.evidence).toMatchObject({
        officialUrl: options.officialUrl,
        checkedAt: options.checkedAt,
      })
      expect(rule.evidence.locator).toMatch(/^pdf:page=\d+;lines=\d+-\d+$/u)
    }
  })

  it('uses an inclusive cutoff and never calls the network', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('deterministic guide parser must not use network')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = parsePkuGraduateGuideText(guideLayout, {
      ...options,
      minimumOpenDeadline: '2025-12-23',
    })

    expect(result.applicationWindows.publishable).toHaveLength(1)
    expect(result.applicationWindows.historical).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('fails closed on missing critical facts and unofficial hosts', () => {
    expect(() => parsePkuGraduateGuideText(
      guideLayout.replace('800 元人民币', '金额另行通知'),
      options,
    )).toThrow(/missing application fee/u)
    expect(() => parsePkuGraduateGuideText(guideLayout, {
      ...options,
      officialUrl: 'https://admission.pku.edu.cn.evil.example/guide.pdf',
    })).toThrow(/official PKU admission PDF/u)
    expect(() => parsePkuGraduateGuideText(guideLayout, {
      ...options,
      tuitionSourceUrl: 'https://example.com/tuition.pdf',
    })).toThrow(/official PKU ISD HTTPS PDF/u)
  })
})
