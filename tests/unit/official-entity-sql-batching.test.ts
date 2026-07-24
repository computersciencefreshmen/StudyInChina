import { describe, expect, it } from 'vitest'

import {
  buildOfficialEntityMaterialization,
} from '../../scripts/ingestion/materialize-official-entities'

function largeOfficialProgramInput(count: number): Record<string, unknown> {
  const checkedAt = '2026-07-24T01:00:00.000Z'
  const officialUrl =
    'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/verified/1'
  return {
    checkedAt,
    source: {
      title: 'Official large materialization fixture',
      publisher: 'Tsinghua University',
      reviewedBy: 'sql-batching-test',
      languageCode: 'zh',
      officialHosts: ['yzbm.tsinghua.edu.cn'],
    },
    entities: Array.from({ length: count }, (_, index) => {
      const code = String(index + 1).padStart(6, '0')
      return {
        entityType: 'program',
        entityKey: `tsinghua:master:batch:${code}`,
        institutionId: 'uni-tsinghua-university',
        programType: 'degree',
        degreeLevel: 'master',
        nameZh: `清华批量可核验项目${code}`,
        officialUrl,
        sourceCheckedAt: checkedAt,
        evidence: {
          locator: `json:programs[code=${code}]`,
          quote: `${code} 清华批量可核验项目${code}`,
          officialUrl,
          checkedAt,
        },
      }
    }),
  }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inLineComment = false
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!
    const next = sql[index + 1]
    current += character
    if (inLineComment) {
      if (character === '\n') inLineComment = false
      continue
    }
    if (!inSingleQuote && character === '-' && next === '-') {
      current += next
      index += 1
      inLineComment = true
      continue
    }
    if (character === "'") {
      if (inSingleQuote && next === "'") {
        current += next
        index += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }
    if (!inSingleQuote && character === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
    }
  }
  if (inSingleQuote) throw new Error('generated SQL ended inside a quoted string')
  if (current.trim()) statements.push(current.trim())
  return statements
}

describe('official entity SQL statement batching', () => {
  it('keeps every statement below 20KB for an 893-record materialization', () => {
    const artifacts = buildOfficialEntityMaterialization(
      largeOfficialProgramInput(893),
    )
    const statements = splitSqlStatements(artifacts.sql)
    const statementBytes = statements.map((statement) => (
      Buffer.byteLength(statement, 'utf8')
    ))
    const workflowUpdates = artifacts.sql.match(
      /UPDATE records\nSET workflow_status = CASE/gu,
    ) ?? []
    const canonicalGuards = artifacts.sql.match(
      /'canonical_guard'/gu,
    ) ?? []
    const controlPlaneMutations = artifacts.sql.match(
      /\bmaterialization_batch(?:es|_records|_source_artifacts|_chunks)\b/gu,
    ) ?? []

    expect(artifacts.manifest.counts).toMatchObject({
      records: 893,
      programs: 893,
      claims: 3_572,
      canonicalFields: 3_572,
      programCycles: 0,
      scholarshipCycles: 0,
    })
    expect(workflowUpdates).toHaveLength(0)
    expect(canonicalGuards).toHaveLength(893)
    expect(controlPlaneMutations).toHaveLength(0)
    expect(artifacts.manifest.recordMappings).toHaveLength(893)
    expect(artifacts.sql).toContain(
      'Batch reservation, evidence binding, validation, and apply are owned by the strict importer.',
    )
    expect(artifacts.sql).not.toContain("ELSE 'applied'")
    expect(Math.max(...statementBytes)).toBeLessThan(20_000)
    expect(artifacts.manifest.maxSqlStatementBytes).toBeLessThan(20_000)
    expect(Math.max(...statementBytes))
      .toBeLessThanOrEqual(artifacts.manifest.maxSqlStatementBytes)
    expect(artifacts.sql).not.toContain('INSERT INTO program_cycles')
    expect(artifacts.sql).not.toContain('INSERT INTO fee_items')
  })
})
