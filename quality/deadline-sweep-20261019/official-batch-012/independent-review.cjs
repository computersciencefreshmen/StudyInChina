const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = __dirname, project = path.resolve(root, '../../..'), primary = process.argv[2];
assert.ok(primary, 'Expected read-only primary workspace');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = filename => JSON.parse(readFileSync(filename, 'utf8'));
const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
const strip = value => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/gu, ' ').trim();
const reportFile = path.join(root, 'report.json'), reportBytes = readFileSync(reportFile), report = JSON.parse(reportBytes);
assert.equal(sha(reportBytes), 'ada983b2997608c749abdc6908a486c5d294e56a2d059309932f403be224ebe2');
const files = ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships'];
const hashes = Object.fromEntries(files.map(name => [name + '.json', sha(readFileSync(path.join(primary, 'content/data/' + name + '.json')))]));
assert.deepEqual(hashes, report.inputFileSha256);
assert.equal(sha(JSON.stringify(hashes)), report.snapshotSha256);
const programs = new Map(read(path.join(primary, 'content/data/programs.json')).map(row => [row.id, row]));
const cycles = new Map(read(path.join(primary, 'content/data/admission-cycles.json')).map(row => [row.id, row]));
const awards = new Map(read(path.join(primary, 'content/data/scholarships.json')).map(row => [row.id, row]));
const sources = new Map(read(path.join(primary, 'content/data/sources.json')).map(row => [row.id, row]));
const manifestBytes = readFileSync(path.join(root, 'capture-manifest.json')), manifest = JSON.parse(manifestBytes);
assert.equal(manifest.requests.length, 14);
const captures = [];
for (const item of manifest.requests) {
  assert.equal(item.status, 200);
  const raw = readFileSync(path.join(root, item.rawPath)), text = readFileSync(path.join(root, item.key + '.txt'));
  assert.equal(sha(raw), item.rawSha256);
  captures.push({ key: item.key, url: item.url, rawSha256: sha(raw), textSha256: sha(text) });
}
const rows = report.groups.flatMap(group => group.records.map(row => ({ ...row, group })));
assert.equal(rows.length, 22); assert.equal(new Set(rows.map(row => row.recordId)).size, 22);
assert.deepEqual(new Set(rows.map(row => row.recordId)), new Set(report.selection.recordIds));
let wholeRowHashes = 0;
for (const row of rows) {
  const canonical = row.collection === 'admissionCycles' ? cycles.get(row.recordId) : awards.get(row.recordId);
  assert.ok(canonical);
  assert.deepEqual(canonical.sourceIds, row.sourceIds);
  assert.equal(row.storedDeadline, row.collection === 'admissionCycles' ? canonical.closesOn : canonical.deadline);
  assert.equal(row.canonicalWritePerformed, false); assert.equal(row.freshnessRenewed, false);
  if (row.collection === 'admissionCycles') {
    const program = programs.get(canonical.programId);
    assert.equal(program.universityId, row.universityId); assert.equal(canonical.programId, row.programId);
    assert.equal(canonical.academicYear, row.academicYear); assert.equal(canonical.intake, row.intake);
    assert.equal(canonical.opensOn, row.storedOpensOn);
    assert.equal(sha(JSON.stringify(canonical)), row.canonicalCycleSha256);
    assert.equal(sha(JSON.stringify(program)), row.canonicalProgramSha256); wholeRowHashes += 2;
  } else {
    assert.ok(canonical.universityIds.includes(row.universityId) || canonical.programIds.some(id => programs.get(id)?.universityId === row.universityId));
    assert.equal(sha(JSON.stringify(canonical)), row.canonicalScholarshipSha256); wholeRowHashes++;
  }
  if (row.result === 'unchanged') assert.equal(row.officialDeadline, row.storedDeadline);
  else assert.equal(row.officialDeadline, null);
  for (const evidence of row.group.evidence) if (evidence.countsAsNewWebsiteRead) {
    const match = captures.find(item => item.url === evidence.url);
    assert.ok(match); assert.equal(match.rawSha256, evidence.rawSha256); assert.equal(match.textSha256, evidence.textSha256);
  }
}
const outcomes = rows.reduce((out, row) => (out[row.result] = (out[row.result] || 0) + 1, out), {});
assert.deepEqual(outcomes, { unchanged: 17, unknown: 2, conflict: 3 });
const text = key => readFileSync(path.join(root, key + '.txt'), 'utf8');
for (const key of ['dlut-a', 'dlut-b']) assert.ok(text(key).includes('applicants are recommend to complete the application by before the end of June.'));
assert.ok(compact(text('cqnu-cn')).includes(compact('春季学期（3月-7月）报名时间：9月1日-12月25日')));
assert.ok(text('cqnu-en').includes('September 1, 2026-December 25, 2026.'));
assert.ok(text('bfsu').includes('September 2026 or January 2027'));
assert.ok(compact(text('bfsu')).includes('December30th,2026March2027'));
assert.ok(text('uibe-degree').includes('Spring Semester: October 20 - December 31 each year'));
assert.ok(text('uibe-foundation').includes('Spring Semester : October 1 to December 31 (closes when seats are filled)'));
assert.ok(text('xmu-language').includes('Spring Semester: December 30, 2026'));
assert.ok(text('hainanu').includes('Spring semester: December 31, 2026 (Semester starts from the beginning of March 2027)'));
assert.ok(text('blcu').includes('before January 12, 2027'));
assert.ok(text('tjfsu').includes('before 30 December 2026'));
assert.ok(compact(text('sjtu')).includes('Spring:Sep.15-Dec.15'));
assert.ok(text('sjtu').includes('2027 Spring Long term Chinese Language Course'));
assert.ok(compact(text('tju')).includes('Program21YearFall&SpringSemester2027.03.15-2027.07.152027.09'));

const biptHtml = readFileSync(path.join(root, 'bipt.html'), 'utf8');
const tableRows = [...biptHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
  [...match[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(cell => ({ attributes: cell[1], text: strip(cell[2]) })));
const header = tableRows.find(row => row[0]?.text === '申请事项');
const registration = tableRows.find(row => row[0]?.text === '报名时间');
assert.ok(header && registration);
assert.equal(header[1].text, '语言生');
assert.equal(registration[1].text, '5月1日-6月30日 11月1日-12月30日');
assert.match(registration[2].attributes, /colspan="2"/);
assert.equal(registration[2].text, '每年3月1日-6月30日');
const biptColumnProof = { headerColumns: header.map(cell => cell.text), timeRow: registration.map(cell => ({ text: cell.text, colspan: /colspan="(\d+)"/.exec(cell.attributes)?.[1] || '1' })),
  conclusion: 'November1–December30 belongs to the language-student column; March1–June30 spans the two degree columns. No explicit spring-intake month is inferred.' };
const reused = [];
for (const group of report.groups) for (const evidence of group.evidence.filter(item => item.countsAsNewWebsiteRead === false)) {
  if (evidence.evidenceMode === 'prior-approved-central-guide-reuse') {
    const receipt = evidence.receipt;
    const raw = readFileSync(path.join(primary, receipt.rawPath)), centralText = readFileSync(path.join(primary, receipt.textPath));
    assert.equal(sha(raw), receipt.rawSha256); assert.equal(sha(centralText), receipt.textSha256);
    assert.ok(compact(centralText.toString('utf8')).includes(compact('2027年3月入学：学生申请截止日期为10月31日')));
    reused.push({ mode: evidence.evidenceMode, rawSha256: sha(raw), originalObservedAt: receipt.retrievedAt, newWebsiteRead: false });
  } else {
    const oldReportBytes = readFileSync(path.join(project, evidence.reportPath));
    assert.equal(sha(oldReportBytes), evidence.reportSha256);
    assert.equal(sha(readFileSync(path.join(project, evidence.rawPath))), evidence.rawSha256);
    const old = JSON.parse(oldReportBytes);
    assert.equal(old.snapshotSha256, report.snapshotSha256);
    assert.equal(evidence.originalObservedAt, evidence.guide.source.completedAt || evidence.guide.source.observedAt);
    for (const row of group.records) {
      const canonical = cycles.get(row.recordId), program = programs.get(canonical.programId);
      const sourceUrl = evidence.guide.source.url;
      assert.ok(canonical.sourceIds.some(id => sources.get(id)?.url === sourceUrl));
      assert.equal(canonical.academicYear, '2027-2028'); assert.equal(canonical.intake, 'autumn');
      assert.equal(program.degreeLevel, group.universityId === 'uni-nanjing-university' ? 'bachelor' : 'master');
    }
    reused.push({ mode: evidence.evidenceMode, reportPath: evidence.reportPath, reportSha256: sha(oldReportBytes),
      rawSha256: evidence.rawSha256, originalObservedAt: evidence.originalObservedAt, boundRecordIds: group.records.map(row => row.recordId), newWebsiteRead: false });
  }
}
assert.equal(reused.filter(row => row.boundRecordIds).reduce((sum, row) => sum + row.boundRecordIds.length, 0), 6);
const cqnu = report.groups.find(group => group.universityId === 'uni-chongqing-normal-university');
assert.equal(cqnu.heldDateCorrection.applied, false);
assert.equal(cqnu.heldDateCorrection.oldValue, '2026-12-30'); assert.equal(cqnu.heldDateCorrection.proposedValue, '2026-12-25');
for (const name of files) assert.equal(sha(readFileSync(path.join(primary, 'content/data/' + name + '.json'))), hashes[name + '.json']);
assert.equal(sha(readFileSync(reportFile)), sha(reportBytes));
const review = { schemaVersion: 1, reviewedAt: new Date().toISOString(), reviewer: 'independent fast_date_inventory agent',
  targetReport: 'quality/deadline-sweep-20261019/official-batch-012/report.json', targetReportSha256: sha(reportBytes),
  decision: 'approved-source-only-audit-with-held-dates', newWebsiteReadsByReviewer: 0, canonicalWrites: 0, publicationApproval: false,
  snapshotSha256: report.snapshotSha256, inputFileSha256: hashes, captureManifestSha256: sha(manifestBytes),
  checks: { exactDistinctRecords: 22, canonicalCycleProgramScholarshipRowHashes: wholeRowHashes,
    sourceHtmlHashes: captures.length, sourceTextHashes: captures.length, rawIntakeDegreeParentScopeMatches: true,
    reportAndSixCanonicalFilesUnchangedDuringReview: true, reusedDateBindings: 6 }, recordOutcomes: outcomes,
  reviewedRecordIds: rows.map(row => row.recordId), newSourcePins: captures, reusedEvidencePins: reused, biptColumnProof,
  findings: [
    { item: 'DLUT two bachelor deadlines', decision: 'Keep both unknown', reason: 'Recommended completion before end of June is not a strict admission cutoff; the scholarship paragraph is a separate deadline scope. OpeningNovember1,2026 may be retained as independently supported evidence.' },
    { item: 'BFSU two ICLT records', decision: 'Keep both conflict', reason: 'School table December30/March2027 conflicts with central October31; school prose also says January2027. Do not infer authority precedence or change dates.' },
    { item: 'CQNU language cycle', decision: 'December25 correction proposal is source-supported; retain held classification and original row', reason: 'CN and EN agree; EN explicitly gives2026. This review does not authorize or implement a canonical change; no supported narrow date consumer is established.' },
    { item: 'BIPT language column', decision: 'December30 language-window binding accepted', reason: biptColumnProof.conclusion },
    { item: 'NJU3 / XMU3 raw cycles', decision: 'Same-day prior date-guide reuse accepted, zero new website reads', reason: 'Exact snapshot/guide hashes, university, own degree, academicYear2027-2028, autumn intake and source URL match. These are self-funded dates, not programme-offering or scholarship approval.' },
    { item: 'Before-date and capacity qualifications', decision: 'Retain all qualifications', reason: 'BLCU beforeJanuary12 and TFSU beforeDecember30 do not prove full-day inclusion; UIBE foundation may close when full. No admission-portal acceptance claim is made.' }
  ], limitations: ['Independent review of stored originals only; no fresh official fetches.', 'No report, canonical, Git, shared progress or deployment state changed.'] };
writeFileSync(path.join(root, 'independent-review-v1.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ decision: review.decision, records: rows.length, wholeRowHashes, outcomes, reviewSha256: sha(readFileSync(path.join(root, 'independent-review-v1.json'))) }, null, 2));
