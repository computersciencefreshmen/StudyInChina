/* Offline independent source-only review. Reads frozen evidence and canonical inputs. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const dir = __dirname, base = path.dirname(dir);
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const rowHash = (r) => hash(JSON.stringify(r));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const compact = (s) => s.normalize('NFKC').replace(/\s+/gu, '');
const reportBytes = fs.readFileSync(path.join(dir, 'report.json')), report = JSON.parse(reportBytes);
const selectionBytes = fs.readFileSync(path.join(dir, 'selection.json')), selection = JSON.parse(selectionBytes);
assert.equal(hash(selectionBytes), report.selectionSha256);
assert.equal(hash(reportBytes), read(path.join(dir, 'completion.json')).reportSha256);
const tables = {}, canonicalFilePins = {};
for (const [name, expected] of Object.entries(report.inputFileSha256)) {
  const b = fs.readFileSync(path.join(primary, 'content/data', name));
  assert.equal(hash(b), expected); assert.equal(expected, selection.inputFileSha256[name]);
  tables[name] = JSON.parse(b); canonicalFilePins[name] = hash(b);
}
assert.equal(Object.keys(tables).length, 6);
const inventoryBytes = fs.readFileSync(path.join(primary, 'quality/deadline-sweep-20261019/catalog-deadlines.json'));
const inventory = JSON.parse(inventoryBytes);
assert.deepEqual(canonicalFilePins, inventory.inputFileSha256);
assert.equal(report.snapshotSha256, inventory.snapshotSha256);
assert.equal(report.auditDate, '2026-10-19'); assert.equal(report.timeZone, 'Asia/Shanghai');
const queueBytes = fs.readFileSync(path.join(primary, report.queuePath)), queue = JSON.parse(queueBytes);
assert.equal(hash(queueBytes), report.queueSha256);
assert.deepEqual(queue.selectedUniversityIds.slice(7, 14), report.selection.universityIds);
const extensionBytes = fs.readFileSync(report.selection.additionalRootSelectionPin.path), extension = JSON.parse(extensionBytes);
assert.equal(hash(extensionBytes), report.selection.additionalRootSelectionPin.sha256);
assert.equal(extension.baseQueueSha256, report.queueSha256);
const programs = new Map(tables['programs.json'].map((r) => [r.id, r]));
const raw = new Map([...tables['admission-cycles.json'], ...tables['scholarships.json']].map((r) => [r.id, r]));
const sources = new Map(tables['sources.json'].map((r) => [r.id, r]));
const records = report.groups.flatMap((g) => g.records);
const exactIds = [...report.selection.baseQueueRecordIds, ...report.selection.additionalSameSourceRecordIds];
assert.equal(exactIds.length, 19); assert.equal(report.selection.baseQueueRecordIds.length, 16); assert.equal(report.selection.additionalSameSourceRecordIds.length, 3);
assert.equal(new Set(exactIds).size, 19); assert.equal(records.length, 19);
assert.deepEqual(records.map((r) => r.recordId).sort(), [...exactIds].sort());
const expectedBase = queue.selectedRecordIds.filter((id) => { const r = raw.get(id); return report.selection.universityIds.includes(r.programId ? programs.get(r.programId).universityId : r.universityIds.find((u) => report.selection.universityIds.includes(u))); });
assert.deepEqual(expectedBase.sort(), [...report.selection.baseQueueRecordIds].sort());
for (const id of report.selection.additionalSameSourceRecordIds) assert.ok(extension.extraRecords.some((r) => r.recordId === id && r.canonicalRecordSha256 === rowHash(raw.get(id))));
const recordPins = [], sourcePins = new Map(), linkedProgramPins = new Map();
for (const r of records) {
  const canonical = raw.get(r.recordId), s = selection.records.find((x) => x.recordId === r.recordId);
  assert.ok(canonical && s); assert.deepEqual(s.row, canonical); assert.equal(rowHash(canonical), r.canonicalRecordSha256);
  assert.equal(s.canonicalRecordSha256, r.canonicalRecordSha256);
  assert.equal(r.storedDeadline, canonical.closesOn ?? canonical.deadline ?? null);
  assert.equal(r.storedOpensOn, canonical.opensOn ?? null);
  if (canonical.programId) {
    const p = programs.get(canonical.programId);
    assert.deepEqual(s.program, p); assert.equal(rowHash(p), r.canonicalProgramSha256);
    assert.equal(p.universityId, r.universityId); assert.equal(p.degreeLevel, r.degreeLevel);
    assert.equal(canonical.academicYear, r.academicYear); assert.equal(canonical.intake, r.intake);
  } else assert.ok(canonical.universityIds.includes(r.universityId));
  for (const pid of canonical.programId ? [canonical.programId] : canonical.programIds) linkedProgramPins.set(pid, { programId: pid, canonicalProgramSha256: rowHash(programs.get(pid)), scope: 'Join/hash pin only; linked programme eligibility is not independently certified by an award finding.' });
  assert.deepEqual(r.sourceIds, canonical.sourceIds);
  for (const p of r.sourcePins) {
    const source = sources.get(p.sourceId);
    assert.equal(source.official, true); assert.equal(source.url, p.url); assert.equal(rowHash(source), p.sourceSha256);
    const full = s.sources.find((x) => x.row.id === p.sourceId);
    assert.ok(full); assert.deepEqual(full.row, source); assert.equal(full.sha256, p.sourceSha256);
    sourcePins.set(p.sourceId, { sourceId: p.sourceId, canonicalSourceSha256: p.sourceSha256, url: p.url });
  }
  assert.ok(!r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.openingDateAssessed && r.candidateOnly && r.dateOnly);
  if (r.result === 'closed') { assert.match(r.officialDeadline, /^\d{4}-\d{2}-\d{2}$/); assert.ok(r.officialDeadline < report.auditDate); assert.equal(r.storedDeadline, null); }
  else { assert.equal(r.result, 'unknown'); assert.equal(r.officialDeadline, null); }
  assert.ok(r.observedAt.startsWith('2026-10-19'));
  recordPins.push({ recordId: r.recordId, canonicalRecordSha256: r.canonicalRecordSha256, programId: r.programId, canonicalProgramSha256: r.canonicalProgramSha256 ?? null, result: r.result, officialDeadline: r.officialDeadline, deadlineBoundary: r.deadlineBoundary, evidenceSourceUrl: r.evidenceSourceUrl, evidenceBodySha256: r.evidenceBodySha256, observedAt: r.observedAt });
}
const captures = [...read(path.join(dir, 'captures.json')).rows, ...read(path.join(dir, 'supplement-captures.json'))];
const rawPins = captures.filter((c) => c.bodyPath).map((c) => {
  const b = fs.readFileSync(path.join(dir, c.bodyPath)); assert.equal(hash(b), c.bodySha256); assert.equal(b.length, c.bytes);
  assert.ok(c.observedAt.startsWith('2026-10-19'));
  return { path: c.bodyPath, rawSha256: c.bodySha256, bytes: c.bytes, url: c.url, observedAt: c.observedAt, contentType: c.contentType };
});
assert.equal(rawPins.length, 9);
const webBytes = fs.readFileSync(path.join(dir, 'haut-web-observation.json')), web = JSON.parse(webBytes);
assert.equal(web.rawOriginServerBytes, false); assert.equal(web.sourceUrl, 'https://sie.haut.edu.cn/info/1298/17096.htm');
for (const g of report.groups) {
  const bodies = [];
  for (const e of g.evidence) {
    const c = captures.find((x) => x.key === e.key); assert.ok(c); assert.equal(c.url, e.url); assert.equal(c.observedAt, e.observedAt);
    if (e.bodyPath) assert.equal(hash(fs.readFileSync(path.join(dir, e.bodyPath))), e.bodySha256);
    if (e.textArtifact) { const b = fs.readFileSync(path.join(dir, e.textArtifact.path)); assert.equal(hash(b), e.textArtifact.sha256); bodies.push(b.toString('utf8')); }
  }
  if (g.actualWebTextEvidence) { assert.equal(hash(webBytes), g.actualWebTextEvidence.sha256); bodies.push(web.text); }
  for (const r of g.records) assert.ok(bodies.some((b) => compact(b).includes(compact(r.quote))), 'Missing exact date/scope quote: ' + r.recordId);
}
const henuRows = records.filter((r) => r.universityId === 'uni-henan-university');
assert.equal(henuRows.filter((r) => r.result === 'closed').length, 1);
assert.equal(henuRows.filter((r) => r.result === 'unknown').length, 4);
assert.ok(compact(fs.readFileSync(path.join(dir, 'henu-current-annex5.txt'), 'utf8')).includes('请输入验证码下载附件'));
const beforeRows = records.filter((r) => r.deadlineBoundary === 'before-date-as-worded'); assert.equal(beforeRows.length, 2);
const hfut = records.filter((r) => r.programmeAppendixEvidence); assert.equal(hfut.length, 3);
assert.deepEqual(hfut.map((r) => r.programmeAppendixEvidence.row).sort((a, b) => a - b), [3, 10, 18]);
const priorPins = [], overlappingIds = new Set();
function collect(o) { if (!o || typeof o !== 'object') return; if (typeof o.recordId === 'string' && exactIds.includes(o.recordId)) overlappingIds.add(o.recordId); for (const v of Object.values(o)) if (v && typeof v === 'object') collect(v); }
for (const name of fs.readdirSync(base).filter((x) => /^official-batch-\d+$/.test(x) && x !== path.basename(dir))) {
  const p = path.join(base, name, 'report.json'); if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p); priorPins.push({ batch: name, sha256: hash(b) }); collect(JSON.parse(b));
}
assert.equal(overlappingIds.size, 0);
assert.equal(hash(fs.readFileSync(path.join(dir, 'report.json'))), hash(reportBytes));
for (const [name, expected] of Object.entries(canonicalFilePins)) assert.equal(hash(fs.readFileSync(path.join(primary, 'content/data', name))), expected);
const results = records.reduce((o, r) => ({ ...o, [r.result]: (o[r.result] || 0) + 1 }), {});
assert.equal(results.closed, 8); assert.equal(results.unknown, 11);
const review = {
  schemaVersion: 1, batchId: report.batchId, reviewer: '/root/fast_date_inventory', reviewedAt: new Date().toISOString(), mode: 'offline-independent-source-only-review',
  decision: 'approved-for-source-only-date-observations-with-preserved-scope-limitations', reportSha256: hash(reportBytes), selectionSha256: hash(selectionBytes), snapshotSha256: report.snapshotSha256, inventorySha256: hash(inventoryBytes), inputFileSha256: canonicalFilePins,
  queueSha256: hash(queueBytes), additionalSelectionReceiptSha256: hash(extensionBytes), exactRecordIds: exactIds,
  summary: { universities: 7, exactRecords: 19, baseQueueRecords: 16, additionalSameSourceRecords: 3, recordResults: results, rawBodiesHashVerified: rawPins.length, sourceRowsPinned: sourcePins.size, canonicalLinkedProgramRowsPinned: linkedProgramPins.size, exactRecordOverlapsOtherBatches: 0, newWebsiteReads: 0, canonicalWrites: 0, freshnessRenewals: 0, gitMutations: 0, sharedStateWrites: 0 },
  findings: [
    { school: 'Hebei Normal University', accepted: '2026/27 named CSC postgraduate award closes February28,2026; relative announcement opening is not converted into an ISO date. July–August document mailing is not the applicant deadline.' },
    { school: 'Hebei University of Technology', accepted: '2026 Type B only, November27,2025–February10,2026. Both bilingual clauses agree. Type A route not borrowed; opening remains candidate-only.' },
    { school: 'Hefei University of Technology', accepted: '2026 guide June15 deadline and directly linked current XLSX programme/language rows3/10/18 match selected bachelor programmes. Independently read original XLSX with Python openpyxl: Biomedical Engineering Chinese; Civil Engineering English; International Economics and Trade Chinese. Generic award remains unknown because programme-linked awards use separate scholarship branches and no independent award deadline is published.' },
    { school: 'Henan University', accepted: '2026/27 exact high-level postgraduate scholarship before January16,2026 retained. Four specific English programme cycles remain unknown: 2022-path catalogue has exact names/degrees but no applicable intake year; actual current Annex5 returns verification-code HTML. Old stored dates are not revalidated and no programme discontinuation is inferred.' },
    { school: 'Henan University of Technology', accepted: 'Native exact source403 then one actual full-page web-text fallback, honestly labelled potentially cached and not raw origin bytes. 2026 April–July application range is month precision only. Four programme and two award rows remain unknown; general month range is context only for awards. Promotion award concerns later academic years, no initial admission deadline borrowed.' },
    { school: 'Hohai University', accepted: 'Initial school application strictly before December30,2025, with candidate November10 opening. School reviews and March27,2026 nominated-applicant CSC stage stay distinct; no late-stage extension is inferred.' },
    { school: 'Huaqiao University', accepted: 'This 2026 ICLT university notice offers September-only bachelor/year/semester routes. Student May15 differs from institutional May25; no March2027 route invented. Candidate openingMarch1 remains separate.' },
  ],
  sourceOnlyScope: 'Approval applies only to these19 original-source date observations and their stated limitations. No new canonical dates, overall freshness, whole-school catalogue completeness, linked programme eligibility from award dates, publication, or website certification is approved. Canonical mutation would require the supported narrow consumer, separate independent approval and exact-row CAS.',
  recordPins, canonicalSourcePins: [...sourcePins.values()], canonicalLinkedProgramPins: [...linkedProgramPins.values()], rawEvidencePins: rawPins,
  webOnlyEvidencePin: { path: 'haut-web-observation.json', sha256: hash(webBytes), observedAt: web.observedAt, sourceUrl: web.sourceUrl, rawOriginServerBytes: false, provenance: web.provenance },
  priorReportPins: priorPins,
  validation: { fullCanonicalRowsParentsAndRegisteredSourcesMatch: true, exactlyNineteenIdsOnce: true, allDateAndScopeQuotesMatchedCapturedText: true, originalBytesHashAndObservedAtVerified: true, hfutCurrentOriginalXlsxIndependentlyReadWithOpenpyxl: true, henuCaptchaNotMisrepresentedAsCatalogue: true, strictBeforeAndApplicantVsReviewDistinctionsRetained: true, unknownAwardDeadlinesNotBorrowed: true, reportAndCanonicalInputsUnchangedBeforeAfter: true },
};
const output = path.join(dir, 'independent-review-v1.json');
fs.writeFileSync(output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ path: output, sha256: hash(fs.readFileSync(output)), reportSha256: hash(reportBytes), records: records.length, results }));
