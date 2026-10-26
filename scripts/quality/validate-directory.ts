import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { loadMaintenanceBundle } from '../maintenance/build-scope'
import { maintenanceScopeSchema, scopeContentSha256 } from '../maintenance/contracts'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { selectPublishedData } from '../../src/lib/data/publication'
import { identityAcceptanceLedgerSchema, identityFingerprint, canonicalIdentityJson } from '../../src/lib/data/identity-acceptance'
import { fieldVerificationLedgerSchema, fieldVerificationContentSha256, validateFieldVerification } from '../../src/lib/data/field-verification'
import { getTodayDate } from '../../src/lib/data/freshness'
import { getApplicationState } from '../../src/lib/data/admission'

const sha = (value: unknown) => createHash('sha256').update(canonicalIdentityJson(value)).digest('hex')
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
function readOptional(path: string, fallback: unknown) { return existsSync(path) ? read(path) : fallback }
export async function validateDirectory(root: string, today = getTodayDate()) {
  const bundle = loadMaintenanceBundle(root), dataDirectory = join(root, 'content/data')
  const scope = maintenanceScopeSchema.parse(read(join(root, 'content/maintenance/scope-272.v1.json')))
  if (scope.sha256 !== await scopeContentSha256(scope) || bundle.universities.length < 272
    || scope.schools.some(school => !bundle.universities.some(university => university.id === school.universityId))) throw new Error('directory_fixed_cohort_changed')
  const identities = identityAcceptanceLedgerSchema.parse(readOptional(join(dataDirectory, 'identity-acceptances.json'), { schemaVersion: 1, entries: [] })).entries
  const fields = fieldVerificationLedgerSchema.parse(readOptional(join(dataDirectory, 'field-verifications.json'), { schemaVersion: 1, entries: [] })).entries
  const seen = new Set<string>(), receipts = new Map<string, unknown>()
  const checkedReceipt = (receiptPath: string, expectedSha256: string, kind: 'identity' | 'field') => {
    const path = resolve(root, receiptPath), inside = relative(root, path)
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('directory_receipt_path_invalid')
    const realInside = relative(realpathSync(root), realpathSync(path))
    if (!realInside || realInside.startsWith('..') || isAbsolute(realInside)) throw new Error('directory_receipt_path_invalid')
    if (!receipts.has(path)) receipts.set(path, read(path))
    const receipt = receipts.get(path)
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error(`directory_${kind}_receipt_changed`)
    const { sha256, ...content } = receipt as Record<string, unknown>
    if (sha256 !== expectedSha256 || sha(content) !== sha256) throw new Error(`directory_${kind}_receipt_changed`)
    return content
  }
  for (const entry of identities) {
    const key = `${entry.entityType}:${entry.recordId}`
    if (seen.has(key)) throw new Error('directory_duplicate_identity_acceptance')
    seen.add(key)
    const list = entry.entityType === 'city' ? bundle.cities : entry.entityType === 'university' ? bundle.universities : entry.entityType === 'program' ? bundle.programs : bundle.scholarships
    const record = list.find(record => record.id === entry.recordId)
    if (!record || identityFingerprint(entry.entityType, record) !== entry.identitySha256
      || !entry.sourceIds.every(id => record.sourceIds.includes(id) && bundle.sources.some(source => source.id === id && source.official))) throw new Error('directory_identity_binding_invalid')
    checkedReceipt(entry.receiptPath, entry.receiptSha256, 'identity')
  }
  const fieldKeys = new Set<string>()
  for (const entry of fields) {
    const key = `${entry.entityType}:${entry.recordId}:${entry.fieldPath}`
    if (fieldKeys.has(key)) throw new Error('directory_duplicate_field_acceptance')
    fieldKeys.add(key)
    const verifiedDay = getTodayDate(new Date(entry.verifiedAt))
    // An expired historical receipt can remain intact, but cannot regain current visibility.
    if (verifiedDay > today || !validateFieldVerification(bundle, entry, verifiedDay)) throw new Error('directory_field_binding_invalid')
    const content = checkedReceipt(entry.receiptPath, entry.receiptSha256, 'field')
    const acceptedAt = typeof content.acceptedAt === 'string' ? new Date(content.acceptedAt) : undefined
    if (content.format !== 'studyinchina.field-import-receipt' || content.formatVersion !== 1
      || !acceptedAt || !Number.isFinite(+acceptedAt) || +acceptedAt < +new Date(entry.verifiedAt) || getTodayDate(acceptedAt) > today
      || !Array.isArray(content.accepted) || !content.accepted.some(value => value && typeof value === 'object'
        && value.recordId === entry.recordId && Array.isArray(value.fieldPaths) && value.fieldPaths.includes(entry.fieldPath))
      || !Array.isArray(content.fieldBindings) || !content.fieldBindings.some(value => value && typeof value === 'object'
        && value.entityType === entry.entityType && value.recordId === entry.recordId && value.fieldPath === entry.fieldPath
        && value.verificationSha256 === fieldVerificationContentSha256(entry))) throw new Error('directory_field_receipt_binding_invalid')
  }
  const directory = selectDiscoveryData(bundle, today, identities, fields), current = selectPublishedData(bundle, today)
  if (/"(?:receiptPath|objectKey|promptSha256|reviewerId|quote)"\s*:/u.test(JSON.stringify(directory))) throw new Error('directory_private_provenance_leak')
  const bySchool = new Map(directory.universities.map(university => [university.id, 0]))
  for (const program of directory.programs) bySchool.set(program.universityId, (bySchool.get(program.universityId) ?? 0) + 1)
  const originalSchoolIds = new Set(scope.schools.map(school => school.universityId))
  if (directory.universities.some(university => !originalSchoolIds.has(university.id)
    && (bySchool.get(university.id) ?? 0) < 1)) throw new Error('directory_new_school_requires_program')
  const allProgramCount = new Map(bundle.universities.map(university => [university.id, 0]))
  for (const program of bundle.programs) allProgramCount.set(program.universityId, (allProgramCount.get(program.universityId) ?? 0) + 1)
  return { format: 'studyinchina.directory-validation', formatVersion: 1, evaluatedForDate: today,
    integrityPassed: true, cohortSchools: scope.schools.length,
    directoryCounts: { universities: directory.universities.length, programs: directory.programs.length, scholarships: directory.scholarships.length },
    currentFactsCounts: { universities: current.universities.length, programs: current.programs.length, admissionCycles: current.admissionCycles.length, scholarships: current.scholarships.length },
    schoolCoverage: { directoryWithPrograms: [...bySchool.values()].filter(count => count > 0).length, directoryWithoutPrograms: [...bySchool.values()].filter(count => count === 0).length,
      rawWithoutPrograms: [...allProgramCount.values()].filter(count => count === 0).length },
    currentCycleStates: Object.fromEntries(['open', 'upcoming', 'closed', 'rolling', 'dates-published', 'not-announced', 'previous-cycle'].map(state => [state, current.admissionCycles.filter(cycle => getApplicationState(cycle, today) === state).length])),
    coverageComplete: false, notice: 'Integrity success certifies accepted data and safe projection only. It does not certify complete school catalogues or open applications.' }
}
async function main() {
  const result = await validateDirectory(process.cwd()), args = process.argv.slice(2)
  if (args.includes('--output')) { const output = resolve(args[args.indexOf('--output') + 1]); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`) }
  console.log(JSON.stringify(result))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'directory_validation_failed'); process.exitCode = 1 })
