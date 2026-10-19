/* Independent source-only review of the immutable batch. No network or canonical writes. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rowHash = (v) => hash(JSON.stringify(v));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const reportBytes = fs.readFileSync(path.join(dir, 'report.json'));
const reportSha = hash(reportBytes);
const report = JSON.parse(reportBytes);
const now = new Date().toISOString();
const fileHashes = () => Object.fromEntries(Object.keys(report.inputFileSha256).map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
const before = fileHashes();
assert.deepEqual(before, report.inputFileSha256);
const queueBytes = fs.readFileSync(path.join(primary, report.queuePath));
assert.equal(hash(queueBytes), report.queueSha256);
const queue = JSON.parse(queueBytes);
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const schools = queue.selectedUniversityIds.slice(7, 14);
const school = (id) => cycles.has(id) ? programs.get(cycles.get(id).programId).universityId : awards.get(id).universityIds.find((u) => schools.includes(u));
const baseIds = queue.selectedRecordIds.filter((id) => schools.includes(school(id)));
assert.equal(baseIds.length, 18);
const extraIds = report.selectionBasis.additionalSameSourceRecordIds;
assert.equal(extraIds.length, 3);
const additionalReceiptPath = '../heartbeat-0539/additional-same-source-selection-v1.json';
const additionalBytes = fs.readFileSync(path.join(dir, additionalReceiptPath));
const additional = JSON.parse(additionalBytes);
assert.equal(additional.baseQueueSha256, report.queueSha256);
for (const id of extraIds) {
  assert.ok(additional.extraRecords.some((r) => r.recordId === id && r.canonicalRecordSha256 === rowHash(cycles.get(id) || awards.get(id))));
}
const selectionBytes = fs.readFileSync(path.join(dir, 'selection.json'));
assert.equal(hash(selectionBytes), report.selectionSha256);
const records = report.groups.flatMap((g) => g.records);
assert.equal(records.length, 21);
assert.equal(new Set(records.map((r) => r.recordId)).size, 21);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...baseIds, ...extraIds].sort());
const artifactPins = new Map();
function artifact(p, expectedHash) {
  const raw = fs.readFileSync(path.join(dir, p));
  const actual = hash(raw);
  if (expectedHash) assert.equal(actual, expectedHash, p);
  const pin = { path: p, sha256: actual, bytes: raw.length };
  artifactPins.set(p, pin);
  return pin;
}
const bodyEvidence = new Map();
const failedEvidence = new Map();
for (const g of report.groups) {
  for (const ev of g.evidence) {
    assert.ok(ev.observedAt && !Number.isNaN(Date.parse(ev.observedAt)));
    if (ev.bodyPath) {
      artifact(ev.bodyPath, ev.bodySha256);
      artifact(ev.textArtifact.path, ev.textArtifact.sha256);
      bodyEvidence.set(ev.bodySha256, ev);
    } else failedEvidence.set(ev.url, ev);
  }
  for (const fail of g.failureArtifacts) artifact(fail.path, fail.sha256);
}
const whitespaceFree = (s) => s.replace(/\s+/g, '');
const bodyText = (ev) => fs.readFileSync(path.join(dir, ev.textArtifact.path), 'utf8');
const pins = [];
const sourcePins = new Map();
const results = {};
for (const r of records) {
  const c = cycles.get(r.recordId);
  const a = awards.get(r.recordId);
  const original = c || a;
  const p = c && programs.get(c.programId);
  assert.equal(rowHash(original), r.canonicalRecordSha256);
  assert.equal(rowHash(original), c ? r.canonicalCycleSha256 : r.canonicalScholarshipSha256);
  assert.equal(r.storedDeadline, c ? c.closesOn : a.deadline);
  assert.equal(r.storedOpensOn, c ? c.opensOn : null);
  assert.equal(r.universityId, school(r.recordId));
  assert.deepEqual(r.sourceIds, original.sourceIds);
  if (c) {
    assert.equal(rowHash(p), r.canonicalProgramSha256);
    assert.equal(r.programId, p.id);
    assert.equal(r.degreeLevel, p.degreeLevel);
    assert.equal(r.academicYear, c.academicYear);
    assert.equal(r.intake, c.intake);
  }
  for (const sp of r.sourcePins) {
    const source = sources.get(sp.sourceId);
    assert.equal(rowHash(source), sp.sourceSha256);
    assert.equal(source.url, sp.url);
    assert.equal(source.official, sp.official);
    sourcePins.set(sp.sourceId, { sourceId: sp.sourceId, canonicalSourceSha256: rowHash(source), sourceFullRecord: source });
  }
  assert.deepEqual(r.sourcePins.map((sp) => sp.sourceId).sort(), [...r.sourceIds].sort());
  assert.equal(r.openingDateAssessed, false);
  assert.equal(r.candidateOnly, true);
  assert.equal(r.canonicalDateChanged, false);
  assert.equal(r.canonicalWritePerformed, false);
  assert.equal(r.freshnessRenewed, false);
  assert.equal(r.publishedInInputSnapshot, false);
  const ev = r.evidenceBodySha256 ? bodyEvidence.get(r.evidenceBodySha256) : failedEvidence.get(r.evidenceSourceUrl);
  assert.ok(ev, r.recordId + ': no source observation');
  assert.equal(r.observedAt, ev.observedAt);
  assert.ok([ev.url, ev.finalUrl].includes(r.evidenceSourceUrl));
  if (r.quote) assert.ok(whitespaceFree(bodyText(ev)).includes(whitespaceFree(r.quote)), r.recordId + ': quote mismatch');
  if (r.result === 'closed') assert.ok(r.officialDeadline < '2026-10-19');
  else assert.equal(r.officialDeadline, null);
  if (r.programmeIdentityEvidence) {
    const context = bodyEvidence.get(r.programmeIdentityEvidence.bodySha256);
    assert.ok(context && context.url === r.programmeIdentityEvidence.url);
    const contents = whitespaceFree(bodyText(context));
    assert.ok(contents.includes(r.programmeIdentityEvidence.code));
    assert.ok(contents.includes(r.programmeIdentityEvidence.chineseName));
    assert.ok(contents.includes(whitespaceFree('硕士英文授课专业')));
  }
  results[r.result] = (results[r.result] || 0) + 1;
  pins.push({ recordId: r.recordId, result: r.result, canonicalRowSha256: rowHash(original), canonicalProgramPins: c ? [{ programId: p.id, canonicalProgramSha256: rowHash(p) }] : a.programIds.map((id) => ({ programId: id, canonicalProgramSha256: rowHash(programs.get(id)) })), storedDeadline: r.storedDeadline, observedOfficialDeadline: r.officialDeadline, evidenceBodySha256: r.evidenceBodySha256, evidenceSourceUrl: r.evidenceSourceUrl, observedAt: r.observedAt });
}
assert.deepEqual(results, { closed: 7, unknown: 10, blocked: 4 });
const upcAward = records.find((r) => r.recordId === 'sch-gap-sch-mew-ne-upc-university');
assert.equal(upcAward.result, 'unknown');
assert.equal(upcAward.candidateRecurringWindow.deadlineMonthDay, '05-15');
const upcEvidence = bodyEvidence.get(upcAward.evidenceBodySha256);
const upcText = whitespaceFree(bodyText(upcEvidence));
const awardQuote = '学校奖 学历生 次年9月入学 次年3月15日 次年5月15日';
assert.ok(upcText.includes(whitespaceFree(awardQuote)));
const clarification = {
  schemaVersion: 1, clarificationId: 'official-batch-017-award-quote-clarification-v1', createdAt: now,
  frozenReport: 'report.json', frozenReportSha256: reportSha,
  recordId: upcAward.recordId, canonicalScholarshipSha256: upcAward.canonicalScholarshipSha256,
  resultBeforeAndAfter: 'unknown', officialDeadlineBeforeAndAfter: null,
  originalReportGeneralApplicationQuote: upcAward.quote,
  originalQuoteScope: 'First/general autumn application table; its May31 is not the school-award deadline.',
  schoolAwardRowFullText: awardQuote,
  schoolAwardRowLocator: 'Actual 申请时间 page section 二、奖学金申请时间; final 学校奖 row, columns 奖学金名称 / 入学时间 / 申请开始时间 / 申请截止时间.',
  schoolAwardWindow: { applicantCategory: '学历生', entry: '次年9月入学', opensOnMonthDay: '03-15', deadlineMonthDay: '05-15', applicationYear: null, relativeYearWording: '次年', exactAbsoluteDateApproved: false },
  evidence: { sourceUrl: upcEvidence.url, rawPath: upcEvidence.bodyPath, rawSha256: upcEvidence.bodySha256, textArtifact: upcEvidence.textArtifact, observedAt: upcEvidence.observedAt },
  assessment: 'The frozen report correctly keeps the award deadline unknown and separately stores the school-award May15 recurring window. Its generic quote points to a different row. This addendum supplies the award-specific original row and does not infer a calendar year, borrow May31, or change any report or canonical bytes.',
  noNewOfficialWebsiteReads: true, canonicalWrites: 0, frozenReportWrites: 0,
};
const clarificationOutput = JSON.stringify(clarification, null, 2) + '\n';
const cumtbHtml = fs.readFileSync(path.join(dir, 'cumtb.html'), 'utf8');
const cumtbImageRefs = [...cumtbHtml.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((s) => /__local|_vsl|vsb_content/i.test(s));
const ctbu = whitespaceFree(fs.readFileSync(path.join(dir, 'ctbu.txt'), 'utf8'));
for (const s of ['2026年9月入学新生。', '2026年3月1日', '国际经济与贸易', '工商管理', '大数据统计与智能计算', '数字经济']) assert.ok(ctbu.includes(whitespaceFree(s)));
for (const r of records.filter((r) => r.universityId === 'uni-chongqing-technology-and-business-university')) assert.equal(r.applicationRoute, 'MoE–Chongqing joint scholarship only');
const cuc = fs.readFileSync(path.join(dir, 'cuc.txt'), 'utf8');
assert.ok(cuc.includes('Preparatory programs (Chinese language students) are open for application year-round. Specific deadlines are subject to the official admissions brochure of each academic year.'));
assert.deepEqual(fileHashes(), before);
assert.equal(hash(fs.readFileSync(path.join(dir, 'report.json'))), reportSha);
const review = {
  schemaVersion: 1, reviewId: 'official-batch-017-independent-review-v1', reviewedAt: now,
  verdict: 'accepted-source-only-scoped-observations-with-explicit-unknowns-and-access-holds', approvedForCanonicalWrite: false,
  reportPath: 'report.json', reportSha256: reportSha, snapshotSha256: report.snapshotSha256,
  inputFileSha256: before, targetQueueSha256: report.queueSha256, selectionSha256: report.selectionSha256,
  additionalSelectionReceipt: additionalReceiptPath, additionalSelectionReceiptSha256: hash(additionalBytes),
  awardQuoteClarification: { path: 'award-quote-clarification-v1.json', sha256: hash(clarificationOutput), conclusionChanges: 0 },
  summary: { universities: 7, records: 21, baseQueue: 18, additionalSameSource: 3, results, fullCanonicalCycleRowsChecked: 18, fullCanonicalProgramRowsCheckedForCycles: 18, fullCanonicalAwardRowsChecked: 3, fullCanonicalSourceRowsChecked: sourcePins.size, capturedOriginalBodiesHashChecked: bodyEvidence.size, exactOriginalObservedAtCheckedForRecords: 21, newWebsiteReads: 0, canonicalWrites: 0, frozenReportWrites: 0, sharedStateWrites: 0, gitActions: 0 },
  findings: [
    { key: 'cumt-master-vs-undergraduate-source', disposition: 'accepted-for-date-only', assessment: 'The registered 3-page PDF is expressly an undergraduate catalogue and is not accepted as master identity evidence. The separately captured current English-master catalogue supplies exact codes 080800 电气工程 (English spelling Electronical Engineering) and 083700 安全科学与工程 under master/English headers. The independently captured application-conditions page literally states autumn degree applicants March1–July10,2026. Combined sources support the two expired date candidates; the catalogue is not falsely described as explicitly year-labelled.', evidence: ['cumt.pdf', 'cumt-master-catalogue.html', 'cumt-application.html'] },
    { key: 'cumt-school-award-separate-scope', disposition: 'accepted-unknown', assessment: 'The school-award row is not verified from the general 2026 degree admission period. The award-specific registered page was not read in this batch, and no July10 award cutoff is asserted.' },
    { key: 'cumtb-image-and-text-limits', disposition: 'accepted-unknown-only', assessment: '2026 Chinese-taught guide text contains requirements, materials, fees and scholarship links without an observed general bachelor submission cutoff. Its original HTML image tags refer to programme/CSCA information. No independently captured image body is present in this bundle, so this review does not certify image contents or full catalogue/date completeness. Holding all three deadlines unknown is acceptable; a linked CSC postgraduate notice cannot supply bachelor dates.', embeddedImageReferenceCount: cumtbImageRefs.length, embeddedImageTagsForProvenanceOnly: cumtbImageRefs, noImageContentsCertified: true },
    { key: 'upc-general-vs-school-award-relative-year', disposition: 'accepted-unknown-with-quote-addendum', assessment: 'General autumn submission ends next-year May31; the separate school-award row ends next-year May15. Neither has an absolute base year. All five records appropriately remain unknown. The award quote addendum replaces no frozen bytes and makes its correct May15 row explicit.', clarification: 'award-quote-clarification-v1.json' },
    { key: 'ctbu-exact-2026-joint-scholarship-route-only', disposition: 'accepted-with-route-restriction', assessment: 'The full 2026/2027 joint scholarship notice identifies September2026 new entrants, explicitly lists all four exact degree routes and prints applicant deadline March1,2026 in Chinese and English. It supports the named award plus those four scholarship-route cycle observations. Later institutional review, emailed exam notification and registration conditions are distinct. It does not certify a universal self-funded/general degree deadline.', candidateDate: '2026-03-01', canonicalNullCandidates: 1, alreadyStoredExpiredDatesScoped: 4, generalDegreeDeadlineCertified: false },
    { key: 'cupl-and-cqmu-finite-access-holds', disposition: 'accepted-blocked', assessment: 'CUPL native capture is a script challenge; a bounded listing fallback followed by the exact notice returned403. CQMU original attachment timed out and a single web fallback was inaccessible. Failure artifacts retain provenance and times; no absent origin bytes/date quote are invented and no retry loop or challenge bypass was performed.', blockedRecords: 4 },
    { key: 'cuc-preparatory-year-round-qualifier', disposition: 'accepted-unknown', assessment: 'The February4,2026 Q&A distinguishes degree application timing from year-round preparatory/Chinese-language applications and defers exact deadlines to academic-year brochures. Publication year and generic rolling access do not establish the selected generic intake cutoff or current portal acceptance.' },
  ],
  canonicalRecordPins: pins, canonicalSourcePins: [...sourcePins.values()], evidenceArtifactPins: [...artifactPins.values()],
  controls: { sourceOnlyApproval: true, canonicalMutationApproved: false, noWholeSchoolCertification: true, noFreshnessRenewal: true, reportUnchangedBeforeAfter: true, canonicalSixFileHashesUnchangedBeforeAfter: true, allNewOpeningsRemainCandidates: true },
};
const clarificationPath = path.join(dir, 'award-quote-clarification-v1.json');
const reviewPath = path.join(dir, 'independent-review-v1.json');
assert.ok(!fs.existsSync(clarificationPath) && !fs.existsSync(reviewPath), 'Never overwrite independent-review artifacts.');
fs.writeFileSync(clarificationPath, clarificationOutput, { flag: 'wx' });
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportSha256: reportSha, clarificationSha256: hash(fs.readFileSync(clarificationPath)), reviewSha256: hash(fs.readFileSync(reviewPath)), records: records.length, results, sourceRows: sourcePins.size, rawBodies: bodyEvidence.size }));
