const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = __dirname;
const primary = process.argv[2];
assert.ok(primary, 'Expected read-only primary workspace argument');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(readFileSync(path.join(primary, name), 'utf8'));
const local = name => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
const names = ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships'];
const inputFileSha256 = Object.fromEntries(names.map(name => [name + '.json', sha(readFileSync(path.join(primary, 'content/data/' + name + '.json')))]));
const snapshotSha256 = sha(JSON.stringify(inputFileSha256));
const planPath = 'quality/deadline-sweep-20261019/next-official-date-targets-v1.json';
const plan = read(planPath);
assert.equal(plan.snapshotSha256, snapshotSha256);
const cycles = new Map(read('content/data/admission-cycles.json').map(row => [row.id, row]));
const programs = new Map(read('content/data/programs.json').map(row => [row.id, row]));
const sources = new Map(read('content/data/sources.json').map(row => [row.id, row]));
const universityIds = plan.selectedUniversityIds.slice(16, 20);
assert.deepEqual(universityIds, ['uni-wenzhou-kean-university', 'uni-fudan-university', 'uni-renmin-university-of-china', 'uni-tsinghua-university']);
const selected = plan.selectedRecordIds.map(id => cycles.get(id)).filter(row => row && universityIds.includes(programs.get(row.programId).universityId));
assert.equal(selected.length, 14);
const prior = number => {
  const relative = '../official-batch-' + number + '/report.json';
  const bytes = readFileSync(path.join(root, relative));
  return { report: JSON.parse(bytes), pin: { batch: 'official-batch-' + number, reportSha256: sha(bytes) } };
};
const batch004 = prior('004'), batch007 = prior('007');
assert.equal(batch004.report.snapshotSha256, snapshotSha256);
assert.equal(batch007.report.snapshotSha256, snapshotSha256);
const previousWku = batch004.report.schools.find(row => row.universityId === universityIds[0]);
assert.equal(previousWku.error, 'web_open_timeout');
const sigs = batch007.report.guideEvidence.find(row => row.key === 'thu-sigs-specific-catalogue-and-guide');
const reusedCaptures = [sigs.source, sigs.catalogueQuerySource];
for (const capture of reusedCaptures) {
  assert.equal(sha(readFileSync(path.join(root, '../official-batch-007', capture.bodyPath))), capture.bodySha256);
}
const sigsText = readFileSync(path.join(root, '../official-batch-007', sigs.source.bodyPath), 'utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
assert.ok(compact(sigsText).includes(compact(sigs.dateQuote)));
const originalConflict = batch007.report.schools.flatMap(school => school.recordResults).find(row => row.recordId === 'cycle-2027-tsinghua-sigs-085700-02-master');
assert.equal(originalConflict.result, 'conflict');
assert.equal(originalConflict.catalogueDeadline, '2027-05-17');
const captures = local('current-capture-receipts.json');
const handbook = local('thu-program-handbook.receipt.json');
for (const capture of captures.filter(row => !row.error)) {
  assert.equal(sha(readFileSync(path.join(root, capture.rawPath))), capture.rawSha256);
  assert.equal(sha(readFileSync(path.join(root, capture.textPath))), capture.textSha256);
}
const fudan = captures.find(row => row.key === 'fudan-winter');
const visit = captures.find(row => row.key === 'thu-visiting');
const ruc = captures.find(row => row.key === 'ruc-nondegree');
assert.equal(fudan.httpStatus, 200); assert.equal(visit.httpStatus, 200);
assert.match(ruc.error, /CERTIFICATE_VERIFY_FAILED/);
const fudanText = readFileSync(path.join(root, fudan.textPath), 'utf8');
const visitText = readFileSync(path.join(root, visit.textPath), 'utf8');
assert.ok(fudanText.includes('Application Deadline for Non-Chinese: 11:00am, November 9, 2026'));
assert.ok(compact(visitText).includes(compact('Application for 2027 Spring Semester Enrolment: 15th Oct. 2026 - 30th Nov. 2026')));
assert.ok(compact(visitText).includes(compact('Application for 2026 Fall Semester Enrolment: 15th Mar. 2026 - 30th May 2026')));

const groups = [];
const addGroup = (key, school, ids, evidence, assess) => {
  const records = ids.map(id => {
    const cycle = cycles.get(id), program = programs.get(cycle.programId);
    assert.equal(program.universityId, school);
    const result = assess(cycle, program);
    if (result.result === 'unchanged') assert.equal(result.officialDeadline, cycle.closesOn);
    if (result.officialOpensOn) assert.equal(result.officialOpensOn, cycle.opensOn);
    const sourceIds = cycle.sourceIds.filter(id => sources.get(id).url === evidence.sourceUrl);
    assert.ok(sourceIds.length, 'Evidence URL must be bound by the actual raw cycle');
    return { collection: 'admissionCycles', recordId: id, programId: program.id, universityId: school,
      degreeLevel: program.degreeLevel, academicYear: cycle.academicYear, intake: cycle.intake,
      storedOpensOn: cycle.opensOn, storedDeadline: cycle.closesOn, storedDateStatus: cycle.dateStatus,
      canonicalCycleSha256: sha(JSON.stringify(cycle)), canonicalProgramSha256: sha(JSON.stringify(program)),
      evidenceSourceIds: sourceIds, sourceIds: cycle.sourceIds, publicationBefore: false,
      dateOnly: true, fullFactsCertified: false, canonicalWritePerformed: false, freshnessRenewed: false,
      ...result };
  });
  groups.push({ key, universityId: school, ...evidence, records });
};
const idsFor = school => selected.filter(row => programs.get(row.programId).universityId === school).map(row => row.id);
addGroup('wku-identical-source-cooldown', universityIds[0], idsFor(universityIds[0]), {
  sourceUrl: previousWku.sourceUrl, evidenceMode: 'reused-prior-failure-cooldown', newOfficialWebsiteRead: false,
  originalObservedAt: previousWku.observedAt, priorReportPin: batch004.pin, originalFailure: previousWku.error,
  priorFailureScope: 'The same URL timed out for the architecture transfer route in batch004; no new site or network condition is available.',
  scope: 'Four additional stored spring2027 transfer routes. Shared URL failure is reused, not their deadline verification.',
  retryPolicy: 'Do not immediately repeat an unchanged failed URL. Reattempt only after source/network conditions change or an explicit later bounded recovery window.'
}, () => ({ result: 'blocked', officialDeadline: null, officialOpensOn: null, reason: 'reused-source-timeout-cooldown-no-new-date-evidence' }));
addGroup('fudan-winter-non-chinese-applicants', universityIds[1], idsFor(universityIds[1]), {
  sourceUrl: fudan.url, evidenceMode: 'new-official-read', newOfficialWebsiteRead: true, capture: fudan,
  observedAt: fudan.completedAt, scope: 'Fudan International Winter Session2026, Dec21,2026–Jan8,2027; non-Chinese student deadline only.',
  dateQuote: 'Application Deadline for Non-Chinese: 11:00am, November 9, 2026 (Beijing time)',
  evidenceLocator: 'Important Deadline / non-Chinese application deadline',
  excludedDates: 'Early-bird August31, Chinese-applicant November23, and payment December7 are different routes or actions.'
}, () => ({ result: 'unchanged', officialDeadline: '2026-11-09', officialCutoffAt: '2026-11-09T11:00:00+08:00', officialOpensOn: null,
  deadlineBoundary: 'exact-time', openingDateResult: 'not-assessed', precisionNote: 'The full deadline day is not available after11:00Beijing time.' }));
addGroup('ruc-pdf-certificate-failure', universityIds[2], idsFor(universityIds[2]), {
  sourceUrl: ruc.url, evidenceMode: 'new-attempt-blocked', newOfficialWebsiteRead: false, failure: ruc,
  scope: 'Three stored non-degree routes sharing the same exact RUC brochure. Neither original year nor October15–November15 dates could be read.',
  acquisitionFailures: ['Web PDF parser timed out.', 'Python TLS: CERTIFICATE_VERIFY_FAILED self-signed certificate.', 'Windows curl/Schannel: SEC_E_UNTRUSTED_ROOT; no certificate validation bypass.'],
  requiresChangedCondition: 'A trusted TLS route or newly accessible official source; no repeated immediate attempts.'
}, () => ({ result: 'blocked', officialDeadline: null, officialOpensOn: null, reason: 'official-pdf-unreadable-with-trusted-tls' }));
const visitingIds = idsFor(universityIds[3]).filter(id => id.includes('visiting-student'));
addGroup('thu-visiting-current-2026-2027-guide', universityIds[3], visitingIds, {
  sourceUrl: visit.url, evidenceMode: 'new-official-read', newOfficialWebsiteRead: true, capture: visit, observedAt: visit.completedAt,
  scope: 'Full current Admission to Visiting Student Program2026/2027 page, with separately printed Fall2026 and Spring2027 schedules.',
  springQuote: '2027 Spring Semester Enrolment: 15th Oct. 2026 - 30th Nov. 2026',
  previousAutumnSchedule: { intakeYear: 2026, opensOn: '2026-03-15', closesOn: '2026-05-30' },
  handbookAttempt: handbook, handbookUsedAsEvidence: false,
  relativeRecommendation: 'One-to-two-weeks-early submission is advice, not a replacement deadline.'
}, cycle => cycle.intake === 'spring' ? {
  result: 'unchanged', officialOpensOn: '2026-10-15', officialDeadline: '2026-11-30', deadlineBoundary: 'date-only-no-time-stated'
} : { result: 'unknown', officialOpensOn: null, officialDeadline: null,
  reason: 'No2027autumn schedule in the current2026/2027guide. Its2026fallMay30must not roll into2027or certify the storedMay15.' });
const sigsIds = idsFor(universityIds[3]).filter(id => id.includes('sigs-'));
addGroup('thu-sigs-raw-routes-prior-007-evidence', universityIds[3], sigsIds, {
  sourceUrl: sigs.source.url, evidenceMode: 'reused-prior-official-capture', newOfficialWebsiteRead: false,
  priorReportPin: batch007.pin, originalObservedAt: sigs.source.completedAt, priorCapturedSources: reusedCaptures,
  priorEvidenceBaseDirectory: 'quality/deadline-sweep-20261019/official-batch-007',
  dateQuote: sigs.dateQuote, generalDeadline: sigs.generalDeadline, generalCutoffAt: sigs.generalCutoffAt,
  scope: 'General2027internationalgraduate application deadline for four held raw master/doctoral routes; no programme-identity or full-fact renewal.',
  openingDateQualification: '即日起 is relative wording. The stored2026-09-18opening is not newly confirmed as an explicit calendar date.',
  fundingQualification: 'Funding advice to apply early is not a separate student scholarship cutoff.'
}, (cycle, program) => program.name.zh.includes('绿色环境基础设施') ? {
  result: 'conflict', officialDeadline: null, officialCutoffAt: null, officialOpensOn: null,
  openingDateResult: 'unknown-relative-wording', generalGuideDeadline: '2027-05-15', generalGuideCutoffAt: '2027-05-15T17:00:00+08:00',
  specificProgrammeCatalogueDeadline: '2027-05-17', specificProgrammeCatalogueCutoffAt: '2027-05-17T17:00:00+08:00',
  specificProgramme: { majorCode: originalConflict.majorCode, directionCode: originalConflict.directionCode, chineseName: originalConflict.catalogueChineseName },
  reason: 'Same named Green Environmental Infrastructure route has the007specific catalogue May17/general guide May15 conflict; no automatic precedence or change.'
} : { result: 'unchanged', officialDeadline: '2027-05-15', officialCutoffAt: '2027-05-15T17:00:00+08:00', officialOpensOn: null,
  deadlineBoundary: 'exact-time', openingDateResult: 'unknown-relative-wording' });
const records = groups.flatMap(group => group.records);
assert.equal(records.length, 14); assert.equal(new Set(records.map(row => row.recordId)).size, 14);
assert.deepEqual(new Set(records.map(row => row.recordId)), new Set(selected.map(row => row.id)));
const outcomes = records.reduce((out, row) => (out[row.result] = (out[row.result] || 0) + 1, out), {});
assert.deepEqual(outcomes, { blocked: 7, unchanged: 5, unknown: 1, conflict: 1 });
for (const name of names) assert.equal(sha(readFileSync(path.join(primary, 'content/data/' + name + '.json'))), inputFileSha256[name + '.json']);
const report = { schemaVersion: 1, batchId: 'official-date-only-011-20261019', auditDate: '2026-10-19', timeZone: 'Asia/Shanghai',
  state: 'completed-with-source-cooldowns-one-unknown-one-conflict', completedAt: new Date().toISOString(), snapshotSha256, inputFileSha256,
  selection: 'Exactly selectedUniversityIds17–20 from the pinned next-official-date-targets-v1.json: WKU4,Fudan1,RUC3,Tsinghua6.',
  targetPlan: planPath, targetPlanSha256: sha(readFileSync(path.join(primary, planPath))),
  acquisition: { newDistinctOfficialUrlsAttempted: 4, newDistinctOfficialUrlsReadSuccessfully: 2,
    newDateEvidenceSourcesRead: 2, reusedPriorSuccessfulCaptureSources: 2, reusedPriorFailureSourceUrls: 1,
    noNewWkuRequests: true, noNewSigsRequests: true, noCertificateBypass: true,
    toolParserFailureAndNativeFallbackRequestsAreNotDistinctOfficialSources: true,
    rawCurrentCaptures: captures.filter(row => !row.error).map(row => ({ url: row.url, rawPath: row.rawPath, rawSha256: row.rawSha256 })) },
  priorReportPins: [batch004.pin, batch007.pin],
  summary: { universitiesWithScopedChecks: 4, recordsAssessed: records.length, recordResults: outcomes,
    canonicalWrites: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0, paidModelCalls: 0, publicationActions: 0 },
  groups, dateCheckedRecordIds: records.filter(row => row.result === 'unchanged').map(row => row.recordId),
  unresolvedDateRecordIds: records.filter(row => row.result !== 'unchanged').map(row => row.recordId),
  limitations: ['No canonical, shared progress, Git or publication changes.',
    'Prior source reads retain their original timestamps/hashes and do not count as new official website reads.',
    'A matched deadline does not confirm a stored opening date based on relative wording, other facts, or the complete programme catalogue.',
    'Blocked PDFs, missing2027autumn schedules and conflicting programme deadlines remain unresolved. No year or date is rolled forward.'] };
writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ records: records.length, outcomes, reportSha256: sha(readFileSync(path.join(root, 'report.json'))) }, null, 2));
