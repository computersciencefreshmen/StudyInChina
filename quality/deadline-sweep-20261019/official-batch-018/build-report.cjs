/* Date-only source observations. Output is immutable; canonical and shared state are read-only. */
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
assert.equal(today, '2026-10-19', 'Use a new output bundle for another audit date.');
const fileNames = ['sources.json', 'cities.json', 'universities.json', 'programs.json', 'admission-cycles.json', 'scholarships.json'];
const fileHashes = () => Object.fromEntries(fileNames.map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
const before = fileHashes();
const inventoryBytes = fs.readFileSync(path.join(primary, 'quality/deadline-sweep-20261019/catalog-deadlines.json'));
const inventory = JSON.parse(inventoryBytes);
assert.deepEqual(before, inventory.inputFileSha256);
const planRelative = 'quality/deadline-sweep-20261019/next-official-date-targets-v3.json';
const planBytes = fs.readFileSync(path.join(primary, planRelative));
const plan = JSON.parse(planBytes);
const schoolIds = plan.selectedUniversityIds.slice(14, 20);
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const rowSchool = (id) => cycles.has(id) ? programs.get(cycles.get(id).programId).universityId : awards.get(id).universityIds.find((u) => schoolIds.includes(u));
const baseIds = plan.selectedRecordIds.filter((id) => schoolIds.includes(rowSchool(id)));
assert.equal(baseIds.length, 20);
const additionalIds = [
  'sch-gap-mve-jzh-cuz-postgraduate-scholarship',
  'sch-gap-mve-jzh-cuz-zhejiang-government',
  'cycle-gap-prog-mew-ne-dlmu-nautical-science-bachelor-2026-2027-other-fee-reference',
  'cycle-gap-local-dmu-pre-medical-2026-2027-other',
  'cycle-gap-mew-scws-dgut-food-and-nutrition-master-2026-2027-autumn',
  'cycle-gap-mew-scws-dgut-integrated-circuit-engineering-master-2026-2027-autumn',
  'cycle-gap-mew-scws-dgut-social-work-master-2026-2027-autumn',
];
assert.ok(additionalIds.every((id) => !baseIds.includes(id)));
const selectedIds = [...baseIds, ...additionalIds];
assert.equal(new Set(selectedIds).size, 27);
const additionalSelectionRelative = 'quality/deadline-sweep-20261019/heartbeat-0539/additional-same-source-selection-v1.json';
const additionalSelectionBytes = fs.readFileSync(path.join(dir, '../heartbeat-0539/additional-same-source-selection-v1.json'));
const additionalSelection = JSON.parse(additionalSelectionBytes);
assert.equal(additionalSelection.baseQueueSha256, hash(planBytes));
for (const id of additionalIds) {
  const selected = additionalSelection.extraRecords.find((r) => r.recordId === id);
  assert.ok(selected, id + ': missing explicit additional selection receipt');
  assert.equal(selected.canonicalRecordSha256, rowHash(cycles.get(id) || awards.get(id)));
}
const capturesBytes = fs.readFileSync(path.join(dir, 'capture-manifest.json'));
const captures = JSON.parse(capturesBytes);
const captureByName = new Map(captures.map((r) => [r.name, r]));
for (const c of captures) {
  assert.equal(c.captureSucceeded, true);
  assert.equal(hash(fs.readFileSync(path.join(dir, c.rawPath))), c.rawSha256);
  assert.equal(hash(fs.readFileSync(path.join(dir, c.textPath))), c.textSha256);
}
const text = (name) => fs.readFileSync(path.join(dir, captureByName.get(name).textPath), 'utf8');
const literal = (name, fragment) => { assert.ok(text(name).replace(/\s+/g, '').includes(fragment.replace(/\s+/g, '')), name + ': missing fragment'); return fragment; };
const evidence = (name, scope) => ({ ...captureByName.get(name), evidenceReadScope: scope || 'complete-captured-visible-text', fullFactsCertified: false });
function base(id) {
  const c = cycles.get(id);
  const a = awards.get(id);
  const r = c || a;
  const p = c && programs.get(c.programId);
  assert.ok(r, id);
  const sourceIds = [...new Set([...r.sourceIds, ...(p?.sourceIds || [])])];
  const programPins = c ? [{ programId: p.id, canonicalProgramSha256: rowHash(p) }] : a.programIds.map((pid) => ({ programId: pid, canonicalProgramSha256: rowHash(programs.get(pid)) }));
  return {
    collection: c ? 'admissionCycles' : 'scholarships', recordId: id,
    selectionOrigin: additionalIds.includes(id) ? 'additionalSameSource7' : 'baseQueue20',
    universityId: rowSchool(id),
    ...(c ? { programId: p.id, programName: p.name.en, degreeLevel: p.degreeLevel, academicYear: c.academicYear, intake: c.intake, storedOpensOn: c.opensOn, storedDateStatus: c.dateStatus, canonicalCycleSha256: rowHash(c), canonicalProgramSha256: rowHash(p) } : { name: a.name.en, programIds: a.programIds, canonicalScholarshipSha256: rowHash(a) }),
    canonicalRecordSha256: rowHash(r), canonicalRowSha256: rowHash(r),
    canonicalProgramPins: programPins,
    sourceIds: r.sourceIds,
    sourcePins: sourceIds.map((sid) => ({ sourceId: sid, url: sources.get(sid).url, canonicalSourceSha256: rowHash(sources.get(sid)), sourceFullRecord: sources.get(sid) })),
    storedDeadline: c ? c.closesOn : a.deadline,
    publishedInInputSnapshot: false, dateOnly: true, fullFactsCertified: false, wholeSchoolCatalogueCompleted: false,
    canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false,
    officialOpensOn: null, openingDateAssessed: false, canonicalDateEqualityConfirmed: false,
  };
}
function bind(id, name) {
  const r = base(id);
  const c = captureByName.get(name);
  return { evidenceSourceUrl: c.url, evidenceBodySha256: c.rawSha256, observedAt: c.observedAt, evidenceSourceIds: r.sourceIds.filter((s) => sources.get(s).url === c.url) };
}
const unknown = (id, name, reason, extra = {}) => ({ ...base(id), ...bind(id, name), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, candidateOnly: true, canonicalDeadlineAssessed: false, reason, ...extra });
const closed = (id, name, date, reason, extra = {}) => ({ ...base(id), ...bind(id, name), result: 'closed', officialDeadline: date, candidateOfficialDeadline: date, candidateOnly: true, canonicalDeadlineAssessed: false, closureAssessment: { asOfDate: today, timeZone: 'Asia/Shanghai', sameRouteAndEntryYear: true, programmeDiscontinued: false }, reason, ...extra });
const groups = [];
const idsFor = (school) => selectedIds.filter((id) => rowSchool(id) === school);

const cuzTitle = literal('cuz-2026-undergraduate', '2026 Communication University of Zhejiang Enrollment Brochure (Bachelor）');
const cuzBefore = literal('cuz-2026-undergraduate', 'Before June 30 of the admission year');
const cuzHtml = fs.readFileSync(path.join(dir, 'cuz-2026-undergraduate.html'), 'utf8');
assert.ok(/rowspan="25"/.test(cuzHtml));
groups.push({
  key: 'cuz-2026-undergraduate-and-three-separate-awards', universityId: schoolIds[0],
  scope: '2026 undergraduate admission for the two exact English-taught programmes; university undergraduate, university postgraduate, and provincial awards each assessed separately.',
  evidence: [evidence('cuz-2026-undergraduate'), evidence('cuz-scholarship')],
  officialTitle: cuzTitle, quotedDate: cuzBefore,
  yearBasis: '2026 entry is explicit in this admission-specific title. The phrase of the admission year resolves to that 2026 entry, rather than projecting a standing annual rule into a new year.',
  deadlineTableBinding: 'The Application Time cell has rowspan=25 in the Hangzhou Qiantang undergraduate catalogue, including both named rows. The language-requirement clause explicitly identifies the English-taught versions of both routes.',
  routeNameQuotes: ['Radio & TV Directing', 'International Journalism & Communication'].map((s) => literal('cuz-2026-undergraduate', s)),
  records: idsFor(schoolIds[0]).map((id) => cycles.has(id)
    ? closed(id, 'cuz-2026-undergraduate', '2026-06-30', 'same-2026-specific-undergraduate-entry-window-is-expired', { quotedDate: cuzBefore, deadlineBoundary: 'before-date-as-worded', boundaryOperator: '<', exactCutoffAt: null, candidateOfficialOpensOn: null, admissionYearResolvedFromExplicit2026Title: true })
    : unknown(id, 'cuz-scholarship', 'separate-scholarship-page-has-benefits-no-current-award-application-dates', { quotedDate: null, admissionDeadlineNotBorrowed: '2026-06-30', admissionDeadlineAppliesToAward: false, awardRouteNameConfirmed: true })),
});
groups.push({
  key: 'dlmu-annual-or-missing-year-dates', universityId: schoolIds[1],
  scope: 'Five exact existing records: language semester, two preparatory cycles, Chinese-taught Marine Engineering, and additional Nautical Science.',
  evidence: [evidence('dlmu-fees'), evidence('dlmu-brochure', 'captured-HTML-and-visible-text-only; embedded-brochure-page-images-not-acquired-or-read'), evidence('dlmu-preparatory'), evidence('dlmu-chinese-bachelor')],
  annualPreparatoryQuote: literal('dlmu-preparatory', 'Application Deadline: each July 10th.'),
  annualBachelorQuote: literal('dlmu-chinese-bachelor', 'The application deadline for applying for a degree program is each June 30th basically'),
  limitations: ['No absolute 2026 entry/application year is provided in these textual deadline clauses.', 'Each July 10th is recurring; each June 30th basically is recurring and qualified, not a firm dated 2026 cutoff.', 'Fees alone establish no application window. The admission-brochure body embeds image pages not read in this bounded date pass, so no claim is made to date verification of that full image brochure.'],
  records: idsFor(schoolIds[1]).map((id) => {
    const p = programs.get(cycles.get(id).programId);
    const preparatory = p.degreeLevel === 'foundation';
    const bachelor = p.degreeLevel === 'bachelor';
    return unknown(id, preparatory ? 'dlmu-preparatory' : bachelor ? 'dlmu-chinese-bachelor' : 'dlmu-fees', preparatory ? 'yearly-july10-rule-not-bound-to-current-2026-cycle' : bachelor ? 'qualified-yearly-june30-rule-not-bound-to-current-2026-cycle' : 'fees-and-brochure-visible-text-do-not-establish-a-dated-language-window', { quotedDate: preparatory ? 'Application Deadline: each July 10th.' : bachelor ? 'The application deadline for applying for a degree program is each June 30th basically' : null, recurringDeadlineReference: preparatory ? { monthDay: '07-10', qualifier: 'each', year: null } : bachelor ? { monthDay: '06-30', qualifier: 'each; basically', year: null } : null, feeReferenceNotRolledForward: true });
  }),
});
const springOpeningQuote = literal('dmu-spring-guide', 'The system will be open on November 5, 2025 at 09:00 Beijing time.');
groups.push({
  key: 'dmu-programmes-no-closing-date-and-spring2026-opening-scope', universityId: schoolIds[2],
  scope: 'Chinese-medium Clinical Medicine, MBBS, BDS, and additional Pre-medical; current records use 2026-2027 / intake other, whereas the opening-only support notice is explicitly Spring 2026.',
  evidence: [evidence('dmu-undergraduate'), evidence('dmu-spring-guide')],
  openingOnlySourceTitle: literal('dmu-spring-guide', 'Admission Guide for DMU 2026 (Spring) International Student Programs'),
  openingOnlyQuote: springOpeningQuote,
  routeQualification: 'That Spring 2026 notice names only Pre-medical and MBBS. It states no closing date, does not bind Chinese-medium Clinical Medicine or BDS, and is not rolled into Spring 2027 or an unspecified 2026-2027 intake.',
  records: idsFor(schoolIds[2]).map((id) => {
    const hasOpeningSource = cycles.get(id).sourceIds.some((s) => sources.get(s).url === captureByName.get('dmu-spring-guide').url);
    return unknown(id, hasOpeningSource ? 'dmu-spring-guide' : 'dmu-undergraduate', hasOpeningSource ? 'spring2026-source-publishes-opening-only-no-deadline-and-does-not-establish-selected-2026-2027-intake' : '2025-programme-index-has-start-semesters-no-application-closing-date', { quotedDate: hasOpeningSource ? springOpeningQuote : null, sourceScopeOpening: hasOpeningSource ? { appliesTo: 'Spring 2026 MBBS / Pre-medical only', date: '2025-11-05', exactTime: '2025-11-05T09:00:00+08:00', bindingToSelectedCycleConfirmed: false } : null, candidateOfficialOpensOn: null, storedOpeningNotNewlyConfirmed: true });
  }),
});
const dluflAbsolute = literal('dlufl-2026-undergraduate', '申请时间：2025年10月15日至2026年4月15日。');
const dluflAnnual = literal('dlufl-2026-undergraduate', '学历生每年 9 月开学，报名截止时间为 4 月底。');
groups.push({
  key: 'dlufl-conflicting-cutoffs-within-same-2026-guide', universityId: schoolIds[3],
  scope: 'Three exact Chinese bachelor routes: Chinese Culture, International Trade, and Teaching Chinese to Speakers of Other Languages.',
  evidence: [evidence('dlufl-2026-undergraduate')],
  officialTitle: literal('dlufl-2026-undergraduate', '大连外国语大学 2026年来华留学本科招生简章'),
  routeNameQuotes: ['汉语言（中国文化）', '汉语言（国际贸易）', '汉语国际教育'].map((s) => literal('dlufl-2026-undergraduate', s)),
  quotedAbsoluteWindow: dluflAbsolute, quotedConflictingStandingRule: dluflAnnual,
  assessment: 'The current guide gives an absolute April 15, 2026 application endpoint and an end-of-April yearly registration deadline for degree students, without explaining the difference. Both are retained. No exact single deadline is approved, and month-end is not invented as a timestamp.',
  records: idsFor(schoolIds[3]).map((id) => ({ ...base(id), ...bind(id, 'dlufl-2026-undergraduate'), result: 'conflict', officialDeadline: null, candidateOfficialDeadline: null, candidateOnly: true, canonicalDeadlineAssessed: false, candidateOfficialOpensOn: '2025-10-15', openingCandidateOnly: true, openingDateAssessed: false, reason: 'same-guide-specific-april15-window-and-unexplained-end-of-april-degree-deadline', allObservedDeadlineAlternativesBeforeAuditDate: true, alternativesExpiryScope: 'For the same 2026 entry, both explicitly dated April15 and the alternative end-of-April interpretation precede October19; exact cutoff remains unresolved.', officialDateVariants: [{ date: '2026-04-15', precision: 'date', scope: 'explicit-absolute-application-period', quotedDate: dluflAbsolute }, { date: null, recurringMonthEnd: 'April', scope: 'degree-student-enrollment-time-section', quotedDate: dluflAnnual }], exactCutoffAt: null })),
});
groups.push({
  key: 'dufe-general-master-vs-csc-typeb-cutoffs', universityId: schoolIds[4],
  scope: 'Three English master fee-reference cycles: Financial Management, International Trade, Tourism Management; generic entry route is not a CSC Type B scholarship application.',
  evidence: [evidence('dufe-master-programmes'), evidence('dufe-support-guide')],
  generalDeadlineQuote: literal('dufe-master-programmes', '报名截止日期\n6月30日'),
  restrictedRouteTitle: literal('dufe-support-guide', 'CSC Scholarship Application Information 2026/2027'),
  restrictedRouteDeadlineQuote: literal('dufe-support-guide', 'March 10th, 2026'),
  scopeQualification: 'The generic master page lists each named major and a June 30 month/day without an application year. The absolute March 10, 2026 belongs to the Chinese Government Scholarship Chinese University Program Type B and is not adopted as a universal degree-program deadline.',
  records: idsFor(schoolIds[4]).map((id) => unknown(id, 'dufe-master-programmes', 'generic-master-june30-has-no-year-csc-typeb-march10-cannot-be-borrowed', { quotedDate: '报名截止日期\n6月30日', recurringDeadlineReference: { monthDay: '06-30', year: null }, excludedOtherRouteDeadline: { route: 'CSC Chinese University Program Type B 2026/2027', deadline: '2026-03-10', appliesToSelectedGeneralDegreeCycle: false, evidenceBodySha256: captureByName.get('dufe-support-guide').rawSha256 } })),
});
const dgutWindow = literal('dgut-2026-master-guide', '2026年4月30日至2026年6月30日');
const dgutAwardsRule = literal('dgut-2026-faq', '答：所有奖学金申请通道仅在学生到校完成正式注册后开放，预录取阶段暂不受理奖学金申请。');
groups.push({
  key: 'dgut-2026-two-proven-routes-plus-three-unbound-routes-and-two-postregistration-awards', universityId: schoolIds[5],
  scope: 'Original International Business and Software Engineering professional masters; three additional existing dated master rows; two separate freshman/living awards.',
  evidence: [evidence('dgut-business'), evidence('dgut-software'), evidence('dgut-2026-master-guide'), evidence('dgut-2026-faq')],
  quotedDate: dgutWindow,
  exactProgrammeTitles: [literal('dgut-business', '025400 国际商务专业介绍（仅面向2026年国际硕士）'), literal('dgut-software', '085405 软件工程专业介绍（仅面向2026年国际硕士）')],
  applicantVsReviewQualification: 'The April 30–June 30, 2026 period is applicant submission. FAQ estimates of 1–2 weeks for preliminary review, 7–15 working days for JW202 and 6–7 month peak processing are not applicant extensions or deadlines.',
  awardOpeningRule: dgutAwardsRule,
  additionalRouteLimitation: 'Three additional rows share the 2026 general guide and already store June 30. Their registered programme-directory page was not read in this run and the guide catalogue is embedded as image tables. Breadcrumb titles for Food and Nutrition / Social Work are discovery context only; the three exact catalogue bindings are not independently certified here. They remain unknown, rather than receiving a date solely from a shared guide URL.',
  records: idsFor(schoolIds[5]).map((id) => {
    if (awards.has(id)) return unknown(id, 'dgut-2026-faq', 'award-applications-open-only-after-formal-on-campus-registration-no-exact-award-cutoff', { quotedDate: dgutAwardsRule, awardApplicationConstraint: 'only-after-official-on-campus-registration; not-at-pre-admission', admissionDeadlineNotBorrowed: '2026-06-30', admissionDeadlineAppliesToAward: false });
    if (additionalIds.includes(id)) return unknown(id, 'dgut-2026-master-guide', 'general-guide-window-known-but-exact-additional-programme-catalogue-binding-not-certified', { quotedDate: dgutWindow, candidateDeadlineNotBoundToExactProgramme: '2026-06-30', storedDeadlinePreserved: true, matchedSharedGuideDoesNotProveExactProgrammeScope: true, candidateOfficialOpensOn: null });
    return closed(id, 'dgut-2026-master-guide', '2026-06-30', 'exact-2026-international-professional-master-title-and-guide-applicant-window-expired', { quotedDate: dgutWindow, candidateOfficialOpensOn: '2026-04-30', openingCandidateOnly: true, openingDateAssessed: false, deadlineBoundary: 'date-only-no-cutoff-clock-supplied', exactCutoffAt: null, exactProgrammeEvidence: id.includes('international-business') ? evidence('dgut-business') : evidence('dgut-software') });
  }),
});
const records = groups.flatMap((g) => g.records);
assert.equal(records.length, 27);
assert.equal(new Set(records.map((r) => r.recordId)).size, 27);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...selectedIds].sort());
const results = records.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
assert.deepEqual(results, { closed: 4, unknown: 20, conflict: 3 });
assert.ok(records.every((r) => !r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.openingDateAssessed));
assert.ok(records.filter((r) => r.result === 'closed').every((r) => r.storedDeadline === null && r.officialDeadline < today && r.candidateOnly));
assert.equal(records.filter((r) => r.collection === 'admissionCycles').length, 22);
assert.equal(records.filter((r) => r.collection === 'scholarships').length, 5);
assert.deepEqual(fileHashes(), before);
const report = {
  schemaVersion: 1, batchId: 'official-date-only-018-20261019', state: 'completed-four-expired-date-candidates-twenty-unknown-three-same-guide-conflicts', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  inventorySha256: hash(inventoryBytes), snapshotSha256: inventory.snapshotSha256, inputFileSha256: before,
  targetPlan: planRelative, targetPlanSha256: hash(planBytes), selectedUniversityIds: schoolIds,
  selection: { baseQueue: 'Exact selectedUniversityIds15–20 and their20 selected IDs from next-official-date-targets-v3.json', baseQueueRecordIds: baseIds, additionalSameSourceRecordIds: additionalIds, totalRecords: 27, additionalAuthorization: 'Parent explicitly requested seven exact unassessed records sharing captured official sources before report freeze; no new website read for these additions.', additionalSelectionReceipt: additionalSelectionRelative, additionalSelectionReceiptSha256: hash(additionalSelectionBytes) },
  acquisition: { newDistinctOfficialUrlsAttempted: 15, newDistinctOfficialUrlsCapturedSuccessfully: 15, failedCaptures: 0, nativeFallbacks: 0, noEndlessRetries: true, newReadsForAdditional7Records: 0, reusedPriorEvidenceSources: 0, captureManifest: 'capture-manifest.json', captureManifestSha256: hash(capturesBytes), rawAndTextHashesVerified: true, normalTLSCertificateValidation: true, embeddedImagesNotRead: ['DLMU brochure body image pages', 'DGUT general guide programme-table images'], sourceScopeIsStatedPerGroup: true, paidModelCalls: 0 },
  summary: { universitiesWithScopedChecks: 6, recordsAssessed: 27, baseQueueRecords: 20, additionalSameSourceRecords: 7, admissionCyclesAssessed: 22, scholarshipsAssessed: 5, recordResults: results, newExplicitExpiredDeadlineCandidates: 4, storedNullDeadlinesNotChanged: records.filter((r) => r.storedDeadline === null).length, canonicalDateEqualitiesCertified: 0, openingDatesAssessed: 0, canonicalWrites: 0, sharedStateWrites: 0, freshnessRenewals: 0, publicationActions: 0, wholeSchoolCataloguesCertified: 0, fullFactsCertified: 0 },
  policy: 'Official dates are candidate observations only. Four expired windows concern exactly the same 2026 routes, preserve strict before where stated, and do not mean programme discontinuation. Unknown year, unmatched route, image-only catalogue binding, scholarship-only restrictions and unexplained source conflicts remain unresolved. New openings are separate candidates and do not certify stored opening equality. Any eventual mutation needs a supported narrow consumer, independent approval and exact-row compare-and-swap; none performed here.',
  groups,
  validation: { exactBase20AndAdditional7IdsCoveredOnce: true, canonicalFullCycleRowPins: 22, canonicalFullProgramRowPinsForCycles: 22, canonicalFullAwardRowPins: 5, allReferencedSourceFullRowsPinned: true, canonicalSixFilesUnchangedBeforeAfter: true, captureRawAndTextBytesHashesVerified: true, quotedLiteralDateFragmentsChecked: true, noCanonicalOrStateOrGitWrites: true },
};
const output = path.join(dir, 'report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ path: output, sha256: hash(fs.readFileSync(output)), records: records.length, results, baseQueue: baseIds.length, additional: additionalIds.length }));
