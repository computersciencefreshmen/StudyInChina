import { describe, expect, it } from 'vitest'
import {
  TSINGHUA_2026_TUITION_URL,
  parseTsinghuaTuitionCatalogHtml,
} from '../../scripts/ingestion/tsinghua-tuition-adapter'

const checkedAt = '2026-07-26T10:00:00.000Z'

const tuitionHtml = `
<!doctype html>
<html lang="en">
  <body>
    <h1>2026年国际研究生学费列表
      Tuition Fees of Graduate Programs for International Students 2026
    </h1>
    <p>国际研究生专业/项目学费（以人民币元为单位）</p>
    <p>Tuition Fees of Graduate Programs (Unit: RMB Yuan)</p>
    <table>
      <tr><th>Doctor/Master</th><th>Disciplines/Programs</th><th>Tuition Fee</th></tr>
      <tr>
        <td rowspan="2">硕士 Master</td>
        <td>07理学、08工学、10医学 / 07 Science, 08 Engineering, 10 Medicine</td>
        <td>33,000 (每学年/Year)</td>
      </tr>
      <tr>
        <td>025100 金融硕士 / 025100 Master of Finance</td>
        <td>198,000 (全项目/Full Program) 第一学年/1st Year: 99,000</td>
      </tr>
      <tr>
        <td>博士 Doctor</td>
        <td>050300 新闻传播学 / 050300 Journalism and Communication</td>
        <td>60,000 (每学年/Year)</td>
      </tr>
    </table>
    <table>
      <tr><th>Code</th><th>School</th><th>Program</th><th>Tuition</th></tr>
      <tr>
        <td>024</td>
        <td>计算机科学与技术系 / Department of Computer Science and Technology</td>
        <td>先进计算英文硕士项目 / Master's Program in Advanced Computing</td>
        <td>39,000（每学年/Year）</td>
      </tr>
    </table>
  </body>
</html>
`

describe('Tsinghua tuition page adapter', () => {
  it('parses official RMB fees, rowspans, periods, and exact evidence locators', () => {
    const catalog = parseTsinghuaTuitionCatalogHtml({
      html: tuitionHtml,
      checkedAt,
    })

    expect(catalog).toMatchObject({
      academicYear: '2026',
      checkedAt,
      officialUrl: TSINGHUA_2026_TUITION_URL,
      currency: 'CNY',
    })
    expect(catalog.rules).toHaveLength(4)
    expect(catalog.rules[0]).toMatchObject({
      academicYear: '2026',
      degreeLevel: 'master',
      disciplinePrefixes: ['07', '08', '10'],
      tuition: {
        value: {
          amount: 33000,
          currency: 'CNY',
          billingPeriod: 'academic_year',
        },
        fieldMeta: {
          status: 'known',
          officialUrl: TSINGHUA_2026_TUITION_URL,
          checkedAt,
          locator: 'css:table:nth-of-type(1) tr:nth-of-type(2)',
        },
      },
    })
    expect(catalog.rules[1]).toMatchObject({
      degreeLevel: 'master',
      programCodes: ['025100'],
      tuition: {
        value: {
          amount: 198000,
          currency: 'CNY',
          billingPeriod: 'full_program',
        },
      },
    })
    expect(catalog.rules[2]).toMatchObject({
      degreeLevel: 'doctorate',
      programCodes: ['050300'],
      tuition: { value: { amount: 60000 } },
    })
    expect(catalog.rules[3]).toMatchObject({
      degreeLevel: 'master',
      departmentCodes: ['024'],
      tuition: { value: { amount: 39000 } },
    })
    expect(catalog.rules.every((rule) => rule.tuition.fieldMeta.quote)).toBe(true)
  })

  it('rejects missing currency declarations, absent fee rows, and non-official hosts', () => {
    expect(() => parseTsinghuaTuitionCatalogHtml({
      html: tuitionHtml.replace('Unit: RMB Yuan', 'Unit omitted'),
      checkedAt,
    })).not.toThrow()

    const noCurrency = tuitionHtml
      .replace('（以人民币元为单位）', '')
      .replace('Unit: RMB Yuan', 'Unit omitted')
    expect(() => parseTsinghuaTuitionCatalogHtml({
      html: noCurrency,
      checkedAt,
    })).toThrow('did not declare RMB Yuan')

    expect(() => parseTsinghuaTuitionCatalogHtml({
      html: tuitionHtml.replaceAll('33,000', 'not announced')
        .replaceAll('198,000', 'not announced')
        .replaceAll('60,000', 'not announced')
        .replaceAll('39,000', 'not announced'),
      checkedAt,
    })).toThrow('no parseable fee rows')

    expect(() => parseTsinghuaTuitionCatalogHtml({
      html: tuitionHtml,
      checkedAt,
      officialUrl: 'https://example.com/fees',
    })).toThrow('must use https://yzbm.tsinghua.edu.cn')
  })
})
