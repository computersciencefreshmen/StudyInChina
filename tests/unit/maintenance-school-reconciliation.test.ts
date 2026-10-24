import { describe, expect, it } from 'vitest'
import { evaluateSchoolReconciliation, type SchoolReconciliation } from '../../scripts/maintenance/reconciliation'

const fixture = (): SchoolReconciliation => ({
  universityId: 'uni-fixture', scope: 'full_official_catalog',
  categories: [
    { category: 'undergraduate_catalog', status: 'captured' },
    ...(['masters_catalog', 'doctoral_catalog', 'non_degree_catalog'] as const).map(category => ({
      category, status: 'officially_not_provided' as const, evidenceUrl: 'https://example.edu.cn/catalog', note: 'Official page explicitly limits the available catalogue to undergraduate study.',
    })),
  ],
  catalogs: [{ sourceId: 'catalog', category: 'undergraduate_catalog', url: 'https://example.edu.cn/catalog',
    snapshotSha256: 'a'.repeat(64), expectedRows: 2, expectedPages: 2, capturedPages: [1, 2],
    expectedAttachments: ['majors.pdf'], capturedAttachments: ['majors.pdf'] }],
  entries: [
    { sourceId: 'catalog', officialKey: 'program-a', status: 'published', recordId: 'program-a' },
    { sourceId: 'catalog', officialKey: 'program-b', status: 'individual_application_unavailable', note: 'Exchange nomination only.' },
  ],
})

describe('school-level catalogue reconciliation', () => {
  it('counts exclusions as accounted rows without calling them published projects', () => {
    expect(evaluateSchoolReconciliation(fixture())).toMatchObject({ status: 'complete', published: 1, accountedRows: 2, officialRows: 2, blockers: [] })
  })
  it('cannot complete when a catalogue page or attachment was not captured', () => {
    const input = fixture()
    input.catalogs[0].capturedPages = [1]
    input.catalogs[0].capturedAttachments = []
    expect(evaluateSchoolReconciliation(input).blockers).toEqual(['catalog:attachments_incomplete', 'catalog:pages_incomplete'])
  })
  it('requires a known official denominator rather than treating extracted rows as the expected total', () => {
    const input = fixture(); input.catalogs[0].expectedRows = null
    expect(evaluateSchoolReconciliation(input)).toMatchObject({ status: 'in_progress', officialRows: null, blockers: ['catalog:official_row_count_unknown'] })
  })
  it('rejects representative sampling, unexplained omissions and missing source categories', () => {
    const input = fixture(); input.scope = 'representative_international_programs'
    input.entries.pop(); input.categories.pop()
    const report = evaluateSchoolReconciliation(input)
    expect(report.status).toBe('in_progress')
    expect(report.blockers).toContain('representative_scope_is_not_complete')
    expect(report.blockers).toContain('catalog:row_count_mismatch')
    expect(report.blockers).toContain('non_degree_catalog:coverage_missing')
  })
  it('requires each published row to map to a record and blocks pending rows', () => {
    const input = fixture(); delete input.entries[0].recordId; input.entries[1].status = 'pending'
    expect(evaluateSchoolReconciliation(input).blockers).toEqual(['pending_row:program-b', 'published_without_record:program-a'])
  })
  it('does not let source failure or a duplicated official row inflate completeness', () => {
    const input = fixture(); input.categories[1].status = 'source_unavailable'; input.entries.push({ ...input.entries[0] })
    const report = evaluateSchoolReconciliation(input)
    expect(report.status).toBe('in_progress')
    expect(report.blockers).toContain('masters_catalog:source_unavailable')
    expect(report.blockers).toContain('duplicate_official_row:program-a')
  })
})
