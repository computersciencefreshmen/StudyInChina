/* Offline independent review. Writes only its new compact receipt, never source data. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const dir = __dirname, primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex'), read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const rb = fs.readFileSync(path.join(dir, 'report.json')), report = JSON.parse(rb), sb = fs.readFileSync(path.join(dir, 'selection.json')), sel = JSON.parse(sb);
const records = report.groups.flatMap((g) => g.records), checks = [], sourcePins = new Map(), programPins = new Map(), artifactPins = new Map();
const compact = (s) => s.normalize('NFKC').replace(/\s+/gu, '');
function check(id, fn, detail) { try { fn(); checks.push({ id, passed: true, ...(detail ? { detail } : {}) }); } catch (error) { checks.push({ id, passed: false, error: String(error) }); } }
check('frozen-report-selection-and-six-canonical-inputs', () => {
  assert.equal(sha(rb), '30e6a423c567a9d99cf2724b9786f8154ca94e831ef3852e36534899412b00c9');
  assert.equal(sha(sb), report.selection.sha256); assert.equal(report.auditDate, '2026-10-19');
  for (const [f, expected] of Object.entries(report.inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(primary, 'content/data', f))), expected);
  assert.deepEqual(report.inputFileSha256, sel.inputFileSha256);
  const ib = fs.readFileSync(path.join(primary, sel.inventoryPath)), inventory = JSON.parse(ib);
  assert.equal(sha(ib), sel.inventorySha256); assert.equal(sha(ib), report.inventorySha256); assert.equal(inventory.snapshotSha256, report.snapshotSha256);
});
const tables = Object.fromEntries(['admission-cycles', 'scholarships', 'programs', 'sources'].map((f) => [f, new Map(read(path.join(primary, 'content/data', f + '.json')).map((r) => [r.id, r]))]));
check('exact-base13-plus-root-additional3-no-duplicates', () => {
  const qb = fs.readFileSync(path.join(primary, sel.queuePath)), q = JSON.parse(qb);
  assert.equal(sha(qb), sel.queueSha256); assert.equal(sha(qb), report.targetQueueSha256);
  assert.deepEqual(report.selectedUniversityIds, sel.universityIds);
  assert.equal(sel.baseQueueRecordIds.length, 13); assert.equal(sel.additionalSameSourceRecordIds.length, 3);
  assert.equal(records.length, 16); assert.equal(new Set(records.map((r) => r.recordId)).size, 16);
  assert.deepEqual(records.map((r) => r.recordId).sort(), [...sel.baseQueueRecordIds, ...sel.additionalSameSourceRecordIds].sort());
  assert.ok(sel.baseQueueRecordIds.every((id) => q.selectedRecordIds.includes(id)));
  const eb = fs.readFileSync(path.resolve(dir, '..', 'heartbeat-0806', 'additional-same-source-selection-v1.json')), extra = JSON.parse(eb);
  assert.equal(sha(eb), sel.additionalSelectionReceiptSha256); assert.equal(extra.baseQueueSha256, sel.queueSha256);
  for (const id of sel.additionalSameSourceRecordIds) assert.ok(extra.extraRecords.some((e) => e.recordId === id && e.canonicalRecordSha256 === sel.records.find((r) => r.recordId === id).canonicalRecordSha256));
});
check('all-row-programme-and-full-registered-source-pins', () => {
  for (const r of records) {
    const s = sel.records.find((x) => x.recordId === r.recordId), canonical = tables[s.collection === 'admissionCycles' ? 'admission-cycles' : 'scholarships'].get(r.recordId);
    assert.deepEqual(s.row, canonical); assert.equal(sha(JSON.stringify(canonical)), r.canonicalRecordSha256); assert.equal(r.canonicalRecordSha256, s.canonicalRecordSha256);
    assert.equal(r.storedDeadline, canonical.closesOn ?? canonical.deadline ?? null); assert.equal(r.storedOpensOn, canonical.opensOn ?? null);
    for (const p of s.programRows) { assert.deepEqual(p.row, tables.programs.get(p.row.id)); assert.equal(sha(JSON.stringify(p.row)), p.canonicalProgramSha256); programPins.set(p.row.id, p.canonicalProgramSha256); }
    assert.deepEqual(r.canonicalProgramPins, s.programRows.map((p) => ({ programId: p.row.id, canonicalProgramSha256: p.canonicalProgramSha256 })));
    if (canonical.programId) { assert.equal(tables.programs.get(canonical.programId).universityId, r.universityId); assert.equal(canonical.academicYear, r.academicYear); assert.equal(canonical.intake, r.intake); } else assert.ok(canonical.universityIds.includes(r.universityId));
    for (const z of s.sources) { assert.deepEqual(z.row, tables.sources.get(z.row.id)); assert.equal(sha(JSON.stringify(z.row)), z.canonicalSourceSha256); assert.equal(z.row.official, true); sourcePins.set(z.row.id, z.canonicalSourceSha256); }
    for (const z of r.sourcePins) { assert.deepEqual(z.sourceFullRecord, tables.sources.get(z.sourceId)); assert.equal(z.canonicalSourceSha256, sourcePins.get(z.sourceId)); }
  }
});
check('original-and-web-observation-bytes-hashes-and-times', () => {
  for (const g of report.groups) for (const e of g.evidence) {
    assert.ok(e.observedAt.startsWith('2026-10-19'));
    if (e.rawPath) { assert.equal(sha(fs.readFileSync(path.join(dir, e.rawPath))), e.rawSha256); assert.equal(sha(fs.readFileSync(path.join(dir, e.textPath))), e.textSha256); artifactPins.set(e.rawPath, { path: e.rawPath, sha256: e.rawSha256, observedAt: e.observedAt }); }
    for (const key of ['retainedResponse', 'tailFailureResponse']) if (e[key]) { assert.equal(sha(fs.readFileSync(path.join(dir, e[key].path))), e[key].sha256); artifactPins.set(e[key].path, { path: e[key].path, sha256: e[key].sha256, observedAt: e.observedAt, originRawBytes: false }); }
  }
  assert.equal([...artifactPins.values()].filter((a) => a.originRawBytes !== false).length, 6);
  for (const r of records) { assert.ok(r.observedAt.startsWith('2026-10-19')); if (!r.originRawBytesAvailableForDateEvidence) assert.equal(r.evidenceBodySha256, null); }
});
check('positive-date-and-scope-quotes-match-read-bodies', () => {
  for (const g of report.groups) {
    const bodies = g.evidence.flatMap((e) => e.textPath ? [fs.readFileSync(path.join(dir, e.textPath), 'utf8')] : e.retainedResponse ? [fs.readFileSync(path.join(dir, e.retainedResponse.path), 'utf8')] : []);
    for (const quote of [g.quote, g.additionalQuote, ...g.records.map((r) => r.quotedDate)].filter(Boolean)) assert.ok(bodies.some((t) => compact(t).includes(compact(quote))), 'Quote not present: ' + quote);
  }
}, 'Positive body clauses checked; no whole-page keyword-absence assertions.');
check('jnmc-month-only-window-and-independent-awards', () => {
  const g = report.groups.find((g) => g.school === 'uni-jining-medical-university'); assert.equal(g.records.length, 6); assert.equal(g.monthWindow.precision, 'month'); assert.ok(g.records.every((r) => r.result === 'unknown' && r.officialDeadline === null));
}, 'PDFp2 visually read: March–June2026 application, June–July reporting; no invented ISO day. Two awards have no independent date.');
check('kmmu-nondegree-and-awards-do-not-borrow-degree-july31', () => {
  const g = report.groups.find((g) => g.school === 'uni-kunming-medical-university'); assert.equal(g.records.length, 5); assert.equal(g.unboundDegreeWindow.closesOn, '2026-07-31'); assert.ok(g.records.every((r) => r.result === 'unknown' && r.officialDeadline === null));
  assert.equal(g.records.filter((r) => r.storedDeadline === '2026-07-31').length, 3);
}, 'Original PDFpp3–4 visually read: self-funded DEGREE only, nondegree explicitly redirected; preparatory page title shell insufficient. Monthly aid and annual academic awards have no own cutoff.');
check('lnnu2025-ncu-upload-kust-landing-njau-partial-and-nau2015', () => {
  const school = (u) => report.groups.find((g) => g.school === 'uni-' + u);
  assert.equal(school('liaoning-normal-university').year, 2025); assert.ok(school('liaoning-normal-university').records.every((r) => r.officialDeadline === null));
  assert.ok(school('nanchang-university').records.every((r) => r.result === 'unknown'));
  assert.ok(school('kunming-university-of-science-and-technology').records.every((r) => r.result === 'unknown'));
  assert.ok(school('nanjing-agricultural-university').records.every((r) => r.result === 'blocked'));
  assert.equal(school('nanjing-audit-university').year, 2015); assert.ok(school('nanjing-audit-university').records.every((r) => r.officialDeadline === null));
}, 'LNNU2025/Mar2026 not rolled to2026/27; bilingual openings differ. NCU upload link has no current cutoff. KUST provincial landing cannot bind generic award. NJAU only first51/101lines; tail fails, blocked. NAU recurring Sep1–Oct10 vs Oct15 documents from2015, PDFpp8–9 visually read, not hardified to2026.');
check('no-canonical-freshness-or-unjustified-window-claims', () => {
  assert.equal(records.filter((r) => r.result === 'unknown').length, 15); assert.equal(records.filter((r) => r.result === 'blocked').length, 1);
  for (const r of records) { assert.equal(r.officialDeadline, null); assert.equal(r.candidateOfficialDeadline, null); assert.ok(r.candidateOnly && r.dateOnly); assert.ok(!r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.fullFactsCertified && !r.wholeSchoolCatalogueCompleted && !r.openingDateAssessed); }
});
check('no-exact-id-overlap-and-frozen-report-inputs-preserved', () => {
  const ids = new Set(records.map((r) => r.recordId)); let overlap = false;
  function scan(o) { if (!o || typeof o !== 'object') return; if (typeof o.recordId === 'string' && ids.has(o.recordId)) overlap = true; Object.values(o).forEach(scan); }
  for (const name of fs.readdirSync(path.dirname(dir)).filter((n) => /^official-batch-\d+$/.test(n) && n !== path.basename(dir))) { const p = path.join(path.dirname(dir), name, 'report.json'); if (fs.existsSync(p)) scan(read(p)); }
  assert.equal(overlap, false); assert.equal(sha(fs.readFileSync(path.join(dir, 'report.json'))), sha(rb));
  for (const [f, expected] of Object.entries(sel.inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(primary, 'content/data', f))), expected);
});
const failed = checks.filter((c) => !c.passed).length;
const review = {
  schemaVersion: 1, reviewId: 'official-batch-026-independent-review-v1', reviewedAt: new Date().toISOString(), reviewer: '/root/fast_date_inventory', result: failed ? 'source-only-review-failed' : 'source-only-pass',
  reviewedReportSha256: sha(rb), reviewedSelectionSha256: sha(sb), inventorySha256: report.inventorySha256, queueSha256: sel.queueSha256, additionalSelectionReceiptSha256: sel.additionalSelectionReceiptSha256, snapshotSha256: report.snapshotSha256, inputFileSha256: report.inputFileSha256,
  summary: { exactRecords: 16, baseQueueRecords: 13, additionalSameSourceRecords: 3, schools: 7, recordResults: { unknown: 15, blocked: 1 }, checksPassed: checks.length - failed, checksFailed: failed, programmeRowsPinned: programPins.size, registeredSourcesPinned: sourcePins.size, rawOriginalBodiesPinned: 6, retainedWebResponseArtifactsPinned: 2, newWebsiteReads: 0, canonicalWrites: 0, sharedStateWrites: 0, freshnessWrites: 0, gitMutations: 0 },
  scope: 'Only these16 date-source observations accepted with stated limitations. No canonical mutation approval, current applicant availability, publication, linked programme full-fact eligibility or whole-school freshness certification. Frozen selection retains complete canonical rows, parents and source objects.',
  canonicalRecordPins: Object.fromEntries(records.map((r) => [r.recordId, r.canonicalRecordSha256])), canonicalProgrammeBindingSetSha256: sha(JSON.stringify([...programPins].sort())), canonicalRegisteredSourceBindingSetSha256: sha(JSON.stringify([...sourcePins].sort())), originalAndObservationPins: [...artifactPins.values()],
  checks, checksScript: 'independent-review-checks.cjs', checksScriptSha256: sha(fs.readFileSync(__filename)),
};
const out = path.join(dir, 'independent-review-v1.json'), body = JSON.stringify(review, null, 2) + '\n';
assert.ok(Buffer.byteLength(body) < 12000, 'Receipt should stay compact'); fs.writeFileSync(out, body, { flag: 'wx' });
console.log(JSON.stringify({ path: out, sha256: sha(body), bytes: Buffer.byteLength(body), result: review.result, checksFailed: failed, failures: checks.filter((c) => !c.passed) })); if (failed) process.exitCode = 1;
