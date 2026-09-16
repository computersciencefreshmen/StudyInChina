import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DataBundle, Program } from '../../src/lib/data/types'
import { assertCalendarDate, buildComprehensiveDataAudit } from './comprehensive-data-audit'

const source = { id: 's', url: 'https://example.edu.cn/program', title: 'Program', publisher: 'University', kind: 'program', language: 'en', official: true, accessedAt: '2026-09-16' } as const
const program: Program = {
  id: 'p', slug: 'program', universityId: 'u', name: { en: 'Program' }, degreeLevel: 'language', discipline: 'chinese-education',
  teachingLanguages: [], durationMonths: null, programUrl: source.url, applyUrl: null, languageRequirements: [],
  verificationScope: 'identity', sourceIds: ['s'], verifiedAt: '2026-08-16', reviewAfter: '2026-09-15', status: 'verified',
}
function fixture(): DataBundle {
  return {
    sources: [{ ...source }],
    cities: [{ id: 'c', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [], sourceIds: ['s'], verifiedAt: '2026-09-16', reviewAfter: '2026-10-16', status: 'verified' }],
    universities: [{ id: 'u', slug: 'university', name: { en: 'University' }, cityId: 'c', region: null, officialUrl: 'https://example.edu.cn', admissionsUrl: null, summary: null, featured: false, sourceIds: ['s'], verifiedAt: '2026-09-16', reviewAfter: '2026-10-16', status: 'verified' }],
    programs: [structuredClone(program)], admissionCycles: [], scholarships: [],
  }
}
test('calendar validation rejects impossible dates and non-canonical values', () => {
  assert.equal(assertCalendarDate('2028-02-29'), '2028-02-29')
  for (const value of ['2026-02-29', '2026-09-31', '2026-9-16', 'today']) assert.throws(() => assertCalendarDate(value))
})
test('audit visits every row, preserves inputs and never renews records because their source is fresh', () => {
  const data = fixture()
  const before = JSON.stringify(data)
  const report = buildComprehensiveDataAudit(data, '2026-09-16')
  assert.equal(report.summary.totalRecords, 4)
  assert.equal(report.summary.verifiedOverdue, 1)
  assert.equal(report.records.find(row => row.id === 'p')?.overdueDays, 1)
  assert.equal(JSON.stringify(data), before)
  assert.equal(report.records.find(row => row.id === 'p')?.verifiedAt, '2026-08-16')
})
test('review remains valid on the reviewAfter day', () => {
  const data = fixture()
  data.programs[0].reviewAfter = '2026-09-16'
  const report = buildComprehensiveDataAudit(data, '2026-09-16')
  assert.equal(report.summary.verifiedOverdue, 0)
})
test('missing relationships and future verification become priority-zero repair tasks', () => {
  const data = fixture()
  data.programs[0].sourceIds = ['missing']
  data.programs[0].universityId = 'missing'
  data.programs[0].verifiedAt = '2026-09-17'
  const report = buildComprehensiveDataAudit(data, '2026-09-16')
  const task = report.tasks.find(task => task.recordId === 'p')!
  assert.equal(task.priority, 0)
  assert.ok(task.issueCodes.includes('future_verification'))
  assert.ok(task.issueCodes.includes('missing_source_reference'))
  assert.ok(task.issueCodes.includes('missing_university_reference'))
  assert.equal(report.summary.schemaValid, false)
})
test('expired deadlines stay historical while future stale cycles receive a source-recheck task', () => {
  const data = fixture()
  data.admissionCycles = [{ id: 'past', programId: 'p', academicYear: '2025-2026', intake: 'autumn', opensOn: null, closesOn: '2026-05-01', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null, factScope: 'dates-only', evidenceBasis: 'cycle-specific', sourceIds: ['s'], verifiedAt: '2026-08-16', reviewAfter: '2026-09-15', status: 'stale' }]
  data.admissionCycles.push({ ...data.admissionCycles[0], id: 'future', academicYear: '2026-2027', closesOn: '2026-10-01' })
  const report = buildComprehensiveDataAudit(data, '2026-09-16')
  assert.ok(report.tasks.find(task => task.recordId === 'past')?.issueCodes.includes('deadline_passed'))
  assert.ok(!report.tasks.find(task => task.recordId === 'past')?.issueCodes.includes('actionable_cycle_needs_recheck'))
  assert.ok(report.tasks.find(task => task.recordId === 'future')?.issueCodes.includes('actionable_cycle_needs_recheck'))
  assert.equal(data.admissionCycles[0].closesOn, '2026-05-01')
})
