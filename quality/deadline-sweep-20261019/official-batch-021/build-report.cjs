/* Immutable source-only date sweep: no catalogue, freshness, progress or Git writes. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rowHash = (r) => hash(JSON.stringify(r));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
assert.equal(today, '2026-10-19');
const files = ['sources.json', 'cities.json', 'universities.json', 'programs.json', 'admission-cycles.json', 'scholarships.json'];
const fileHashes = () => Object.fromEntries(files.map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
const before = fileHashes();
const inventoryBytes = fs.readFileSync(path.join(primary, 'quality/deadline-sweep-20261019/catalog-deadlines.json'));
const inventory = JSON.parse(inventoryBytes);
assert.deepEqual(before, inventory.inputFileSha256);
const queuePath = 'quality/deadline-sweep-20261019/next-official-date-targets-v4.json';
const queueBytes = fs.readFileSync(path.join(primary, queuePath));
const queue = JSON.parse(queueBytes);
const schools = queue.selectedUniversityIds.slice(14, 20);
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const school = (id) => cycles.has(id) ? programs.get(cycles.get(id).programId).universityId : awards.get(id).universityIds.find((u) => schools.includes(u));
const baseIds = queue.selectedRecordIds.filter((id) => schools.includes(school(id)));
assert.equal(baseIds.length, 14);
const additionalIds = ['sch-gap-wave3-guet-guangxi-asean-full-scholarship', 'sch-gap-mew-0805-scw-glut-guangxi-asean-scholarship', 'sch-gap-mew-0805-scw-glut-belt-road-president-scholarship'];
const additionalReceiptPath = '../heartbeat-0554/additional-same-source-selection-v1.json';
const additionalBytes = fs.readFileSync(path.join(dir, additionalReceiptPath));
const additional = JSON.parse(additionalBytes);
assert.equal(additional.baseQueueSha256, hash(queueBytes));
for (const id of additionalIds) assert.ok(additional.extraRecords.some((r) => r.recordId === id && r.canonicalRecordSha256 === rowHash(awards.get(id))));
const ids = [...baseIds, ...additionalIds];
assert.equal(new Set(ids).size, 17);
const captureManifestBytes = fs.readFileSync(path.join(dir, 'capture-manifest.json'));
const derivedCaptureBytes = fs.readFileSync(path.join(dir, 'derived-guide-captures.json'));
const captures = [...JSON.parse(captureManifestBytes), ...JSON.parse(derivedCaptureBytes)];
const byName = new Map(captures.map((r) => [r.name, r]));
for (const c of captures) {
  assert.equal(c.captureSucceeded, true);
  assert.equal(hash(fs.readFileSync(path.join(dir, c.rawPath))), c.rawSha256);
  assert.equal(hash(fs.readFileSync(path.join(dir, c.textPath))), c.textSha256);
}
const text = (name) => fs.readFileSync(path.join(dir, byName.get(name).textPath), 'utf8');
const quote = (name, fragment) => { assert.ok(text(name).replace(/\s+/g, '').includes(fragment.replace(/\s+/g, '')), name + ': quote missing'); return fragment; };
const evidence = (name, scope = 'complete-captured-visible-text-date-scope-only') => ({ ...byName.get(name), readScope: scope, fullFactsCertified: false });
const imagePin = (p) => ({ path: p, sha256: hash(fs.readFileSync(path.join(dir, p))) });
function base(id, evidenceName) {
  const c = cycles.get(id);
  const a = awards.get(id);
  const r = c || a;
  const p = c && programs.get(c.programId);
  const ev = byName.get(evidenceName);
  const sourceIds = [...new Set([...r.sourceIds, ...(p?.sourceIds || [])])];
  return {
    collection: c ? 'admissionCycles' : 'scholarships', recordId: id,
    selectionOrigin: baseIds.includes(id) ? 'baseQueue14' : 'additionalSameSource3', universityId: school(id),
    ...(c ? { programId: p.id, programName: p.name.en, degreeLevel: p.degreeLevel, academicYear: c.academicYear, intake: c.intake, storedOpensOn: c.opensOn, storedDateStatus: c.dateStatus, canonicalCycleSha256: rowHash(c), canonicalProgramSha256: rowHash(p) } : { name: a.name.en, programIds: a.programIds, canonicalScholarshipSha256: rowHash(a), storedOpensOn: null }),
    canonicalRecordSha256: rowHash(r), canonicalRowSha256: rowHash(r),
    canonicalProgramPins: (c ? [p.id] : a.programIds).map((pid) => ({ programId: pid, canonicalProgramSha256: rowHash(programs.get(pid)) })),
    storedDeadline: c ? c.closesOn : a.deadline,
    sourceIds: r.sourceIds,
    sourcePins: sourceIds.map((sid) => ({ sourceId: sid, canonicalSourceSha256: rowHash(sources.get(sid)), url: sources.get(sid).url, sourceFullRecord: sources.get(sid) })),
    evidenceSourceUrl: ev.url, evidenceBodySha256: ev.rawSha256, observedAt: ev.observedAt,
    evidenceSourceIds: r.sourceIds.filter((sid) => sources.get(sid).url === ev.url),
    candidateOnly: true, dateOnly: true, fullFactsCertified: false, wholeSchoolCatalogueCompleted: false,
    canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false,
    officialOpensOn: null, candidateOfficialOpensOn: null, openingDateAssessed: false,
  };
}
const unknown = (id, name, reason, extra = {}) => ({ ...base(id, name), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, canonicalDeadlineAssessed: false, reason, ...extra });
const closed = (id, name, date, reason, extra = {}) => ({ ...base(id, name), result: 'closed', officialDeadline: date, candidateOfficialDeadline: date, candidateDeadlineChangesStoredNull: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === null, storedDateMatchesScopedOfficialDay: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === date, canonicalDeadlineAssessed: false, reason, deadlineBoundary: 'date-only-no-clock-time-stated', exactCutoffAt: null, closureScope: 'Only this same-2026 application window is past; programme discontinuation is not inferred.', ...extra });
const idsFor = (u) => ids.filter((id) => school(id) === u);
const groups = [];
const gzhWindow = quote('gzhmu-2026-graduate', 'Application Dates: March 1, 2026 — June 30, 2026');
groups.push({
  key: 'gzhmu-2026-academic-doctorate-and-independent-freshman-award', universityId: schools[0],
  evidence: [evidence('gzhmu-2026-graduate')],
  scope: '2026 international academic PhD admission and the separately scoped Guangdong-government freshman award.',
  officialTitle: quote('gzhmu-2026-graduate', "Guangzhou Medical University 2026 Admission Guide for International Master's/Doctoral Students"),
  quotedDate: gzhWindow,
  intakeQuote: quote('gzhmu-2026-graduate', 'Students should register in September 2026'),
  applicantVsReview: 'The applicant online submission period is March1–June30. The later interview notification, pre-admission result within one month and tuition confirmation dates are different stages, not application extensions.',
  records: idsFor(schools[0]).map((id) => cycles.has(id)
    ? closed(id, 'gzhmu-2026-graduate', '2026-06-30', 'same-2026-academic-doctorate-applicant-period-expired-stored-day-matches', { quotedDate: gzhWindow, sourceWindowOpensOn: '2026-03-01', sourceWindowOpeningNotIndependentlyCertifiedAsCanonicalEquality: true, candidateDeadlineChangesStoredNull: false, storedDateMatchesScopedOfficialDay: true })
    : unknown(id, 'gzhmu-2026-graduate', 'freshman-award-has-postregistration-payment-no-independent-application-deadline', { quotedDate: null, awardEligibilityAndPaymentQuote: quote('gzhmu-2026-graduate', 'The one-off scholarship will be sent to the personal bank account of the winner after registration.'), admissionDeadlineNotBorrowed: '2026-06-30', admissionDeadlineAppliesToAward: false })),
});
const gzhuPolicyQuote = quote('gzhu-handbook', '广州大学留学生奖助学金每年评选时间为每个秋季学期。');
groups.push({
  key: 'gzhu-belt-road-award-2021-policy-not-current-window', universityId: schools[1],
  evidence: [evidence('gzhu-international-talent'), evidence('gzhu-handbook', 'Full PDF text extracted; handbook cover and scholarship chapter PDF pages12–15 read for date scope; pages1,13,14 rendered and visually inspected. Other unrelated handbook policies not certified.')],
  scope: 'Only the existing Guangzhou University Belt and Road scholarship date, with a standing talent page and historical handbook policy.',
  handbookOriginalDate: quote('gzhu-handbook', 'March, 2021'),
  quotedDate: gzhuPolicyQuote,
  yearAndStageQualification: 'The March2021 trial handbook sets yearly autumn selection, not a dated 2026 applicant deadline. It requires admitted/registered students and annual information issued by the international school; a five-working-day result publication period is institutional review, not an application cutoff.',
  visualEvidence: ['gzhu-handbook-intro-001.png', 'gzhu-scholarship-013.png', 'gzhu-scholarship-014.png'].map(imagePin),
  records: idsFor(schools[1]).map((id) => unknown(id, 'gzhu-handbook', '2021-standing-policy-annual-autumn-selection-no-current-award-window', { quotedDate: gzhuPolicyQuote, registeredStudentCondition: quote('gzhu-handbook', '申请人为广州大学已录取，本人已报到的在读外国留学生。'), currentYearBound: false })),
});
const gzucmRound1 = quote('gzucm-support', '第一批次：即日起至 2026 年 4 月 15 日');
const gzucmRound2 = quote('gzucm-support', '第二批次：2026 年 4 月 16 日至 2026 年 6 月 1 日');
groups.push({
  key: 'gzucm-2026-chinese-tcm-bachelor-two-application-rounds', universityId: schools[2],
  evidence: [evidence('gzucm-2026-undergraduate'), evidence('gzucm-support')],
  scope: '2026 international Chinese-taught Traditional Chinese Medicine bachelor, exact five-year programme on PDFpage5.',
  originalYear: 2026, quotedDates: [gzucmRound1, gzucmRound2],
  evidencePages: { title: 1, applicantRounds: 2, exactProgrammeAndChineseLanguage: 5 },
  visualEvidence: ['gzucm-date-2.png', 'gzucm-programme-5.png'].map(imagePin),
  records: idsFor(schools[2]).map((id) => closed(id, 'gzucm-support', '2026-06-01', 'same-2026-tcm-bachelor-latest-of-two-explicit-applicant-rounds-is-past', { quotedDate: gzucmRound2, applicationRounds: [{ opensOn: null, openingRelativeWording: '即日起', closesOn: '2026-04-15' }, { opensOn: '2026-04-16', closesOn: '2026-06-01' }], finalRoundDoesNotReplaceFirstRoundOpening: true, applicantDeadlineNotReviewDate: true })),
});
const glmuDeadline = quote('glmu-2026-undergraduate-guide', '（二）报名截止时间：2026年6月30日。');
groups.push({
  key: 'glmu-2026-exact-bachelor-guide-from-registered-programme-navigation', universityId: schools[3],
  evidence: [evidence('glmu-2026-programmes'), evidence('glmu-admission-guide-index'), evidence('glmu-2026-undergraduate-guide')],
  scope: 'Only Clinical Medicine (Chinese) and Pharmacy (Chinese route of Chinese/English programme) bachelors in the current 2026 international undergraduate guide.',
  navigationProvenance: 'Registered programme page links 来华留学生招生简章 index /zszl/lhlxszsjz.htm; that index links exact 2026 undergraduate guide /info/1161/2514.htm. Both derived official pages captured; title/list alone not used as deadline evidence.',
  officialTitle: quote('glmu-2026-undergraduate-guide', '桂林医科大学2026年来华留学生（本科生）招生简章'),
  quotedDate: glmuDeadline,
  applicantVsReview: 'Section五 gives application submission cutoff; section六 later describes institutional review and notification, no applicant extension is inferred.',
  records: idsFor(schools[3]).map((id) => closed(id, 'glmu-2026-undergraduate-guide', '2026-06-30', 'exact-2026-international-undergraduate-guide-names-selected-major-and-applicant-deadline', { quotedDate: glmuDeadline, evidenceDiscovery: 'direct-official-programme-page-navigation-to-current-guide', exactMajorQuote: quote('glmu-2026-undergraduate-guide', programs.get(cycles.get(id).programId).name.zh) })),
});
const guetDeadline = quote('guet-guide', '15th June');
groups.push({
  key: 'guet-undated-guide-month-day-with-specialised-scholarship-route', universityId: schools[4],
  evidence: [evidence('guet-guide')],
  scope: 'English AI and Computer Science bachelors, Chinese/English Computer Science master, Chinese language course and separately added Guangxi ASEAN full scholarship.',
  quotedDate: guetDeadline, evidencePages: { englishBachelors: 6, master: 8, languageCourse: 11, chineseDate: 13, englishDate: 14, hostScholarshipMention: 4 },
  yearQualification: 'The actual PDF and date clause do not identify an applicable entry/application year. Passport validity until next June30 is not an application-year anchor. June15 is retained as undated reference only.',
  routeQualification: 'Submission instructions name a Specialized Scholarship Application. The guide also mentions several government scholarship schemes, so no independent exact ASEAN-award cutoff is inferred from a generic date line.',
  visualEvidence: ['guet-cover-01.png', 'guet-date-13.png', 'guet-date-14.png'].map(imagePin),
  records: idsFor(schools[4]).map((id) => unknown(id, 'guet-guide', awards.has(id) ? 'no-year-or-independent-asean-award-deadline-in-generic-guide' : 'undated-june15-application-reference-not-bound-to-selected-2026-2027-cycle', { quotedDate: guetDeadline, recurringOrUndatedDeadlineReference: { monthDay: '06-15', year: null, recurrenceExplicit: false }, targetYearNotInferredFromSourceMetadata: true, ...(awards.has(id) ? { generalDeadlineNotBorrowedAsAwardDate: true } : {}) })),
});
groups.push({
  key: 'glut-2026-guide-no-published-applicant-or-award-dates', universityId: schools[5],
  evidence: [evidence('glut-directory'), evidence('glut-2026-guide')],
  scope: 'Four existing programme fee-reference cycles and two distinct award records; dates only.',
  officialTitle: quote('glut-2026-guide', '2026年桂林理工大学 国际学生招生指南'),
  sourceYearQualification: 'The 2026 guide directly links the department/major directory originally published2023. The catalogue and current programme categories establish programme context, not a 2026 deadline.',
  awardNames: [quote('glut-2026-guide', '广西政府东盟国家留学生奖学金'), quote('glut-2026-guide', '桂林理工大学“一带一路”校长奖学金')],
  limitations: 'Full captured guide text gives application materials and online-application procedure but no fixed opening/closing dates. Named scholarship listings have no independent application windows. No fee, programme-list publication, office time or enrollment step is treated as a deadline.',
  records: idsFor(schools[5]).map((id) => unknown(id, 'glut-2026-guide', awards.has(id) ? 'named-award-listed-without-independent-current-application-dates' : '2026-programme-guide-and-directory-publish-no-fixed-application-window', { quotedDate: null, feeReferenceNotRolledForward: true, admissionDeadlineNotBorrowed: true })),
});
const records = groups.flatMap((g) => g.records);
assert.equal(records.length, 17);
assert.equal(new Set(records.map((r) => r.recordId)).size, 17);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...ids].sort());
const results = records.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
assert.deepEqual(results, { closed: 4, unknown: 13 });
assert.equal(records.filter((r) => r.collection === 'admissionCycles').length, 12);
assert.equal(records.filter((r) => r.collection === 'scholarships').length, 5);
assert.ok(records.filter((r) => r.result === 'closed').every((r) => r.officialDeadline < today && r.candidateOnly));
assert.ok(records.every((r) => !r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.openingDateAssessed));
assert.deepEqual(fileHashes(), before);
const report = {
  schemaVersion: 1, batchId: 'official-date-only-021-20261019', state: 'completed-three-new-expired-date-candidates-one-existing-expired-date-thirteen-unknown', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  snapshotSha256: inventory.snapshotSha256, inventorySha256: hash(inventoryBytes), inputFileSha256: before,
  targetQueue: queuePath, targetQueueSha256: hash(queueBytes), selectedUniversityIds: schools,
  selection: { baseQueueRecordIds: baseIds, additionalSameSourceRecordIds: additionalIds, baseQueueRecords: 14, additionalSameSourceRecords: 3, totalRecords: 17, additionalSelectionReceipt: 'quality/deadline-sweep-20261019/heartbeat-0554/additional-same-source-selection-v1.json', additionalSelectionReceiptSha256: hash(additionalBytes) },
  acquisition: { newDistinctOfficialUrlsAttempted: 11, newDistinctOfficialUrlsCapturedSuccessfully: 11, originalSourcesCaptured: 9, derivedCurrentGlmuGuideNavigationPagesCaptured: 2, newWebsiteReadsForAdditionalAwards: 0, reusedPriorEvidence: 0, nativeFallbacks: 0, captureManifestSha256: hash(captureManifestBytes), derivedGuideCapturesSha256: hash(derivedCaptureBytes), rawAndTextCaptureHashesVerified: true, pdfPagesExtracted: { 'gzhu-handbook.pdf': 123, 'gzucm-support.pdf': 7, 'guet-guide.pdf': 16 }, noFullHandbookPolicyCertification: true, normalTLSCertificateValidation: true, paidModelCalls: 0 },
  summary: { universitiesWithScopedChecks: 6, recordsAssessed: 17, baseQueueRecords: 14, additionalSameSourceRecords: 3, admissionCyclesAssessed: 12, scholarshipsAssessed: 5, recordResults: results, newExactExpiredDeadlineCandidatesFromCanonicalNull: 3, existingExpiredDatesScoped: 1, independentAwardDeadlinesEstablished: 0, canonicalWrites: 0, sharedStateWrites: 0, gitMutations: 0, freshnessRenewals: 0, publicationActions: 0, wholeSchoolCataloguesCertified: 0, fullFactsCertified: 0 },
  policy: 'All findings are date-only observations; new dates stay candidate-only. Original null/stored dates, status and freshness stay untouched. Same-2026 application closure does not mean discontinued programme. A month/day without year and a historical recurring policy cannot certify the target year. Every award keeps its own scope and no degree deadline is borrowed. Any future write requires a supported narrow consumer, independent review and exact-row compare-and-swap.',
  groups,
  validation: { exactBase14AndAdditional3IdsCoveredOnce: true, fullCanonicalCycleRowPins: 12, fullCanonicalProgramRowPinsForCycles: 12, fullCanonicalAwardRowPins: 5, fullCanonicalSourceRowsPinned: true, quotedDateFragmentsMatchedAfterWhitespaceNormalization: true, rawAndTextBytesHashVerified: true, selectedPdfDateAndPolicyPagesRenderedAndVisuallyRead: true, canonicalSixFilesUnchangedBeforeAfter: true },
};
const output = path.join(dir, 'report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportPath: output, sha256: hash(fs.readFileSync(output)), records: records.length, results }));
