/* Immutable scoped date-only observations. Reads current primary catalogue; no catalogue writes. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const local = __dirname;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rowHash = (row) => hash(JSON.stringify(row));
const now = new Date();
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now), '2026-10-19', 'This immutable report is scoped to 2026-10-19 only.');
const files = ['sources.json', 'cities.json', 'universities.json', 'programs.json', 'admission-cycles.json', 'scholarships.json'];
const fileHashes = () => Object.fromEntries(files.map((f) => [f, hash(fs.readFileSync(path.join(root, 'content/data', f)))]));
const before = fileHashes();
const audit = read(path.join(root, 'quality/deadline-sweep-20261019/catalog-deadlines.json'));
assert.deepEqual(before, audit.inputFileSha256);
const planRelative = 'quality/deadline-sweep-20261019/next-official-date-targets-v2.json';
const planBytes = fs.readFileSync(path.join(root, planRelative));
const plan = JSON.parse(planBytes);
const schoolIds = plan.selectedUniversityIds.slice(14, 20);
const programs = read(path.join(root, 'content/data/programs.json'));
const cycles = read(path.join(root, 'content/data/admission-cycles.json'));
const awards = read(path.join(root, 'content/data/scholarships.json'));
const sources = read(path.join(root, 'content/data/sources.json'));
const sourceById = new Map(sources.map((s) => [s.id, s]));
const programById = new Map(programs.map((p) => [p.id, p]));
const cycleById = new Map(cycles.map((c) => [c.id, c]));
const awardById = new Map(awards.map((a) => [a.id, a]));
const selectedIds = plan.selectedRecordIds.filter((id) => {
  const c = cycleById.get(id);
  const a = awardById.get(id);
  return c ? schoolIds.includes(programById.get(c.programId).universityId) : a?.universityIds.some((u) => schoolIds.includes(u));
});
assert.equal(selectedIds.length, 14);
const captureBytes = fs.readFileSync(path.join(local, 'capture-manifest.json'));
const captures = JSON.parse(captureBytes);
const captureByName = new Map(captures.map((c) => [c.name, c]));
for (const c of captures) {
  if (c.rawPath) assert.equal(hash(fs.readFileSync(path.join(local, c.rawPath))), c.rawSha256);
  if (c.textPath) assert.equal(hash(fs.readFileSync(path.join(local, c.textPath))), c.textSha256);
}
const text = (name) => fs.readFileSync(path.join(local, captureByName.get(name).textPath), 'utf8');
const quote = (name, fragment) => { assert.ok(text(name).includes(fragment), `${name}: missing literal evidence`); return fragment; };
const evidence = (name) => {
  const c = captureByName.get(name);
  return { sourceUrl: c.url, observedAt: c.observedAt, rawPath: c.rawPath || null, rawSha256: c.rawSha256 || null, textPath: c.textPath || null, textSha256: c.textSha256 || null, acquisitionSucceeded: c.captureSucceeded, ...(c.error ? { error: c.error } : {}) };
};
function base(id) {
  const c = cycleById.get(id);
  const a = awardById.get(id);
  const p = c && programById.get(c.programId);
  const row = c || a;
  assert.ok(selectedIds.includes(id));
  assert.equal(c ? c.closesOn : a.deadline, null);
  return {
    collection: c ? 'admissionCycles' : 'scholarships', recordId: id,
    universityId: c ? p.universityId : a.universityIds[0],
    ...(c ? { programId: p.id, degreeLevel: p.degreeLevel, programName: p.name.en, academicYear: c.academicYear, intake: c.intake, storedOpensOn: c.opensOn, storedDateStatus: c.dateStatus, canonicalCycleSha256: rowHash(c), canonicalProgramSha256: rowHash(p) } : { programIds: a.programIds, name: a.name.en, canonicalScholarshipSha256: rowHash(a) }),
    canonicalRowSha256: rowHash(row), storedDeadline: c ? c.closesOn : a.deadline,
    sourceIds: row.sourceIds, sourceUrls: row.sourceIds.map((s) => sourceById.get(s).url),
    publicationBefore: false, dateOnly: true, fullFactsCertified: false,
    canonicalWritePerformed: false, freshnessRenewed: false,
    officialOpensOn: null, openingDateAssessed: false,
    canonicalDateEqualityConfirmed: false,
  };
}
const groups = [];
function group(key, universityId, names, config) {
  const ids = selectedIds.filter((id) => base(id).universityId === universityId);
  groups.push({ key, universityId, evidenceMode: 'new-current-official-source-capture', newOfficialWebsiteRead: true, evidence: names.map(evidence), ...config(ids) });
}
const closed = (id, officialDeadline, extra = {}) => ({ ...base(id), result: 'closed', officialDeadline, candidateOfficialDeadline: officialDeadline, candidateOnly: true, canonicalDeadlineAssessed: false, closureAssessment: { asOfDate: '2026-10-19', timeZone: 'Asia/Shanghai', comparison: 'explicit-same-2026-route-deadline-is-before-audit-day', appliesTo2027Successor: false }, ...extra });
const unknown = (id, reason, extra = {}) => ({ ...base(id), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, candidateOnly: false, canonicalDeadlineAssessed: false, reason, ...extra });

group('csu-2026-english-undergraduate', schoolIds[0], ['csu-2026-english-undergraduate'], (ids) => ({
  scope: '2026 English-taught international undergraduate admission, specifically the two stored named CSU-Dundee programmes. Same 2026 intake year; no transfer to a 2027 intake.',
  officialTitle: quote('csu-2026-english-undergraduate', '2026 Application Guide to English-taught Undergraduate Programs for International Students in Central South University'),
  quotedDate: quote('csu-2026-english-undergraduate', 'From now on to May 31, 2026'),
  applicationActor: 'prospective international undergraduate applicant',
  openingQualifier: 'From now on is relative; no exact opening date is asserted.',
  endBoundaryQualifier: 'No cutoff clock time or explicit before operator is stated.',
  routeNameQuotes: ['Computing Science', 'Mechanical Engineering'].map((s) => quote('csu-2026-english-undergraduate', s)),
  records: ids.map((id) => closed(id, '2026-05-31', { reason: 'same-2026-named-english-undergraduate-route-explicit-application-deadline-expired', evidenceSourceIds: base(id).sourceIds, candidateOfficialOpensOn: null, deadlinePrecision: 'date', routeYearMatch: true })),
}));
group('cust-recurring-partial-scholarship-with-2023-context', schoolIds[1], ['cust-partial-software-scholarship'], (ids) => ({
  scope: 'English-taught Software Engineering bachelor partial-scholarship route. The page has no current year binding; do not apply its recurring month/day to a 2026-2027 fee-reference record with intake other.',
  quotedDate: quote('cust-partial-software-scholarship', 'Deadline of Applicants is December 20th for Spring intake, and May 31st for Autumn intake.'),
  historicalYearContext: quote('cust-partial-software-scholarship', 'the test time is approximately June 2023, and the specific time will be notified separately'),
  recurringDeadlineReferences: [{ intake: 'spring', monthDay: '12-20', year: null }, { intake: 'autumn', monthDay: '05-31', year: null }],
  records: ids.map((id) => unknown(id, 'unbound-year-recurring-scholarship-dates-with-2023-context-no-exact-current-intake-date', { evidenceSourceIds: base(id).sourceIds.filter((s) => sourceById.get(s).url === captureByName.get('cust-partial-software-scholarship').url), currentAcademicYearBound: false })),
}));
group('csust-2026-2027-silk-road-award', schoolIds[2], ['csust-admissions-index', 'csust-silk-road-2026-2027'], (ids) => ({
  scope: 'Exactly the stored 2026/2027 Silk Road Chinese Government Scholarship; designated New Energy Science and Engineering bachelor and Power Engineering and Engineering Thermophysics master routes.',
  officialTitle: quote('csust-silk-road-2026-2027', 'Changsha University of Science and Technology 2026/2027 Academic Year “Silk Road” Chinese Government Scholarship Program Admission Brochure'),
  quotedDate: quote('csust-silk-road-2026-2027', 'May 22, 2026'),
  applicantDeadlineHeading: quote('csust-silk-road-2026-2027', 'VI. Application Deadline'),
  applicationActor: 'scholarship applicant',
  processQualifier: 'The separate later CSC submission after university preliminary review must be made by its specified deadline; that unspecified step is not substituted for the published applicant deadline.',
  endBoundaryQualifier: 'No cutoff clock time or explicit before operator is stated.',
  records: ids.map((id) => closed(id, '2026-05-22', { reason: 'same-explicit-2026-2027-silk-road-scholarship-applicant-deadline-expired', evidenceSourceIds: base(id).sourceIds, derivedEvidenceUrl: captureByName.get('csust-silk-road-2026-2027').url, evidenceDiscovery: 'exact-current-year-detail-linked-from-canonical-official-admission-index', deadlinePrecision: 'date', routeYearMatch: true })),
}));
group('cuit-2026-autumn-master-guide-and-catalogue', schoolIds[3], ['cuit-guide'], (ids) => ({
  scope: 'The PDF itself is the 2026 international postgraduate guide, only autumn admission, masters duration three years. All four exact stored master route names appear in its same-year catalogue.',
  quotedDate: quote('cuit-guide', '2026年3月1日——2026年6月30日'),
  quotedDateEnglish: quote('cuit-guide', 'From March 1, 2026 to June 30, 2026'),
  intakeQuote: quote('cuit-guide', 'Currently, the university only'),
  evidencePages: { yearAndTitle: 1, autumnAndApplicantDates: 3, names: [11, 12] },
  visuallyInspectedRenders: ['cuit-date-page-03.png', 'cuit-catalogue-page-11.png', 'cuit-catalogue-page-12.png'],
  routeNameQuotes: ['人工智能', '环境科学与工程', '大气科学', '社会工作'].map((s) => quote('cuit-guide', s)),
  applicationActor: 'international master applicant submitting complete materials by email within the application period',
  endBoundaryQualifier: 'No cutoff clock time or explicit before operator is stated.',
  records: ids.map((id) => closed(id, '2026-06-30', { reason: 'same-2026-autumn-master-guide-and-exact-catalogue-route-deadline-expired', evidenceSourceIds: base(id).sourceIds.filter((s) => sourceById.get(s).url === captureByName.get('cuit-guide').url), candidateOfficialOpensOn: '2026-03-01', openingDateAssessed: false, openingCandidateOnly: true, deadlinePrecision: 'date', routeYearMatch: true })),
}));
group('cdut-china-link-current-source-412-cooldown', schoolIds[4], ['cdut-china-link'], (ids) => ({
  evidenceMode: 'new-official-url-attempt-failed-with-one-bounded-native-fallback', newOfficialWebsiteRead: false,
  scope: 'Exact stored 2026-2027 China Link cycle and associated award; the current official page remains inaccessible.',
  failedRecovery: 'web.open returned HTTP 412 and one normal-TLS bounded native fallback returned HTTP 412; no repeated retry.',
  retryPolicy: 'cooldown-until-source-or-network-condition-changes',
  storedUnconfirmedRestrictions: { rollingApplications: true, latestStudyStartOn: '2027-08-31', latestStudyStartIsApplicationDeadline: false, bothUniversityAndCSCSubmissionsRequired: true },
  restrictionsEvidenceStatus: 'stored-canonical-not-reconfirmed-in-this-batch',
  records: ids.map((id) => ({ ...base(id), result: 'blocked', officialDeadline: null, candidateOfficialDeadline: null, candidateOnly: false, canonicalDeadlineAssessed: false, reason: 'official-source-412-after-one-bounded-native-recovery-current-date-not-reconfirmed', evidenceSourceIds: base(id).sourceIds, mustNotConvertLatestStudyStartToDeadline: true })),
}));
group('cdutcm-2026-self-funded-doctorate-and-separate-awards', schoolIds[5], ['cdutcm-2026-self-funded'], (ids) => ({
  scope: 'The official 2026 self-funded foreign postgraduate call explicitly includes doctorate, while the two freshman government awards defer application arrangements to other notices.',
  officialTitle: quote('cdutcm-2026-self-funded', '【自费留学生研究生】2026年成都中医药大学招收外国研究生简章'),
  quotedDate: quote('cdutcm-2026-self-funded', '即日起- 2026年6月30日，全天24小时'),
  scholarshipArrangementQuote: quote('cdutcm-2026-self-funded', '上述奖学金的申请办法请留意成都中医药大学国际教育学院网页相关通知。'),
  applicationActor: 'foreign self-funded master or doctorate applicant using university online application system',
  endBoundaryQualifier: 'The published window says 全天24小时 (24 hours every day); it does not specify a 24:00 timestamp or a before operator. Preserve date precision.',
  openingQualifier: '即日起 is relative to the notice; no numeric opening date is asserted.',
  records: ids.map((id) => cycleById.has(id)
    ? closed(id, '2026-06-30', { reason: 'same-2026-self-funded-foreign-postgraduate-doctoral-route-applicant-deadline-expired', evidenceSourceIds: base(id).sourceIds.filter((s) => sourceById.get(s).url === captureByName.get('cdutcm-2026-self-funded').url), candidateOfficialOpensOn: null, deadlinePrecision: 'date', exactCutoffTime: null, originalTimeWording: '全天24小时', routeYearMatch: true })
    : unknown(id, 'award-application-arrangements-deferred-to-separate-notices-no-separate-award-deadline', { evidenceSourceIds: base(id).sourceIds, admissionDeadlineNotBorrowed: '2026-06-30' })),
}));
const records = groups.flatMap((g) => g.records);
assert.equal(records.length, 14);
assert.equal(new Set(records.map((r) => r.recordId)).size, 14);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...selectedIds].sort());
const results = records.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
assert.deepEqual(results, { closed: 8, unknown: 4, blocked: 2 });
assert.ok(records.every((r) => r.canonicalWritePerformed === false && r.freshnessRenewed === false && r.openingDateAssessed === false && r.canonicalDateEqualityConfirmed === false));
assert.ok(records.filter((r) => r.result === 'closed').every((r) => r.routeYearMatch && r.officialDeadline < '2026-10-19' && r.candidateOnly && r.storedDeadline === null));
assert.equal(records.filter((r) => r.candidateOfficialOpensOn).length, 4);
const after = fileHashes();
assert.deepEqual(after, before);
const report = {
  schemaVersion: 1, batchId: 'official-date-only-015-20261019', auditDate: '2026-10-19', timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  state: 'completed-with-eight-closed-date-candidates-four-unknown-two-source-blocked',
  snapshotSha256: audit.snapshotSha256, inputFileSha256: before,
  targetPlan: planRelative, targetPlanSha256: hash(planBytes),
  selection: 'Exactly selectedUniversityIds 15–20 (CSU,CUST,CSUST,CUIT,CDUT,CDUTCM) and their 14 selected record IDs from next-official-date-targets-v2.json.',
  acquisition: { newDistinctOfficialUrlsAttempted: 7, newDistinctOfficialUrlsReadSuccessfully: 6, dateEvidenceDetailSourcesReadSuccessfully: 5, supportingIndexPagesReadSuccessfully: 1, reusedPriorEvidenceSources: 0, rawCaptureManifest: 'capture-manifest.json', rawCaptureManifestSha256: hash(captureBytes), rawCaptureFilesHashVerified: true, normalTLSValidation: true, toolFailureAndNativeRecoveryNotCountedAsDistinctSources: true, paidModelCalls: 0 },
  summary: { universitiesWithScopedChecks: 6, recordsAssessed: 14, recordResults: results, explicitExpiredDeadlineCandidates: 8, unknownDeadlines: 4, blockedDateRecords: 2, newOpeningDateCandidates: 4, canonicalDateEqualitiesCertified: 0, canonicalWrites: 0, freshnessRenewals: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0, publicationActions: 0 },
  candidatePolicy: 'All eight explicit expired deadlines concern the same 2026 routes and are observations only. Stored deadlines remain null. Four numeric opening dates are candidateOfficialOpensOn only, openingDateAssessed is false. Any canonical date/status change requires a supported narrow consumer, independent approval and exact-row compare-and-swap; this report performs none. Expired admission never means discontinued programme.',
  groups,
  validation: { exactSelectedRecordsCovered: 14, uniqueRecordIds: 14, fullCanonicalCycleRowHashes: records.filter((r) => r.collection === 'admissionCycles').length, fullCanonicalProgramRowHashes: records.filter((r) => r.collection === 'admissionCycles').length, fullCanonicalScholarshipRowHashes: records.filter((r) => r.collection === 'scholarships').length, canonicalSixFileHashesUnchangedBeforeAfter: true, canonicalSnapshotMatchedPinnedAudit: true, rawAndExtractedEvidenceHashesVerified: true, literalQuotedDateFragmentsVerified: true, pdfDateAndRoutePagesRenderedAndVisuallyInspected: true, allDateObservationsCandidateOnly: true },
};
fs.writeFileSync(path.join(local, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ path: path.join(local, 'report.json'), sha256: hash(fs.readFileSync(path.join(local, 'report.json'))), records: records.length, results }));
