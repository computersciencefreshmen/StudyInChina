/* Independent source-only review; existing evidence only, no network or shared-state mutation. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rowHash = (r) => hash(JSON.stringify(r));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const reportBytes = fs.readFileSync(path.join(dir, 'report.json'));
const reportSha = hash(reportBytes);
const report = JSON.parse(reportBytes);
const fileHashes = () => Object.fromEntries(Object.keys(report.inputFileSha256).map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
const before = fileHashes();
assert.deepEqual(before, report.inputFileSha256);
const queueBytes = fs.readFileSync(path.join(primary, report.queuePath));
assert.equal(hash(queueBytes), report.queueSha256);
const queue = JSON.parse(queueBytes);
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const schools = queue.selectedUniversityIds.slice(7, 14);
assert.deepEqual(report.selection.universityIds, schools);
const school = (id) => cycles.has(id) ? programs.get(cycles.get(id).programId).universityId : awards.get(id).universityIds.find((u) => schools.includes(u));
const expectedBase = queue.selectedRecordIds.filter((id) => schools.includes(school(id)));
assert.equal(expectedBase.length, 14);
assert.deepEqual([...report.selection.baseQueueRecordIds].sort(), [...expectedBase].sort());
const extraIds = report.selection.additionalSameSourceRecordIds;
assert.equal(extraIds.length, 3);
const extensionBytes = fs.readFileSync(report.selection.additionalRootSelectionPin.path);
assert.equal(hash(extensionBytes), report.selection.additionalRootSelectionPin.sha256);
const extension = JSON.parse(extensionBytes);
assert.equal(extension.baseQueueSha256, report.queueSha256);
for (const id of extraIds) assert.ok(extension.extraRecords.some((r) => r.recordId === id && r.canonicalRecordSha256 === rowHash(cycles.get(id) || awards.get(id))));
const selectionBytes = fs.readFileSync(path.join(dir, 'selection.json'));
assert.equal(hash(selectionBytes), report.selectionSha256);
const records = report.groups.flatMap((g) => g.records);
assert.equal(records.length, 17);
assert.equal(new Set(records.map((r) => r.recordId)).size, 17);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...expectedBase, ...extraIds].sort());
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
for (const g of report.groups) {
  for (const ev of g.evidence) {
    assert.ok(ev.observedAt && !Number.isNaN(Date.parse(ev.observedAt)));
    if (ev.bodyPath) {
      artifact(ev.bodyPath, ev.bodySha256);
      artifact(ev.textArtifact.path, ev.textArtifact.sha256);
      bodyEvidence.set(ev.bodySha256, ev);
    }
  }
  for (const fail of g.failureArtifacts) artifact(fail.path, fail.sha256);
}
const whiteFree = (s) => s.replace(/\s+/g, '');
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
  assert.equal(r.universityId, school(r.recordId));
  assert.equal(r.storedDeadline, c ? c.closesOn : a.deadline);
  assert.equal(r.storedOpensOn, c ? c.opensOn : null);
  assert.deepEqual(r.sourceIds, original.sourceIds);
  if (c) {
    assert.equal(rowHash(p), r.canonicalProgramSha256);
    assert.equal(r.programId, p.id);
    assert.equal(r.degreeLevel, p.degreeLevel);
    assert.equal(r.academicYear, c.academicYear);
    assert.equal(r.intake, c.intake);
  }
  assert.deepEqual(r.sourcePins.map((s) => s.sourceId).sort(), [...r.sourceIds].sort());
  for (const sp of r.sourcePins) {
    const source = sources.get(sp.sourceId);
    assert.equal(rowHash(source), sp.sourceSha256);
    assert.equal(source.url, sp.url);
    assert.equal(source.official, sp.official);
    sourcePins.set(sp.sourceId, { sourceId: sp.sourceId, canonicalSourceSha256: rowHash(source), sourceFullRecord: source });
  }
  assert.equal(r.candidateOnly, true);
  assert.equal(r.canonicalDateChanged, false);
  assert.equal(r.canonicalWritePerformed, false);
  assert.equal(r.freshnessRenewed, false);
  assert.equal(r.openingDateAssessed, false);
  assert.equal(r.publishedInInputSnapshot, false);
  const ev = bodyEvidence.get(r.evidenceBodySha256);
  assert.ok(ev, r.recordId + ': raw wrapper or source must exist even for blocked result');
  assert.equal(r.observedAt, ev.observedAt);
  assert.ok([ev.url, ev.finalUrl].includes(r.evidenceSourceUrl));
  if (r.quote) assert.ok(whiteFree(fs.readFileSync(path.join(dir, ev.textArtifact.path), 'utf8')).includes(whiteFree(r.quote)), r.recordId + ': quote not found');
  if (r.result === 'closed') assert.ok(r.officialDeadline < '2026-10-19');
  else assert.equal(r.officialDeadline, null);
  results[r.result] = (results[r.result] || 0) + 1;
  pins.push({ recordId: r.recordId, result: r.result, canonicalRowSha256: rowHash(original), canonicalProgramPins: (c ? [p.id] : a.programIds).map((pid) => ({ programId: pid, canonicalProgramSha256: rowHash(programs.get(pid)) })), sourceIds: r.sourceIds, storedDeadline: r.storedDeadline, officialDeadlineObserved: r.officialDeadline, deadlineBoundary: r.deadlineBoundary, applicationRouteRestriction: r.applicationRoute || null, evidenceBodySha256: r.evidenceBodySha256, evidenceSourceUrl: r.evidenceSourceUrl, observedAt: r.observedAt });
}
assert.deepEqual(results, { unknown: 5, closed: 11, blocked: 1 });
const allIds = new Set(records.map((r) => r.recordId));
const priorReportPins = [];
function findExactOverlap(value, found) {
  if (typeof value === 'string' && allIds.has(value)) found.add(value);
  else if (Array.isArray(value)) for (const item of value) findExactOverlap(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) findExactOverlap(item, found);
}
for (let i = 1; i <= 19; i++) {
  const batch = 'official-batch-' + String(i).padStart(3, '0');
  const raw = fs.readFileSync(path.join(dir, '..', batch, 'report.json'));
  const found = new Set();
  findExactOverlap(JSON.parse(raw), found);
  assert.equal(found.size, 0, 'prior report overlaps exact IDs: ' + batch + ': ' + [...found].join(','));
  priorReportPins.push({ batch, reportSha256: hash(raw), overlappingExactIds: [] });
}
const getText = (name) => whiteFree(fs.readFileSync(path.join(dir, name + '.txt'), 'utf8'));
const gxt = getText('gxtcmu');
for (const s of ['2026GuangxiGovernmentFullScholarshipforASEANStudents', '2026年5月25日', '2026年9月初入学', '3.1本科生', '3.2硕士', '3.3博士', '中医内科学', '中医医史文献', '针灸推拿学', '中医学']) assert.ok(gxt.includes(whiteFree(s)), 'GXT missing scope ' + s);
for (const r of records.filter((r) => r.universityId === 'uni-guangxi-university-of-chinese-medicine')) assert.equal(r.applicationRoute, '2026 Guangxi Government ASEAN full scholarship only');
for (const r of records.filter((r) => r.evidenceSourceUrl.includes('t231826'))) assert.equal(r.deadlineBoundary, 'before-date-as-worded');
assert.equal(records.find((r) => r.universityId === 'uni-guangzhou-academy-of-fine-arts').deadlineBoundary, 'inclusive-date-as-worded');
assert.ok(getText('gxmu-admission').includes(whiteFree('After enrolling every year')));
assert.ok(getText('gxnu').includes(whiteFree('June 30, Each Year')));
const failedPdfBytes = fs.readFileSync(path.join(dir, 'guide-pdf-capture.json'));
const failedPdf = JSON.parse(failedPdfBytes);
assert.equal(failedPdf.httpStatus, 200);
assert.equal(failedPdf.officialDateVerified, false);
assert.ok(failedPdf.error.includes('Timeout'));
assert.ok(!failedPdf.bodyPath && !failedPdf.bodySha256);
artifact('guide-pdf-capture.json');
artifact('gxnu-rule-page1.png');
assert.deepEqual(fileHashes(), before);
assert.equal(hash(fs.readFileSync(path.join(dir, 'report.json'))), reportSha);
const review = {
  schemaVersion: 1, reviewId: 'official-batch-020-independent-review-v1', reviewedAt: new Date().toISOString(),
  verdict: 'accepted-source-only-scoped-date-observations-with-explicit-route-restrictions-and-one-access-hold', approvedForCanonicalWrite: false,
  reportPath: 'report.json', reportSha256: reportSha, snapshotSha256: report.snapshotSha256, inputFileSha256: before,
  targetQueueSha256: report.queueSha256, selectionSha256: report.selectionSha256, additionalSelectionReceiptSha256: hash(extensionBytes),
  summary: { universities: 7, records: 17, baseQueue: 14, additionalSameSource: 3, results, newNullDeadlineCandidates: 4, existingExpiredDatesScoped: 7, canonicalCycleRowsChecked: 12, canonicalProgramRowsCheckedForCycles: 12, canonicalAwardRowsChecked: 5, canonicalFullSourceRowsChecked: sourcePins.size, originalBodiesHashChecked: bodyEvidence.size, recordObservationTimesMatched: 17, priorBatchesCheckedForNoExactIdOverlap: 19, duplicateRecordIds: 0, newWebsiteReads: 0, canonicalWrites: 0, frozenReportWrites: 0, stateWrites: 0, gitActions: 0 },
  findings: [
    { key: 'gxtcmu-year-from-body-route-and-degree-tables', disposition: 'accepted-with-award-scope-only', assessment: 'A 2023 URL segment does not set the document year. Actual title, literal May25,2026 cutoff, 2026 email subject and September2026 entry independently bind the current source. Sections3.1,3.2,3.3 separately match Chinese Medicine and Acupuncture/Tuina bachelors, Chinese Internal Medicine master, and History/Literature of Chinese Medicine doctorate. All four cycles and the named award are supported only for this Guangxi Government ASEAN full-scholarship route; no universal self-funded cutoff is certified. Review/approval and July–August admission-document mailing are later stages.', observedDeadline: '2026-05-25' },
    { key: 'gxmu-general-vs-asean-vs-president-award', disposition: 'accepted-with-separate-scopes', assessment: 'The 2026 undergraduate guide itself names Chinese-medium Clinical Medicine, six-year English MBBS and Stomatology with a January1–August15 fall application period; 2026 is contextual in the same year-specific guide rather than repeated beside the month/day range. The dedicated 2026 ASEAN notice instead requires applicant submission before May10; strict before qualifier is preserved for both canonical IDs referring to that one award. HSK completion by July2027, CSCA scores by July30 (or15 days before an award deadline), provincial review and individual deposit conditions do not replace the applicant window. President scholarship is automatic ranking only after admitted self-funded students register and pay; no exact deadline is invented.', generalDeadline: '2026-08-15', aseanDeadline: '2026-05-10', aseanBoundary: 'before-date-as-worded', presidentDeadline: null },
    { key: 'gdut-language-perennial-reference', disposition: 'accepted-unknown', assessment: 'The language-training subsection says perennial recruitment; the separate June30,2026 day is for degree students. The spring title and later August–September2026 registration paragraph do not establish an exact current language intake. Report appropriately retains unknown and does not declare unconditional current opening.' },
    { key: 'gxnu-table-column-and-undated-year', disposition: 'accepted-unknown', assessment: 'Original PDFpage1 and rendered image were read. Chinese Language and Literature is a Chinese-taught doctoral row; its Application Deadline column says June30,Each Year and its Enrollment Date column says Sep. These must not be swapped. The two-page list establishes no exact application year; unknown is correct.', visualEvidence: 'gxnu-rule-page1.png' },
    { key: 'gxu-fees-not-date-evidence', disposition: 'accepted-unknown', assessment: 'Both language degree/nondegree records are sourced to a fee page. Full captured page gives charges and semester/year units with no application date. No target-year cutoff is inferred.' },
    { key: 'gxmzu-wrapper200-vs-unread-pdf', disposition: 'accepted-blocked', assessment: 'Two stored official wrappers contain year-specific titles and attachments; neither wrapper establishes the full award date. Original PDF GET returned200 headers but timed out before a body/hash was saved, then one bounded web fallback failed. The report correctly distinguishes wrapper bytes from the absent original PDF and keeps the award blocked under cooldown.' },
    { key: 'gafa-inclusive-applicant-deadline', disposition: 'accepted-date-only', assessment: 'The full 2026 international doctoral call identifies Chinese-medium/fulltime doctorate and Art Studies among its doctoral points. Its applicant-email subsection explicitly ends April17,2026 inclusive of that day. Publication-relative opening, later interview notice, passport validity and September registration are not substituted for the application cutoff. Programme-catalogue attachment facts are not independently certified by this review.', observedDeadline: '2026-04-17', boundary: 'inclusive-date-as-worded' },
  ],
  canonicalRecordPins: pins, canonicalSourcePins: [...sourcePins.values()], evidenceArtifactPins: [...artifactPins.values()], priorReportPins,
  controls: { sourceOnlyApproval: true, noCanonicalMutationApproval: true, noWholeSchoolCompletionClaim: true, noFreshnessRenewal: true, reportUnchangedBeforeAfter: true, canonicalSixFilesUnchangedBeforeAfter: true },
};
const output = path.join(dir, 'independent-review-v1.json');
fs.writeFileSync(output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportSha256: reportSha, reviewSha256: hash(fs.readFileSync(output)), records: records.length, results, sourceRows: sourcePins.size, originalBodies: bodyEvidence.size }));
