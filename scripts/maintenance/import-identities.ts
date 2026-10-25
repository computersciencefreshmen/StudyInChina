import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import type { DataBundle, Program, Scholarship, Source } from '../../src/lib/data/types'
import { bundleSchema } from '../../src/lib/data/schema'
import { htmlToText } from '../../workers/ingestion/src/rules'
import { identityAcceptanceLedgerSchema, identityFingerprint, type IdentityAcceptanceLedger } from '../../src/lib/data/identity-acceptance'
import { catalogSha256, loadMaintenanceBundle } from './build-scope'
import {
  canonicalJson, exportContentSha256, maintenanceCandidateExportSchema, maintenanceScopeSchema,
  programIdentityFieldsSchema, proposalContentSha256, scopeContentSha256,
  type MaintenanceProposal, type MaintenanceScope, type SourceEvidence, type ProgramIdentityFields,
} from './contracts'

export type IdentityBinding = { canonicalKey: string; recordId: string; aliases: string[] }
export type IdentityBindings = { schemaVersion: 1; entries: IdentityBinding[] }
export type IdentityImportReceipt = {
  format: 'studyinchina.identity-import-receipt'; formatVersion: 1; batchId: string; batchSha256: string;
  scopeRegistrySha256: string; inputCatalogSha256: string; outputCatalogSha256: string;
  acceptedAt: string; accepted: Array<{ proposalId: string; recordId: string; canonicalKey: string; action: 'created' | 'identity_accepted' }>;
  unchanged?: Array<{ proposalId: string; recordId: string; reason: 'identity_and_official_source_unchanged' }>;
  held: Array<{ proposalId: string; reason: string }>; sha256: string;
}

const sha256 = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')
const normalizeName = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
const normalizedText = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const schoolDay = (timestamp: string): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(timestamp))

/** A successful re-read can be an operational observation without becoming a new public fact. */
export function hasAcceptedIdentityWithOfficialUrl(bundle: DataBundle, ledger: IdentityAcceptanceLedger,
  entityType: 'program' | 'scholarship', record: Program | Scholarship, url: string, acceptedAt: string): boolean {
  if (record.status === 'draft' || record.status === 'archived' || record.verifiedAt > schoolDay(acceptedAt)) return false
  const official = new Map(bundle.sources.filter(source => source.official).map(source => [source.id, source]))
  if (!record.sourceIds.length || !record.sourceIds.every(id => official.has(id))) return false
  if (!record.sourceIds.some(id => official.get(id)?.url === url)) return false
  const fingerprint = identityFingerprint(entityType, record)
  return ledger.entries.some(entry => entry.entityType === entityType && entry.recordId === record.id
    && entry.identitySha256 === fingerprint && new Date(entry.acceptedAt) <= new Date(acceptedAt)
    && entry.sourceIds.length > 0 && entry.sourceIds.every(id => record.sourceIds.includes(id) && official.has(id)))
}

export function canonicalProgramIdentityKey(universityId: string, fields: ProgramIdentityFields): string {
  const identity = fields.officialProgramCode
    ? `code:${normalizeName(fields.officialProgramCode)}:department:${normalizeName(fields.departmentCode ?? '')}`
    : `name:${normalizeName(fields.name.zh ?? fields.name.en ?? '')}`
  return `${universityId}|${fields.degreeLevel}|${fields.programType}|${identity}`
}

function nameAliases(universityId: string, fields: ProgramIdentityFields): string[] {
  return [...new Set(Object.values(fields.name).map(name => `${universityId}|${fields.degreeLevel}|name:${normalizeName(name)}`))]
}

function assertOfficial(url: string, school: MaintenanceScope['schools'][number]): void {
  const hostname = new URL(url).hostname.toLowerCase()
  if (!school.officialHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error('source_outside_registered_school_hosts')
  }
}

function normalizeBindings(input: IdentityBindings): IdentityBindings {
  if (input.schemaVersion !== 1 || !Array.isArray(input.entries)) throw new Error('Unsupported identity binding ledger')
  const keys = new Set<string>()
  for (const entry of input.entries) {
    if (!entry.canonicalKey || !entry.recordId || !Array.isArray(entry.aliases)) throw new Error('Invalid identity binding')
    if (keys.has(entry.canonicalKey)) throw new Error('Duplicate canonical identity binding')
    keys.add(entry.canonicalKey)
  }
  return structuredClone(input)
}

function sourceText(bytes: Uint8Array, contentType: string): string {
  if (/pdf|image\//iu.test(contentType)) throw new Error('binary_source_requires_checksum_bound_text_artifact')
  const prefix = new TextDecoder().decode(bytes.slice(0, 2048))
  const encoding = /charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/iu.exec(contentType)?.[1]
    ?? /<meta\b[^>]*charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/iu.exec(prefix)?.[1] ?? 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  return /html/iu.test(contentType) ? htmlToText(text) : text
}

function assertLocatedQuote(evidence: SourceEvidence, text: string, raw?: Uint8Array): void {
  let located: string | undefined
  const lines = /^(?:text|lines?):(\d+)(?:-(\d+))?$/u.exec(evidence.locator)
  const offsets = /^text:offset:(\d+):(\d+)$/u.exec(evidence.locator)
  const page = /^page\s+(\d+)(?:\b.*)?$/iu.exec(evidence.locator)
  if (lines) {
    const start = Number(lines[1]), end = Number(lines[2] ?? lines[1])
    const content = text.split(/\r?\n/u)
    if (start >= 1 && end >= start && end <= content.length) located = content.slice(start - 1, end).join('\n')
  } else if (offsets) {
    const start = Number(offsets[1]), end = Number(offsets[2])
    if (end > start && end <= text.length) located = text.slice(start, end)
  } else if (page) located = text.split('\f')[Number(page[1]) - 1]
  else if (evidence.locator === 'document' || evidence.locator === 'text:document') located = text
  else if (evidence.locator.startsWith('css:') && raw) {
    const document = new JSDOM(new TextDecoder().decode(raw)).window.document
    located = document.querySelector(evidence.locator.slice(4))?.textContent ?? undefined
  } else if ((evidence.locator.startsWith('json:/') || evidence.locator.startsWith('/')) && raw) {
    const pointer = evidence.locator.replace(/^json:/u, '')
    let value: unknown = JSON.parse(new TextDecoder().decode(raw))
    for (const token of pointer.slice(1).split('/').map(token => token.replace(/~1/gu, '/').replace(/~0/gu, '~'))) {
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[token] : undefined
    }
    if (value !== undefined) located = typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (located === undefined || !normalizedText(located).includes(normalizedText(evidence.quote))) throw new Error('evidence_quote_not_at_locator')
}

/** The writer reads immutable artifacts; a producer/model's assertion alone never verifies a quote. */
export async function verifyReviewedProposalEvidence(proposal: MaintenanceProposal,
  school: MaintenanceScope['schools'][number], readArtifact: (key: string) => Promise<Uint8Array>, extraEvidence: SourceEvidence[] = []): Promise<void> {
  const review = proposal.review
  if (!review || review.decision !== 'approved' || !Object.values(review.checks).every(Boolean)) throw new Error('independent_identity_review_required')
  if (review.candidateSha256 !== await proposalContentSha256(proposal)
    || review.snapshotSha256 !== proposal.source.snapshotSha256) throw new Error('review_fingerprint_mismatch')
  if (review.method === 'independent_model') {
    if (!review.reviewAttemptId || !proposal.extractionAttemptId || review.reviewAttemptId === proposal.extractionAttemptId
      || !review.artifactKey || !review.reviewArtifactSha256) throw new Error('independent_model_receipt_required')
    const artifact = await readArtifact(review.artifactKey)
    if (sha256(artifact) !== review.reviewArtifactSha256) throw new Error('review_artifact_checksum_mismatch')
    const receipt = JSON.parse(new TextDecoder().decode(artifact)) as Record<string, unknown>
    if (receipt.candidateSha256 !== review.candidateSha256 || receipt.reviewAttemptId !== review.reviewAttemptId
      || receipt.decision !== 'approved') throw new Error('review_artifact_binding_mismatch')
  }
  const source = proposal.source
  assertOfficial(source.url, school)
  const rawBytes = await readArtifact(source.objectKey)
  if (sha256(rawBytes) !== source.snapshotSha256) throw new Error('source_snapshot_checksum_mismatch')
  let text: string
  if (source.textArtifact) {
    if (source.textArtifact.rawSnapshotSha256 !== source.snapshotSha256) throw new Error('text_artifact_raw_binding_mismatch')
    const bytes = await readArtifact(source.textArtifact.objectKey)
    if (sha256(bytes) !== source.textArtifact.sha256) throw new Error('text_artifact_checksum_mismatch')
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } else text = sourceText(rawBytes, source.contentType)
  const sourceEvidence: SourceEvidence = {
    sourceId: source.id, url: source.url, snapshotSha256: source.snapshotSha256, objectKey: source.objectKey,
    locator: source.locator, quote: source.quote,
  }
  const allEvidence = [sourceEvidence, ...proposal.fieldEvidence, ...extraEvidence]
  const evidenceTexts = new Map<string, { text: string; raw: Uint8Array; sha256: string }>([
    [source.objectKey, { text, raw: rawBytes, sha256: source.snapshotSha256 }],
  ])
  for (const evidence of allEvidence) {
    assertOfficial(evidence.url, school)
    let captured = evidenceTexts.get(evidence.objectKey)
    if (captured === undefined) {
      const bytes = await readArtifact(evidence.objectKey)
      if (sha256(bytes) !== evidence.snapshotSha256) throw new Error('evidence_snapshot_checksum_mismatch')
      captured = { text: sourceText(bytes, 'text/html'), raw: bytes, sha256: evidence.snapshotSha256 }
      evidenceTexts.set(evidence.objectKey, captured)
    }
    if (evidence.snapshotSha256 !== captured.sha256) throw new Error('evidence_snapshot_identity_conflict')
    if (!normalizedText(captured.text).includes(normalizedText(evidence.quote))) throw new Error('evidence_quote_not_found')
    assertLocatedQuote(evidence, captured.text, captured.raw)
  }
}

async function verifyProposalEvidence(proposal: MaintenanceProposal, fields: ProgramIdentityFields,
  school: MaintenanceScope['schools'][number], readArtifact: (key: string) => Promise<Uint8Array>): Promise<void> {
  assertOfficial(fields.programUrl, school)
  await verifyReviewedProposalEvidence(proposal, school, readArtifact, [fields.internationalAdmissionsEvidence])
  for (const [locale, name] of Object.entries(fields.name)) {
    const nameEvidence = proposal.fieldEvidence.filter(evidence => evidence.fieldPath === `name.${locale}`)
    if (!nameEvidence.some(evidence => normalizedText(evidence.quote).includes(normalizedText(name)))) throw new Error(`official_name_evidence_missing:${locale}`)
  }
  if (!proposal.fieldEvidence.some(evidence => evidence.fieldPath === 'degreeLevel')) throw new Error('degree_level_evidence_missing')
  for (const field of ['officialProgramCode', 'departmentCode'] as const) {
    const code = fields[field]
    if (code && !proposal.fieldEvidence.some(evidence => evidence.fieldPath === field
      && normalizedText(evidence.quote).includes(normalizedText(code)))) throw new Error(`official_code_evidence_missing:${field}`)
  }
  if (!/international|foreign|国际|外国|留学/iu.test(fields.internationalAdmissionsEvidence.quote)) throw new Error('international_admissions_scope_unproven')
  if (/^(?:international\s+)?(?:undergraduate|bachelor'?s?|master'?s?|doctoral|phd)\s+(?:degree\s+)?programs?$/iu.test(fields.name.en ?? '')) {
    throw new Error('generic_catalog_heading_is_not_program')
  }
}

export async function importIdentityCandidates(options: {
  bundle: DataBundle; scope: unknown; batch: unknown; acceptedAt: string; receiptPath: string;
  acceptances?: IdentityAcceptanceLedger; bindings?: IdentityBindings; appliedReceipts?: IdentityImportReceipt[];
  readArtifact: (key: string) => Promise<Uint8Array>;
}): Promise<{ bundle: DataBundle; acceptances: IdentityAcceptanceLedger; bindings: IdentityBindings; receipt: IdentityImportReceipt; replayed: boolean }> {
  const scope = maintenanceScopeSchema.parse(options.scope)
  const batch = maintenanceCandidateExportSchema.parse(options.batch)
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('Scope checksum mismatch')
  if (batch.sha256 !== await exportContentSha256(batch)) throw new Error('Candidate export checksum mismatch')
  if (batch.scopeRegistrySha256 !== scope.sha256) throw new Error('Candidate uses another fixed school scope')
  const original = bundleSchema.parse(options.bundle)
  const inputHash = await catalogSha256(original)
  const acceptances = identityAcceptanceLedgerSchema.parse(options.acceptances ?? { schemaVersion: 1, entries: [] })
  const bindings = normalizeBindings(options.bindings ?? { schemaVersion: 1, entries: [] })
  const prior = options.appliedReceipts?.find(receipt => receipt.batchId === batch.batchId)
  if (prior) {
    const { sha256: priorSha, ...content } = prior
    if (sha256(canonicalJson(content)) !== priorSha || prior.batchSha256 !== batch.sha256
      || inputHash !== prior.outputCatalogSha256) throw new Error('Previously consumed batch does not match current catalogue')
    return { bundle: original, acceptances, bindings, receipt: prior, replayed: true }
  }
  if (inputHash !== batch.inputCatalogSha256) throw new Error('Candidate base catalogue changed; regenerate or reconcile the batch')
  const acceptedAt = new Date(options.acceptedAt)
  if (!Number.isFinite(acceptedAt.valueOf()) || acceptedAt.toISOString() !== options.acceptedAt) throw new Error('acceptedAt must be a canonical ISO timestamp')
  const bundle = structuredClone(original)
  const accepted: IdentityImportReceipt['accepted'] = []
  const unchanged: NonNullable<IdentityImportReceipt['unchanged']> = []
  const held: IdentityImportReceipt['held'] = []
  const pendingAcceptances: Array<{ record: Program; reviewer: string }> = []
  const schools = new Map(scope.schools.map(school => [school.universityId, school]))
  for (const proposal of batch.proposals) {
    try {
      if (proposal.status !== 'ready') throw new Error('producer_held')
      if (proposal.entityType !== 'program') throw new Error('entity_type_has_no_identity_consumer')
      const school = schools.get(proposal.universityId)
      if (!school) throw new Error('school_outside_fixed_scope')
      const university = bundle.universities.find(university => university.id === school.universityId)
      if (!university) throw new Error('school_missing_from_catalogue')
      const fields = programIdentityFieldsSchema.parse(proposal.fields)
      if (proposal.scope.year !== null || proposal.scope.intake !== null) throw new Error('identity_must_not_claim_a_cycle')
      if (new Date(proposal.source.checkedAt) > acceptedAt || new Date(proposal.review?.reviewedAt ?? '') > acceptedAt) throw new Error('future_evidence_or_review')
      await verifyProposalEvidence(proposal, fields, school, options.readArtifact)
      const key = canonicalProgramIdentityKey(school.universityId, fields)
      const aliases = nameAliases(school.universityId, fields)
      const bound = bindings.entries.find(binding => binding.canonicalKey === key)
      const explicitId = proposal.recordId ?? bound?.recordId
      let record = explicitId ? bundle.programs.find(program => program.id === explicitId) : undefined
      if (explicitId && !record) throw new Error('mapped_record_missing')
      if (record && (record.universityId !== school.universityId || record.degreeLevel !== fields.degreeLevel)) throw new Error('mapped_identity_school_or_degree_conflict')
      if (record && !Object.values(record.name).some(name => name && Object.values(fields.name)
        .some(candidateName => normalizeName(candidateName) === normalizeName(name)))) throw new Error('mapped_identity_name_conflict')
      if (!record) {
        const matches = bundle.programs.filter(program => program.universityId === school.universityId
          && program.degreeLevel === fields.degreeLevel && Object.values(program.name).some(name => name
            && Object.values(fields.name).some(candidateName => normalizeName(candidateName) === normalizeName(name))))
        if (matches.length > 1) throw new Error('ambiguous_existing_program_identity')
        record = matches[0]
        if (record && fields.officialProgramCode && bindings.entries.some(binding => binding.recordId === record?.id
          && binding.canonicalKey.includes('|code:') && binding.canonicalKey !== key)) throw new Error('official_code_conflicts_with_existing_binding')
      }
      if (record?.status === 'archived' || record?.status === 'draft') throw new Error('draft_or_archived_identity_requires_separate_promotion')
      if (record && fields.officialProgramCode && bindings.entries.some(binding => binding.recordId === record?.id
        && binding.canonicalKey.includes('|code:') && binding.canonicalKey !== key)) throw new Error('official_code_conflicts_with_existing_binding')
      const action = record ? 'identity_accepted' as const : 'created' as const
      if (!record && fields.programUrl !== proposal.source.url) throw new Error('new_identity_program_url_requires_matching_source')
      if (bound && record && bound.recordId !== record.id) throw new Error('canonical_key_already_bound_to_another_record')
      if (record && hasAcceptedIdentityWithOfficialUrl(bundle, acceptances, 'program', record, proposal.source.url, options.acceptedAt)) {
        unchanged.push({ proposalId: proposal.id, recordId: record.id, reason: 'identity_and_official_source_unchanged' })
        continue
      }
      const date = schoolDay(proposal.source.checkedAt)
      const sourceId = `src-maintenance-identity-${sha256(proposal.source.url).slice(0, 24)}`
      const source: Source = {
        id: sourceId, url: proposal.source.url, title: `Official international program catalogue — ${school.name.en ?? school.name.zh ?? school.universityId}`,
        publisher: school.name.en ?? school.name.zh ?? school.universityId, kind: 'program', language: 'other', official: true, accessedAt: date,
      }
      if (!record) {
        const digest = sha256(key).slice(0, 24)
        record = {
          id: `program-${digest}`, slug: `${university.slug}-${fields.degreeLevel}-${digest}`,
          universityId: university.id, name: fields.name, degreeLevel: fields.degreeLevel, discipline: 'other',
          teachingLanguages: [], durationMonths: null, programUrl: fields.programUrl,
          applyUrl: null, languageRequirements: [], verificationScope: 'identity', sourceIds: [sourceId],
          verifiedAt: date, reviewAfter: date, status: 'verified',
        }
        if (bundle.programs.some(program => program.id === record?.id || program.slug === record?.slug)) throw new Error('generated_program_identity_collision')
        bundle.programs.push(record)
      }
      // Existing canonical facts and audit dates are never renewed by an identity-only review.
      if (!bundle.sources.some(item => item.id === sourceId)) bundle.sources.push(source)
      if (!record.sourceIds.some(id => bundle.sources.find(source => source.id === id)?.url === proposal.source.url)) {
        record.sourceIds = [...record.sourceIds, sourceId]
      }
      if (!bound) bindings.entries.push({ canonicalKey: key, recordId: record.id, aliases })
      else bound.aliases = [...new Set([...bound.aliases, ...aliases])].sort()
      accepted.push({ proposalId: proposal.id, recordId: record.id, canonicalKey: key, action })
      pendingAcceptances.push({ record, reviewer: proposal.review!.reviewerId })
    } catch (error) {
      held.push({ proposalId: proposal.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  const validated = bundleSchema.parse(bundle)
  const receiptContent: Omit<IdentityImportReceipt, 'sha256'> = {
    format: 'studyinchina.identity-import-receipt', formatVersion: 1,
    batchId: batch.batchId, batchSha256: batch.sha256, scopeRegistrySha256: scope.sha256,
    inputCatalogSha256: inputHash, outputCatalogSha256: await catalogSha256(validated), acceptedAt: options.acceptedAt, accepted, unchanged, held,
  }
  const receipt = { ...receiptContent, sha256: sha256(canonicalJson(receiptContent)) }
  for (const { record, reviewer } of pendingAcceptances) {
    const acceptance = {
      entityType: 'program' as const, recordId: record.id, identitySha256: identityFingerprint('program', record),
      sourceIds: record.sourceIds, acceptedAt: options.acceptedAt, reviewer,
      receiptPath: options.receiptPath, receiptSha256: receipt.sha256,
    }
    const old = acceptances.entries.findIndex(entry => entry.entityType === 'program' && entry.recordId === record.id)
    if (old < 0) acceptances.entries.push(acceptance)
    else acceptances.entries[old] = acceptance
  }
  return { bundle: validated, acceptances: identityAcceptanceLedgerSchema.parse(acceptances), bindings, receipt, replayed: false }
}

/** Reject traversal and symlinks outside the caller's verified artifact directory. */
export function localArtifactReader(artifactRoot: string): (key: string) => Promise<Uint8Array> {
  const root = realpathSync(resolve(artifactRoot))
  return async key => {
    if (isAbsolute(key)) throw new Error('Artifact keys must be relative')
    const target = realpathSync(resolve(root, key))
    const path = relative(root, target)
    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('Artifact path escapes snapshot root')
    return readFileSync(target)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const argument = (name: string) => args[args.indexOf(name) + 1]
  if (!['--batch', '--scope', '--artifacts', '--output'].every(name => args.includes(name))) {
    throw new Error('Usage: import-identities.ts --batch <export.json> --scope <scope.json> --artifacts <directory> --output <candidate-directory> [--root <repository>]')
  }
  const root = resolve(args.includes('--root') ? argument('--root') : process.cwd())
  const output = resolve(argument('--output'))
  const relativeOutput = relative(resolve(root, 'content', 'data'), output)
  if (relativeOutput !== '..' && !relativeOutput.startsWith(`..${sep}`) && !isAbsolute(relativeOutput)) throw new Error('Output must be a candidate directory outside canonical content/data')
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown
  const result = await importIdentityCandidates({
    bundle: loadMaintenanceBundle(root), scope: read(argument('--scope')), batch: read(argument('--batch')),
    acceptedAt: new Date().toISOString(), receiptPath: 'identity-import-receipt.json',
    readArtifact: localArtifactReader(argument('--artifacts')),
    ...(args.includes('--acceptances') ? { acceptances: read(argument('--acceptances')) as IdentityAcceptanceLedger } : {}),
    ...(args.includes('--bindings') ? { bindings: read(argument('--bindings')) as IdentityBindings } : {}),
    ...(args.includes('--receipts') ? { appliedReceipts: read(argument('--receipts')) as IdentityImportReceipt[] } : {}),
  })
  mkdirSync(output, { recursive: true })
  const files: Record<string, unknown> = { 'candidate-bundle.json': result.bundle,
    'identity-acceptances.json': result.acceptances, 'identity-bindings.json': result.bindings,
    'identity-import-receipt.json': result.receipt }
  for (const [name, value] of Object.entries(files)) writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, accepted: result.receipt.accepted.length, held: result.receipt.held.length, replayed: result.replayed, receiptSha256: result.receipt.sha256 }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
