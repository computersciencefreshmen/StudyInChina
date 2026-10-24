import { createHash } from 'node:crypto'
import type { DataBundle, Scholarship, Source } from '../../src/lib/data/types'
import { bundleSchema } from '../../src/lib/data/schema'
import { getTodayDate } from '../../src/lib/data/freshness'
import { identityAcceptanceLedgerSchema, identityFingerprint, type IdentityAcceptanceLedger } from '../../src/lib/data/identity-acceptance'
import { catalogSha256 } from './build-scope'
import { canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, maintenanceScopeSchema, scopeContentSha256,
  type MaintenanceProposal, type MaintenanceScope } from './contracts'
import { verifyReviewedProposalEvidence, type IdentityBindings } from './import-identities'
import { scholarshipIdentityFieldsSchema, type ScholarshipIdentityFields } from './scholarship-contracts'

export type ScholarshipIdentityImportReceipt = {
  format: 'studyinchina.scholarship-identity-import-receipt'; formatVersion: 1; batchId: string; batchSha256: string;
  scopeRegistrySha256: string; inputCatalogSha256: string; beforeCatalogSha256: string; outputCatalogSha256: string; acceptedAt: string;
  accepted: Array<{ proposalId: string; recordId: string; canonicalKey: string; action: 'created' | 'identity_accepted' }>;
  held: Array<{ proposalId: string; reason: string }>; sha256: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const nameKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
const textKey = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
export function canonicalScholarshipIdentityKey(universityId: string, fields: ScholarshipIdentityFields): string {
  return `scholarship|${universityId}|${fields.providerType}|name:${nameKey(fields.name.zh ?? fields.name.en ?? '')}`
}
const sameName = (record: Scholarship, fields: ScholarshipIdentityFields) => Object.values(record.name).some(name => name
  && Object.values(fields.name).some(candidate => nameKey(candidate) === nameKey(name)))
function assertSchoolUrl(url: string, school: MaintenanceScope['schools'][number]) {
  const hostname = new URL(url).hostname.toLowerCase()
  if (!school.officialHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) throw Error('scholarship_source_outside_registered_hosts')
}
async function verifyIdentity(proposal: MaintenanceProposal, fields: ScholarshipIdentityFields,
  school: MaintenanceScope['schools'][number], readArtifact: (key: string) => Promise<Uint8Array>) {
  if (proposal.review?.method === 'deterministic') throw Error('scholarship_semantic_review_required')
  assertSchoolUrl(fields.scholarshipUrl, school)
  if (fields.scholarshipUrl !== proposal.source.url) throw Error('scholarship_url_requires_matching_captured_source')
  await verifyReviewedProposalEvidence(proposal, school, readArtifact, [fields.internationalAdmissionsEvidence, fields.institutionEvidence])
  for (const [locale, name] of Object.entries(fields.name)) if (!proposal.fieldEvidence.some(evidence => evidence.fieldPath === `name.${locale}`
    && textKey(evidence.quote).includes(textKey(name)))) throw Error(`scholarship_name_evidence_missing:${locale}`)
  const provider = proposal.fieldEvidence.find(evidence => evidence.fieldPath === 'providerType')
  if (!provider) throw Error('scholarship_provider_evidence_missing')
  const providerPatterns: Record<string, RegExp> = {
    csc: /chinese government scholarship|\bCSC\b|中国政府奖学金|国家留学基金/iu,
    university: /university|president|大学|学院|校长|学校|校级/iu,
    province: /provinc|省(?:政府|奖学金)|省[^。\n]{0,30}奖学金/iu,
    city: /municipal|city government|市(?:政府|奖学金)|市[^。\n]{0,30}奖学金/iu,
  }
  if (providerPatterns[fields.providerType] && !providerPatterns[fields.providerType].test(provider.quote)) throw Error('scholarship_provider_type_not_supported')
  if (!/international|foreign|国际|外国|留学/iu.test(fields.internationalAdmissionsEvidence.quote)) throw Error('international_scholarship_scope_unproven')
  if (!Object.values(school.name).some(name => textKey(fields.institutionEvidence.quote).includes(textKey(name)))) throw Error('scholarship_institution_affiliation_unproven')
  if (/^(?:scholarships?|financial (?:aid|support)|funding|grants?)(?: and (?:grants?|scholarships?))?$/iu.test(fields.name.en ?? '')
    || /^(?:奖学金|助学金|奖助学金|资助|奖学金介绍|奖学金项目)$/u.test(fields.name.zh ?? '')) throw Error('generic_scholarship_heading_is_not_identity')
  if (!Object.values(fields.name).every(name => /scholarship|grant|fellowship|award|奖学金|助学金|奖助|资助|奖励金/iu.test(name))) throw Error('concrete_scholarship_identity_unproven')
}

/** A single caller composes identity and field stages against the same immutable input hash. */
export async function importScholarshipIdentities(options: {
  bundle: DataBundle; inputBundle?: DataBundle; scope: unknown; batch: unknown; acceptedAt: string; receiptPath: string;
  acceptances?: IdentityAcceptanceLedger; bindings?: IdentityBindings; appliedReceipts?: ScholarshipIdentityImportReceipt[];
  readArtifact: (key: string) => Promise<Uint8Array>;
}): Promise<{ bundle: DataBundle; acceptances: IdentityAcceptanceLedger; bindings: IdentityBindings; receipt: ScholarshipIdentityImportReceipt; replayed: boolean }> {
  const scope = maintenanceScopeSchema.parse(options.scope), batch = maintenanceCandidateExportSchema.parse(options.batch)
  if (scope.sha256 !== await scopeContentSha256(scope)) throw Error('Scope checksum mismatch')
  if (batch.sha256 !== await exportContentSha256(batch)) throw Error('Candidate export checksum mismatch')
  if (batch.scopeRegistrySha256 !== scope.sha256) throw Error('Candidate uses another fixed school scope')
  const original = bundleSchema.parse(options.bundle), input = bundleSchema.parse(options.inputBundle ?? options.bundle)
  const inputHash = await catalogSha256(input), beforeHash = await catalogSha256(original)
  const acceptances = identityAcceptanceLedgerSchema.parse(options.acceptances ?? { schemaVersion: 1, entries: [] })
  const bindings = structuredClone(options.bindings ?? { schemaVersion: 1 as const, entries: [] })
  if (bindings.schemaVersion !== 1 || !Array.isArray(bindings.entries)
    || bindings.entries.some(entry => !entry.canonicalKey || !entry.recordId || !Array.isArray(entry.aliases))
    || new Set(bindings.entries.map(entry => entry.canonicalKey)).size !== bindings.entries.length) throw Error('Invalid identity binding ledger')
  const prior = options.appliedReceipts?.find(receipt => receipt.batchId === batch.batchId)
  if (prior) {
    const { sha256, ...content } = prior
    if (hash(canonicalJson(content)) !== sha256 || prior.batchSha256 !== batch.sha256 || beforeHash !== prior.outputCatalogSha256) throw Error('Previously consumed scholarship batch does not match current catalogue')
    return { bundle: original, acceptances, bindings, receipt: prior, replayed: true }
  }
  if (inputHash !== batch.inputCatalogSha256) throw Error('Candidate base catalogue changed; regenerate or reconcile the batch')
  const acceptedAt = new Date(options.acceptedAt)
  if (!Number.isFinite(+acceptedAt) || acceptedAt.toISOString() !== options.acceptedAt) throw Error('acceptedAt must be a canonical ISO timestamp')
  const bundle = structuredClone(original), schools = new Map(scope.schools.map(school => [school.universityId, school]))
  const accepted: ScholarshipIdentityImportReceipt['accepted'] = [], held: ScholarshipIdentityImportReceipt['held'] = []
  const pending: Array<{ record: Scholarship; reviewer: string }> = []
  for (const proposal of batch.proposals.filter(proposal => proposal.entityType === 'scholarship' && 'scholarshipUrl' in proposal.fields)) {
    try {
      if (proposal.status !== 'ready') throw Error('producer_held')
      if (proposal.scope.year !== null || proposal.scope.intake !== null) throw Error('scholarship_identity_must_not_claim_a_cycle')
      const school = schools.get(proposal.universityId), university = bundle.universities.find(record => record.id === proposal.universityId)
      if (!school || !university) throw Error('school_outside_fixed_scope')
      const fields = scholarshipIdentityFieldsSchema.parse(proposal.fields)
      if (new Date(proposal.source.checkedAt) > acceptedAt || new Date(proposal.review?.reviewedAt ?? '') > acceptedAt) throw Error('future_evidence_or_review')
      await verifyIdentity(proposal, fields, school, options.readArtifact)
      const canonicalKey = canonicalScholarshipIdentityKey(school.universityId, fields)
      const aliases = [...new Set(Object.values(fields.name).map(name => `scholarship|${school.universityId}|${fields.providerType}|name:${nameKey(name)}`))].sort()
      const bound = bindings.entries.find(entry => entry.canonicalKey === canonicalKey || entry.aliases.some(alias => aliases.includes(alias)))
      const explicitId = proposal.recordId ?? bound?.recordId
      let record = explicitId ? bundle.scholarships.find(record => record.id === explicitId) : undefined
      if (explicitId && !record) throw Error('mapped_scholarship_missing')
      if (record && (record.providerType !== fields.providerType || !record.universityIds.includes(school.universityId) || !sameName(record, fields))) throw Error('mapped_scholarship_identity_scope_conflict')
      if (!record) {
        const matches = bundle.scholarships.filter(record => record.providerType === fields.providerType && record.universityIds.includes(school.universityId) && sameName(record, fields))
        if (matches.length > 1) throw Error('ambiguous_existing_scholarship_identity')
        record = matches[0]
      }
      if (record?.status === 'draft' || record?.status === 'archived') throw Error('draft_or_archived_identity_requires_separate_promotion')
      if (bound && record && bound.recordId !== record.id) throw Error('canonical_scholarship_key_already_bound')
      const action = record ? 'identity_accepted' as const : 'created' as const
      const sourceId = `src-maintenance-scholarship-${hash(proposal.source.url).slice(0, 24)}`, checkedDay = getTodayDate(new Date(proposal.source.checkedAt))
      const source: Source = { id: sourceId, url: proposal.source.url, title: `Official scholarship information — ${school.name.en ?? school.name.zh ?? school.universityId}`,
        publisher: school.name.en ?? school.name.zh ?? school.universityId, kind: 'scholarship', language: 'other', official: true, accessedAt: checkedDay }
      const existingSource = bundle.sources.find(source => source.id === sourceId)
      if (existingSource && (existingSource.url !== source.url || !existingSource.official || existingSource.kind !== 'scholarship')) throw Error('scholarship_source_identity_conflict')
      if (!record) {
        const digest = hash(canonicalKey).slice(0, 24)
        record = { id: `scholarship-${digest}`, slug: `${university.slug}-scholarship-${digest}`, name: fields.name, providerType: fields.providerType,
          universityIds: [school.universityId], programIds: [], coverage: { tuition: 'unknown', accommodation: 'unknown', insurance: 'unknown', stipendCnyPerMonth: null },
          deadline: null, applicationUrl: null, summary: null, sourceIds: [sourceId], verifiedAt: checkedDay, reviewAfter: checkedDay, status: 'stale' }
        if (bundle.scholarships.some(existing => existing.id === record?.id || existing.slug === record?.slug)) throw Error('generated_scholarship_identity_collision')
        bundle.scholarships.push(record)
      }
      if (!existingSource) bundle.sources.push(source)
      if (!bound) bindings.entries.push({ canonicalKey, recordId: record.id, aliases })
      else bound.aliases = [...new Set([...bound.aliases, ...aliases])].sort()
      accepted.push({ proposalId: proposal.id, recordId: record.id, canonicalKey, action })
      pending.push({ record, reviewer: proposal.review!.reviewerId })
    } catch (error) { held.push({ proposalId: proposal.id, reason: error instanceof Error ? error.message : String(error) }) }
  }
  const validated = bundleSchema.parse(bundle)
  const content: Omit<ScholarshipIdentityImportReceipt, 'sha256'> = { format: 'studyinchina.scholarship-identity-import-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, scopeRegistrySha256: scope.sha256, inputCatalogSha256: inputHash, beforeCatalogSha256: beforeHash,
    outputCatalogSha256: await catalogSha256(validated), acceptedAt: options.acceptedAt, accepted, held }
  const receipt = { ...content, sha256: hash(canonicalJson(content)) }
  for (const { record, reviewer } of pending) {
    const entry = { entityType: 'scholarship' as const, recordId: record.id, identitySha256: identityFingerprint('scholarship', record), sourceIds: record.sourceIds,
      acceptedAt: options.acceptedAt, reviewer, receiptPath: options.receiptPath, receiptSha256: receipt.sha256 }
    const existing = acceptances.entries.findIndex(item => item.entityType === 'scholarship' && item.recordId === record.id)
    if (existing < 0) acceptances.entries.push(entry); else acceptances.entries[existing] = entry
  }
  return { bundle: validated, acceptances: identityAcceptanceLedgerSchema.parse(acceptances), bindings, receipt, replayed: false }
}
