/* Separate reviewer: existing official captures only; no network or catalogue mutation. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rowHash = (r) => hash(JSON.stringify(r));
const reportBytes = fs.readFileSync(path.join(dir, 'report.json'));
const reportSha = hash(reportBytes);
const report = JSON.parse(reportBytes);
const before = Object.fromEntries(Object.keys(report.inputFileSha256).map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
assert.deepEqual(before, report.inputFileSha256);
const queueBytes = fs.readFileSync(path.join(primary, 'quality/deadline-sweep-20261019/next-official-date-targets-v2.json'));
assert.equal(hash(queueBytes), report.targetQueueSha256);
const queue = JSON.parse(queueBytes);
assert.deepEqual(report.selectedUniversityIds, queue.selectedUniversityIds.slice(7, 14));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map((r) => [r.id, r]));
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map((r) => [r.id, r]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map((r) => [r.id, r]));
const records = report.groups.flatMap((g) => g.records);
const expected = queue.selectedRecordIds.filter((id) => { const c = cycles.get(id); return c && report.selectedUniversityIds.includes(programs.get(c.programId).universityId); });
assert.equal(records.length, 18);
assert.equal(new Set(records.map((r) => r.recordId)).size, 18);
assert.deepEqual(records.map((r) => r.recordId).sort(), expected.sort());
assert.equal(new Set(records.map((r) => r.universityId)).size, 7);
const evidenceByHash = new Map();
const checkedArtifacts = new Map();
function pinArtifact(p, expectedSha) {
  const raw = fs.readFileSync(path.join(dir, p));
  const actual = hash(raw);
  if (expectedSha) assert.equal(actual, expectedSha, p);
  const artifact = { path: p, sha256: actual, bytes: raw.length };
  checkedArtifacts.set(p, artifact);
  return artifact;
}
for (const group of report.groups) {
  for (const ev of group.evidence) {
    if (!ev.bodyPath) continue;
    pinArtifact(ev.bodyPath, ev.bodySha256);
    assert.ok(ev.observedAt && !Number.isNaN(Date.parse(ev.observedAt)));
    if (ev.textArtifact) pinArtifact(ev.textArtifact.path, ev.textArtifact.sha256);
    evidenceByHash.set(ev.bodySha256, ev);
  }
  for (const ev of group.visualEvidence) pinArtifact(ev.path, ev.sha256);
}
const whitespaceFree = (s) => s.replace(/\s+/g, '');
const counts = {};
const canonicalPins = [];
for (const r of records) {
  const c = cycles.get(r.recordId);
  const p = programs.get(c.programId);
  assert.equal(r.canonicalRecordSha256, rowHash(c));
  assert.equal(r.canonicalCycleSha256, rowHash(c));
  assert.equal(r.canonicalProgramSha256, rowHash(p));
  assert.equal(r.programId, p.id);
  assert.equal(r.universityId, p.universityId);
  assert.equal(r.degreeLevel, p.degreeLevel);
  assert.equal(r.academicYear, c.academicYear);
  assert.equal(r.intake, c.intake);
  assert.equal(c.closesOn, null);
  assert.equal(c.opensOn, null);
  assert.equal(r.storedDeadline, null);
  assert.equal(r.storedOpensOn, null);
  assert.equal(r.openingDateAssessed, false);
  assert.equal(r.canonicalDateChanged, false);
  assert.equal(r.candidateOnly, true);
  assert.equal(r.freshnessRenewed, false);
  assert.equal(r.publishedInInputSnapshot, false);
  assert.deepEqual(r.sourceIds, c.sourceIds);
  assert.deepEqual([...r.registeredSourceUrls].sort(), c.sourceIds.map((id) => sources.get(id).url).sort());
  const ev = evidenceByHash.get(r.evidenceBodySha256);
  assert.ok(ev, r.recordId + ': missing pinned raw body');
  assert.equal(r.observedAt, ev.observedAt);
  assert.ok([ev.url, ev.finalUrl].includes(r.evidenceSourceUrl));
  const extracted = fs.readFileSync(path.join(dir, ev.textArtifact.path), 'utf8');
  assert.ok(whitespaceFree(extracted).includes(whitespaceFree(r.quote)), r.recordId + ': quote absent from complete extraction');
  if (r.result === 'closed') assert.ok(r.officialDeadline && r.officialDeadline < '2026-10-19');
  else assert.equal(r.officialDeadline, null);
  counts[r.result] = (counts[r.result] || 0) + 1;
  canonicalPins.push({ recordId: r.recordId, canonicalCycleSha256: rowHash(c), programId: p.id, canonicalProgramSha256: rowHash(p), result: r.result, officialDeadlineCandidate: r.officialDeadline, officialCutoffAtCandidate: r.officialCutoffAt, evidenceBodySha256: r.evidenceBodySha256, observedAt: r.observedAt });
}
assert.deepEqual(counts, { closed: 6, unknown: 12 });
const byId = new Map(records.map((r) => [r.recordId, r]));
const bachelor = byId.get('cycle-gap-prog-mew-nss-cad-acting-bachelor-2026-2027-autumn');
const doctorate = byId.get('cycle-gap-prog-mew-nss-cad-drama-film-doctorate-2026-2027-autumn');
assert.equal(bachelor.officialCutoffAt, '2026-03-06T09:00:00+08:00');
assert.equal(bachelor.candidateOfficialOpeningAt, '2026-03-02T09:00:00+08:00');
assert.equal(bachelor.otherApplicantStages[0].cutoffAt, '2026-03-16T17:00:00+08:00');
assert.equal(bachelor.otherApplicantStages[1].boundary, 'before-date-as-worded');
assert.equal(doctorate.officialCutoffAt, '2026-03-06T17:00:00+08:00');
assert.equal(doctorate.excludedOtherRouteDeadline.deadline, '2026-02-28');
assert.equal(byId.get('cycle-gap-prog-mew-ne-btbu-finance-bachelor-2026-2027-autumn').result, 'unknown');
const btbu = fs.readFileSync(path.join(dir, 'btbu.txt'), 'utf8');
const btbuCatalogue = btbu.split('=== PAGE 6 ===')[1].split('=== PAGE 9 ===')[0];
assert.ok(btbuCatalogue.includes('财务管理'));
assert.ok(!btbuCatalogue.includes('金融学'));
assert.ok(!btbuCatalogue.includes('Finance'));
const doc = whitespaceFree(fs.readFileSync(path.join(dir, 'cad-doctor-guide.txt'), 'utf8'));
assert.ok(doc.includes('留学生考生不参加网报。'));
const additionalRenders = ['independent-cad-stage-page-07.png', 'independent-cad-stage-page-08.png', 'independent-bupt-date-page-10.png'].map((p) => pinArtifact(p));
const sourceArtifacts = [...checkedArtifacts.values()];
const after = Object.fromEntries(Object.keys(before).map((f) => [f, hash(fs.readFileSync(path.join(primary, 'content/data', f)))]));
assert.deepEqual(after, before);
assert.equal(hash(fs.readFileSync(path.join(dir, 'report.json'))), reportSha);
const review = {
  schemaVersion: 1, reviewId: 'official-batch-014-independent-review-v1', reviewedAt: new Date().toISOString(),
  verdict: 'accepted-for-scoped-date-only-candidate-observations',
  approvedForCanonicalWrite: false, reportPath: 'report.json', reportSha256: reportSha,
  auditDate: report.auditDate, timeZone: report.timeZone, snapshotSha256: report.snapshotSha256,
  inputFileSha256: before, targetQueueSha256: report.targetQueueSha256,
  summary: { universities: 7, exactSelectedIds: 18, closedDateCandidates: 6, unknownDeadlines: 12, canonicalCycleFullRowHashesChecked: 18, canonicalProgramFullRowHashesChecked: 18, originalBodyFilesHashChecked: evidenceByHash.size, allStoredDeadlineAndOpeningDatesRemainNull: true, newOfficialWebsiteReads: 0, canonicalWrites: 0, reportWrites: 0, stateWrites: 0, gitActions: 0 },
  findings: [
    { key: 'cad-bachelor-distinct-application-stages', disposition: 'accepted', evidence: ['cad-bachelor-guide.pdf pages 3,7,8,10', 'cad-bachelor-date-page3.png', ...additionalRenders.filter((r) => r.path.includes('cad')).map((r) => r.path)], assessment: '2026 international undergraduate first application-material submission runs March 2 at 09:00 to March 6 at 09:00 Beijing time. March 16 at 17:00 applies only to major selection/payment after review, and before April 15 applies only to qualification documents after successful registration. The earliest mandatory first-submission cutoff is the correct scoped candidate for a new applicant; later stages cannot replace it.', candidateCutoffAt: bachelor.officialCutoffAt, relativeOrBeforeQualifiersPreserved: true },
    { key: 'cad-doctor-foreign-vs-hmt-route', disposition: 'accepted', evidence: ['cad-doctor-guide.pdf page 1', 'cad-doctor-date-page1.png'], assessment: 'The actual 2026 doctoral guide explicitly exempts foreign applicants from HMT online registration. Its March 2–6 material submission covers foreign applicants, ending March 6 at 17:00 Beijing time. HMT-only February 28 at 24:00 is retained solely as an excluded route; its normalized March 1 midnight is not used as the foreign deadline.', candidateCutoffAt: doctorate.officialCutoffAt },
    { key: 'btbu-matching-three-majors-finance-unmatched', disposition: 'accepted', evidence: ['btbu.pdf pages 6–8,11', 'btbu-programs-page6.png', 'btbu-deadline-page11.png'], assessment: 'The actual 2026 catalogue includes Business Administration, International Economics and Trade, and Polymer Materials and Engineering; their explicit applicant deadline May 1, 2026 supports three closed candidates. It lists Financial Management, which is not Finance. No Finance/金融学 entry is found across all three catalogue pages; that stored route remains unknown. No permanent discontinuation is inferred.' },
    { key: 'bjut-programme-specific-absolute-window', disposition: 'accepted', evidence: ['bjut.pdf pages 1–2', 'bjut-date-page2.png'], assessment: 'Exact English-taught International Economics and Trade bachelor programme has an explicitly year-bound November 1, 2025 to June 15, 2026 application period, September entry, and the matching 2026–2027 stored cycle. It supports one closed candidate and a separate numeric opening candidate, without opening-date equality certification.' },
    { key: 'bupt-relative-months-not-hardened', disposition: 'accepted', evidence: ['bupt.pdf pages 1,6,10', 'independent-bupt-date-page-10.png'], assessment: '2026 brochure and four route names are present, but its application period states October 20 to April 20 next year without absolute endpoint years. The report conservatively retains four unknown deadlines and does not manufacture a 2025/2026 or 2026/2027 window.' },
    { key: 'ccom-recurring-before-dates', disposition: 'accepted', evidence: ['ccom.html', 'ccom.txt section 五'], assessment: 'The January 13, 2026 publication date does not establish the application year of generic spring/autumn fee references. Before January 1 and before June 15 remain recurring references with strict before qualifiers; four deadlines stay unknown.' },
    { key: 'bwu-before-class-and-cueb-recurring-rule', disposition: 'accepted', evidence: ['bwu-guide.html', 'cueb-deadline.html'], assessment: 'BWU any-time-before-class and approximate early-September intake do not provide an exact 2026 deadline. CUEB before June 10 each year is recurring and the stored bachelor intake is other; language-only spring before December 20 is excluded. All three remain unknown.' },
  ],
  canonicalRecordPins: canonicalPins,
  evidenceArtifactPins: sourceArtifacts,
  controls: { reviewUsesExistingCapturesOnly: true, originalPdfBytesAndObservationTimesPinned: true, sourceReportUnchangedBeforeAfter: true, canonicalSixFilesUnchangedBeforeAfter: true, candidateOnlyNoApprovedMutation: true, noWholeSchoolCertification: true, noFeeOrFullFreshnessRenewal: true },
};
const output = path.join(dir, 'independent-review-v1.json');
fs.writeFileSync(output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportSha256: reportSha, reviewPath: output, reviewSha256: hash(fs.readFileSync(output)), records: records.length, results: counts, originalBodyFiles: evidenceByHash.size, totalEvidenceArtifacts: sourceArtifacts.length }));
