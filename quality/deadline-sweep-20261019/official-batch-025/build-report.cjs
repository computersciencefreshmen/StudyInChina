/* Finite source-only date assessment; no canonical, freshness, state or Git writes. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const dir = __dirname, root = path.resolve(dir, '../../..');
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rowHash = row => hash(JSON.stringify(row));
const bytes = name => fs.readFileSync(path.join(dir, name));
const read = name => JSON.parse(bytes(name));
const selectionBytes = bytes('selection.json'), selection = JSON.parse(selectionBytes);
const today = '2026-10-19';
assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), today);
const files = Object.keys(selection.inputFileSha256);
const fileHashes = () => Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
const before = fileHashes(); assert.deepEqual(before, selection.inputFileSha256);
const queueBytes = fs.readFileSync(path.join(primary, selection.queuePath));
const inventoryBytes = fs.readFileSync(path.join(primary, selection.inventoryPath));
const inventory = JSON.parse(inventoryBytes), queue = JSON.parse(queueBytes);
assert.equal(hash(queueBytes), selection.queueSha256); assert.equal(hash(inventoryBytes), selection.inventorySha256);
assert.equal(selection.snapshotSha256, inventory.snapshotSha256); assert.equal(queue.snapshotSha256, inventory.snapshotSha256);
assert.deepEqual(selection.universityIds, queue.selectedUniversityIds.slice(0, 5));
const load = f => new Map(JSON.parse(fs.readFileSync(path.join(primary, 'content/data', f))).map(row => [row.id, row]));
const cycles = load('admission-cycles.json'), awards = load('scholarships.json'), programs = load('programs.json'), sources = load('sources.json');
const extensionBytes = fs.readFileSync(path.join(root, selection.additionalSelectionReceipt)), extension = JSON.parse(extensionBytes);
assert.equal(hash(extensionBytes), selection.additionalSelectionReceiptSha256); assert.equal(extension.baseQueueSha256, selection.queueSha256);
const byId = new Map(selection.records.map(r => [r.recordId, r]));
assert.equal(byId.size, 19); assert.equal(selection.baseQueueRecordIds.length, 11); assert.equal(selection.additionalSameSourceRecordIds.length, 8);
for (const selected of selection.records) {
  const row = cycles.get(selected.recordId) || awards.get(selected.recordId);
  assert.deepEqual(row, selected.row); assert.equal(rowHash(row), selected.canonicalRecordSha256);
  for (const p of selected.programRows) { assert.deepEqual(p.row, programs.get(p.row.id)); assert.equal(rowHash(p.row), p.canonicalProgramSha256); }
  for (const s of selected.sources) { assert.deepEqual(s.row, sources.get(s.row.id)); assert.equal(rowHash(s.row), s.canonicalSourceSha256); }
  if (selected.selectionOrigin === 'additionalSameSource8') assert.ok(extension.extraRecords.some(x => x.recordId === selected.recordId && x.canonicalRecordSha256 === selected.canonicalRecordSha256));
}
const manifestBytes = bytes('capture-summary.json'), fallbackBytes = bytes('fallback-manifest.json');
const attempts = [...JSON.parse(manifestBytes), ...JSON.parse(fallbackBytes)], captures = new Map(attempts.map(r => [r.key, r]));
for (const item of attempts) {
  if (item.rawPath) assert.equal(hash(bytes(item.rawPath)), item.rawSha256);
  if (item.textPath) assert.equal(hash(bytes(item.textPath)), item.textSha256);
  assert.ok(Number.isFinite(Date.parse(item.observedAt)));
}
const text = key => bytes(captures.get(key).textPath).toString('utf8');
const normal = value => value.replace(/\s+/g, '');
const quote = (key, value) => { assert.ok(normal(text(key)).includes(normal(value)), key + ': quote missing: ' + value); return value; };
const ev = (key, scope) => ({ ...captures.get(key), readScope: scope, fullFactsCertified: false });
function base(id, key) {
  const selected = byId.get(id), row = selected.row, cycle = selected.collection === 'admissionCycles', original = captures.get(key);
  return {
    collection: selected.collection, recordId: id, selectionOrigin: selected.selectionOrigin, universityId: selected.universityId,
    ...(cycle ? { programId: selected.program.id, programName: selected.program.name.en, degreeLevel: selected.program.degreeLevel, academicYear: row.academicYear, intake: row.intake, canonicalCycleSha256: selected.canonicalRecordSha256, canonicalProgramSha256: selected.canonicalProgramSha256, storedOpensOn: row.opensOn, storedDateStatus: row.dateStatus } : { name: row.name.en, programIds: row.programIds, canonicalScholarshipSha256: selected.canonicalRecordSha256, storedOpensOn: null }),
    canonicalRecordSha256: selected.canonicalRecordSha256, canonicalRowSha256: selected.canonicalRecordSha256,
    canonicalProgramPins: selected.programRows.map(p => ({ programId: p.row.id, canonicalProgramSha256: p.canonicalProgramSha256 })),
    storedDeadline: cycle ? row.closesOn : row.deadline, storedStatus: row.status, storedVerifiedAt: row.verifiedAt, storedReviewAfter: row.reviewAfter,
    sourceIds: row.sourceIds,
    sourcePins: selected.sources.map(s => ({ sourceId: s.row.id, canonicalSourceSha256: s.canonicalSourceSha256, url: s.row.url, sourceFullRecord: s.row })),
    evidenceSourceKey: key, evidenceSourceUrl: original.url, evidenceBodySha256: original.rawSha256 || null, observedAt: original.observedAt,
    evidenceSourceIds: row.sourceIds.filter(sid => sources.get(sid).url === original.url),
    candidateOnly: true, dateOnly: true, fullFactsCertified: false, wholeSchoolCatalogueCompleted: false,
    canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false, canonicalDeadlineAssessed: false,
    officialOpensOn: null, candidateOfficialOpensOn: null, openingDateAssessed: false, exactCutoffAt: null,
  };
}
const unknown = (id, key, reason, fields = {}) => ({ ...base(id, key), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, reason, ...fields });
const idsFor = u => selection.records.filter(r => r.universityId === u).map(r => r.recordId);
const groups = [];
groups.push({ key: 'hlju-2027-homepage-not-specific-admission-date', universityId: selection.universityIds[0], evidence: [ev('source-02', 'Complete captured homepage visible text read; current news/navigation are not a2027 programme guide.')],
  limitation: 'The registered source is the college homepage. It contains2026 news, no full2027 law-master or translation-bachelor admissions notice or dated applicant window. No dates inferred from home/landing/publication metadata.',
  records: idsFor(selection.universityIds[0]).map(id => unknown(id, 'source-02', '2027-exact-programme-year-and-applicant-date-not-in-homepage-body', { targetYear: 2027, landingNotDateEvidence: true })),
});
groups.push({ key: 'hubu-three-programmes-source-unavailable-cooldown', universityId: selection.universityIds[1], evidence: [ev('source-01', 'NativeTLS handshake timeout; no body captured.'), ev('source-01-recovery', 'One normal-certificate Windowscurl fallback failed certificate revocation availability; no body or dates read.')],
  limitation: 'One nativeGET plus one normalTLS fallback only. No revocation/TLS validation bypass, no further retry or date certification.',
  records: idsFor(selection.universityIds[1]).map(id => ({ ...unknown(id, 'source-01', 'native-TLS-timeout-and-one-normal-certificate-fallback-failed-no-date-body'), result: 'blocked', cooldown: true, sourceUnavailable: true })),
});
groups.push({ key: 'jufe-award-empty-official-directory-shells', universityId: selection.universityIds[2], evidence: [ev('source-04', 'Full returned visible directory shell read; no award article/date body.'), ev('source-05', 'Full returned scholarship directory shell read; no independent dated award article.')],
  limitation: 'Both200responses contain site navigation/contact and award-category labels. Their successful HTTPstatus is not a dated award guide. No year/window read and no deadline invented.',
  records: idsFor(selection.universityIds[2]).map(id => unknown(id, 'source-04', 'returned-award-directory-shell-has-no-current-applicant-date-body', { directoryHTTP200NotDateCertification: true })),
});
const jluRange = quote('source-03', 'generally\nfrom early January to April');
groups.push({ key: 'jlu2026-2027-TypeA-home-country-dispatch-window-not-exact-day', universityId: selection.universityIds[3], evidence: [ev('source-03', 'Complete captured2026/2027TypeAofficialnotice read for date scope.')],
  officialTitle: quote('source-03', '2026/2027 Academic Year General Regulations of Enrollment for Bilateral Program of Chinese Government Scholarship at Jilin University (Type A)'), quotedDate: jluRange,
  scope: 'Applicants apply to their home-country dispatching authority, generally earlyJanuary–April; exact time must be confirmed with that authority. This is not a university fixed closing day or TypeBdeadline.',
  records: idsFor(selection.universityIds[3]).map(id => unknown(id, 'source-03', 'TypeA-generally-January-April-home-country-dispatch-period-no-exact-cutoff', { quotedDate: jluRange, recurringOrGeneralReference: { from: 'earlyJanuary', to: 'April', exactDay: null }, dispatchAuthorityDeterminesExactPeriod: true, TypeBDeadlineNotBorrowed: true })),
});
const jnuDates = quote('source-06', 'January 15 – February 28, 2026;\nApril 1 – May 31, 2026');
const jnuSpecial = quote('source-06', 'Enrollment in the Chinese Language Education major at the College of Chinese Language and Culture is exclusively available through the Overseas Chinese Language Education Student Scholarship Program, as detailed in the college\'s official brochure.');
const aliasById = {
  'cycle-gap-clw-sw-jnu-chinese-language-bachelor-2026-2027-autumn-fee-reference': 'Chinese Language',
  'cycle-gap-clw-sw-jnu-tcsol-bachelor-2026-2027-autumn-fee-reference': 'Teaching Chinese to Speakers of Other Language',
  'cycle-wave3-program-jinan-university-international-economics-and-trade-bachelor-autumn-2026-historical': 'International Economy and Trade',
  'cycle-wave3-program-jinan-university-computer-science-and-technology-bachelor-autumn-2026-historical': 'Computer Science and Technology',
  'cycle-wave3-program-jinan-university-accounting-bachelor-autumn-2026-historical': 'Accounting',
  'cycle-wave3-program-jinan-university-finance-bachelor-autumn-2026-historical': 'Finance',
  'cycle-wave3-program-jinan-university-pharmacy-bachelor-autumn-2026-historical': 'Pharmacy',
  'cycle-wave3-program-jinan-university-international-journalism-and-communication-bachelor-autumn-2026-historical': 'International News and Communication',
  'cycle-wave3-program-jinan-university-food-nutrition-and-health-bachelor-autumn-2026-historical': 'Food Nutrition and Health',
  'cycle-wave3-program-jinan-university-clinical-medicine-bachelor-autumn-2026-historical': 'Clinical Medicine',
};
groups.push({ key: 'jnu2026-two-application-review-windows-and-independent-award-scopes', universityId: selection.universityIds[4], evidence: [ev('source-06', 'Full captured2026guide including2026major table, both application routes, and scholarship/exclusive-route clauses read. No new links or fee verification.')],
  officialTitle: quote('source-06', 'Jinan University Application Guide for International Students (2026)'), quotedDate: jnuDates,
  dateMeaning: 'Both intervals are online applicant registration for ApplicationReviewAdmission, not institution-only review. Preserve the March gap. JointEntranceExamination has separateMarch1–15online registration, March19–27verification and May30–31exams; none replaces the review-route deadline.',
  sourceWindows: [{ route: 'ApplicationReviewAdmission-first-window', opensOn: '2026-01-15', closesOn: '2026-02-28' }, { route: 'ApplicationReviewAdmission-second-window', opensOn: '2026-04-01', closesOn: '2026-05-31' }],
  continuousWindowNotInferred: true, wholeProgrammeOtherRoutesNotCertified: true, exclusiveChineseEducationRoute: jnuSpecial,
  exactEightAdditionalProgrammeContext: 'InternationalSchool English-table major rows match the eight assigned Englishhistoricalbachelors; ClinicalMedicine is sixyears and the others fouryears. InternationalEconomyandTrade and InternationalNewsandCommunication are the original Englishname variants. ChineseLanguage andTCSOL are named in the CollegeofChineseLanguageandCulture table.',
  records: idsFor(selection.universityIds[4]).map(id => {
    if (awards.has(id)) return unknown(id, 'source-06', 'Guangdong-government-award-listing-no-independent-dated-cutoff', { quotedDate: null, programmeDeadlineNotBorrowed: '2026-05-31', otherCSCTypicalNovember2025April2026ReferenceNotBorrowed: true });
    if (id.includes('chinese-culture-education')) return unknown(id, 'source-06', 'ChineseLanguageEducation-exclusive-scholarship-route-defers-to-own-college-brochure', { quotedDate: jnuSpecial, candidateOfficialDeadline: '2026-05-31', candidateBindingState: 'general-review-route-date-not-bound-to-exclusive-scholarship-route', storedDayNotRecertified: true, additionalGuideNotFetched: true });
    const selected = byId.get(id); assert.equal(selected.row.academicYear, '2026-2027'); assert.equal(selected.program.degreeLevel, 'bachelor'); assert.ok(aliasById[id]);
    assert.equal(selected.row.closesOn, '2026-05-31');
    return { ...base(id, 'source-06'), result: 'closed', officialDeadline: '2026-05-31', candidateOfficialDeadline: '2026-05-31', reason: '2026-exact-undergraduate-table-match-and-final-ApplicationReview-online-registration-window-past', quotedDate: jnuDates, exactProgrammeQuote: quote('source-06', aliasById[id]), degreeBinding: 'bachelor', teachingLanguageBinding: selected.program.teachingLanguages, durationMonthsBinding: selected.program.durationMonths, programmeContext: selected.selectionOrigin === 'additionalSameSource8' ? 'InternationalSchool English-table programme' : 'CollegeofChineseLanguageandCulture Chinese-table programme', findingScope: '2026 ApplicationReviewAdmission only; no2027year, otherfundingroute or programme discontinuation is inferred.', sourceWindows: [{ opensOn: '2026-01-15', closesOn: '2026-02-28' }, { opensOn: '2026-04-01', closesOn: '2026-05-31' }], continuousWindowNotInferred: true, storedDateMatchesScopedOfficialDay: true, candidateDeadlineChangesStoredNull: false, deadlineBoundary: 'date-only-no-clock-time-stated' };
  }),
});
const records = groups.flatMap(g => g.records), ids = [...selection.baseQueueRecordIds, ...selection.additionalSameSourceRecordIds];
assert.equal(records.length, 19); assert.equal(new Set(records.map(r => r.recordId)).size, 19); assert.deepEqual(records.map(r => r.recordId).sort(), ids.sort());
const results = records.reduce((o, r) => { o[r.result] = (o[r.result] || 0) + 1; return o; }, {});
assert.deepEqual(results, { unknown: 6, blocked: 3, closed: 10 });
assert.ok(records.filter(r => r.result === 'closed').every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.officialDeadline) && r.officialDeadline < today));
const priorPins = [];
for (let n = 1; n < 25; n++) {
  const relative = `quality/deadline-sweep-20261019/official-batch-${String(n).padStart(3, '0')}/report.json`, file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const original = fs.readFileSync(file); priorPins.push({ path: relative, sha256: hash(original) });
  const scan = v => { if (typeof v === 'string') assert.ok(!ids.includes(v), 'Prior exact record: ' + v); else if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') Object.values(v).forEach(scan); }; scan(JSON.parse(original));
}
assert.deepEqual(fileHashes(), before);
const report = { schemaVersion: 1, batchId: selection.batchId, state: 'completed-finite-date-only-check', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(), snapshotSha256: selection.snapshotSha256, inventorySha256: hash(inventoryBytes), inputFileSha256: before, targetQueue: selection.queuePath, targetQueueSha256: selection.queueSha256, selectedUniversityIds: selection.universityIds,
  selection: { path: 'selection.json', sha256: hash(selectionBytes), baseQueueRecordIds: selection.baseQueueRecordIds, additionalSameSourceRecordIds: selection.additionalSameSourceRecordIds, baseQueueRecords: 11, additionalSameSourceRecords: 8, totalRecords: 19, additionalSelectionReceipt: selection.additionalSelectionReceipt, additionalSelectionReceiptSha256: selection.additionalSelectionReceiptSha256 },
  acquisition: { newDistinctOfficialUrlsAttempted: 6, nativeRequests: 6, oneNormalTLSFallbackRequest: 1, totalNetworkRequests: 7, originalFullSuccessfulResponses: 5, failedNativeSourceWithoutBody: 1, failedFallbackWithoutBody: 1, originalNativeManifestSha256: hash(manifestBytes), fallbackManifestSha256: hash(fallbackBytes), normalTLSCertificateValidation: true, newWebsiteReadsForAdditional8Records: 0, newPaidCalls: 0, deeperSourceExpansionRequests: 0, rawAndTextHashesVerified: true },
  summary: { universitiesWithScopedChecks: 5, recordsAssessed: 19, baseQueueRecords: 11, additionalSameSourceRecords: 8, admissionCyclesAssessed: 16, scholarshipsAssessed: 3, recordResults: results, newExactExpiredDeadlineCandidatesFromCanonicalNull: 0, existingExpiredDatesScoped: 10, existingStoredDatesWithUnresolvedExclusiveRoute: 1, canonicalWrites: 0, sharedStateWrites: 0, gitMutations: 0, freshnessRenewals: 0, publicationActions: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0 },
  policy: 'Only date/scope source observations. All canonical dates, status and freshness stay unchanged; same2026route closure does not mean programme discontinuation. Do not roll2026into2027, invent an exactday from a month range, join two separate applicant windows, or borrow programme dates for awards. New/unresolved findings are candidates only; any consumer needs independent review and exactrowCAS.',
  groups, validation: { exactBase11AndAdditional8CoveredOnce: true, fullCanonicalRecordProgramSourcePinsVerified: true, sixCanonicalFilesUnchanged: true, retainedOriginalByteHashesAndObservedAtVerified: true, noPriorExactRecordOverlap: true, priorReportPins: priorPins },
};
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const reportSha256 = hash(bytes('report.json'));
fs.writeFileSync(path.join(dir, 'completion.json'), JSON.stringify({ batchId: report.batchId, completedAt: report.completedAt, reportSha256, summary: report.summary, canonicalMutation: false, freshnessRenewed: false, gitOrStateMutation: false }, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(dir, 'README.md'), `# Official date-only batch025\n\n19 exact records:11 queue-v6base plus8 assigned JNUhistoricalcycles. Results:10 scopedpastwindows,6 unknown,3 blocked. Originalbytes/hashes/observationtimes and scope restrictions are in report.json.\n\nAllcanonicaldates/status/freshness,stateandGitremainunchanged. JNUseparatewindowsandtheexclusivescholarshiproutearenotcombined;homepage/directory200responsesarenotdeadlineproof.\n\nReport SHA256: ${reportSha256}\n`, { flag: 'wx' });
console.log(JSON.stringify({ reportSha256, records: records.length, results }));
