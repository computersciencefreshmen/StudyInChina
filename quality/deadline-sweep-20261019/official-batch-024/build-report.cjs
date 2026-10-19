/* Immutable, source-only date observations. No catalogue, freshness, state or Git writes. */
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
const queuePath = 'quality/deadline-sweep-20261019/next-official-date-targets-v5.json';
const queueBytes = fs.readFileSync(path.join(primary, queuePath));
const queue = JSON.parse(queueBytes);
const schools = queue.selectedUniversityIds.slice(14, 20);
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const school = (id) => cycles.has(id) ? programs.get(cycles.get(id).programId).universityId : awards.get(id).universityIds.find((u) => schools.includes(u));
const baseIds = queue.selectedRecordIds.filter((id) => schools.includes(school(id)));
assert.equal(baseIds.length, 15);
const additionalIds = [
  'cycle-wave4-program-hunan-university-applied-economics-master-2026-2027-other-evidence',
  'cycle-wave4-program-hunan-university-business-administration-master-2026-2027-other-evidence',
  'cycle-gap-wave8-2-hutb-international-business-master-2026-2027-autumn-fee-reference',
  'cycle-gap-mve-jzh-just-energy-power-master-2026-2027-autumn-fee-reference',
  'cycle-gap-mve-jzh-just-management-science-doctorate-2026-2027-autumn-fee-reference',
  'cycle-gap-mve-jzh-just-mba-master-2026-2027-autumn-fee-reference',
  'cycle-gap-mve-jzh-just-naval-architecture-master-2026-2027-autumn-fee-reference',
];
const additionalReceipt = 'quality/deadline-sweep-20261019/heartbeat-0610/additional-same-source-selection-v1.json';
const additionalBytes = fs.readFileSync(path.resolve(dir, '../heartbeat-0610/additional-same-source-selection-v1.json'));
const additional = JSON.parse(additionalBytes);
assert.equal(additional.baseQueueSha256, hash(queueBytes));
assert.equal(additional.snapshotSha256, inventory.snapshotSha256);
for (const id of additionalIds) assert.ok(additional.extraRecords.some((r) => r.recordId === id && r.canonicalRecordSha256 === rowHash(cycles.get(id))));
const ids = [...baseIds, ...additionalIds];
assert.equal(new Set(ids).size, 22);
const captureManifestBytes = fs.readFileSync(path.join(dir, 'capture-manifest.json'));
const recoveryBytes = fs.readFileSync(path.join(dir, 'recovery-and-original-manifest.json'));
const attempts = [...JSON.parse(captureManifestBytes), ...JSON.parse(recoveryBytes)];
const captures = attempts.filter((r) => r.captureSucceeded);
assert.equal(captures.length, 9);
const byName = new Map(captures.map((r) => [r.name, r]));
for (const c of captures) {
  assert.equal(hash(fs.readFileSync(path.join(dir, c.rawPath))), c.rawSha256);
  assert.equal(hash(fs.readFileSync(path.join(dir, c.textPath))), c.textSha256);
  assert.ok(c.observedAt.startsWith(today));
}
const text = (name) => fs.readFileSync(path.join(dir, byName.get(name).textPath), 'utf8');
const quote = (name, fragment) => { assert.ok(text(name).replace(/\s+/g, '').includes(fragment.replace(/\s+/g, '')), name + ': quote missing: ' + fragment); return fragment; };
const evidence = (name) => ({ ...byName.get(name), readScope: 'complete-captured-extracted-text-date-scope-only', fullFactsCertified: false });
const imagePin = (p) => ({ path: p, sha256: hash(fs.readFileSync(path.join(dir, p))) });
function base(id, evidenceName) {
  const c = cycles.get(id), a = awards.get(id), r = c || a, p = c && programs.get(c.programId), ev = byName.get(evidenceName);
  const sourceIds = [...new Set([...r.sourceIds, ...(p?.sourceIds || [])])];
  return {
    collection: c ? 'admissionCycles' : 'scholarships', recordId: id,
    selectionOrigin: baseIds.includes(id) ? 'baseQueue15' : 'additionalSameSource7', universityId: school(id),
    ...(c ? { programId: p.id, programName: p.name.en, degreeLevel: p.degreeLevel, academicYear: c.academicYear, intake: c.intake, storedOpensOn: c.opensOn, storedDateStatus: c.dateStatus, canonicalCycleSha256: rowHash(c), canonicalProgramSha256: rowHash(p) } : { name: a.name.en, programIds: a.programIds, canonicalScholarshipSha256: rowHash(a), storedOpensOn: null }),
    canonicalRecordSha256: rowHash(r), canonicalRowSha256: rowHash(r),
    canonicalProgramPins: (c ? [p.id] : a.programIds).map((pid) => ({ programId: pid, canonicalProgramSha256: rowHash(programs.get(pid)) })),
    storedDeadline: c ? c.closesOn : a.deadline, sourceIds: r.sourceIds,
    sourcePins: sourceIds.map((sid) => ({ sourceId: sid, canonicalSourceSha256: rowHash(sources.get(sid)), url: sources.get(sid).url, sourceFullRecord: sources.get(sid) })),
    evidenceSourceUrl: ev.url, evidenceBodySha256: ev.rawSha256, observedAt: ev.observedAt,
    evidenceSourceIds: r.sourceIds.filter((sid) => sources.get(sid).url === ev.url),
    candidateOnly: true, dateOnly: true, fullFactsCertified: false, wholeSchoolCatalogueCompleted: false,
    canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false,
    officialOpensOn: null, candidateOfficialOpensOn: null, openingDateAssessed: false,
  };
}
const unknown = (id, name, reason, extra = {}) => ({ ...base(id, name), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, canonicalDeadlineAssessed: false, reason, ...extra });
const closed = (id, name, date, reason, extra = {}) => ({ ...base(id, name), result: 'closed', officialDeadline: date, candidateOfficialDeadline: date, candidateDeadlineChangesStoredNull: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === null, storedDateMatchesScopedOfficialDay: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === date, canonicalDeadlineAssessed: false, reason, deadlineBoundary: 'date-only-no-clock-time-stated', exactCutoffAt: null, closureScope: 'Only the explicitly matched applicant year and route are past; no programme discontinuation or closure of other routes is inferred.', ...extra });
const idsFor = (u) => ids.filter((id) => school(id) === u);
const groups = [];
const hzauDate = quote('hzau-application-recovery', 'Huazhong Agricultural University Scholarship: November 1, 2025 to February 27, 2026');
groups.push({ key: 'hzau-separately-named-university-scholarship-2026', universityId: schools[0], evidence: [evidence('hzau-scholarship-recovery'), evidence('hzau-application-recovery')],
  scope: 'Exact separately named HZAU university postgraduate scholarship application period, not a borrowed CSC date.',
  quotedDate: hzauDate, acquisitionQualification: 'Each of two normal Python TLS requests failed with SSL EOF; each was recovered exactly once with bounded Windows curl and normal TLS certificate validation. Original failures remain in the initial manifest.',
  records: idsFor(schools[0]).map((id) => closed(id, 'hzau-application-recovery', '2026-02-27', 'application-page-separately-names-this-university-award-and-exact-2025-2026-applicant-period', { quotedDate: hzauDate, candidateOfficialOpensOn: '2025-11-01', awardOwnDateNotBorrowed: true })),
});
const hnuDate = quote('hnu-csc-2026', 'The deadline of application for High-level Postgraduate Program is March 1st, 2026.');
const hnuSelfDate = quote('hnu-self-financed', 'The application deadline is July 18, 2025 Beijing time.');
const hnuMajorById = {
  'cycle-gap-wave8-hnu-chemistry-doctorate-2026-2027-autumn': 'Chemistry (Ph.D)',
  'cycle-gap-wave8-hnu-computer-science-technology-master-2026-2027-autumn': 'Computer Science and Technology (Master or Ph.D)',
  'cycle-gap-wave8-hnu-mechanical-engineering-doctorate-2026-2027-autumn': 'Mechanical Engineering (Ph.D)',
  [additionalIds[0]]: 'Applied Economics (Master or Ph.D)', [additionalIds[1]]: 'Business Administration (Master or Ph.D)',
};
groups.push({ key: 'hnu-2026-csc-type-b-distinct-from-self-financed-2025', universityId: schools[1], evidence: [evidence('hnu-csc-2026'), evidence('hnu-self-financed')],
  officialTitle: quote('hnu-csc-2026', 'Chinese Government Scholarship Application Notices for High-level Postgraduate Program of Hunan University in 2026'),
  quotedDate: hnuDate, historicalSelfFinancedReference: { originalYear: 2025, deadline: '2025-07-18', quotedDate: hnuSelfDate, targetYearRolledForward: false },
  visualEvidence: ['hnu-csc-programme-1.png', 'hnu-csc-deadline-4.png', 'hnu-self-title-1.png', 'hnu-self-deadline-4.png'].map(imagePin),
  scope: 'Five exact majors/degree levels plus the separately named high-level postgraduate scholarship, only under the 2026 CSC Type B route. General self-financed 2026 admissions are not certified.',
  records: idsFor(schools[1]).map((id) => {
    const c = cycles.get(id);
    if (c) { assert.ok(c.sourceIds.includes('hnu-csc-postgraduate-2026')); assert.ok(c.notes.en.includes('full tuition under 2026 CSC route')); }
    return closed(id, 'hnu-csc-2026', '2026-03-01', c ? 'exact-2026-csc-programme-and-degree-explicitly-listed-with-canonical-cycle-route-note' : 'exact-2026-high-level-postgraduate-csc-award-has-own-applicant-cutoff', {
      quotedDate: hnuDate, fundingRoute: '2026 CSC High-level Postgraduate Program, Type B',
      ...(c ? { exactProgrammeDegreeQuote: quote('hnu-csc-2026', hnuMajorById[id]), canonicalRouteBinding: { sourceId: 'hnu-csc-postgraduate-2026', canonicalNoteFragment: 'Funding note: full tuition under 2026 CSC route.', canonicalNotes: c.notes }, programmeIdentityAndFundingDateScopesDistinct: true } : { awardOwnDateNotBorrowed: true }),
      selfFinancedLimitation: 'Stored programme URL may point to the historical 2025 self-financed PDF. Its July18,2025 deadline is preserved as historical reference only; this row finding applies solely to the explicitly stored 2026 CSC route.',
      historicalSelfFinancedReference: { year: 2025, deadline: '2025-07-18', quotedDate: hnuSelfDate, evidenceBodySha256: byName.get('hnu-self-financed').rawSha256 },
    });
  }),
});
const hutbDate = quote('hutb-2026-guide', '截止时间：2026年6月30日（秋季入学）');
groups.push({ key: 'hutb-two-exact-2026-autumn-programmes-three-independently-undated-awards', universityId: schools[2], evidence: [evidence('hutb-2026-guide')],
  quotedDate: hutbDate, englishDate: quote('hutb-2026-guide', 'Deadline: June 30, 2026 (fall semester admission)'),
  scope: 'Chinese-language nondegree and International Business master explicitly listed in the 2026 bilingual table; three independently scoped award rows.',
  unrelatedTranslationIssue: 'Applicant age paragraph has English June1,2025 versus Chinese June1,2026. Both application deadline clauses agree on June30,2026. Other eligibility facts are not certified.',
  records: idsFor(schools[2]).map((id) => cycles.has(id) ? closed(id, 'hutb-2026-guide', '2026-06-30', 'exact-2026-autumn-guide-lists-selected-language-or-international-business-programme', { quotedDate: hutbDate, exactProgrammeQuote: quote('hutb-2026-guide', programs.get(cycles.get(id).programId).degreeLevel === 'master' ? '国际商务' : '汉语言进修'), feeReferenceNotUsedAsYearAnchor: true })
    : unknown(id, 'hutb-2026-guide', 'award-listing-has-no-independent-application-period', { quotedDate: null, admissionDeadlineNotBorrowed: '2026-06-30', admissionDeadlineAppliesToAward: false, awardScopeQualification: id.includes('inclusive') ? 'Performance-based awards for outstanding students already studying at HUTB; not an independently dated freshman award application.' : 'Named provincial or Belt and Road language award has no independent applicant cutoff in this guide.' })),
});
groups.push({ key: 'jsu-presidential-scholarship-no-independent-dated-window', universityId: schools[3], evidence: [evidence('jsu-president')],
  scope: 'Only exact JSU Presidential Scholarship award; annual renewal, registration and office hours are not new-applicant cutoffs.',
  applicationInstruction: quote('jsu-president', 'Please download and fill the above application form, upload to the section of Presidential Scholarship Application Form when making online application through admission.ujs.edu.cn'),
  records: idsFor(schools[3]).map((id) => unknown(id, 'jsu-president', 'current-award-page-provides-upload-procedure-but-no-independent-year-specific-deadline', { quotedDate: null, admissionDeadlineNotBorrowed: true })),
});
const justDate = quote('just-2026-guide', 'April 10, 2026 to June 10, 2026.');
const justMajors = {
  'cycle-gap-local-strong-just-b-business-administration-en-2026-2027-other': 'Bachelor of Business Administration (BBA)',
  'cycle-gap-local-strong-just-b-computer-science-en-2026-2027-other': 'Computer Science and Technology',
  [additionalIds[3]]: 'Energy and Power', [additionalIds[4]]: 'Management Science and Engineering',
  [additionalIds[5]]: 'Master of Business Administration (MBA)', [additionalIds[6]]: 'Naval Architecture and Ocean Engineering',
};
groups.push({ key: 'just-six-exact-2026-degree-catalogue-matches-and-two-separate-awards', universityId: schools[4], evidence: [evidence('just-2026-guide')],
  quotedDate: justDate, scope: 'Six exact programmes with degree-level matches in the 2026 table. Provincial and university scholarships retain their independent undated status.',
  degreeBinding: 'First two selected programmes are Bachelor table rows, Energy and Power / MBA / Naval Architecture and Ocean Engineering are Master rows, Management Science and Engineering is a PhD row. MBA and Management Science are marked bilingual with HSK preferred; no independent language eligibility certification.',
  applicantVsInstitutionDates: quote('just-2026-guide', 'Admission documents will be sent before August 15, 2026.'),
  records: idsFor(schools[4]).map((id) => cycles.has(id) ? closed(id, 'just-2026-guide', '2026-06-10', '2026-applicant-period-plus-exact-programme-and-degree-table-match', { quotedDate: justDate, candidateOfficialOpensOn: '2026-04-10', exactProgrammeQuote: quote('just-2026-guide', justMajors[id]), catalogueDegreeBinding: programs.get(cycles.get(id).programId).degreeLevel, feeReferenceNotUsedAsYearAnchor: true, mailingAndInstitutionReviewDatesNotBorrowed: true })
    : unknown(id, 'just-2026-guide', id.includes('jiangsu-provincial') ? 'provincial-award-managed-externally-no-independent-award-date-in-current-guide' : 'university-scholarship-listing-and-registered-student-excellence-have-no-independent-application-date', { quotedDate: null, admissionDeadlineNotBorrowed: '2026-06-10', admissionDeadlineAppliesToAward: false })),
});
const jxnuDate = quote('jxnu-2026-iclt-original', '2026 年 5 月 15 日（2026 年 9 月入学）');
groups.push({ key: 'jxnu-2026-iclt-september-deadline-and-undated-march2027-route', universityId: schools[5], evidence: [evidence('jxnu-2026-iclt'), evidence('jxnu-2026-iclt-original')],
  navigationProvenance: 'Registered official wrapper embeds wp_pdf_player pdfsrc; exact PDF original captured and all ten pages extracted. Wrapper HTTP200 alone is not treated as full-guide verification.',
  scope: 'Whole award row covers the 2026 ICLT scheme; same original also offers a March2027 one-semester intake whose deadline is not stated. September-only closure is kept as scoped evidence, not the entire award deadline.',
  visualEvidence: ['jxnu-date-04.png', 'jxnu-date-05.png'].map(imagePin),
  records: idsFor(schools[5]).map((id) => unknown(id, 'jxnu-2026-iclt-original', 'wide-award-includes-september2026-and-march2027-routes-but-publishes-only-september-applicant-cutoff', {
    quotedDate: jxnuDate, openingQuote: quote('jxnu-2026-iclt-original', '2026 年 3 月 1 日起'), candidateOfficialOpensOn: '2026-03-01',
    candidateScopedWindows: [{ route: '2026 September intake only', applicantDeadline: '2026-05-15', timeZone: 'Asia/Shanghai', exactCutoffAt: null, result: 'closed', quotedDate: jxnuDate, deadlineBoundary: 'date-only-no-clock-time-stated' }, { route: '2027 March one-semester intake', applicantDeadline: null, result: 'unknown', intakeQuote: quote('jxnu-2026-iclt-original', '2026 年 9 月、2027 年 3 月入学，资助期限为 5 个月。') }],
    noWholeAwardDeadlineInferred: true, institutionReviewNotApplicantDeadline: 'Review about three months before enrollment is an institutional stage, not a student application cutoff.',
  })),
});
const records = groups.flatMap((g) => g.records);
assert.equal(records.length, 22);
assert.equal(new Set(records.map((r) => r.recordId)).size, 22);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...ids].sort());
const results = records.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
assert.deepEqual(results, { closed: 15, unknown: 7 });
assert.equal(records.filter((r) => r.collection === 'admissionCycles').length, 13);
assert.equal(records.filter((r) => r.collection === 'scholarships').length, 9);
assert.equal(records.filter((r) => r.result === 'closed' && r.candidateDeadlineChangesStoredNull).length, 8);
assert.ok(records.filter((r) => r.result === 'closed').every((r) => r.officialDeadline < today && r.candidateOnly));
assert.ok(records.filter((r) => r.result === 'unknown').every((r) => r.officialDeadline === null));
assert.ok(records.every((r) => !r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.openingDateAssessed));
assert.deepEqual(fileHashes(), before);
const report = {
  schemaVersion: 1, batchId: 'official-date-only-024-20261019', state: 'completed-fifteen-scoped-expired-windows-seven-unknown', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  snapshotSha256: inventory.snapshotSha256, inventorySha256: hash(inventoryBytes), inputFileSha256: before,
  targetQueue: queuePath, targetQueueSha256: hash(queueBytes), selectedUniversityIds: schools,
  selection: { baseQueueRecordIds: baseIds, additionalSameSourceRecordIds: additionalIds, baseQueueRecords: 15, additionalSameSourceRecords: 7, totalRecords: 22, additionalSelectionReceipt: additionalReceipt, additionalSelectionReceiptSha256: hash(additionalBytes) },
  acquisition: { newDistinctOfficialUrlsAttempted: 9, newDistinctOfficialUrlsCapturedSuccessfully: 9, originalSourcesCaptured: 8, derivedEmbeddedOriginalPdfCaptured: 1, newWebsiteReadsForAdditionalRecords: 0, reusedPriorEvidence: 0, initialNativeTLSFailures: 2, singleNormalTLSWindowsCurlRecoveries: 2, captureManifestSha256: hash(captureManifestBytes), recoveryAndOriginalManifestSha256: hash(recoveryBytes), rawAndTextCaptureHashesVerified: true, pdfPagesExtracted: { 'hnu-csc-2026.pdf': 4, 'hnu-self-financed.pdf': 4, 'jxnu-2026-iclt-original.pdf': 10 }, normalTLSCertificateValidation: true, paidModelCalls: 0 },
  summary: { universitiesWithScopedChecks: 6, recordsAssessed: 22, baseQueueRecords: 15, additionalSameSourceRecords: 7, admissionCyclesAssessed: 13, scholarshipsAssessed: 9, recordResults: results, newExactExpiredDeadlineCandidatesFromCanonicalNull: 8, existingExpiredDatesScoped: 7, independentAwardDeadlinesEstablished: 2, additionalAwardScopedSeptemberDeadlineNotWholeAwardClosure: 1, canonicalWrites: 0, sharedStateWrites: 0, gitMutations: 0, freshnessRenewals: 0, publicationActions: 0, wholeSchoolCataloguesCertified: 0, fullFactsCertified: 0 },
  policy: 'Date-only candidate observations. No canonical dates, statuses or freshness changed. Same-route past application windows do not imply programme discontinuation or closure of other routes. No historical self-financed year is rolled into the target year. Every award retains its own deadline scope. Any future date write requires a supported narrow consumer, independent approval and exact-row compare-and-swap.',
  groups,
  validation: { exactBase15AndAdditional7IdsCoveredOnce: true, fullCanonicalCycleRowPins: 13, fullCanonicalProgramRowPinsForCycles: 13, fullCanonicalAwardRowPins: 9, fullCanonicalSourceRowsPinned: true, quotedDateFragmentsMatchedAfterWhitespaceNormalization: true, rawAndTextBytesHashVerified: true, selectedPdfDateProgrammeAndScopePagesRenderedAndVisuallyRead: true, canonicalSixFilesUnchangedBeforeAfter: true },
};
const output = path.join(dir, 'report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportPath: output, sha256: hash(fs.readFileSync(output)), records: records.length, results }));
