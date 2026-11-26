import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import review from '../../quality/maintenance/batches/ecnu-five-reviewed-20261126/review.json'
import archive from '../../quality/maintenance/batches/ecnu-five-reviewed-20261126/archive-receipt.json'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { canonicalIdentityJson } from '@/lib/data/identity-acceptance'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { validateFieldVerification } from '@/lib/data/field-verification'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { hasDetailedPublicProgram } from '@/lib/data/public-program-quality'

const day = '2026-11-26'
const bundle = loadMaintenanceBundle(process.cwd())
const ids = Object.keys(review.programmeEvidence)
const receiptPath = 'quality/maintenance/batches/ecnu-five-reviewed-20261126/field-receipt.json'
const fields = readFieldVerifications().filter(f => f.receiptPath === receiptPath)
const snapshot = getPublicCatalogSnapshot(bundle, day)

describe('five distinct ECNU Chinese self-funded masters for 2027', () => {
  it('starts from zero school coverage and accepts only these five explicit programme identities', () => {
    expect(review.baseline.gitCommit).toBe('6c12d085e88b3db7da69450698da2b0d6215edc6')
    expect(review.baseline.coverage.currentProgramCount).toBe(0)
    expect(ids).toHaveLength(5)
    const identities = readIdentityAcceptances(undefined, { strictProjection: true })
    expect(new Set(Object.values(review.programmeEvidence).map(e => e.name.zh)).size).toBe(5)
    for (const id of ids) {
      const evidence = review.programmeEvidence[id as keyof typeof review.programmeEvidence]
      const program = bundle.programs.find(p => p.id === id)!
      expect(program.name.zh).toBe(evidence.name.zh)
      expect(program.programUrl).toBe(evidence.programmeUrl)
      expect(identities.filter(i => i.entityType === 'program' && i.recordId === id)).toHaveLength(1)
      expect(evidence.annualScope.pdfPublicationYear).toBeNull()
      expect(evidence.annualScope.pdfAnnualEligibilityNotAsserted).toBe(true)
    }
  })

  it('publishes the exact 3-year Chinese rows with their self-funded autumn scope', () => {
    expect(review.annualYearEvidence.quote).toBe('开学时间：2027年9月初')
    const selected = snapshot.directory.programs.filter(p => ids.includes(p.id))
    expect(selected).toHaveLength(5)
    for (const program of selected) {
      expect(program.degreeLevel).toBe('master')
      expect(program.durationMonths).toBe(36)
      expect(program.teachingLanguages).toEqual(['Chinese'])
      const cycles = snapshot.directory.admissionCycles.filter(c => c.programId === program.id)
      expect(cycles).toHaveLength(1)
      expect(cycles[0]).toMatchObject({ academicYear: '2027', intake: 'autumn', teachingLanguage: 'Chinese',
        applicationRound: 'Self-funded', opensOn: null, closesOn: '2027-06-01', tuitionCny: 28000,
        tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', applicationFeeCny: 800, factScope: 'partial' })
      expect(hasDetailedPublicProgram(program, cycles, day)).toBe(true)
    }
  })

  it('retains uncertain background and conditional exemptions without inventing prerequisites', () => {
    for (const id of ids) {
      const c = snapshot.directory.admissionCycles.find(c => c.programId === id)!
      expect(JSON.stringify(c.eligibility)).not.toMatch(/经济与管理学院|prior.major|professor|age/iu)
      expect(c.notes?.zh).toContain('含义须校方澄清')
      expect(c.notes?.en).toContain('not converted into a prior-major restriction')
      expect(c.languageRequirements).toHaveLength(1)
      expect(c.languageRequirements[0].minimum).toContain('HSK level 5 certificate with at least 210 points OR HSK level 6 with at least 180 points')
      expect(c.notes?.zh).toContain('不移植奖学金专用体检/无犯罪证明文件要求')
      expect(JSON.stringify(c.applicationMaterials)).toContain('at least 1,000 Chinese characters')
      expect(c.opensOn).toBeNull()
    }
  })

  it('binds 75 facts to eight byte-verified originals and invalidates changed annual scopes', () => {
    const { sha256, ...content } = archive
    expect(createHash('sha256').update(canonicalIdentityJson(content)).digest('hex')).toBe(sha256)
    expect(archive.objects).toHaveLength(8)
    expect(fields).toHaveLength(75)
    for (const source of archive.objects) {
      expect(source.readbackSha256).toBe(source.originalSha256)
      expect(source.readbackBytes).toBe(source.originalBytes)
    }
    for (const field of fields) {
      expect(validateFieldVerification(bundle, field, day)).toEqual(field)
      expect(archive.objects.find(a => a.key === field.objectKey)?.readbackSha256).toBe(field.snapshotSha256)
      if (field.fieldPath === 'applyUrl') expect(field.sourceUrl).toBe(field.value)
    }
    const first = fields.find(f => f.entityType === 'admissionCycle' && f.fieldPath === 'eligibility')!
    for (const change of [{ academicYear: '2028' }, { teachingLanguage: 'English' }]) {
      const changed = structuredClone(bundle)
      Object.assign(changed.admissionCycles.find(c => c.id === first.recordId)!, change)
      expect(validateFieldVerification(changed, first, day)).toBeUndefined()
    }
  })
})
