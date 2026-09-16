import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTodayDate, isCurrentVerifiedRecord } from '../../src/lib/data/freshness'
import { getApplicationState } from '../../src/lib/data/admission'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'

const DAY = 86_400_000
const files = {
  universities: 'universities', programs: 'programs', scholarships: 'scholarships',
  admissionCycles: 'admission-cycles', cities: 'cities', sources: 'sources',
} as const
type Collection = keyof typeof files
type Finding = { code: string; field: string; priority: 0 | 1 | 2 | 3; action: string }
type Row = {
  collection: Collection; id: string; status: string; public: boolean;
  verifiedAt: string | null; reviewAfter: string | null; overdueDays: number;
  officialSourceIds: string[]; sourceUrls: string[]; findings: Finding[];
}

export function assertCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Audit date must be a real calendar date in YYYY-MM-DD form')
  }
  return value
}
function elapsedDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}
function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

/** Structural coverage is exhaustive. A row here does not imply its website was opened. */
export function buildComprehensiveDataAudit(data: DataBundle, today: string) {
  assertCalendarDate(today)
  const schemaResult = bundleSchema.safeParse(data)
  const published = selectPublishedData(data, today)
  const sourceMap = new Map(data.sources.map(source => [source.id, source]))
  const programMap = new Map(data.programs.map(program => [program.id, program]))
  const universityIds = new Set(data.universities.map(record => record.id))
  const cityIds = new Set(data.cities.map(record => record.id))
  const cyclesByProgram = new Map<string, DataBundle['admissionCycles']>()
  for (const cycle of data.admissionCycles) {
    const cycles = cyclesByProgram.get(cycle.programId) ?? []
    cycles.push(cycle)
    cyclesByProgram.set(cycle.programId, cycles)
  }
  const publicSets = Object.fromEntries(Object.keys(files).map(key => [key,
    new Set(published[key as Collection].map(record => record.id)),
  ])) as Record<Collection, Set<string>>
  const rows: Row[] = []

  for (const collection of Object.keys(files) as Collection[]) {
    const seen = new Set<string>()
    for (const record of data[collection]) {
      const sourceIds = 'sourceIds' in record ? record.sourceIds : [record.id]
      const officialSources = sourceIds.flatMap(id => sourceMap.get(id)?.official ? [sourceMap.get(id)!] : [])
      const row: Row = {
        collection, id: record.id, status: 'status' in record ? record.status : 'registered',
        public: publicSets[collection].has(record.id),
        verifiedAt: 'verifiedAt' in record ? record.verifiedAt : null,
        reviewAfter: 'reviewAfter' in record ? record.reviewAfter : null,
        overdueDays: 'reviewAfter' in record ? Math.max(0, elapsedDays(record.reviewAfter, today)) : 0,
        officialSourceIds: officialSources.map(source => source.id),
        sourceUrls: [...new Set(officialSources.map(source => source.url))], findings: [],
      }
      const add = (code: string, field: string, priority: Finding['priority'], action: string) => row.findings.push({ code, field, priority, action })
      if (seen.has(record.id)) add('duplicate_id', 'id', 0, 'Resolve the duplicate identity and all relationships before publication.')
      seen.add(record.id)
      for (const sourceId of sourceIds) if (!sourceMap.has(sourceId)) add('missing_source_reference', 'sourceIds', 0, `Register or correct the missing source ${sourceId}.`)
      if (!officialSources.length) add('no_official_source', 'sourceIds', 0, 'Locate and register an authoritative source; do not promote unsupported facts.')
      if ('verifiedAt' in record) {
        if (record.verifiedAt > today) add('future_verification', 'verifiedAt', 0, 'Correct a future check timestamp; an evaluation date cannot substitute for a real source check.')
        if (record.reviewAfter < record.verifiedAt) add('invalid_review_order', 'reviewAfter', 0, 'Correct review scheduling while preserving the actual source-check date.')
        if (record.status === 'verified' && row.overdueDays > 0) add('verified_overdue', 'status', 1, 'Mark stale without changing verifiedAt/reviewAfter; restore facts only after source-by-source verification.')
        if (record.status === 'stale') add('stale_evidence', 'status', 2, 'Open current official evidence, compare the exact intake and every exposed field, then record a real check date.')
        if (record.status === 'verified' && ['programs', 'scholarships', 'admissionCycles'].includes(collection) && elapsedDays(record.verifiedAt, record.reviewAfter) > 31) add('review_window_too_long', 'reviewAfter', 1, 'Schedule dynamic evidence review within 31 days of verification.')
        if (record.status === 'verified' && record.reviewAfter >= today && elapsedDays(today, record.reviewAfter) <= 7) add('review_due_within_seven_days', 'reviewAfter', 2, 'Recheck source evidence before the scheduled review expires.')
        if ('name' in record && !record.name.en) add('missing_english_identity', 'name.en', 2, 'Verify the official English identity or provide an explicitly reviewed translation.')
      }
      if ('accessedAt' in record) {
        if (record.accessedAt > today) add('future_source_access', 'accessedAt', 0, 'Correct the source access date using actual retrieval evidence.')
        if (elapsedDays(record.accessedAt, today) > 30) add('source_monthly_review_due', 'accessedAt', 2, 'Refetch source content and compare provenance; HTTP success alone does not verify any facts.')
        const duplicates = data.sources.filter(source => source.url === record.url)
        if (duplicates.length > 1) add('shared_source_url', 'url', 3, 'Deduplicate network retrieval by URL while retaining stable source IDs and dependent provenance.')
      }
      if ('cityId' in record) {
        if (!cityIds.has(record.cityId)) add('missing_city_reference', 'cityId', 0, 'Repair the university-to-city relationship.')
        if (!record.admissionsUrl) add('missing_admissions_route', 'admissionsUrl', 2, 'Locate the university international admissions entry point.')
        const programs = data.programs.filter(program => program.universityId === record.id && publicSets.programs.has(program.id))
        if (row.public && programs.length < 3) add('sparse_program_catalogue', 'programs', 2, 'Reconcile the official programme catalogue; record legitimate limited provision explicitly.')
      }
      if ('degreeLevel' in record) {
        if (!universityIds.has(record.universityId)) add('missing_university_reference', 'universityId', 0, 'Repair the program-to-university relationship.')
        if (record.status !== 'archived' && record.status !== 'draft') {
          if (record.durationMonths === null) add('missing_duration', 'durationMonths', 2, 'Capture program-specific study duration from official evidence.')
          if (!record.teachingLanguages.length) add('missing_teaching_language', 'teachingLanguages', 2, 'Capture the explicitly stated teaching language; do not infer it from website language.')
          if (!record.applyUrl) add('missing_application_route', 'applyUrl', 2, 'Follow the official application instructions and record the supported portal.')
          if (!record.languageRequirements.length && !record.details?.eligibility.length) add('missing_requirements', 'languageRequirements', 2, 'Capture requirements or an explicit no-prerequisite statement; absence is not exemption.')
          const cycles = cyclesByProgram.get(record.id) ?? []
          const publicCycles = cycles.filter(cycle => publicSets.admissionCycles.has(cycle.id))
          if (!publicCycles.length) add('no_current_disposition', 'admissionCycles', 1, 'Check the next official intake; preserve unknown dates if the new cycle has not been announced.')
          if (!publicCycles.some(cycle => cycle.tuitionStatus === 'confirmed' && cycle.tuitionCny !== null)) add('no_current_confirmed_tuition', 'admissionCycles.tuitionCny', 2, 'Locate current cycle-specific tuition and billing period; historical fees remain references.')
        }
      }
      if ('programId' in record) {
        if (!programMap.has(record.programId)) add('missing_program_reference', 'programId', 0, 'Repair the cycle-to-program relationship.')
        const state = getApplicationState(record, today)
        if (record.closesOn && record.closesOn < today) add('deadline_passed', 'closesOn', 3, 'Preserve the historical deadline and closed state; discover the next intake separately.')
        if (record.closesOn && record.closesOn >= today && elapsedDays(today, record.closesOn) <= 45) add('deadline_within_45_days', 'closesOn', 1, 'Recheck the deadline and application route at least every three days.')
        if (['open', 'upcoming', 'rolling', 'dates-published'].includes(state) && !isCurrentVerifiedRecord(record, today)) add('actionable_cycle_needs_recheck', 'status', 1, 'Prioritize live source review for this potentially available intake; do not infer that applications are open.')
        if (/conflict|冲突|противореч/i.test(Object.values(record.notes ?? {}).join(' '))) add('documented_source_conflict', 'notes', 1, 'Resolve against all cited official sources; keep conflicting fields unavailable until agreement exists.')
      }
      if ('coverage' in record) {
        for (const id of record.universityIds) if (!universityIds.has(id)) add('missing_university_reference', 'universityIds', 0, `Repair the scholarship relationship to ${id}.`)
        for (const id of record.programIds) if (!programMap.has(id)) add('missing_program_reference', 'programIds', 0, `Repair the scholarship relationship to ${id}.`)
        if (record.status !== 'draft' && record.status !== 'archived') {
          if (!record.deadline) add('scholarship_deadline_unannounced', 'deadline', 2, 'Locate the applicable intake and deadline; keep null when no official deadline is published.')
          else if (record.deadline < today) add('deadline_passed', 'deadline', 3, 'Preserve the expired scholarship cycle; never increment its year automatically.')
          if (!record.applicationUrl) add('missing_application_route', 'applicationUrl', 2, 'Record the provider-authorized scholarship application route.')
          if (Object.values(record.coverage).some(value => value === 'unknown' || value === null)) add('partial_scholarship_coverage', 'coverage', 2, 'Verify each benefit separately; unknown stipend does not imply zero funding.')
        }
      }
      if ('coordinates' in record && !record.coordinates) add('missing_coordinates', 'coordinates', 3, 'Verify city coordinates against an authoritative geographic source.')
      rows.push(row)
    }
  }
  const allFindings = rows.flatMap(row => row.findings)
  const tasks = rows.filter(row => row.findings.length).map(row => ({
    taskId: `${row.collection}:${row.id}`, collection: row.collection, recordId: row.id,
    priority: Math.min(...row.findings.map(finding => finding.priority)),
    officialUrls: row.sourceUrls,
    issueCodes: [...new Set(row.findings.map(finding => finding.code))],
    actions: row.findings.map(finding => ({ field: finding.field, action: finding.action })),
  })).sort((a, b) => a.priority - b.priority || a.taskId.localeCompare(b.taskId))
  return {
    schemaVersion: 1, evaluatedForDate: today,
    methodology: {
      scope: 'Every stored record in all six content/data collections; deterministic structural and freshness audit.',
      websiteVerification: 'This script makes no network requests and does not assert that any website was checked. Separate source-check receipts document real retrievals.',
      sourceAge: 'Source accessedAt older than 30 days triggers review; a fresh source timestamp never refreshes dependent records automatically.',
      publication: 'Public counts use the production selectPublishedData gate evaluated for the supplied China calendar date.',
      missingFields: 'Missing facts become follow-up tasks, not guessed values; a passed deadline is historical information, not corruption.',
    },
    summary: {
      rawRecords: Object.fromEntries(Object.keys(files).map(key => [key, data[key as Collection].length])),
      publicRecords: Object.fromEntries(Object.keys(files).map(key => [key, published[key as Collection].length])),
      totalRecords: rows.length, rowsWithFindings: tasks.length,
      findingsByCode: countBy(allFindings, finding => finding.code),
      tasksByPriority: countBy(tasks, task => String(task.priority)),
      verifiedOverdue: rows.filter(row => row.findings.some(finding => finding.code === 'verified_overdue')).length,
      statusByCollection: Object.fromEntries(Object.keys(files).map(key => [key, countBy(rows.filter(row => row.collection === key), row => row.status)])),
      schemaValid: schemaResult.success,
      structuralErrors: schemaResult.success ? [] : schemaResult.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    },
    records: rows, tasks,
  }
}

export function readAuditData(root: string): DataBundle {
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key,
    JSON.parse(readFileSync(resolve(root, 'content/data', `${file}.json`), 'utf8')),
  ])) as DataBundle
}

function main() {
  const args = process.argv.slice(2)
  let today = getTodayDate()
  let output: string | undefined
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--today') today = assertCalendarDate(args[++index] ?? '')
    else if (args[index] === '--output') output = args[++index]
    else throw new Error(`Unknown option: ${args[index]}`)
  }
  const report = buildComprehensiveDataAudit(readAuditData(process.cwd()), today)
  const snapshotHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key,
    createHash('sha256').update(readFileSync(resolve('content/data', `${file}.json`))).digest('hex'),
  ]))
  const target = resolve(output ?? `quality/audit-${today}-data.json`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify({ ...report, generatedAt: new Date().toISOString(), snapshotHashes }, null, 2)}\n`)
  console.log(JSON.stringify({ output: target, ...report.summary }, null, 2))
  if (!report.summary.schemaValid) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
