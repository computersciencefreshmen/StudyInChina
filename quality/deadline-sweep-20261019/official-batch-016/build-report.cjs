const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const selection = read(path.join(root, 'selection.json'));
const captures = read(path.join(root, 'capture-summary.json'));
const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
const receipt = key => captures.find(x => x.key === key);
const sourceText = key => fs.readFileSync(path.join(root, receipt(key).textPath), 'utf8');
const quotePresent = (key, quote) => assert.ok(compact(sourceText(key)).includes(compact(quote)), `Missing original quote: ${key} ${quote}`);
assert.equal(selection.records.length, 14);
assert.equal(selection.baseQueueRecordIds.length, 13);
assert.deepEqual(selection.additionalSameSourceRecordIds, ['cycle-gap-wave3-depth-cugb-geology-master-english-2026-2027-autumn']);
for (const capture of captures) {
  assert.equal(sha(fs.readFileSync(path.join(root, capture.rawPath))), capture.rawSha256);
  assert.equal(sha(fs.readFileSync(path.join(root, capture.textPath))), capture.textSha256);
  assert.equal(fs.readFileSync(path.join(root, capture.rawPath)).length, capture.bytes);
}
assert.equal(captures.length, 9);
assert.equal(captures.filter(x => x.httpStatus === 200 && !x.error).length, 7);
const beforeHashes = Object.fromEntries(Object.keys(selection.inputFileSha256).map(name => [name, sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name)))]));
assert.deepEqual(beforeHashes, selection.inputFileSha256);
assert.equal(sha(JSON.stringify(beforeHashes)), selection.snapshotSha256);
assert.equal(sha(fs.readFileSync(path.join(selection.primaryWorkspace, selection.queuePath))), selection.queueSha256);
const queue = read(path.join(selection.primaryWorkspace, selection.queuePath));
assert.deepEqual(queue.selectedUniversityIds.slice(0, 7), selection.universityIds);
assert.ok(selection.baseQueueRecordIds.every(id => queue.selectedRecordIds.includes(id)));

quotePresent('source-04', 'CAA 2026 Admissions Guide for International Student (Doctoral Program Taught in English)');
quotePresent('source-04', 'The academic programs include Art Studies and Design Studies');
quotePresent('source-04', 'June 20, 2026 (Beijing Time, inclusive).');
quotePresent('source-04', 'Admitted new students should register on time in September 2026.');
quotePresent('source-01', '留学生本科招生简章2026年');
for (const name of ['作曲与作曲技术理论', '音乐表演（指挥）', '音乐教育（声乐特长）']) quotePresent('source-01', name);
quotePresent('source-01', '2026年1月13日——2026年1月20日');
quotePresent('source-09', '下一年度的申请时间和办法另行通知。');
for (const key of ['source-05', 'source-06']) assert.equal(receipt(key).httpStatus, 412);
quotePresent('source-08', '2026 CPU Chinese Government Scholarship "Silk Road" Program Admission Notice');
quotePresent('source-08', 'Application Deadline:17th May 2026');
quotePresent('source-03', 'Beijing for International Students（2026）');
quotePresent('source-03', 'Deadline for Chinese Government Scholarship (Type B)：March 15, 2026');
quotePresent('source-03', 'Deadline for Self-funded student：June 30, 2026');
quotePresent('source-03', 'Table 1. List of undergraduate enrollment programs (Taught in Chinese)');
quotePresent('source-03', 'Computer Science and Technology');
quotePresent('source-03', 'Table 3. List of Disciplines for Postgraduate Enrollment (Taught in English)');
quotePresent('source-03', '0830 Environmental Science and Engineering Master, Doctor');
quotePresent('source-03', '0709 Geology Master, Doctor');
quotePresent('source-07', 'October 16th, 2026 – February 28th, 2027');
quotePresent('source-07', '2027 CUG Chinese Government Scholarship-High Level Postgraduate Program.pdf');
quotePresent('source-07', 'Business Administration');
assert.ok(!sourceText('source-07').includes('February 28th, 2026'));

const fallback = {
  schemaVersion: 1, recordedAt: new Date().toISOString(), method: 'web.open', boundedFallbackNumber: 1,
  results: ['source-05', 'source-06'].map(key => ({ key, url: receipt(key).url,
    result: 'HTTP 412: Precondition Failed', success: false, rawOriginalBytesAvailableFromWebTool: false })),
  timingQualification: 'recordedAt is the transcription time. The web tool did not expose an origin response timestamp.',
  policy: 'One web fallback per failed exact URL; no certificate, challenge or access-control bypass; no further immediate retry.'
};
const fallbackPath = path.join(root, 'cjlu-web-fallback.receipt.json');
if (!fs.existsSync(fallbackPath)) fs.writeFileSync(fallbackPath, JSON.stringify(fallback, null, 2) + '\n', { flag: 'wx' });
const evidence = [
  { key: 'caa-2026-english-doctoral', sourceKeys: ['source-04'],
    scope: '2026 English-taught international doctoral admission. Art Studies is explicitly named in the same article; September2026registration fixes the entry year and intake context.',
    dateQuotes: [{ quote: 'June 20, 2026 (Beijing Time, inclusive).', locator: 'II. Application Deadline', meaning: 'Applicant general admission deadline; inclusive date, no invented clock time.' }],
    programmeQuote: 'The academic programs include Art Studies and Design Studies', excludedDates: 'Passport validity, diploma completion, July result release and September registration are not application deadlines.' },
  { key: 'ccmusic-2026-bachelor', sourceKeys: ['source-01'],
    scope: '2026 international full-time bachelor call, with the three exact named directions on PDFp4 and applicant registration window onp5.',
    dateQuotes: [{ quote: '2026 年 1 月 13 日——2026 年 1 月 20 日', locator: 'PDF p5 二（二）报名方式与时间1', meaning: 'Student registration/application window, not university notification or test scheduling.' }],
    programmeQuotes: ['作曲与作曲技术理论', '音乐表演（指挥）', '音乐教育（声乐特长）'], visualPagesInspected: [4, 5] },
  { key: 'cfau-bgs-no-date', sourceKeys: ['source-09'],
    scope: 'BGS annual application procedure for incoming autumn students and current students. No concrete applicant cutoff is printed.',
    dateQuotes: [{ quote: '下一年度的申请时间和办法另行通知。', locator: '二、BGS奖学金管理规则3', meaning: 'Next-year arrangements require another notice; upload2026-03-10is not an opening or deadline.' }] },
  { key: 'cjlu-two-412-sources', sourceKeys: ['source-05', 'source-06'],
    scope: 'Assigned Business Administration programme-plan and supporting admissions URLs both returned412; no programme text or date was available.',
    dateQuotes: [], fallbackReceipt: 'cjlu-web-fallback.receipt.json', evidenceStatus: 'blocked after one reasonable fallback per URL; retained412bytes are not admission evidence.' },
  { key: 'cpu-2026-silk-road', sourceKeys: ['source-08'],
    scope: 'Exact named2026Chinese Government Scholarship Silk Road award at CPU, applicant CPU-platform stage.',
    dateQuotes: [{ quote: 'Application Deadline: 17th May 2026', locator: 'Part.01 When and Where to Apply', meaning: 'Applicant deadline; later CPU reviewMay18-20, nominated-student CSC stage, July release and September enrolment are distinct actions.' }],
    openingQualification: 'From now until is relative; no numeric opening date is inferred.' },
  { key: 'cugb-2026-source-with-funding-branches', sourceKeys: ['source-03', 'source-02'],
    scope: 'Original2026guide. PDFp5 separates CSCTypeA, CSCTypeB and self-funded applicant deadlines. The portal supports discovery, not date proof.',
    dateQuotes: [{ quote: 'Deadline for Chinese Government Scholarship (Type B)：March 15, 2026', locator: 'PDF p5 Time for Application2', meaning: 'CSCTypeB only.' }, { quote: 'Deadline for Self-funded student：June 30, 2026', locator: 'PDF p5 Time for Application3', meaning: 'Self-funded applicants only.' }, { quote: 'Deadline for Chinese Government Scholarship (Type A)：Refer to the Chinese Embassy in your country', locator: 'PDF p5 Time for Application1', meaning: 'No university-wideTypeAcalendar cutoff is asserted.' }],
    programmeScope: 'Chinese bachelor table onp8-9includes ComputerScience080901and Geology0709. English postgraduate Table3onp10-11includes Geology0709Master,Doctor and EnvironmentalScienceandEngineering0830Master,Doctor. Table4onp11visually confirms Geology English-master eligibility.',
    visualPagesInspected: [5, 11], feeReferenceQualification: 'The new English-doctoral fee-reference row has no funding branch. It remains unknown with separate route-specific candidates instead of being assigned a universalJune30date.' },
  { key: 'cug-wuhan-source-now-2027', sourceKeys: ['source-07'],
    scope: 'The mutable canonical URL now publishes the2027high-level postgraduate scholarship window. Both assigned records belong to the2026route.',
    dateQuotes: [{ quote: 'October 16th, 2026 – February 28th, 2027', locator: 'IX. Application Period', meaning: 'Successor2027applicant window only; not evidence for a2026deadline.' }],
    yearContextQuote: '2027 CUG Chinese Government Scholarship-High Level Postgraduate Program.pdf',
    programmeQuote: 'Business Administration',
    yearBindingResult: 'different-year-source-currently-replaced; no date roll-forward and no old2026deadline recertification.' }
];
const groups = [];
function add(key, ids, assess) {
  const ev = evidence.find(e => e.key === key);
  const records = ids.map(id => {
    const s = selection.records.find(x => x.recordId === id), row = s.row;
    const pins = s.sources.filter(x => ev.sourceKeys.some(k => receipt(k).url === x.row.url)).map(x => ({ sourceId: x.row.id, canonicalSourceSha256: x.sha256, url: x.row.url, official: x.row.official,
      role: x.row.url.endsWith('/admission/') ? 'supporting-portal-not-date-proof' : 'official-original-or-attempt' }));
    assert.ok(pins.length && pins.every(x => x.official));
    const result = assess(s);
    if (result.result === 'closed') assert.ok(result.officialDeadline < '2026-10-19');
    else assert.equal(result.officialDeadline, null);
    return { collection: s.collection, recordId: id, universityId: s.universityId, programId: s.program?.id ?? null,
      programNameZh: s.program?.name.zh ?? row.name.zh, degreeLevel: s.program?.degreeLevel ?? null,
      academicYear: row.academicYear ?? null, intake: row.intake ?? null,
      selectionScope: s.additionalSameSourceBinding ? 'additionalSameSource1' : 'baseQueue13',
      storedOpensOn: row.opensOn ?? null, storedDeadline: s.collection === 'admissionCycles' ? row.closesOn : row.deadline,
      storedDateStatus: row.dateStatus ?? null, storedStatus: row.status, storedVerifiedAt: row.verifiedAt, storedReviewAfter: row.reviewAfter,
      canonicalRowSha256: s.canonicalRecordSha256,
      ...(s.collection === 'admissionCycles' ? { canonicalCycleSha256: s.canonicalRecordSha256, canonicalProgramSha256: s.canonicalProgramSha256 } : { canonicalScholarshipSha256: s.canonicalRecordSha256 }),
      sourceIds: row.sourceIds, evidenceSourcePins: pins, evidenceKey: key,
      officialOpensOn: null, candidateOfficialDeadline: null, candidateOnly: true, dateOnly: true,
      fullFactsCertified: false, freshnessRenewed: false, canonicalWritePerformed: false,
      programmeDiscontinuedConfirmed: false, openingDateEqualityCertified: false,
      rawRecordPreservedIn: 'selection.json', requiresIndependentApprovalAndCasBeforeCanonicalDateChange: true, ...result };
  });
  groups.push({ key, universityId: records[0].universityId, evidenceKey: key, records });
}
const idsFor = school => selection.records.filter(x => x.universityId === school).map(x => x.recordId);
add('caa-2026-english-doctoral', idsFor(selection.universityIds[0]), () => ({ result: 'closed', officialDeadline: '2026-06-20', candidateOfficialDeadline: '2026-06-20',
  applicableEntryYear: 2026, applicationScope: 'English-taught ArtStudiesdoctoral applicant, September2026entry', deadlineBoundary: 'inclusive-date-as-worded', officialTimeZone: 'Asia/Shanghai', exactCutoffTime: null,
  reason: 'Exact programme, degree, English-batch, entry year and applicant deadline match in the same full guide; canonical null retained.' }));
add('ccmusic-2026-bachelor', idsFor(selection.universityIds[1]), s => ({ result: 'closed', officialDeadline: '2026-01-20', candidateOfficialDeadline: '2026-01-20',
  candidateOfficialOpensOn: '2026-01-13', openingDateResult: 'new-candidate-canonical-null-retained', applicableEntryYear: 2026,
  programmeScopeMatch: { originalChineseName: s.program.name.zh, degree: 'bachelor', originalCataloguePage: 4 },
  deadlineBoundary: 'date-only-no-time-stated', applicationScope: '2026international bachelor applicant registration',
  reason: 'Exact programme direction is listed onp4and2026applicant window onp5. The fee-reference row is not bound by year alone.' }));
add('cfau-bgs-no-date', idsFor(selection.universityIds[2]), () => ({ result: 'unknown', officialDeadline: null,
  reason: 'The annual BGS procedure has no concrete applicant cutoff;2026upload date is not an application window and next-year timing is separately notified.' }));
add('cjlu-two-412-sources', idsFor(selection.universityIds[3]), () => ({ result: 'blocked', officialDeadline: null, sourceFailureKeys: ['source-05', 'source-06'],
  reason: 'Both exact official sources returned412and one bounded web fallback each also returned412; programme/date text cannot be certified.' }));
add('cpu-2026-silk-road', idsFor(selection.universityIds[4]), () => ({ result: 'closed', officialDeadline: '2026-05-17', candidateOfficialDeadline: '2026-05-17', applicableEntryYear: 2026,
  deadlineBoundary: 'date-only-no-time-stated', applicationScope: '2026SilkRoadaward applicant submission to CPUplatform, not later university review or nominated-student CSC stage',
  reason: 'Exact named2026award and applicant cutoff match the original notice; canonical null retained.' }));
const cugb = idsFor(selection.universityIds[5]);
add('cugb-2026-source-with-funding-branches', cugb.filter(id => id.includes('doctorate')), () => ({ result: 'unknown', officialDeadline: null,
  candidateDeadlinesByFundingRoute: [{ route: 'self-funded', deadline: '2026-06-30', explicitApplicantDeadline: true }, { route: 'CSCTypeB', deadline: '2026-03-15', explicitApplicantDeadline: true }, { route: 'CSCTypeA', deadline: null, reason: 'home-countryChineseEmbassy controls deadline' }],
  exactProgrammeDegreeYearMatched: true, matchedDisciplineCode: '0830', matchedCatalogueScope: 'English-taught postgraduate, MasterandDoctor, PDFTable3p10-11', fundingRouteOfStoredRecordResolved: false,
  reason: 'English doctoral discipline and2026year match, but this null fee-reference row does not specify a funding branch. Neither scoped date is promoted to a universal programme deadline.' }));
add('cugb-2026-source-with-funding-branches', cugb.filter(id => id.startsWith('sch-')), () => ({ result: 'closed', officialDeadline: '2026-03-15', candidateOfficialDeadline: '2026-03-15', applicableEntryYear: 2026,
  deadlineBoundary: 'date-only-no-time-stated', applicationScope: 'Exact named2026CSCTypeBaward applicant deadline; notTypeAor self-funded admission',
  reason: 'The exact award route and2026TypeBcutoff are explicit in originalPDFp5. Canonical null retained.' }));
add('cugb-2026-source-with-funding-branches', cugb.filter(id => id.startsWith('cycle-') && !id.includes('doctorate')), s => ({ result: 'closed', officialDeadline: '2026-06-30', candidateOfficialDeadline: '2026-06-30', applicableEntryYear: 2026,
  storedDeadlineMatchesScopedOfficialDay: true, applicationScope: '2026self-funded student admission only; matching existing storedJune30day is not a universal scholarship deadline', deadlineBoundary: 'date-only-no-time-stated',
  programmeScopeMatch: s.program.degreeLevel === 'master' ? { disciplineCode: '0709', originalName: 'Geology', degree: 'master', language: 'English', evidence: 'PDFTable3p10andTable4p11English-mastercheckmark', visuallyChecked: true } : { originalName: s.program.name.en.replace(' (Bachelor)', ''), degree: 'bachelor', language: 'Chinese', evidence: 'PDFTable1p8-9' },
  otherFundingBranchesNotReassigned: true,
  reason: 'Exact programme, degree, language and2026guide match. Existing storedJune30corresponds to the self-funded branch; retain its scope and do not substitute CSCdates.' }));
add('cug-wuhan-source-now-2027', idsFor(selection.universityIds[6]), s => ({ result: 'unknown', officialDeadline: null,
  storedRouteYear: 2026, currentSourceRouteYear: 2027, currentSourceMatchesStoredYear: false,
  oldStoredDeadlineRevalidated: false,
  successorWindowCandidate: { applicableEntryYear: 2027, opensOn: '2026-10-16', deadline: '2027-02-28', candidateOnly: true, appliesToStoredRecord: false,
    sourceQuote: 'October 16th, 2026 – February 28th, 2027', attachmentYearContext: '2027 CUG Chinese Government Scholarship-High Level Postgraduate Program.pdf' },
  storedWindowContext: s.collection === 'admissionCycles' ? 'Stored2026-02-28isalreadyexpiredbutnotnewlyreconfirmedfromthisreplacedsource.' : 'Storedawardnameis2026anddeadlineisnull;source2027cannotcertifyit.',
  publicationRiskFlags: ['Mutable source URL now has a different admission year.', 'Do not roll the old2026row to the2027successor or renew its freshness.'],
  reason: 'Current original explicitly describes the2027successor, although the canonical source metadata still labels2026. Need an authentic2026original to recheck the assigned old route.' }));

const records = groups.flatMap(g => g.records);
assert.equal(records.length, 14);
assert.equal(new Set(records.map(x => x.recordId)).size, 14);
assert.deepEqual(new Set(records.map(x => x.recordId)), new Set(selection.records.map(x => x.recordId)));
const counts = records.reduce((out, row) => (out[row.result] = (out[row.result] || 0) + 1, out), {});
assert.deepEqual(counts, { closed: 9, unknown: 4, blocked: 1 });
for (const record of selection.records) {
  assert.equal(sha(JSON.stringify(record.row)), record.canonicalRecordSha256);
  if (record.program) assert.equal(sha(JSON.stringify(record.program)), record.canonicalProgramSha256);
  for (const source of record.sources) assert.equal(sha(JSON.stringify(source.row)), source.sha256);
}
for (const name of Object.keys(beforeHashes)) assert.equal(sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name))), beforeHashes[name]);
const report = { schemaVersion: 1, batchId: selection.batchId, auditDate: '2026-10-19', timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  state: 'completed-candidates-with-successor-year-source-drift-and-one-source-block', snapshotSha256: selection.snapshotSha256, inputFileSha256: beforeHashes,
  targetPlan: selection.queuePath, targetPlanSha256: selection.queueSha256, selectionSha256: sha(fs.readFileSync(path.join(root, 'selection.json'))),
  selection: { baseQueueRecordCount: 13, additionalSameSourceRecordCount: 1, totalExactRecords: 14, universityIds: selection.universityIds,
    baseQueueRecordIds: selection.baseQueueRecordIds, additionalSameSourceRecordIds: selection.additionalSameSourceRecordIds,
    additionalBindingScope: 'Explicit parent assignment before freeze; no new fetch. Original2026GeologyEnglish-mastertable independently checked, includingTable4English-mastercheckmark.' },
  acquisition: { newDistinctOfficialUrlsAttempted: 9, originalGets: 9, successfulOriginalUrls: 7, source412OriginalsRetained: 2, boundedWebFallbackAttempts: 2,
    totalNetworkAttempts: 11, successfulFallbackSources: 0, automaticallyRepeatedRequests: 0, paidModelCalls: 0, certificateOrChallengeBypasses: 0,
    successfulOriginalSchools: 6, successfulSourcesApplicableToAssigned2026HardDates: 4 },
  sourceCaptures: captures, fallbackReceipt: { path: 'cjlu-web-fallback.receipt.json', sha256: sha(fs.readFileSync(fallbackPath)) },
  evidence, groups,
  summary: { schoolsAttempted: 7, recordsAssessed: 14, baseQueueRecords: 13, additionalSameSourceRecords: 1, recordResults: counts,
    newExactExpiredDeadlineCandidatesFromCanonicalNull: 6, existingExpiredDeadlinesScoped: 3, newOpeningDateCandidatesFromCanonicalNull: 3,
    recordsWithDifferentCurrentSourceYear: 2, unresolvedFundingRouteRecord: 1, unknownDatesNotClosedByInference: 4,
    canonicalWrites: 0, freshnessRenewals: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0, gitMutations: 0, sharedStateWrites: 0, publicationActions: 0 },
  cooldowns: [{ universityId: selection.universityIds[3], sourceKeys: ['source-05', 'source-06'], reason: 'Both originals and one bounded fallback each returned412.', immediateRetryAllowed: false,
    retryCondition: 'Changed official source/network condition or an explicit later bounded recovery window.' }],
  publicationRiskFlags: [
    'CUGWuhan same URL now carries2027dates; never copy those into either assigned2026record.',
    'CUGBTypeBMarch15, self-fundedJune30and embassy-controlledTypeAdeadlines are distinct. The new generic doctoral fee-reference row remains unknown.',
    'ExistingCUGBJune30programme days are checked only within self-funded scope. Full-factstatus and other funding branches are not renewed.',
    'Closed means this dated application window expired, not that the degree programme was discontinued.',
    'All candidate dates require narrow independent approval and compare-and-swap before any canonical consumption.'
  ],
  validation: { exactSelectedBaseAndAdditionalIds: 14, uniqueRecordIds: 14, recordsStoredOnlyUnderGroupsRecords: true, rawAndTextShaVerified: true,
    canonicalSixFileHashesUnchangedBeforeAfter: true, originalDateAndProgrammeQuotesChecked: true, pdfDatesAndCatalogueVisuallyInspected: true,
    nullCanonicalFieldsPreserved: true, noYearRolledForward: true, noFullFactFreshnessRenewal: true }
};
const file = path.join(root, 'report.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const completion = { schemaVersion: 1, batchId: selection.batchId, completedAt: report.completedAt, snapshotSha256: selection.snapshotSha256, reportSha256: sha(fs.readFileSync(file)), summary: report.summary };
fs.writeFileSync(path.join(root, 'completion.json'), JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'README.md'), `# Official date-only batch 016\n\nSeven schools, base queue13records plus one explicitly assigned same-source binding:14exact records total. There are9closed candidate scopes,4unknown and1blocked. All canonical fields and freshness remain unchanged.\n\nImportant findings: the CUGWuhan mutable source now describes the2027successor window (2026-10-16to2027-02-28), so it cannot revalidate either old2026record. CUGB funding routes differ: TypeB2026-03-15, self-funded2026-06-30, TypeAembassy-controlled. The unlabelled doctoral fee-reference record remains unknown with route-specific candidates. The additional English Geology master is supported by exact2026degree/language tables, including the English-master checkmark; its existingJune30day is scoped to self-funded admission.\n\nNine exactGETs yielded7successful originals and2retained412responses. One web fallback perCJLUURLalso failed; cooldown is retained. PDF date and programme table pages were extracted and visually checked.\n\nOriginal records and source/program pins: selection.json. Each assessed record appears once in report.json under groups[].records[]. Report SHA256: ${completion.reportSha256}\n`, { flag: 'wx' });
console.log(JSON.stringify(completion, null, 2));
