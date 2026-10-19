/* Compact offline independent review; writes only its new review receipt. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const dir = __dirname, primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex'), read = (p) => JSON.parse(fs.readFileSync(p, 'utf8')), compact = (s) => s.normalize('NFKC').replace(/\s+/gu, '');
const rb = fs.readFileSync(path.join(dir, 'report.json')), report = JSON.parse(rb), sb = fs.readFileSync(path.join(dir, 'selection.json')), sel = JSON.parse(sb);
const records = report.groups.flatMap((g) => g.records), checks = [], programPins = new Map(), sourcePins = new Map();
function check(id, fn, detail) { try { fn(); checks.push({ id, passed: true, ...(detail ? { detail } : {}) }); } catch (e) { checks.push({ id, passed: false, error: String(e) }); } }
const tables = Object.fromEntries(['admission-cycles', 'scholarships', 'programs', 'sources'].map((n) => [n, new Map(read(path.join(primary, 'content/data', n + '.json')).map((r) => [r.id, r]))]));
check('frozen-report-selection-six-inputs-and-inventory', () => {
  assert.equal(sha(rb), 'b7675df7e02f1868f6f35050905d3be4e0b4f014ebd1256dff21a2612120fd2f'); assert.equal(sha(sb), report.selection.sha256);
  for (const [f, expected] of Object.entries(sel.inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(primary, 'content/data', f))), expected);
  const ib = fs.readFileSync(path.join(primary, sel.inventoryPath)); assert.equal(sha(ib), report.inventorySha256); assert.equal(JSON.parse(ib).snapshotSha256, report.snapshotSha256);
});
check('exact-base11-plus-root-additional8', () => {
  const qb = fs.readFileSync(path.join(primary, sel.queuePath)), q = JSON.parse(qb); assert.equal(sha(qb), report.targetQueueSha256); assert.equal(sha(qb), sel.queueSha256);
  assert.deepEqual(q.selectedUniversityIds.slice(0, 5), sel.universityIds); assert.equal(sel.baseQueueRecordIds.length, 11); assert.equal(sel.additionalSameSourceRecordIds.length, 8);
  const ids = [...sel.baseQueueRecordIds, ...sel.additionalSameSourceRecordIds]; assert.equal(records.length, 19); assert.equal(new Set(ids).size, 19); assert.deepEqual(records.map((r) => r.recordId).sort(), [...ids].sort());
  assert.ok(sel.baseQueueRecordIds.every((id) => q.selectedRecordIds.includes(id)));
  const eb = fs.readFileSync(path.resolve(dir, '../heartbeat-0806/additional-same-source-selection-v1.json')), extra = JSON.parse(eb); assert.equal(sha(eb), sel.additionalSelectionReceiptSha256); assert.equal(extra.baseQueueSha256, sel.queueSha256);
  for (const id of sel.additionalSameSourceRecordIds) assert.ok(extra.extraRecords.some((e) => e.recordId === id && e.canonicalRecordSha256 === sel.records.find((r) => r.recordId === id).canonicalRecordSha256));
});
check('all-canonical-record-parent-and-source-pins', () => {
  for (const r of records) {
    const s = sel.records.find((v) => v.recordId === r.recordId), original = tables[s.collection === 'admissionCycles' ? 'admission-cycles' : 'scholarships'].get(r.recordId);
    assert.deepEqual(s.row, original); assert.equal(sha(JSON.stringify(original)), r.canonicalRecordSha256); assert.equal(r.storedDeadline, original.closesOn ?? original.deadline ?? null);
    for (const p of s.programRows) { assert.deepEqual(p.row, tables.programs.get(p.row.id)); assert.equal(sha(JSON.stringify(p.row)), p.canonicalProgramSha256); programPins.set(p.row.id, p.canonicalProgramSha256); }
    assert.deepEqual(r.canonicalProgramPins, s.programRows.map((p) => ({ programId: p.row.id, canonicalProgramSha256: p.canonicalProgramSha256 })));
    if (original.programId) { assert.equal(tables.programs.get(original.programId).universityId, r.universityId); assert.equal(original.academicYear, r.academicYear); assert.equal(original.intake, r.intake); } else assert.ok(original.universityIds.includes(r.universityId));
    for (const z of s.sources) { assert.deepEqual(z.row, tables.sources.get(z.row.id)); assert.equal(sha(JSON.stringify(z.row)), z.canonicalSourceSha256); assert.equal(z.row.official, true); sourcePins.set(z.row.id, z.canonicalSourceSha256); }
    for (const z of r.sourcePins) { assert.deepEqual(z.sourceFullRecord, tables.sources.get(z.sourceId)); assert.equal(z.canonicalSourceSha256, sourcePins.get(z.sourceId)); }
  }
});
const captures = [...read(path.join(dir, 'capture-summary.json')), ...read(path.join(dir, 'fallback-manifest.json'))], rawPins = [];
check('five-raw-originals-text-hashes-and-observation-times', () => {
  for (const e of captures) {
    assert.ok(e.observedAt.startsWith('2026-10-19'));
    if (!e.rawPath) continue;
    assert.equal(sha(fs.readFileSync(path.join(dir, e.rawPath))), e.rawSha256); assert.equal(sha(fs.readFileSync(path.join(dir, e.textPath))), e.textSha256);
    rawPins.push({ path: e.rawPath, sha256: e.rawSha256, observedAt: e.observedAt });
  }
  assert.equal(rawPins.length, 5);
  for (const g of report.groups) for (const e of g.evidence) { const c = captures.find((v) => v.key === e.key); assert.ok(c); assert.equal(e.url, c.url); assert.equal(e.observedAt, c.observedAt); if (e.rawPath) assert.equal(e.rawSha256, c.rawSha256); }
});
check('positive-date-and-exact-programme-quotes-in-original-bodies', () => {
  for (const g of report.groups) {
    const texts = g.evidence.filter((e) => e.textPath).map((e) => fs.readFileSync(path.join(dir, e.textPath), 'utf8'));
    for (const q of [g.quotedDate, g.exclusiveChineseEducationRoute, ...g.records.flatMap((r) => [r.quotedDate, r.exactProgrammeQuote])].filter(Boolean)) assert.ok(texts.some((t) => compact(t).includes(compact(q))), 'Positive quote missing: ' + q);
  }
}, 'Positive source clauses verified, not whole-page keyword-absence assumptions.');
check('jnu-rowspan-language-degree-duration-bindings', () => {
  const html = fs.readFileSync(path.join(dir, 'source-06.html'), 'utf8');
  const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((m) => m[0]).find((t) => t.includes('International School') && t.includes('Teaching Chinese to Speakers of Other Language'));
  assert.ok(table);
  const grid = [], carry = new Map();
  for (const tr of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells = [];
    for (const [i, c] of [...carry]) { cells[i] = c.text; if (c.remaining === 1) carry.delete(i); else c.remaining--; }
    let col = 0;
    for (const m of tr[0].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      while (cells[col] !== undefined) col++;
      const value = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(), rs = Number(/rowspan="(\d+)"/i.exec(m[2])?.[1] || 1), cs = Number(/colspan="(\d+)"/i.exec(m[2])?.[1] || 1);
      for (let j = 0; j < cs; j++) { cells[col + j] = value; if (rs > 1) carry.set(col + j, { text: value, remaining: rs - 1 }); } col += cs;
    }
    grid.push(cells);
  }
  for (const id of sel.additionalSameSourceRecordIds) {
    const r = records.find((r) => r.recordId === id), p = tables.programs.get(r.programId), matched = grid.find((cells) => cells[0]?.includes('Teaching in English') && cells[1]?.replace(/^\*\s*/, '') === r.exactProgrammeQuote);
    assert.ok(matched, id); assert.equal(p.degreeLevel, 'bachelor'); assert.ok(p.teachingLanguages.includes('English')); assert.equal(Number(matched[2]) * 12, p.durationMonths);
  }
}, 'Original HTML rowspans independently expanded: English Panyu6 + Shipai2; ClinicalMedicine6years, other seven4years. CLLC ChineseLanguage/TCSOL remain college-specific.');
check('jnu-two-applicant-windows-route-restrictions-and-award-separation', () => {
  const g = report.groups.find((g) => g.universityId === 'uni-jinan-university'), closed = g.records.filter((r) => r.result === 'closed'); assert.equal(closed.length, 10);
  assert.deepEqual(g.sourceWindows.map((w) => [w.opensOn, w.closesOn]), [['2026-01-15', '2026-02-28'], ['2026-04-01', '2026-05-31']]); assert.equal(g.continuousWindowNotInferred, true);
  for (const r of closed) { assert.equal(r.officialDeadline, '2026-05-31'); assert.equal(r.storedDeadline, '2026-05-31'); assert.equal(r.academicYear, '2026-2027'); }
  const exclusive = g.records.find((r) => r.recordId.includes('chinese-culture-education')); assert.equal(exclusive.result, 'unknown'); assert.equal(exclusive.officialDeadline, null); assert.equal(exclusive.candidateBindingState, 'general-review-route-date-not-bound-to-exclusive-scholarship-route');
  const award = g.records.find((r) => r.collection === 'scholarships'); assert.equal(award.result, 'unknown'); assert.equal(award.officialDeadline, null);
}, 'Online applicant registration is not institutional review; March gap retained. Joint-exam registration/exams and Aug15 diploma supplement separate. Exclusive ChineseLanguageEducation route needs own brochure; Guangdong award does not borrow May31.');
check('hlju2027-homepage-hubu-failures-jufe-shells-jlu-typea', () => {
  const school = (u) => report.groups.find((g) => g.universityId === 'uni-' + u);
  assert.ok(school('heilongjiang-university').records.every((r) => r.result === 'unknown' && r.academicYear === '2027-2028' && r.officialDeadline === null));
  assert.ok(school('hubei-university').records.every((r) => r.result === 'blocked' && r.cooldown));
  assert.ok(school('jiangxi-university-of-finance-and-economics').records.every((r) => r.result === 'unknown'));
  assert.ok(school('jilin-university').records.every((r) => r.result === 'unknown' && r.dispatchAuthorityDeterminesExactPeriod));
}, '2026 homepage news do not support2027. HUBU one native+normalTLS failure preserved without revocation bypass. JUFE directory200 is not full award-date evidence. JLU TypeA generally earlyJan–April is home-country dispatch scope, no exact fixed day or TypeB borrowing.');
check('candidate-only-counts-no-canonical-or-freshness-change', () => {
  assert.deepEqual(records.reduce((o, r) => ({ ...o, [r.result]: (o[r.result] || 0) + 1 }), {}), { unknown: 6, blocked: 3, closed: 10 });
  for (const r of records) { assert.ok(r.candidateOnly && r.dateOnly); assert.ok(!r.canonicalWritePerformed && !r.canonicalDateChanged && !r.freshnessRenewed && !r.openingDateAssessed && !r.fullFactsCertified && !r.wholeSchoolCatalogueCompleted); if (r.result !== 'closed') assert.equal(r.officialDeadline, null); }
});
check('exact-id-no-overlap-and-input-report-preservation', () => {
  const ids = new Set(records.map((r) => r.recordId)); let duplicate = false;
  function scan(o) { if (!o || typeof o !== 'object') return; if (typeof o.recordId === 'string' && ids.has(o.recordId)) duplicate = true; Object.values(o).forEach(scan); }
  for (const n of fs.readdirSync(path.dirname(dir)).filter((n) => /^official-batch-\d+$/.test(n) && n !== path.basename(dir))) { const p = path.join(path.dirname(dir), n, 'report.json'); if (fs.existsSync(p)) scan(read(p)); }
  assert.equal(duplicate, false); assert.equal(sha(fs.readFileSync(path.join(dir, 'report.json'))), sha(rb));
  for (const [f, expected] of Object.entries(sel.inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(primary, 'content/data', f))), expected);
});
const failed = checks.filter((c) => !c.passed).length;
const review = {
  schemaVersion: 1, reviewId: 'official-batch-025-independent-review-v1', reviewedAt: new Date().toISOString(), reviewer: '/root/fast_date_inventory', result: failed ? 'source-only-review-failed' : 'source-only-pass',
  reviewedReportSha256: sha(rb), reviewedSelectionSha256: sha(sb), inventorySha256: report.inventorySha256, queueSha256: sel.queueSha256, additionalSelectionReceiptSha256: sel.additionalSelectionReceiptSha256, snapshotSha256: report.snapshotSha256, inputFileSha256: report.inputFileSha256,
  summary: { exactRecords: 19, baseQueueRecords: 11, additionalSameSourceRecords: 8, schools: 5, recordResults: { closed: 10, unknown: 6, blocked: 3 }, checksPassed: checks.length - failed, checksFailed: failed, programmeRowsPinned: programPins.size, registeredSourcesPinned: sourcePins.size, rawOriginalBodiesPinned: 5, newWebsiteReads: 0, canonicalWrites: 0, sharedStateWrites: 0, freshnessWrites: 0, gitMutations: 0 },
  scope: 'Only these19 source-date observations with their funding/route/year limitations. No canonical mutation approval, publication, current open-window claim, full-fact programme certification or whole-school freshness renewal. Frozen selection retains complete canonical records, parents and registered-source rows.',
  canonicalRecordPins: Object.fromEntries(records.map((r) => [r.recordId, r.canonicalRecordSha256])), canonicalProgrammeBindingSetSha256: sha(JSON.stringify([...programPins].sort())), canonicalRegisteredSourceBindingSetSha256: sha(JSON.stringify([...sourcePins].sort())), rawOriginalPins: rawPins,
  failureManifestPin: { path: 'fallback-manifest.json', sha256: sha(fs.readFileSync(path.join(dir, 'fallback-manifest.json'))) }, checks, checksScript: 'independent-review-checks.cjs', checksScriptSha256: sha(fs.readFileSync(__filename)),
};
const body = JSON.stringify(review, null, 2) + '\n'; assert.ok(Buffer.byteLength(body) < 12000);
const output = path.join(dir, 'independent-review-v1.json'); fs.writeFileSync(output, body, { flag: 'wx' });
console.log(JSON.stringify({ path: output, sha256: sha(body), bytes: Buffer.byteLength(body), result: review.result, checksFailed: failed, failures: checks.filter((c) => !c.passed) })); if (failed) process.exitCode = 1;
