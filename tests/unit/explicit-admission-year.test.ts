import { describe, expect, it } from 'vitest'
import { admissionCycleSchema } from '@/lib/data/schema'
import { admissionIntakeYear, annualCycleIdentityKey, isCurrentAdmissionYear, parseAdmissionYear, quotedAdmissionIntake } from '@/lib/data/cycle-scope'
import { fieldRecordScopeSha256 } from '@/lib/data/field-verification'
import type { AdmissionCycle } from '@/lib/data/types'
import { cycleDiscoveryFieldsSchema, explicitCycleScope } from '../../scripts/maintenance/cycle-contracts'
import { criticalEvidenceIssue } from '../../workers/ingestion/src/rules'
import { sourceManifest } from '../../workers/ingestion/tests/fixtures'

const cycle: AdmissionCycle = { id: 'legacy-cycle', programId: 'program', academicYear: '2027-2028', intake: 'autumn',
  opensOn: '2026-11-01', closesOn: '2027-05-30', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null,
  factScope: 'partial', sourceIds: ['official'], status: 'stale', verifiedAt: '2026-11-16', reviewAfter: '2026-11-16' }

describe('source-declared admission year', () => {
  it.each(['2027', '2027-2028'])('accepts %s verbatim, without translating the source label', value => {
    expect(admissionCycleSchema.parse({ ...cycle, academicYear: value }).academicYear).toBe(value)
    expect(isCurrentAdmissionYear(value, '2026-11-16')).toBe(true)
  })
  it.each(['', 'unknown', '2027-2029', '2027-2027', '2027/2028', '2027-28', ' 2027', '2027年'])('rejects invalid year %s', value => {
    expect(parseAdmissionYear(value)).toBeNull()
    expect(admissionCycleSchema.safeParse({ ...cycle, academicYear: value }).success).toBe(false)
  })
  it('keeps historical and distant future years outside the public window', () => {
    for (const year of ['2025', '2024-2025', '2030', '2030-2031', 'unknown']) expect(isCurrentAdmissionYear(year, '2026-11-16')).toBe(false)
    expect(admissionIntakeYear('2027', 'spring')).toBe('2027')
    expect(admissionIntakeYear('2027-2028', 'spring')).toBe('2028')
    expect(admissionIntakeYear('2027-2028', 'autumn')).toBe('2027')
  })
  it('leaves legacy identities and scope hashes byte-for-byte unchanged', () => {
    expect(annualCycleIdentityKey('program', cycle.academicYear, cycle.intake)).toBe('program|2027-2028|autumn')
    expect(fieldRecordScopeSha256('admissionCycle', cycle)).toBe('3d42a71e2d7c121d295a49468dad904f0845fd7734ed367cbb217cb4ce2e86e8')
    expect(fieldRecordScopeSha256('admissionCycle', { ...cycle, academicYear: '2027' })).not.toBe(fieldRecordScopeSha256('admissionCycle', cycle))
  })
  it('requires a cited literal year, not an unrelated date, another intake, or a range substring', () => {
    const field = { path: 'academicYear', type: 'string' as const, required: true, critical: true }
    expect(criticalEvidenceIssue(field, '2027', '2027年国际本科招生简章', sourceManifest())).toBeNull()
    for (const quote of ['International admissions 2028', 'Applications close 2027-05-30', '申请截止日期2027年5月30日', '2027', 'Academic year 2027-2028', 'Admissions for 2028; applications close 2027/05/30', '2028年入学，申请截止2027年5月30日', 'Admissions open September 2027. Entry September 2028.'])
      expect(criticalEvidenceIssue(field, '2027', quote, sourceManifest())).not.toBeNull()
    expect(criticalEvidenceIssue(field, '2027-2028', 'Academic year 2027-2028', sourceManifest())).toBeNull()
    expect(criticalEvidenceIssue(field, '2027-2029', 'Academic year 2027-2029', sourceManifest())).not.toBeNull()
    expect(quotedAdmissionIntake('2027', 'autumn', 'Autumn 2027 Computer Science')).toBe(true)
    expect(quotedAdmissionIntake('2027', 'autumn', '入学日期2027年9月，计算机科学与技术')).toBe(true)
    expect(quotedAdmissionIntake('2027', 'spring', 'Spring 2027 Computer Science')).toBe(true)
    expect(quotedAdmissionIntake('2027', 'autumn', 'Autumn 2028 Computer Science; apply by 2027-12-01')).toBe(false)
    expect(quotedAdmissionIntake('2027', 'autumn', 'Autumn 2027-2028 Computer Science')).toBe(false)
    expect(quotedAdmissionIntake('2027', 'autumn', 'Computer Science autumn 2028 admission; applications open 2027年9月1日')).toBe(false)
    expect(quotedAdmissionIntake('2027', 'autumn', 'Spring 2027 Computer Science')).toBe(false)
  })
  it('imports only the named programme and exact single-year seasonal scope', () => {
    const evidence = { sourceId: 'official', url: 'https://example.edu/2027', snapshotSha256: 'a'.repeat(64), objectKey: 'raw/guide', locator: 'section:1', quote: 'International bachelor Computer Science. Spring 2027 Computer Science. Application deadline 2027-02-01.' }
    const fields = cycleDiscoveryFieldsSchema.parse({ programId: 'program', programScopeSha256: 'b'.repeat(64), academicYear: '2027', intake: 'spring',
      patches: [{ fieldPath: 'closesOn', value: '2027-02-01', factStatus: 'known' }, { fieldPath: 'dateStatus', value: 'published', factStatus: 'known' }],
      programEvidence: evidence, internationalAdmissionsEvidence: evidence, cycleScopeEvidence: evidence })
    const identity = { name: { en: 'Computer Science' }, degreeLevel: 'bachelor' }
    expect(explicitCycleScope(fields, identity)).toBe(true)
    expect(explicitCycleScope({ ...fields, academicYear: '2028' }, identity)).toBe(false)
    expect(explicitCycleScope({ ...fields, intake: 'autumn' }, identity)).toBe(false)
    expect(explicitCycleScope(fields, { ...identity, name: { en: 'Chemistry' } })).toBe(false)
  })
})
