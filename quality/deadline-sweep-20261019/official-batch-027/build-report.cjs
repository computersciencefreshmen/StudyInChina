/* Date evidence only: no canonical, state, freshness, Git or deployment mutation. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const dir = __dirname, baseDir = path.dirname(dir), sha = (v) => crypto.createHash('sha256').update(v).digest('hex'), read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sb = fs.readFileSync(path.join(dir, 'selection.json')), sel = JSON.parse(sb), primary = sel.primaryWorkspace;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
assert.equal(today, '2026-10-19');
const tables = {};
for (const [name, expected] of Object.entries(sel.inputFileSha256)) { const b = fs.readFileSync(path.join(primary, 'content/data', name)); assert.equal(sha(b), expected); tables[name] = JSON.parse(b); }
const raw = new Map([...tables['admission-cycles.json'], ...tables['scholarships.json']].map((r) => [r.id, r])), programs = new Map(tables['programs.json'].map((r) => [r.id, r])), sources = new Map(tables['sources.json'].map((r) => [r.id, r]));
const qb = fs.readFileSync(path.join(primary, sel.queuePath)), queue = JSON.parse(qb); assert.equal(sha(qb), sel.queueSha256);
assert.deepEqual(queue.selectedUniversityIds.slice(12, 20), sel.selectedUniversityIds);
assert.equal(sel.records.length, 18); assert.equal(sel.additionalSameSourceRecords, 0);
const inventoryBytes = fs.readFileSync(path.join(primary, 'quality/deadline-sweep-20261019/catalog-deadlines.json')), inventory = JSON.parse(inventoryBytes);
assert.deepEqual(sel.inputFileSha256, inventory.inputFileSha256); assert.equal(sel.snapshotSha256, inventory.snapshotSha256);
const receiptNames = ['captures.json', 'tls-recoveries.json', 'embedded-original-capture.json'];
const captures = receiptNames.flatMap((f) => { const r = read(path.join(dir, f)); return Array.isArray(r) ? r : [r]; });
const byName = new Map(captures.map((r) => [r.name, r]));
const filePin = (p) => ({ path: p, sha256: sha(fs.readFileSync(path.join(dir, p))) });
for (const c of captures.filter((r) => r.rawPath)) { const b = fs.readFileSync(path.join(dir, c.rawPath)); assert.equal(sha(b), c.rawSha256); assert.equal(b.length, c.bytes); if (c.textPath) assert.equal(sha(fs.readFileSync(path.join(dir, c.textPath))), c.textSha256); }
const text = (name) => fs.readFileSync(path.join(dir, byName.get(name).textPath), 'utf8');
const quote = (name, fragment) => { assert.ok(text(name).replace(/\s+/gu, '').includes(fragment.replace(/\s+/gu, '')), name + ': missing quote ' + fragment); return fragment; };
const evidence = (name, role = 'complete-original-date-scope-only') => ({ ...byName.get(name), evidenceRole: role, fullFactsCertified: false });
const u = sel.selectedUniversityIds, idsFor = (school) => sel.records.filter((r) => r.universityId === school).map((r) => r.recordId);
function row(id, name, result, date, reason, extra = {}) {
  const s = sel.records.find((r) => r.recordId === id), r = raw.get(id), p = s.program, c = byName.get(name);
  assert.deepEqual(r, s.row); assert.equal(sha(JSON.stringify(r)), s.canonicalRecordSha256);
  if (p) { assert.deepEqual(p, programs.get(p.id)); assert.equal(sha(JSON.stringify(p)), s.canonicalProgramSha256); }
  for (const v of s.sources) { assert.deepEqual(v.row, sources.get(v.row.id)); assert.equal(sha(JSON.stringify(v.row)), v.sha256); assert.equal(v.row.official, true); }
  return {
    collection: s.collection, recordId: id, universityId: s.universityId, selectionOrigin: 'baseQueue18', programId: p?.id ?? null, name: p?.name.en ?? r.name.en,
    academicYear: r.academicYear ?? null, intake: r.intake ?? null, degreeLevel: p?.degreeLevel ?? null,
    canonicalRecordSha256: s.canonicalRecordSha256, ...(p ? { canonicalCycleSha256: s.canonicalRecordSha256, canonicalProgramSha256: s.canonicalProgramSha256 } : { canonicalScholarshipSha256: s.canonicalRecordSha256 }),
    canonicalProgramPins: s.linkedPrograms.map((v) => ({ programId: v.row.id, canonicalProgramSha256: v.sha256 })),
    sourceIds: r.sourceIds, sourcePins: s.sources.map((v) => ({ sourceId: v.row.id, canonicalSourceSha256: v.sha256, url: v.row.url })),
    storedDeadline: r.closesOn ?? r.deadline ?? null, storedOpensOn: r.opensOn ?? null, storedDateStatus: r.dateStatus ?? null,
    result, officialDeadline: date, candidateOfficialDeadline: date, reason,
    officialOpensOn: null, candidateOfficialOpensOn: null, openingDateAssessed: false, officialCutoffAt: null,
    deadlineBoundary: result === 'closed' ? 'date-only-no-clock-time-stated' : 'not-established',
    evidenceSourceUrl: c.url, evidenceBodySha256: c.rawSha256 ?? null, observedAt: c.observedAt,
    candidateOnly: true, dateOnly: true, canonicalDeadlineAssessed: false, canonicalDateChanged: false, canonicalWritePerformed: false, freshnessRenewed: false, wholeSchoolCatalogueCompleted: false, fullFactsCertified: false, programmeDiscontinuedConfirmed: false,
    ...(result === 'closed' ? { candidateChangesStoredNull: (r.closesOn ?? r.deadline ?? null) === null, storedDateMatchesScopedOfficialDay: (r.closesOn ?? r.deadline ?? null) === date, closureScope: 'Only the stated matching 2026 route is past; no continuing discontinuation or closure of other routes is inferred.' } : {}), ...extra,
  };
}
const groups = [];
groups.push({ key: 'njmu-two-finite-source-attempts-blocked', universityId: u[0], scope: 'Exact two Clinical Medicine cycles and tuition-scholarship row; no readable guide body was obtained.', evidence: [evidence('njmu-2026', 'failed-native-Python-TLS'), evidence('njmu-2026-recovery', 'failed-single-Windows-TLS-recovery')],
  records: idsFor(u[0]).map((id) => row(id, 'njmu-2026-recovery', 'blocked', null, 'native-tls-eof-then-one-bounded-windows-curl-timeout-no-original-body', { quotedDate: null, retryPolicy: 'cooldown-no-further-retries', noLandingOrMetadataDateCertification: true })),
});
groups.push({ key: 'njtech-standing-freshman-scholarship-no-current-dated-window', universityId: u[1], evidence: [evidence('njtech-scholarship')], scope: 'Exact university freshman scholarship; 2022 publication/2024 update does not establish a 2026 application period.',
  applicationQuote: quote('njtech-scholarship', '留学生新生在招生申请系统中，勾选校级奖学金，并提交有关材料。'),
  records: idsFor(u[1]).map((id) => row(id, 'njtech-scholarship', 'unknown', null, 'standing-award-policy-has-submission-procedure-but-no-independent-current-application-window', { quotedDate: null, originalPublication: '2022-03-30', statedUpdate: '2024-01-26', awardDeadlineNotBorrowed: true })),
});
const nuaaDate = quote('nuaa-silkroad-2026', 'I. Application Time：From now to May 18, 2026 .');
groups.push({ key: 'nuaa-exact-2026-csc-silkroad-english-graduate-route', universityId: u[2], evidence: [evidence('nuaa-silkroad-2026')], scope: 'Three explicitly listed English master programmes and the independently named 2026 CSC Silk Road award, only this Type B route.',
  yearTitle: quote('nuaa-silkroad-2026', '2026 NUAA CSC Scholarship – Silk Road Program'), quotedDate: nuaaDate,
  eligibilityRouteRestriction: quote('nuaa-silkroad-2026', 'Silk Road countries: Pakistan, Indonesia, Bangladesh, Nepal, Thailand, Morocco, Kenya, Tanzania'),
  records: idsFor(u[2]).map((id) => { const s = sel.records.find((r) => r.recordId === id); return row(id, 'nuaa-silkroad-2026', 'closed', '2026-05-18', 'same-2026-type-b-silkroad-award-and-exact-english-graduate-programme-route-expired', { quotedDate: nuaaDate, fundingRoute: 'Chinese Government Scholarship Type B Silk Road Program 2026', openingRelativeWording: 'From now', exactMajorQuote: s.program ? quote('nuaa-silkroad-2026', s.program.name.en) : null, applicantVsInstitutionalStage: 'July31 admission-document dispatch, September registration and annual May reviews are separate from the May18 applicant cutoff.', awardOwnDateNotBorrowed: !s.program, geographicEligibilityRestrictionRetained: true }); }),
});
const njucmDate = quote('njucm-undergraduate', 'December 1, 2025 to May 15, 2026.');
const njucmAdvised = quote('njucm-undergraduate', 'Due to limited scholarship quotas, applicants for scholarships are advised to submit their applications by May 10, 2026.');
groups.push({ key: 'njucm-2026-two-exact-undergraduates-and-independent-provincial-award', universityId: u[3], evidence: [evidence('njucm-undergraduate')], scope: 'Exact Science of TCM Health Preservation and Pharmacy of Chinese Meteria Medica in the embedded 2026 undergraduate table, plus separately scoped Study in Jiangsu award.', quotedDate: njucmDate, advisoryScholarshipQuote: njucmAdvised,
  records: idsFor(u[3]).map((id) => { const s = sel.records.find((r) => r.recordId === id); return s.program ? row(id, 'njucm-undergraduate', 'closed', '2026-05-15', '2026-undergraduate-guide-exact-programme-table-and-applicant-period-match', { quotedDate: njucmDate, candidateOfficialOpensOn: '2025-12-01', exactMajorQuote: quote('njucm-undergraduate', id.includes('health-preservation') ? 'Science of TCM Health Preservation' : 'Pharmacy of Chinese Meteria Medica'), sourceLanguageScope: 'Chinese-taught undergraduate applicants; HSK Level4 requirement in same guide.', feeReferenceNotUsedAsYearAnchor: true })
    : row(id, 'njucm-undergraduate', 'unknown', null, 'provincial-award-listed-without-independent-hard-cutoff-may10-is-advisory-only', { quotedDate: null, advisoryDate: '2026-05-10', advisoryDateQuote: njucmAdvised, advisoryDateIsNotHardDeadline: true, generalAdmissionDeadlineNotBorrowed: '2026-05-15', awardListingQuote: quote('njucm-undergraduate', 'Study in Jiangsu Provincial Government Scholarship') }); }),
});
const nufeFirst = quote('nufe-programmes', '第一批次：2025年11月21日——2026年3月1日'), nufeSecond = quote('nufe-programmes', '第二批次：2026年3月2日——2026年6月15日');
groups.push({ key: 'nufe-current-2026-chinese-undergraduate-notice-early-ended-and-independent-award', universityId: u[4], evidence: [evidence('nufe-programmes'), evidence('nufe-scholarship')], scope: 'Accounting and Chinese Language and Literature Chinese bachelors in the 2026 programme table. University award competition is separately scoped to eligible enrolled students.',
  titleQuote: quote('nufe-programmes', '2026年外国留学生本科项目招生简章（中文授课）（招生已提前结束）'), applicationRoundQuotes: [nufeFirst, nufeSecond],
  records: idsFor(u[4]).map((id) => { const s = sel.records.find((r) => r.recordId === id); return s.program ? row(id, 'nufe-programmes', 'closed', '2026-06-15', 'exact-2026-chinese-bachelor-programme-is-listed-and-notice-explicitly-says-admission-ended-early', {
    quotedDate: nufeSecond, exactMajorQuote: quote('nufe-programmes', s.program.name.zh), admissionEndedEarly: true, earlyClosureQuote: '招生已提前结束', actualEarlyClosureDate: null,
    officialDeadlineSemantics: 'Published originally scheduled final applicant cutoff; NOT an assertion that the actual earlier closure occurred on June15.',
    applicationRounds: [{ candidateOpensOn: '2025-11-21', scheduledClosesOn: '2026-03-01' }, { candidateOpensOn: '2026-03-02', scheduledClosesOn: '2026-06-15' }],
    openingDatesRemainRoundScopedCandidates: true, institutionReviewNotApplicantDeadline: 'March30/June30 are result announcements; not application cutoffs.', feeReferenceNotUsedAsYearAnchor: true,
  }) : row(id, 'nufe-scholarship', 'unknown', null, 'standing-performance-based-university-awards-have-no-independent-current-exact-deadline', { quotedDate: null, governmentCompetitionQuote: quote('nufe-scholarship', 'NUFE announces the scholarship competition notice every fall semester to all eligible international students on campus.'), yearQualification: 'Standing policy lists annual competitions and enrolment/performance conditions, not a dated 2026 new-applicant award deadline.', generalAdmissionDeadlineNotBorrowed: '2026-06-15' }); }),
});
const njuptDate = quote('njupt-2026-original', '即日起至 2026 年 2 月 28 日');
groups.push({ key: 'njupt-2026-high-level-postgraduate-original-pdf', universityId: u[5], evidence: [evidence('njupt-2026-recovery', 'wrapper-only-links-exact-original-PDF'), evidence('njupt-2026-original')], scope: 'Exact 2026 CSC high-level postgraduate award; ten-page embedded original read, not wrapper/title-only verification.', quotedDate: njuptDate,
  visualEvidence: ['njupt-title-1.png', 'njupt-deadline-10.png'].map(filePin),
  records: idsFor(u[5]).map((id) => row(id, 'njupt-2026-original', 'closed', '2026-02-28', 'same-2026-csc-high-level-award-original-pdf-explicit-applicant-cutoff', { quotedDate: njuptDate, fundingRoute: '2026 CSC high-level postgraduate Type B; agency10293', openingRelativeWording: '即日起 / From now', evidenceLocator: 'Original PDF page10 Application Time; page1 year/title; pages3–4 application process.', applicantVsInterview: 'March2026 academic interviews follow application; no March application extension is inferred.', awardOwnDateNotBorrowed: true })),
});
const residenceQuote = quote('njust-bachelor-guide', '江苏省政府茉莉花奖学金生、南京市政府—南京理工大学合作奖学金生的居留许可按照学年每年办理');
groups.push({ key: 'njust-two-distinct-awards-residence-policy-not-application-dates', universityId: u[6], evidence: [evidence('njust-bachelor-guide', 'actual-complete-six-page-residence-policy-not-admission-guide'), evidence('njust-graduate-guide', 'registered-PDF-redirected-to-HTML-404-not-a-PDF-success')], scope: 'Two separately named awards recognized by residence/visa rules; no applicant award window is announced.', quotedPolicy: residenceQuote, visualEvidence: [filePin('njust-residence-1.png')],
  filenameQualification: 'Capture names bachelor-guide/graduate-guide were acquisition labels only. First actual original is NJUST Rules on Residence and Visa for International Students; second registered PDF returns error.njust.edu.cn/errorpage/errorTips404.html as HTML200.',
  records: idsFor(u[6]).map((id) => row(id, 'njust-bachelor-guide', 'unknown', null, 'award-identity-in-residence-policy-without-independent-application-window', { quotedDate: null, residencePolicyQuote: residenceQuote, recurringResidencePermitNotScholarshipApplicationDate: true, unavailableSupportingPdf: { requestedUrl: byName.get('njust-graduate-guide').url, finalUrl: byName.get('njust-graduate-guide').finalUrl, rawBodySha256: byName.get('njust-graduate-guide').rawSha256, fullSourceRead: false }, noAwardDateFromVisaExpiry: true })),
});
const ntuFallback = read(path.join(dir, 'ntu-web-fallback.json'));
groups.push({ key: 'ntu-dynamic-shell-not-university-award-body', universityId: u[7], evidence: [evidence('ntu-scholarship', 'dynamic-default-shell-no-selected-award-body')], webFallbackEvidence: { ...filePin('ntu-web-fallback.json'), ...ntuFallback }, scope: 'Exact university award cannot be assessed from the default Chinese Government Scholarship navigation shell.',
  records: idsFor(u[7]).map((id) => row(id, 'ntu-scholarship', 'blocked', null, 'native-and-one-web-fallback-both-show-default-shell-no-university-award-body', { quotedDate: null, retryPolicy: 'cooldown-no-further-retries', hiddenHtmlCommentExamplesNotOfficialVisibleAwardEvidence: true, webFallbackRawOriginServerBytes: false, noHttp200OrNavigationCertification: true })),
});
const records = groups.flatMap((g) => g.records), results = records.reduce((o, r) => ({ ...o, [r.result]: (o[r.result] || 0) + 1 }), {});
assert.equal(records.length, 18); assert.equal(new Set(records.map((r) => r.recordId)).size, 18); assert.deepEqual(records.map((r) => r.recordId).sort(), [...sel.selectedRecordIds].sort());
assert.deepEqual(results, { blocked: 4, unknown: 5, closed: 9 }); assert.equal(records.filter((r) => r.collection === 'admissionCycles').length, 9);
assert.equal(records.filter((r) => r.result === 'closed' && r.candidateChangesStoredNull).length, 6);
assert.ok(records.filter((r) => r.result === 'closed').every((r) => r.officialDeadline < today));
assert.ok(records.filter((r) => r.result !== 'closed').every((r) => r.officialDeadline === null));
const ids = new Set(records.map((r) => r.recordId)), priorReportPins = [], overlaps = new Set();
function scan(o) { if (!o || typeof o !== 'object') return; if (typeof o.recordId === 'string' && ids.has(o.recordId)) overlaps.add(o.recordId); Object.values(o).forEach(scan); }
for (const name of fs.readdirSync(baseDir).filter((n) => /^official-batch-\d+$/.test(n) && n !== path.basename(dir))) { const p = path.join(baseDir, name, 'report.json'); if (fs.existsSync(p)) { const b = fs.readFileSync(p); scan(JSON.parse(b)); priorReportPins.push({ batch: name, sha256: sha(b) }); } }
assert.equal(overlaps.size, 0);
for (const [name, expected] of Object.entries(sel.inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(primary, 'content/data', name))), expected);
const report = {
  schemaVersion: 1, batchId: 'official-date-only-027-20261019', state: 'completed-nine-scoped-past-windows-five-unknown-four-blocked', auditDate: today, timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  snapshotSha256: sel.snapshotSha256, inventorySha256: sha(inventoryBytes), inputFileSha256: sel.inputFileSha256, targetQueue: sel.queuePath, targetQueueSha256: sel.queueSha256, selectionSha256: sha(sb), selectedUniversityIds: u,
  selection: { baseQueueRecords: 18, additionalSameSourceRecords: 0, totalRecords: 18, baseQueueRecordIds: sel.selectedRecordIds, additionalSameSourceRecordIds: [] },
  acquisition: { registeredDistinctUrlsAttempted: 10, derivedExactEmbeddedPdfUrlsAttempted: 1, nativeRequests: 13, singleNativeTlsRecoveries: 2, webFallbackRequests: 1, rawBodiesSaved: captures.filter((r) => r.rawPath).length, completeDateScopeSourceBodiesRead: 7, transportCapturedButNotFullGuide: ['njupt-2026-recovery', 'njust-graduate-guide', 'ntu-scholarship'], paidModelCalls: 0, normalTlsValidation: true, captureManifestPins: receiptNames.map(filePin), boundedWebFallbackPin: filePin('ntu-web-fallback.json') },
  summary: { schoolsAttempted: 8, recordsAssessed: 18, baseQueueRecords: 18, additionalSameSourceRecords: 0, admissionCyclesAssessed: 9, scholarshipsAssessed: 9, recordResults: results, newExactPastDeadlineCandidatesFromStoredNull: 6, existingExpiredDatesScoped: 3, independentAwardPastDeadlineCandidates: 2, canonicalWrites: 0, sharedStateWrites: 0, gitMutations: 0, freshnessRenewals: 0, deploymentActions: 0, wholeSchoolCataloguesCertified: 0, fullFactsCertified: 0 },
  rules: ['Candidate-only source observations; no canonical dates/status/freshness changed.', 'A past explicitly matched 2026 window is not proof of programme discontinuation or a later cycle.', 'Independent awards do not borrow general admission deadlines. Advisory May10 is not a hard award cutoff.', 'NUFE June15 is the originally scheduled final deadline; actual unspecified early-closure day is not invented.', 'HTTP200/landing, hidden example comments, failed TLS and redirected HTML404 are not full-guide date evidence.', 'Any later canonical mutation requires a supported narrow consumer, separate independent approval and exact-row compare-and-swap.'],
  groups, priorReportPins,
  validation: { exactEighteenIdsCoveredOnce: true, allSixCanonicalInputsUnchanged: true, fullCanonicalRecordParentLinkedProgrammeAndSourceRowsPinnedInSelection: true, quotedDateAndScopeFragmentsMatchOriginalText: true, rawTextBytesAndObservedAtPinned: true, pdfKeyPagesRenderedAndVisuallyInspected: true, noExactIdOverlapWithOtherFrozenReports: true },
};
const output = path.join(dir, 'report.json'); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportPath: output, sha256: sha(fs.readFileSync(output)), records: records.length, results }));
