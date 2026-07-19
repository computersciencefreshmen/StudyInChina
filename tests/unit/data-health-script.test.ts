import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts', 'data-health.mjs')
const temporaryDirectories: string[] = []

type HealthReport = {
  mode: string
  summary: {
    statuses: Record<string, number>
    suppressedDraftRecords: number
    overdueVerified: number
    links: { checked: number; hard: number; warning: number }
  }
  issues: Array<{
    severity: string
    kind: string
    recordId: string | null
    recordStatus: string | null
    statusCode?: number | null
  }>
}

function runHealth(
  records: unknown[],
  { mode = 'daily', linkReport }: { mode?: string; linkReport?: unknown } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'studycn-data-health-'))
  temporaryDirectories.push(directory)
  const dataDirectory = join(directory, 'data')
  const outputPath = join(directory, 'report.json')

  // The CLI intentionally accepts generic JSON documents, so a compact
  // fixture is enough to exercise status and scheduling behavior.
  mkdirSync(dataDirectory)
  writeFileSync(join(dataDirectory, 'records.json'), JSON.stringify(records), 'utf8')

  const args = [
    scriptPath,
    '--data-dir',
    dataDirectory,
    '--mode',
    mode,
    '--today',
    '2026-07-19',
    '--json',
    outputPath,
  ]

  if (linkReport) {
    const linkReportPath = join(directory, 'links.json')
    writeFileSync(linkReportPath, JSON.stringify(linkReport), 'utf8')
    args.push('--link-report', linkReportPath)
  }

  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  const report = JSON.parse(readFileSync(outputPath, 'utf8')) as HealthReport
  return { result, report }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('data health CLI', () => {
  it.each(['daily', 'weekly', 'monthly', 'semester'])('accepts %s audit mode', (mode) => {
    const { result, report } = runHealth([{ id: 'archived-record', status: 'archived' }], {
      mode,
    })

    expect(result.status).toBe(0)
    expect(report.mode).toBe(mode)
  })

  it('fails the daily gate when a verified public record is overdue', () => {
    const { result, report } = runHealth([
      { id: 'source-one', status: 'archived' },
      {
        id: 'verified-overdue',
        status: 'verified',
        sourceIds: ['source-one'],
        verifiedAt: '2026-06-01',
        reviewAfter: '2026-07-18',
      },
    ])

    expect(result.status).toBe(1)
    expect(report.summary.overdueVerified).toBe(1)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'review-overdue',
          recordId: 'verified-overdue',
          recordStatus: 'verified',
        }),
      ]),
    )
  })

  it('lists stale risks while suppressing draft and archived record details', () => {
    const { result, report } = runHealth([
      { id: 'source-one', status: 'archived' },
      {
        id: 'draft-overdue',
        status: 'draft',
        sourceIds: [],
        verifiedAt: null,
        reviewAfter: '2026-01-01',
        deadline: '2026-01-01',
      },
      {
        id: 'archived-upcoming',
        status: 'archived',
        sourceIds: [],
        verifiedAt: null,
        reviewAfter: '2026-07-20',
        deadline: '2026-07-20',
      },
      {
        id: 'stale-record',
        status: 'stale',
        sourceIds: ['source-one'],
        verifiedAt: '2026-06-01',
        reviewAfter: '2026-07-18',
      },
    ])

    expect(result.status).toBe(0)
    expect(report.summary.statuses).toMatchObject({ draft: 1, stale: 1, archived: 2 })
    expect(report.summary.suppressedDraftRecords).toBe(1)
    expect(report.summary.overdueVerified).toBe(0)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'record-stale', recordId: 'stale-record' }),
        expect.objectContaining({ kind: 'review-overdue', recordId: 'stale-record' }),
      ]),
    )
    expect(report.issues.some((issue) => issue.recordId === 'draft-overdue')).toBe(false)
    expect(report.issues.some((issue) => issue.recordId === 'archived-upcoming')).toBe(false)
  })

  it('keeps broader review modes advisory for an overdue verified record', () => {
    const { result, report } = runHealth(
      [
        { id: 'source-one', status: 'archived' },
        {
          id: 'verified-overdue',
          status: 'verified',
          sourceIds: ['source-one'],
          verifiedAt: '2026-06-01',
          reviewAfter: '2026-07-18',
        },
      ],
      { mode: 'monthly' },
    )

    expect(result.status).toBe(0)
    expect(report.mode).toBe('monthly')
    expect(report.summary.overdueVerified).toBe(1)
  })

  it('preserves confirmed 404/410 failures and inconclusive link warnings', () => {
    const { result, report } = runHealth(
      [{ id: 'source-one', status: 'archived' }],
      {
        mode: 'weekly',
        linkReport: {
          summary: { checked: 2, ok: 0, hard: 1, warning: 1 },
          results: [
            {
              url: 'https://example.com/missing',
              severity: 'hard',
              status: 404,
              reason: 'Confirmed HTTP 404 after HEAD and ranged GET',
              references: [{ file: 'records.json', path: '$[0].url', recordId: 'source-one' }],
            },
            {
              url: 'https://example.com/protected',
              severity: 'warning',
              status: 403,
              reason: 'HTTP 403; verify manually',
              references: [{ file: 'records.json', path: '$[0].url', recordId: 'source-one' }],
            },
          ],
        },
      },
    )

    expect(result.status).toBe(0)
    expect(report.summary.links).toMatchObject({ checked: 2, hard: 1, warning: 1 })
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'broken-link', severity: 'error', statusCode: 404 }),
        expect.objectContaining({ kind: 'link-warning', severity: 'warning', statusCode: 403 }),
      ]),
    )
  })
})
