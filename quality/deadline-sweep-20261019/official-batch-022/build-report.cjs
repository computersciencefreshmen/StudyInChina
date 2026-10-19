/* Source-only exact-record date assessment. Never writes catalogue/state/Git. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const root = path.resolve(dir, '../../..');
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const rowHash = row => hash(JSON.stringify(row));
const bytes = file => fs.readFileSync(path.join(dir, file));
const read = file => JSON.parse(bytes(file));
const norm = value => value.replace(/\s+/g, '');
const selectionBytes = bytes('selection.json');
const selection = JSON.parse(selectionBytes);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
assert.equal(today, '2026-10-19');
const files = Object.keys(selection.inputFileSha256);
const fileHashes = () => Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(primary, 'content/data', file)))]));
const before = fileHashes();
assert.deepEqual(before, selection.inputFileSha256);
const inventoryBytes = fs.readFileSync(path.join(primary, selection.inventoryPath));
const inventory = JSON.parse(inventoryBytes);
const queueBytes = fs.readFileSync(path.join(primary, selection.queuePath));
const queue = JSON.parse(queueBytes);
assert.equal(hash(inventoryBytes), selection.inventorySha256);
assert.equal(inventory.snapshotSha256, selection.snapshotSha256);
assert.equal(hash(queueBytes), selection.queueSha256);
assert.equal(queue.snapshotSha256, selection.snapshotSha256);
assert.deepEqual(queue.selectedUniversityIds.slice(0, 7), selection.universityIds);
assert.equal(selection.baseQueueRecordIds.length, 22);
assert.equal(selection.additionalSameSourceRecordIds.length, 7);
const extensionBytes = fs.readFileSync(path.join(root, selection.additionalSelectionReceipt));
const extension = JSON.parse(extensionBytes);
assert.equal(hash(extensionBytes), selection.additionalSelectionReceiptSha256);
assert.equal(extension.baseQueueSha256, selection.queueSha256);
const canonical = name => new Map(JSON.parse(fs.readFileSync(path.join(primary, 'content/data', name))).map(row => [row.id, row]));
const cycles = canonical('admission-cycles.json');
const awards = canonical('scholarships.json');
const programs = canonical('programs.json');
const sources = canonical('sources.json');
const byId = new Map(selection.records.map(record => [record.recordId, record]));
const allIds = [...selection.baseQueueRecordIds, ...selection.additionalSameSourceRecordIds];
assert.equal(byId.size, 29);
assert.equal(new Set(allIds).size, 29);
for (const item of selection.records) {
  const row = cycles.get(item.recordId) || awards.get(item.recordId);
  assert.deepEqual(item.row, row);
  assert.equal(rowHash(row), item.canonicalRecordSha256);
  for (const pin of item.programRows) {
    assert.deepEqual(pin.row, programs.get(pin.row.id));
    assert.equal(rowHash(pin.row), pin.canonicalProgramSha256);
  }
  for (const pin of item.sources) {
    assert.deepEqual(pin.row, sources.get(pin.row.id));
    assert.equal(rowHash(pin.row), pin.canonicalSourceSha256);
  }
  if (selection.additionalSameSourceRecordIds.includes(item.recordId)) assert.ok(extension.extraRecords.some(row => row.recordId === item.recordId && row.canonicalRecordSha256 === item.canonicalRecordSha256));
}
const captures = [...read('capture-summary.json'), ...read('capture-derived-summary.json')];
const capture = new Map(captures.map(item => [item.key, item]));
for (const item of captures) {
  if (item.rawPath) assert.equal(hash(bytes(item.rawPath)), item.rawSha256);
  if (item.textPath) assert.equal(hash(bytes(item.textPath)), item.textSha256);
  assert.ok(Number.isFinite(Date.parse(item.observedAt)));
}
const webBytes = bytes('web-fallback-observations.json');
const web = new Map(JSON.parse(webBytes).map(item => [item.key, item]));
for (const item of web.values()) assert.equal(hash(bytes(item.retainedObservationPath)), item.retainedObservationSha256);
const visualBytes = bytes('gmc-visual-reading.json');
const visual = JSON.parse(visualBytes);
assert.equal(visual.sourcePdfSha256, capture.get('source-12').rawSha256);
for (const image of visual.images) assert.equal(hash(bytes(image.path)), image.sha256);
const text = key => bytes(capture.get(key).textPath).toString('utf8');
const quote = (key, value) => { assert.ok(norm(text(key)).includes(norm(value)), key + ': quote not in retained visible body: ' + value); return value; };
const evidence = (key, scope = 'complete-visible-body-date-scope-only') => ({ ...capture.get(key), sourceType: capture.get(key).httpStatus === 200 && !capture.get(key).error ? 'origin-original-bytes' : 'failed-origin-response-not-date-proof', readScope: scope, fullFactsCertified: false });
const webEvidence = key => ({ ...web.get(key), fullFactsCertified: false });
function base(id, key) {
  const selected = byId.get(id);
  const row = selected.row;
  const cycle = selected.collection === 'admissionCycles';
  const ev = key.startsWith('web-') ? web.get(key) : capture.get(key);
  const sourceType = key.startsWith('web-') ? ev.sourceType : 'origin-original-bytes';
  return {
    collection: selected.collection, recordId: id, selectionOrigin: selected.selectionOrigin, universityId: selected.universityId,
    ...(cycle ? { programId: selected.program.id, programName: selected.program.name.en, degreeLevel: selected.program.degreeLevel, academicYear: row.academicYear, intake: row.intake, canonicalCycleSha256: selected.canonicalRecordSha256, canonicalProgramSha256: selected.canonicalProgramSha256, storedOpensOn: row.opensOn, storedDateStatus: row.dateStatus } : { name: row.name.en, programIds: row.programIds, canonicalScholarshipSha256: selected.canonicalRecordSha256, storedOpensOn: null }),
    canonicalRecordSha256: selected.canonicalRecordSha256, canonicalRowSha256: selected.canonicalRecordSha256,
    canonicalProgramPins: selected.programRows.map(pin => ({ programId: pin.row.id, canonicalProgramSha256: pin.canonicalProgramSha256 })),
    storedDeadline: cycle ? row.closesOn : row.deadline, storedStatus: row.status, storedVerifiedAt: row.verifiedAt, storedReviewAfter: row.reviewAfter,
    sourceIds: row.sourceIds,
    sourcePins: selected.sources.map(pin => ({ sourceId: pin.row.id, canonicalSourceSha256: pin.canonicalSourceSha256, url: pin.row.url, sourceFullRecord: pin.row })),
    evidenceSourceKey: key, evidenceSourceUrl: ev.url, observedAt: ev.observedAt,
    evidenceSourceType: sourceType,
    evidenceBodySha256: key.startsWith('web-') ? null : (ev.httpStatus === 200 && !ev.error ? ev.rawSha256 : null),
    retainedObservationSha256: key.startsWith('web-') ? ev.retainedObservationSha256 : null,
    originRawBytesAvailableForDateEvidence: !key.startsWith('web-') && ev.httpStatus === 200 && !ev.error,
    evidenceSourceIds: row.sourceIds.filter(sid => sources.get(sid).url === ev.url),
    candidateOnly: true, dateOnly: true, fullFactsCertified: false, wholeSchoolCatalogueCompleted: false,
    canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false,
    canonicalDeadlineAssessed: false, officialOpensOn: null, candidateOfficialOpensOn: null, openingDateAssessed: false,
    exactCutoffAt: null,
  };
}
const unknown = (id, key, reason, extra = {}) => ({ ...base(id, key), result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null, reason, ...extra });
const closed = (id, key, day, reason, extra = {}) => ({ ...base(id, key), result: 'closed', officialDeadline: day, candidateOfficialDeadline: day, reason, storedDateMatchesScopedOfficialDay: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === day, candidateDeadlineChangesStoredNull: (cycles.get(id)?.closesOn ?? awards.get(id)?.deadline ?? null) === null, deadlineBoundary: 'calendar-date-only-no-clock-time-stated', closureScope: 'Only the explicitly matched2026 application window is past; discontinuation is not inferred.', ...extra });
const schoolIds = university => selection.records.filter(row => row.universityId === university).map(row => row.recordId);
const groups = [];
groups.push({
  key: 'gmc-2026-original-scanned-guide-route-mismatch-held', universityId: selection.universityIds[0],
  evidence: [evidence('source-01', 'Landing title/navigation only; no deadline certified from landing.'), evidence('source-12', 'All six scanned originalPDF pages rendered and visually read; no text layer exists.')],
  rawPdfVisualReadingReceipt: { path: 'gmc-visual-reading.json', sha256: hash(visualBytes) },
  quotedDate: visual.deadline.text, originalYear: 2026, sourceDeadlineCandidate: '2026-09-30',
  applicantVsInstitution: 'ThePDF ApplicationTime box is applicant submission; later interviews, result publication and registration are separate steps.',
  unresolvedScope: 'The exact2026PDF names ClinicalMedicine with1+5years and BDS with5years. Canonical selected rows claim five-year Chinese-taught routes; clinical duration differs and BDS Chinese teaching language is not explicit. A shared sourceURL is insufficient to certify those exact routes.',
  records: schoolIds(selection.universityIds[0]).map(id => unknown(id, 'source-12', 'dated-2026-original-found-but-selected-five-year-chinese-route-not-fully-matched', { quotedDate: visual.deadline.text, candidateOfficialDeadline: '2026-09-30', candidateBindingState: 'unresolved-exact-route-not-approved', officialDeadlineNotBoundToExactProgramme: true, evidencePage: 5, evidencePrintedPage: 6, deadlineBoundary: 'till2026-09-30-no-clock-time', publishRiskFlags: id.includes('clinical-medicine') ? ['originalPDFClinicalMedicine1+5years-versus-canonical60months', 'direct-five-year-Chinese-route-not-explicit'] : ['originalBDS-five-years-Chinese-teaching-language-not-explicit'] })),
});
const gznuDate = quote('source-02', '报名应在2026年5月30日前申请，可选择申请学习一学期或一学年');
groups.push({
  key: 'gznu-2026-fall-language-admission-versus-scholarship', universityId: selection.universityIds[1], evidence: [evidence('source-02')],
  officialTitle: quote('source-02', '2026年贵州师范大学秋季学期国际学生汉语进修项目'), quotedDate: gznuDate,
  courseDurationNotDeadline: { semester: 'September–December2026', academicYear: 'September2026–July2027', applicantDeadline: '2026-05-30' },
  boundaryQualification: 'Chinese says beforeMay30; English says byMay30. Both original formulations are retained; no precise clock/inclusion boundary is invented.',
  englishDateQuote: quote('source-02', 'Application Deadline: Applications must be submitted by May 30, 2026.'),
  records: schoolIds(selection.universityIds[1]).map(id => cycles.has(id)
    ? closed(id, 'source-02', '2026-05-30', 'same-2026-fall-language-semester-or-year-explicit-applicant-cutoff-is-past', { quotedDate: gznuDate, deadlineBoundary: 'Chinese-beforeMay30-English-byMay30-no-clock-stated', boundaryLanguageDifferenceRetained: true })
    : unknown(id, 'source-02', 'language-programme-scholarship-listed-without-independent-applicant-cutoff', { quotedDate: null, awardQuote: quote('source-02', '特别优秀的学生可申请我校奖学金'), generalProgrammeDeadlineNotBorrowed: '2026-05-30' })),
});
const hainanSelfDate = quote('source-04', 'July 15, 2026: Deadline for self-funded student applications;');
const hainanGovDate = quote('source-04', 'May 20, 2026: Deadline for applications for Hainan Government Scholarships for international students;');
const hainanGeneralAwardDate = quote('source-04', 'Those applying for scholarships must finish their applications before May 20.');
groups.push({
  key: 'hainan-2026-self-funded-and-independent-scholarship-dates', universityId: selection.universityIds[2],
  evidence: [evidence('source-03', 'Old registeredURL404 body retained only; no date proof.'), evidence('source-04')],
  officialTitle: quote('source-04', '海南医科大学国际学生学历生招生简章 (2026)'),
  exactProgrammeQuote: quote('source-04', '临床医学\nClinical Medicine\n汉语\nChinese\n5\n年'),
  quotedDates: [hainanSelfDate, hainanGovDate, hainanGeneralAwardDate],
  notApplicantCutoff: { registration: quote('source-04', 'September 15, 2026: Deadline for registration.'), generalFebruaryToJulyReference: 'General annual advice is superseded for exact2026 self-funded applications by the explicitJuly15 clause; September15 is registration only.' },
  awardScopeQualification: 'The guide names both provincial-government and ASEAN awards. The specifically dated2026May20 clause names HainanGovernmentScholarships. A broader undated-year May20-before instruction is not silently promoted to an independent exact ASEAN award cutoff.',
  records: schoolIds(selection.universityIds[2]).map(id => cycles.has(id)
    ? closed(id, 'source-04', '2026-07-15', 'same-2026-Chinese-clinical-bachelor-explicit-self-funded-applicant-deadline-past', { quotedDate: hainanSelfDate, fundingScope: 'self-funded applications only; scholarship routes have separate earlier dates', scholarshipDeadlineNotSubstituted: '2026-05-20', registrationNotSubstituted: '2026-09-15' })
    : id.includes('hainan-government')
      ? closed(id, 'source-04', '2026-05-20', 'explicit-2026-HainanGovernment-scholarship-application-deadline-past', { quotedDate: hainanGovDate, beforeWordingAlsoRetained: hainanGeneralAwardDate, deadlineBoundary: 'datedMay20deadline-plus-general-scholarship-beforeMay20-wording-no-clock-stated', generalAdmissionDeadlineNotBorrowed: '2026-07-15' })
      : unknown(id, 'source-04', 'ASEAN-award-present-but-only-shared-May20-before-instruction-not-independent-exact-dated-ASEAN-cutoff', { quotedDate: hainanGeneralAwardDate, candidateOfficialDeadline: '2026-05-20', candidateBindingState: 'shared-scholarship-instruction-requires-exact-award-scope-review', candidateDeadlineYearContext: '2026guide title and datedgovernmentaward clause; shared instruction itself omits year', deadlineBoundary: 'beforeMay20-no-clock-stated', namedAwardQuote: quote('source-04', 'Hainan Provincial Government Scholarship for International Students and ASEAN Scholarship.') })),
});
const hduDate = quote('source-05', 'Application Procedure (Deadline: June 15th/When seats are full):');
groups.push({
  key: 'hdu-2026-nine-exact-programme-rows-and-separate-SONIS-award', universityId: selection.universityIds[3], evidence: [evidence('source-05'), evidence('source-06', 'Studentregulationsread for sourcecontext only; registration/payment/annualreview timing not treated as2026 application evidence.')],
  officialTitle: quote('source-05', '2026杭州电子科技大学国际学生申请指南'), quotedDate: hduDate,
  exactYearContexts: [quote('source-05', 'Undergraduate Programs in 2026'), quote('source-05', 'Master Degree Programs in 2026'), quote('source-05', 'Chinese Language Programs for International Students in 2026')],
  capacityCondition: 'June15 is the nominal final calendar day. Applications can end earlier when seats are full; no actual capacity-ending day is known or fabricated.',
  records: schoolIds(selection.universityIds[3]).map(id => cycles.has(id)
    ? closed(id, 'source-05', '2026-06-15', 'exact-programme-named-in-2026-degree-or-language-table-and-shared-applicant-cutoff-past', { quotedDate: hduDate, exactProgrammeChineseQuote: quote('source-05', byId.get(id).program.degreeLevel === 'language' ? '汉语言进修生' : byId.get(id).program.name.zh), scopedProgrammeYear: 2026, capacityMayCloseEarlier: true, capacityClosureDateUnknown: true, deadlineBoundary: 'June15-or-earlier-when-seats-full-no-clock-stated', candidateOfficialOpensOn: null })
    : unknown(id, 'source-05', 'SONIS-first-academic-year-award-listed-no-independent-scholarship-cutoff', { quotedDate: null, generalProgrammeDeadlineNotBorrowed: '2026-06-15', scholarshipQualificationQuote: quote('source-05', '优秀新国际学生奖学金'), degreeOnlyAwardQuote: quote('source-05', 'For Degree Students') })),
});
const hmuWeb = web.get('web-07');
groups.push({
  key: 'hmu-2026-three-scholarship-branches-vs-unread-general-postgraduate-brochure', universityId: selection.universityIds[4],
  evidence: [evidence('source-07', 'Origin403 challenge body retained, no date certified from it.'), evidence('source-08', 'Origin403 challenge body retained, no date certified from it.'), webEvidence('web-07'), webEvidence('web-08')],
  quotedDate: hmuWeb.quote,
  dateEvidenceProvenance: 'Full parsed official scholarship notice read through the one web fallback after origin403. OriginHTML bytes were unavailable; retained observation receipt hash is not represented as original-page-body SHA.',
  scholarshipScope: 'The same2026notice explicitly lists three schemes and then one applicant period for master and doctoral scholarship applicants. Broad highlevelgraduate and Eurasia routes cover postgraduateprogrammes; SilkRoad is restricted toRussian citizens and specifiedmedicalmajors. Nofunding/eligibilityfacts are renewed.',
  broaderProgrammeScopeUnresolved: 'The separate2026 general postgraduate brochure requires its actualPDF; attachment retrieval requested a captcha and was stopped. The canonical generic master/doctoralMarch5 closesOn is therefore not certified for all self-funded or general routes merely because it matches the scholarshipperiod.',
  notApplicantCutoff: 'September30,2026 is scholarship-student campus registration only.',
  records: schoolIds(selection.universityIds[4]).map(id => awards.has(id)
    ? closed(id, 'web-07', '2026-03-05', 'three-named-2026-scholarship-schemes-share-explicit-applicant-period-past', { quotedDate: hmuWeb.quote, candidateOfficialOpensOn: '2025-11-01', candidateOpeningOnly: true, structuredCanonicalOpeningStillAbsent: true, noLateApplicationsAccepted: true, scope: 'Only the named2026scholarshipprogramme; not all general/self-fundedpostgraduateadmission.', origin403ReceiptKey: 'source-07', applicantVsInstitution: 'CSCTypeB applicant submission period; subsequent interviews, nomination and campusregistration are separate.' })
    : unknown(id, 'web-07', 'stored-March5-only-matched-scholarship-branch-general-postgraduate-original-PDF-unread', { quotedDate: hmuWeb.quote, candidateOfficialDeadline: '2026-03-05', candidateBindingState: 'scholarship-branch-only-not-general-cycle', scopedCandidateWindow: { opensOn: '2025-11-01', closesOn: '2026-03-05', funding: '2026graduate-scholarshiproutes-only' }, storedDayEqualityNotFullRouteCertification: true, generalBrochureAttachmentHeld: true, publishRiskFlags: ['do-not-certify-generic-cycle-as-entirely-closed-from-scholarship-only-date', 'general-PDF-not-read-captcha-cooldown'] })),
});
groups.push({
  key: 'hrbnu-two-awards-source-unavailable-bounded-cooldown', universityId: selection.universityIds[5], evidence: [evidence('source-09', 'NativeTLS handshake timedout; no bodycaptured.'), webEvidence('web-09')],
  acquisitionLimitation: 'One nativeGET and one webfallback timedout; no further attempts or TLS/captcha workaround. No exact applicant year/date was read.',
  records: schoolIds(selection.universityIds[5]).map(id => ({ ...unknown(id, 'source-09', 'official-source-native-and-single-web-fallback-timeout-no-date-body'), result: 'blocked', evidenceSourceType: 'failed-origin-and-web-requests-no-date-proof', cooldown: true, deadlineCertified: false })),
});
const hebmuRecurrence = quote('source-10', '申请人须于每年\n9\n月初至\n次年\n2\n月');
groups.push({
  key: 'hebmu-current-degree-brochure-too-large-and-recurring-CSC-process', universityId: selection.universityIds[6],
  evidence: [evidence('source-10'), evidence('source-11', '2026guide landing confirms categories and attachmentURL only; not deadlineproof.'), evidence('source-13', 'OriginalPDF exceeded10MiBboundedtransfer; capturestopped without retaining a false complete body/hash.')],
  brochureDiscovery: 'Retained raw2026landing directly links the exactPDF; nativeGET exceeded the predetermined10MiBlimit. No exact dates are extracted from the landing, filename, or partialtransfer.',
  recurringScholarshipQuote: hebmuRecurrence,
  recurrenceQualification: 'Annual earlySeptember→followingFebruary is a month-level recurring process. It supplies no exact upcoming day/year and cannot be rolled into2026or2027exact dates. Bilateral and autonomousuniversityroutes are distinct.',
  records: schoolIds(selection.universityIds[6]).map(id => awards.has(id)
    ? unknown(id, 'source-10', 'annual-early-September-to-next-February-process-no-exact-dated-CSC-application-cutoff', { quotedDate: hebmuRecurrence, recurringReference: { opens: 'earlySeptember', closes: 'followingFebruary', exactYears: null, exactDay: null }, nextCycleNotInvented: true })
    : unknown(id, 'source-11', 'exact2026-bachelor-academic-master-doctorate-guide-attachment-too-large-no-date-body-read', { quotedDate: null, landingNotDateEvidence: true, originalPdfCaptureHeld: true, originalPdfCaptureKey: 'source-13', exact2026CategoriesNamedButNoDeadlineCertified: true, scholarshipRecurrenceNotBorrowedAsDegreeDeadline: true, cooldown: true })),
});
const records = groups.flatMap(group => group.records);
assert.equal(records.length, 29);
assert.equal(new Set(records.map(row => row.recordId)).size, 29);
assert.deepEqual(records.map(row => row.recordId).sort(), [...allIds].sort());
const results = records.reduce((out, row) => { out[row.result] = (out[row.result] || 0) + 1; return out; }, {});
assert.deepEqual(results, { unknown: 11, closed: 16, blocked: 2 });
assert.ok(records.filter(row => row.result === 'closed').every(row => /^\d{4}-\d{2}-\d{2}$/.test(row.officialDeadline) && row.officialDeadline < today));
assert.ok(records.every(row => row.candidateOnly && !row.canonicalWritePerformed && !row.canonicalDateChanged && !row.freshnessRenewed && row.officialOpensOn === null && !row.openingDateAssessed));
const priorReportPins = [];
for (let number = 1; number < 22; number += 1) {
  const relative = `quality/deadline-sweep-20261019/official-batch-${String(number).padStart(3, '0')}/report.json`;
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;
  const original = fs.readFileSync(file);
  priorReportPins.push({ path: relative, sha256: hash(original) });
  const scan = value => {
    if (typeof value === 'string') assert.ok(!allIds.includes(value), 'Priorrecordoverlap: ' + value);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  scan(JSON.parse(original));
}
assert.deepEqual(fileHashes(), before);
const report = {
  schemaVersion: 1, batchId: selection.batchId, state: 'completed-date-only-with-explicit-held-routes', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  snapshotSha256: selection.snapshotSha256, inventorySha256: hash(inventoryBytes), inputFileSha256: before,
  targetQueue: selection.queuePath, targetQueueSha256: selection.queueSha256, selectedUniversityIds: selection.universityIds,
  selection: { path: 'selection.json', sha256: hash(selectionBytes), baseQueueRecordIds: selection.baseQueueRecordIds, additionalSameSourceRecordIds: selection.additionalSameSourceRecordIds, baseQueueRecords: 22, additionalSameSourceRecords: 7, totalRecords: 29, additionalSelectionReceipt: selection.additionalSelectionReceipt, additionalSelectionReceiptSha256: selection.additionalSelectionReceiptSha256 },
  acquisition: { nativeRequests: 13, originalFullSuccessfulResponses: 8, failedHTTPResponseBodiesRetained: 3, failedTLSWithoutBody: 1, oversizedPDFAttemptsStopped: 1, webFallbackExactUrls: 3, successfulWebFullNoticeReads: 1, successfulWebLandingReadsWithoutDateProof: 1, webFallbackFailures: 1, attachmentCaptchaLandingReads: 1, totalNetworkRequests: 17, distinctOfficialUrlsAttempted: 14, newUrlRequestsForAdditional7Records: 0, rawAndTextHashesVerified: true, originalNativeCaptureManifestSha256: hash(bytes('capture-summary.json')), derivedNativeCaptureManifestSha256: hash(bytes('capture-derived-summary.json')), webFallbackObservationReceiptSha256: hash(webBytes), visualReceiptSha256: hash(visualBytes), paidModelCalls: 0, normalTLSCertificateValidation: true, sourceOriginalBytesAndWebObservationHashesNeverConflated: true },
  summary: { universitiesWithScopedChecks: 7, recordsAssessed: 29, baseQueueRecords: 22, additionalSameSourceRecords: 7, admissionCyclesAssessed: records.filter(row => row.collection === 'admissionCycles').length, scholarshipsAssessed: records.filter(row => row.collection === 'scholarships').length, recordResults: results, newExactExpiredDeadlineCandidatesFromCanonicalNull: records.filter(row => row.result === 'closed' && row.storedDeadline === null).length, existingExpiredDatesScoped: records.filter(row => row.result === 'closed' && row.storedDeadline !== null).length, unresolvedCandidateBindings: records.filter(row => row.result === 'unknown' && row.candidateOfficialDeadline !== null).length, canonicalWrites: 0, sharedStateWrites: 0, gitMutations: 0, freshnessRenewals: 0, publicationActions: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0 },
  policy: 'Date-only source observations. Newdates remain candidates, oldnulls and all storedrowmetadata/freshness remain unchanged. No programme is declared discontinued. Calendar closure applies only to explicit sameyear/route. Broadcourse dates never automatically become independentaward dates. Unsupported programme/year/funding scopes remain unknown; heldsources retain bounded cooldown. Any future narrow consumer needs independent review and exactrowCAS.',
  groups,
  validation: { exactBase22PlusAdditional7CoveredOnce: true, fullCanonicalRowsAndProgramAndSourceUnionsPinned: true, originalSixFilesUnchanged: true, originalByteHashesAndObservedAtPinned: true, webObservationNotPretendedOriginBody: true, PDFImageOnlyPagesAllSixVisuallyRead: true, noPriorExactRecordOverlap: true, priorReportPins },
};
const output = path.join(dir, 'report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const reportSha256 = hash(fs.readFileSync(output));
fs.writeFileSync(path.join(dir, 'completion.json'), JSON.stringify({ batchId: report.batchId, completedAt: report.completedAt, reportPath: 'report.json', reportSha256, summary: report.summary, canonicalMutation: false, freshnessRenewed: false, gitOrStateMutation: false }, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(dir, 'README.md'), `# Official date-only batch022\n\n29 exact records from7 universities:22 queue-v5 base records plus7 explicitly assigned same-source additions. Results:${results.closed} closed candidates,${results.unknown} unknown,${results.blocked} blocked.\n\nOnly source observations are saved. All canonical dates/status/freshness, sharedstate and Git remain untouched. A closed window never means a discontinued programme. Detailed route restrictions and bounded capture failures remain in report.json.\n\nOrigin bytes and web parsed observations are distinct; the HMU scholarship original was403 while one web fallback returned its full parsed notice. The generic postgraduatePDF was captcha-held. The Hebei originalPDF exceeded the10MiB bounded capture and is not certified.\n\nReport SHA256: ${reportSha256}\n`, { flag: 'wx' });
console.log(JSON.stringify({ reportPath: output, reportSha256, records: records.length, results, summary: report.summary }));
