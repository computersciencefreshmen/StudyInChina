import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { AdmissionCycle, AuditMeta, DataBundle, LocalizedText } from '../../src/lib/data/types'

type WindowState = 'closed' | 'open' | 'future' | 'deadline-not-passed' | 'unknown' | 'rolling' | 'previous-cycle-reference' | 'invalid-dates'
type Assessment = {
  windowState: WindowState
  deadlineState: 'expired' | 'not-expired' | 'missing' | 'invalid'
  opensOn: string | null
  deadline: string | null
  historicalReference: boolean
  issues: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const label = (name: LocalizedText) => name.zh || name.en || Object.values(name).find(Boolean) || ''
const unique = (values: string[]) => [...new Set(values)].sort()
const tally = <T>(rows: T[], key: (row: T) => string) => rows.reduce<Record<string, number>>((out, row) => {
  const value = key(row)
  out[value] = (out[value] || 0) + 1
  return out
}, {})

function validDate(value: string): boolean {
  return DATE.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}

export function chinaCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Only compares stored structured dates. No web fetching and no inference of discontinuation. */
export function assessDates(
  opensOn: string | null,
  deadline: string | null,
  dateStatus: AdmissionCycle['dateStatus'] | undefined,
  today: string,
): Assessment {
  const issues: string[] = []
  const deadlineState = deadline === null ? 'missing' : !validDate(deadline) ? 'invalid' : deadline < today ? 'expired' : 'not-expired'
  if (opensOn !== null && !validDate(opensOn)) issues.push('invalid-opening-date')
  if (deadlineState === 'invalid') issues.push('invalid-deadline')
  if (opensOn && deadline && opensOn > deadline) issues.push('opening-after-deadline')
  if (dateStatus === 'not-announced' && (opensOn || deadline)) issues.push('not-announced-with-stored-dates')
  if (dateStatus === 'rolling' && deadline) issues.push('rolling-with-explicit-deadline')
  let windowState: WindowState
  if (issues.some(issue => issue.startsWith('invalid-') || issue === 'opening-after-deadline')) windowState = 'invalid-dates'
  else if (deadlineState === 'expired') windowState = 'closed'
  else if (dateStatus === 'previous-cycle-reference') windowState = 'previous-cycle-reference'
  else if (opensOn && opensOn > today) windowState = 'future'
  else if (dateStatus === 'rolling') windowState = 'rolling'
  else if (deadline && opensOn && opensOn <= today) windowState = 'open'
  else if (deadline) windowState = 'deadline-not-passed'
  else windowState = 'unknown'
  return { windowState, deadlineState, opensOn, deadline,
    historicalReference: dateStatus === 'previous-cycle-reference' || deadlineState === 'expired', issues }
}

function selfTest(): void {
  const day = '2026-10-19'
  assert.equal(assessDates('2026-09-01', day, 'published', day).windowState, 'open', 'deadline day is inclusive')
  assert.equal(assessDates(null, '2026-10-18', 'rolling', day).windowState, 'closed', 'explicit expired deadline wins over rolling')
  assert.equal(assessDates('2026-10-20', '2026-11-01', 'published', day).windowState, 'future')
  assert.equal(assessDates(null, day, undefined, day).windowState, 'deadline-not-passed', 'missing opening date must not imply open')
  assert.equal(assessDates(null, null, undefined, day).windowState, 'unknown')
  assert.equal(assessDates(null, null, 'rolling', day).windowState, 'rolling')
  assert.equal(assessDates(null, '2026-02-30', 'published', day).windowState, 'invalid-dates')
  assert.equal(assessDates('2026-11-01', day, 'published', day).windowState, 'invalid-dates')
  assert.equal(assessDates(null, null, 'previous-cycle-reference', day).historicalReference, true)
  assert.equal(chinaCalendarDate(new Date('2026-10-18T16:00:00Z')), day, 'China calendar rolls over at UTC 16:00')
  assert.equal(chinaCalendarDate(new Date('2026-10-18T15:59:59Z')), '2026-10-18')
  console.log('11 deadline and Asia/Shanghai boundary assertions passed.')
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error('Missing value for --' + name)
  return value
}

export function generateAudit(inputDirectory: string, outputDirectory: string, today: string, batchSize: number): void {
  if (!validDate(today)) throw new Error('Expected --today YYYY-MM-DD')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Expected --batch-size between 1 and 100')
  const inputDir = path.resolve(inputDirectory)
  const outputDir = path.resolve(outputDirectory)
  if (outputDir === inputDir || outputDir.startsWith(inputDir + path.sep)) throw new Error('Output must not be inside the read-only input directory')
  const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' } as const
  const hashes: Record<string, string> = {}
  const raw = Object.fromEntries(Object.entries(files).map(([collection, filename]) => {
    const text = readFileSync(path.join(inputDir, filename + '.json'), 'utf8')
    hashes[filename + '.json'] = sha(text)
    return [collection, JSON.parse(text)]
  })) as DataBundle
  const snapshotSha256 = sha(JSON.stringify(hashes))
  const published = selectPublishedData(raw, today)
  const publishedIds = {
    universities: new Set(published.universities.map(row => row.id)),
    programs: new Set(published.programs.map(row => row.id)),
    cycles: new Set(published.admissionCycles.map(row => row.id)),
    scholarships: new Set(published.scholarships.map(row => row.id)),
  }
  const schools = new Map(raw.universities.map(row => [row.id, row]))
  const programs = new Map(raw.programs.map(row => [row.id, row]))
  const sources = new Map(raw.sources.map(row => [row.id, row]))
  const sourceUrls = (sourceIds: string[]) => unique(sourceIds.flatMap(id => sources.get(id)?.url || []))
  const auditMeta = (row: AuditMeta) => ({ status: row.status, verifiedAt: row.verifiedAt,
    reviewAfter: row.reviewAfter, reviewExpired: row.reviewAfter < today, sourceIds: row.sourceIds,
    sourceUrls: sourceUrls(row.sourceIds), missingSourceIds: row.sourceIds.filter(id => !sources.has(id)),
    officialWebsiteVerifiedThisRun: false as const })
  const cycles = raw.admissionCycles.map(row => {
    const program = programs.get(row.programId)
    return { id: row.id, programId: row.programId, universityId: program?.universityId || null,
      programName: program ? label(program.name) : null, academicYear: row.academicYear, intake: row.intake,
      dateStatus: row.dateStatus, published: publishedIds.cycles.has(row.id), ...auditMeta(row),
      assessment: assessDates(row.opensOn, row.closesOn, row.dateStatus, today) }
  })
  const scholarships = raw.scholarships.map(row => ({ id: row.id, name: label(row.name),
    declaredUniversityIds: row.universityIds, programIds: row.programIds,
    universityIds: unique([...row.universityIds, ...row.programIds.flatMap(id => programs.get(id)?.universityId || [])]),
    unresolvedProgramIds: row.programIds.filter(id => !programs.has(id)),
    applicationUrl: row.applicationUrl, published: publishedIds.scholarships.has(row.id), ...auditMeta(row),
    assessment: assessDates(null, row.deadline, undefined, today) }))
  const programRows = raw.programs.map(row => {
    const related = cycles.filter(cycle => cycle.programId === row.id)
    return { id: row.id, universityId: row.universityId, name: label(row.name), degreeLevel: row.degreeLevel,
      programUrl: row.programUrl, applicationUrl: row.applyUrl, published: publishedIds.programs.has(row.id),
      verificationScope: row.verificationScope || null, ...auditMeta(row),
      admissionCycleIds: related.map(cycle => cycle.id), scholarshipIds: scholarships.filter(scholarship =>
        scholarship.programIds.includes(row.id)).map(scholarship => scholarship.id),
      cycleWindowCounts: tally(related, cycle => cycle.assessment.windowState),
      deadlineAuditConclusion: related.length ? 'See per-cycle assessment; deadline closure does not mean discontinued.' : 'No stored cycle; official deadline recheck required.',
      discontinuedInferred: false as const }
  })
  const currentStates = new Set<WindowState>(['open', 'future', 'deadline-not-passed'])
  const unresolvedStates = new Set<WindowState>(['unknown', 'rolling', 'invalid-dates'])
  const schoolRows = raw.universities.map(row => {
    const relatedCycles = cycles.filter(cycle => cycle.universityId === row.id)
    const relatedScholarships = scholarships.filter(scholarship => scholarship.universityIds.includes(row.id))
    const relatedPrograms = programRows.filter(program => program.universityId === row.id)
    const assessments = [...relatedCycles, ...relatedScholarships].map(item => item.assessment)
    const currentWindowCount = assessments.filter(value => currentStates.has(value.windowState)).length
    const unknownOrRollingCount = assessments.filter(value => unresolvedStates.has(value.windowState)).length
    return { id: row.id, name: label(row.name), published: publishedIds.universities.has(row.id),
      officialUrl: row.officialUrl, admissionsUrl: row.admissionsUrl, ...auditMeta(row),
      programIds: relatedPrograms.map(program => program.id), admissionCycleIds: relatedCycles.map(cycle => cycle.id),
      scholarshipIds: relatedScholarships.map(scholarship => scholarship.id),
      cycleWindowCounts: tally(relatedCycles, cycle => cycle.assessment.windowState),
      scholarshipWindowCounts: tally(relatedScholarships, scholarship => scholarship.assessment.windowState),
      priority: { currentWindowCount, unknownOrRollingCount, programsWithoutCycle: relatedPrograms.filter(program => !program.admissionCycleIds.length).length,
        score: currentWindowCount * 100 + unknownOrRollingCount * 10 + relatedPrograms.filter(program => !program.admissionCycleIds.length).length },
      officialRecheckStatus: 'pending' as const }
  }).sort((a, b) => Number(b.published) - Number(a.published) || b.priority.score - a.priority.score || a.id.localeCompare(b.id))

  const batches = []
  for (let offset = 0; offset < schoolRows.length; offset += batchSize) {
    const members = schoolRows.slice(offset, offset + batchSize)
    batches.push({ id: 'schools-' + String(batches.length + 1).padStart(2, '0'),
      state: 'pending-official-recheck', universityIds: members.map(row => row.id),
      publicUniversityCount: members.filter(row => row.published).length,
      programIds: unique(members.flatMap(row => row.programIds)),
      admissionCycleIds: unique(members.flatMap(row => row.admissionCycleIds)),
      scholarshipIds: unique(members.flatMap(row => row.scholarshipIds)),
      sourceUrls: unique(members.flatMap(row => [row.officialUrl, ...(row.admissionsUrl ? [row.admissionsUrl] : []), ...row.sourceUrls])),
      currentWindowCount: members.reduce((sum, row) => sum + row.priority.currentWindowCount, 0),
      unknownOrRollingCount: members.reduce((sum, row) => sum + row.priority.unknownOrRollingCount, 0) })
  }
  const unattributed = scholarships.filter(row => row.universityIds.length === 0)
  const unattributedScholarshipBatches = []
  for (let offset = 0; offset < unattributed.length; offset += batchSize) {
    unattributedScholarshipBatches.push({ id: 'global-scholarships-' + String(unattributedScholarshipBatches.length + 1).padStart(2, '0'),
      state: 'pending-official-recheck', scholarshipIds: unattributed.slice(offset, offset + batchSize).map(row => row.id) })
  }
  const summary = {
    raw: { universities: raw.universities.length, programs: raw.programs.length, admissionCycles: raw.admissionCycles.length, scholarships: raw.scholarships.length, sources: raw.sources.length },
    published: { universities: published.universities.length, programs: published.programs.length, admissionCycles: published.admissionCycles.length, scholarships: published.scholarships.length },
    admissionCycleWindows: tally(cycles, row => row.assessment.windowState),
    scholarshipWindows: tally(scholarships, row => row.assessment.windowState),
    admissionCycleDeadlineStates: tally(cycles, row => row.assessment.deadlineState),
    scholarshipDeadlineStates: tally(scholarships, row => row.assessment.deadlineState),
    cyclesWithoutProgram: cycles.filter(row => !row.universityId).length,
    programsWithoutUniversity: programRows.filter(row => !schools.has(row.universityId)).length,
    programsWithoutCycle: programRows.filter(row => !row.admissionCycleIds.length).length,
    scholarshipsWithoutUniversityAttribution: unattributed.length,
    rawUniversitiesWithoutPublicIdentity: schoolRows.filter(row => !row.published).length,
    schoolBatches: batches.length, unattributedScholarshipBatches: unattributedScholarshipBatches.length,
    officialWebsiteVerifiedThisRun: 0,
  }
  assert.equal(new Set(batches.flatMap(batch => batch.universityIds)).size, raw.universities.length)
  assert.equal(batches.flatMap(batch => batch.universityIds).length, raw.universities.length)
  const queuedScholarships = new Set([...batches, ...unattributedScholarshipBatches].flatMap(batch => batch.scholarshipIds))
  assert.equal(queuedScholarships.size, raw.scholarships.length, 'Every scholarship must have a finite recheck batch')
  const queuedPrograms = new Set(batches.flatMap(batch => batch.programIds))
  const queuedCycles = new Set(batches.flatMap(batch => batch.admissionCycleIds))
  const orphanQueue = { programIds: programRows.filter(row => !queuedPrograms.has(row.id)).map(row => row.id),
    admissionCycleIds: cycles.filter(row => !queuedCycles.has(row.id)).map(row => row.id) }
  // One official page often supplies dates for many programs. Read it once,
  // then bind its wording to each intake rather than repeating network work.
  const pageGroups = new Map<string, { url: string; sourceIds: string[]; universityIds: string[];
    admissionCycleIds: string[]; scholarshipIds: string[]; windowStates: WindowState[] }>()
  const bindPage = (row: { id: string; sourceIds: string[]; assessment: Assessment }, universityIds: string[], kind: 'cycle' | 'scholarship') => {
    for (const sourceId of row.sourceIds) {
      const source = sources.get(sourceId)
      if (!source?.official) continue
      const group = pageGroups.get(source.url) || { url: source.url, sourceIds: [], universityIds: [],
        admissionCycleIds: [], scholarshipIds: [], windowStates: [] }
      group.sourceIds.push(sourceId)
      const bindings = kind === 'cycle' ? group.admissionCycleIds : group.scholarshipIds
      if (!bindings.includes(row.id)) {
        group.universityIds.push(...universityIds)
        bindings.push(row.id)
        group.windowStates.push(row.assessment.windowState)
      }
      pageGroups.set(source.url, group)
    }
  }
  cycles.forEach(row => bindPage(row, row.universityId ? [row.universityId] : [], 'cycle'))
  scholarships.forEach(row => bindPage(row, row.universityIds, 'scholarship'))
  const officialRecheckPages = [...pageGroups.values()].map(group => ({ url: group.url,
    sourceIds: unique(group.sourceIds), universityIds: unique(group.universityIds),
    admissionCycleIds: unique(group.admissionCycleIds), scholarshipIds: unique(group.scholarshipIds),
    windowCounts: tally(group.windowStates, value => value),
    currentWindowCount: group.windowStates.filter(value => currentStates.has(value)).length,
    unknownOrRollingCount: group.windowStates.filter(value => unresolvedStates.has(value)).length,
    officialWebsiteVerifiedThisRun: false })).sort((a, b) => b.currentWindowCount - a.currentWindowCount
      || b.unknownOrRollingCount - a.unknownOrRollingCount || a.url.localeCompare(b.url))
  const inventorySummary = { ...summary, distinctOfficialDateRecheckPages: officialRecheckPages.length,
    distinctOfficialDateRecheckPagesWithCurrentWindows: officialRecheckPages.filter(row => row.currentWindowCount > 0).length }
  const reportPath = path.join(outputDir, 'catalog-deadlines.json')
  const markdownPath = path.join(outputDir, 'catalog-deadlines.md')
  const progressPath = path.join(outputDir, 'official-recheck-progress.json')
  const existingBundle = [reportPath, markdownPath, progressPath].filter(existsSync)
  if (existingBundle.length) {
    if (existingBundle.length !== 3) throw new Error('Partial immutable audit bundle; use a unique --output-dir')
    const previous = JSON.parse(readFileSync(reportPath, 'utf8'))
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'))
    // Legacy reports did not store the capacity explicitly. Multiple school
    // batches establish it exactly; a single short legacy batch cannot do so.
    const previousBatchSize = previous.batchSize ?? (previous.batches?.length > 1 ? previous.batches[0].universityIds?.length : null)
    const matches = previous.today === today && previous.snapshotSha256 === snapshotSha256
      && previous.inputDir === inputDir && previousBatchSize === batchSize
      && progress.today === today && progress.snapshotSha256 === snapshotSha256
      && JSON.stringify(previous.inputFileSha256) === JSON.stringify(hashes)
      && JSON.stringify(previous.summary) === JSON.stringify(inventorySummary)
      && JSON.stringify(previous.batches) === JSON.stringify(batches)
      && JSON.stringify(previous.unattributedScholarshipBatches) === JSON.stringify(unattributedScholarshipBatches)
    if (!matches) throw new Error('Immutable audit date, snapshot or options differ; use a unique --output-dir')
    console.log(JSON.stringify({ result: 'reused immutable audit', today, inputDir, outputDir, snapshotSha256, ...inventorySummary }, null, 2))
    return
  }
  mkdirSync(outputDir, { recursive: true })
  const existingProgress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, 'utf8')) : null
  if (!existingProgress) writeFileSync(progressPath, JSON.stringify({ schemaVersion: 1, snapshotSha256, today,
    instruction: 'Update only after actually reading official pages. A completed date sweep is not official website verification. Never renew verifiedAt or reviewAfter from this report alone.',
    batches: [...batches, ...unattributedScholarshipBatches].map(batch => ({ batchId: batch.id, state: 'pending',
      completedUniversityIds: [], receipts: [], deployedCommit: null, deployedUrl: null })) }, null, 2) + '\n', { flag: 'wx' })
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), today, timeZone: 'Asia/Shanghai',
    inputDir, snapshotSha256, inputFileSha256: hashes, batchSize,
    auditType: 'automated-stored-date-inventory', officialWebsiteVerifiedThisRun: false,
    rules: [
      'A deadline equal to today remains valid through the end of that date in Asia/Shanghai.',
      'Closed means this stored intake deadline has passed. It never means the program is discontinued.',
      'deadline-not-passed means an explicit deadline remains; a missing opening date cannot prove applications are open.',
      'Scholarships have no structured opening date in this schema; unexpired scholarships are deadline-not-passed.',
      'Rolling and unknown dates need official rechecks and are never automatically renewed.',
      'Historical rows are retained for reference. No canonical fact, audit timestamp or publication status is mutated.',
      'Publication counts use the actual local selectPublishedData gate with this snapshot and audit date.',
      'School batches prioritize published identities, current windows, then unknown/rolling dates; all raw identities are included.',
      'Scholarship-to-university mapping unions explicit attribution and program parents, not a guarantee of eligibility for all programs.',
      'Official-recheck progress is preserved on reruns; compare snapshot hashes before reusing completion receipts.',
    ], summary: inventorySummary, progressFile: path.basename(progressPath),
    progressMatchesCurrentSnapshot: !existingProgress || existingProgress.snapshotSha256 === snapshotSha256,
    batches, unattributedScholarshipBatches, orphanQueue, officialRecheckPages,
    universities: schoolRows, programs: programRows, admissionCycles: cycles, scholarships,
    sources: raw.sources.map(row => ({ id: row.id, url: row.url, official: row.official, accessedAt: row.accessedAt })) }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  const table = (rows: Record<string, number>) => Object.entries(rows).map(([key, count]) => `| ${key} | ${count} |`).join('\n')
  const markdown = `# Catalogue deadline sweep: ${today}\n\n` +
    `This is an automated inventory of stored structured dates, **not new official website verification**. Official pages read in this run: **0**. The cutoff is inclusive in Asia/Shanghai. An expired intake is historical reference; it is not evidence that the program stopped operating.\n\n` +
    `Input: \`${inputDir}\`\n\nSnapshot SHA-256: \`${snapshotSha256}\`\n\n` +
    `| Scope | Universities | Programs | Admission cycles | Scholarships |\n|---|---:|---:|---:|---:|\n` +
    `| Raw | ${summary.raw.universities} | ${summary.raw.programs} | ${summary.raw.admissionCycles} | ${summary.raw.scholarships} |\n` +
    `| Published by current gate | ${summary.published.universities} | ${summary.published.programs} | ${summary.published.admissionCycles} | ${summary.published.scholarships} |\n\n` +
    `## Stored admission windows\n\n| State | Count |\n|---|---:|\n${table(summary.admissionCycleWindows)}\n\n` +
    `## Stored scholarship windows\n\n| State | Count |\n|---|---:|\n${table(summary.scholarshipWindows)}\n\n` +
    `Open requires both a nonfuture opening date and an unexpired deadline. Deadline-not-passed has a stored unexpired deadline but no structured opening date. Unknown and rolling require official rechecks. All classifications are per stored intake.\n\n` +
    `## Resumable official recheck queue\n\n` +
    `${summary.schoolBatches} school batches of at most ${batchSize}, covering all ${summary.raw.universities} raw identities and ${summary.published.universities} published identities. ${summary.unattributedScholarshipBatches} additional batches cover ${summary.scholarshipsWithoutUniversityAttribution} scholarships without university attribution. Schools with current windows and unresolved dates come first.\n\n` +
    `Use \`catalog-deadlines.json\` for exact IDs, university links, per-record source URLs and batch membership. Its \`officialRecheckPages\` deduplicates ${officialRecheckPages.length} official date source pages (${inventorySummary.distinctOfficialDateRecheckPagesWithCurrentWindows} with current windows), so one page read can support multiple matching intake records. Record actual official-page findings in \`official-recheck-progress.json\`; completion receipts require URL, accessed date and the official deadline wording. Keep this progress file when rerunning. Deploy and push each completed reviewed batch, recording commit and deployed URL. The generator changes no canonical data.\n\n` +
    `| Batch | Schools | Public | Programs | Cycles | Scholarships | Current windows | Unknown/rolling |\n|---|---:|---:|---:|---:|---:|---:|---:|\n` +
    batches.map(batch => `| ${batch.id} | ${batch.universityIds.length} | ${batch.publicUniversityCount} | ${batch.programIds.length} | ${batch.admissionCycleIds.length} | ${batch.scholarshipIds.length} | ${batch.currentWindowCount} | ${batch.unknownOrRollingCount} |`).join('\n') + '\n'
  writeFileSync(markdownPath, markdown, { flag: 'wx' })
  console.log(JSON.stringify({ today, inputDir, outputDir, snapshotSha256, ...inventorySummary }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--self-test')) selfTest()
  else generateAudit(option('input-dir', 'content/data'), option('output-dir', 'quality/deadline-sweep-' + chinaCalendarDate().replaceAll('-', '')),
    option('today', chinaCalendarDate()), Number(option('batch-size', '20')))
}
