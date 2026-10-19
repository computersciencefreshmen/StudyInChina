const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const root = __dirname;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const selection = read(path.join(root, 'selection.json'));
const captures = read(path.join(root, 'capture-summary.json'));
const compact = t => t.normalize('NFKC').replace(/\s+/gu, '');
const text = n => fs.readFileSync(path.join(root, `source-${n}.txt`), 'utf8');
const receipt = n => captures.find(r => r.key === `source-${n}`);
const assertText = (n, quote) => assert.ok(compact(text(n)).includes(compact(quote)), `Missing original quote ${n}: ${quote}`);
for (const r of captures) {
  assert.equal(sha(fs.readFileSync(path.join(root, r.rawPath))), r.rawSha256);
  assert.equal(sha(fs.readFileSync(path.join(root, r.textPath))), r.textSha256);
  assert.equal(fs.readFileSync(path.join(root, r.rawPath)).length, r.bytes);
}
assert.equal(captures.length, 11);
assert.equal(captures.filter(r => r.httpStatus === 200 && !r.error).length, 10);
assert.equal(receipt('08').httpStatus, 404);
const inputFileSha256 = Object.fromEntries(Object.keys(selection.inputFileSha256).map(name => [name, sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name)))]));
assert.deepEqual(inputFileSha256, selection.inputFileSha256);
assert.equal(sha(JSON.stringify(inputFileSha256)), selection.snapshotSha256);
assert.equal(sha(fs.readFileSync(path.join(selection.primaryWorkspace, selection.queuePath))), selection.queueSha256);
const queue = read(path.join(selection.primaryWorkspace, selection.queuePath));
assert.deepEqual(queue.selectedUniversityIds.slice(0, 7), selection.universityIds);
assert.equal(selection.records.length, 27);

const a = '为保证申请人顺利完成中国政府奖学金申请流程，建议在2026年2月25日（含）前完成留基委系统网上报名';
assertText('05', a);
assertText('05', '2026/2027学年高水平研究生项目招生简章');
assertText('05', '2026年来华留学硕士研究生可招生专业');
assertText('05', '2026年来华留学博士研究生可招生专业');
assertText('05', '100217麻醉学');
assertText('05', '1007Z1临床药学');
assertText('03', 'The Deadline for application of degree programs is May 15th. All the degree programs start in September.');
assert.ok(!/202[4-7]/.test(text('03')), 'AHU body has no applicable calendar year');
assertText('04', '2026-2027');
assertText('04', 'School of Forestry Forestry');
assertText('04', 'International Economics and Trade');
assertText('04', 'Landscape Architecture B. Eng.');
assertText('04', 'APPLICATION DEADLINE 申请截止日期 June 15, 2026 2026年6月15日');
assertText('04', 'Beijing Government Scholarship (BGS) - Application Deadline: June 8, 2026');
assertText('01', '2026 International Students Admission Book');
assertText('01', 'English taught programs');
assertText('01', 'Aeronautical and Astronautical Engineering');
assertText('01', 'Automation');
assertText('01', 'Electronics Science and Technology');
assertText('01', 'International Economics and Trade');
assertText('01', 'Application Deadline: June 1, 2026');
assertText('07', '开放报名时间：2024年3月1日至5月31日（秋季学期）、2024年9月1日至11月30日（春季学期）');
assertText('10', '2024/2025学年度中国政府奖学金');
assertText('10', '时间：即日至2023年12月20日（北京时间）');
assertText('10', '时间2024年1月5日至2024年1月15日（北京时间）');
assertText('06', '注：每年的申请时间略有不同');
assertText('06', '秋季学期一般从9月1日开始，1月15日结束，报名时间不晚于7月15日');
assertText('06', '4月10日前将申请材料寄至北京交通大学');
const sportAutumn = '秋季入学（9月入学）：2025年12月1日至2026年6月1日申请。';
assertText('09', sportAutumn);
assertText('09', '汉语进修生项目');
assertText('09', '武术类及中医养生类进修项目');
assertText('09', '攻读专业型硕士学位（国际中文教育专业）的国际学生学习年限为2年');
const sportCsc = '申请人须在2026年3月1日之前登陆北京体育大学外事服务系统';
assertText('11', sportCsc);
assertText('11', '北京体育大学2026年中国政府奖学金');

const fallback = {
  schemaVersion: 1, sourceKey: 'source-08', url: receipt('08').url,
  method: 'web.open', attempt: 2, recordedAt: new Date().toISOString(),
  toolResult: 'URL https://admission.bisu.edu.cn/attach/0/2411071706042027427.pdf is not accessible via this tool.',
  result: 'blocked', rawOriginalBytesRetained: false, newDateEvidence: false,
  timingQualification: 'recordedAt is when the tool failure was transcribed; web tool did not expose a source response timestamp.',
  retryPolicy: 'One bounded fallback exhausted. No immediate retry; await changed source or a due later recovery window.'
};
const fallbackPath = path.join(root, 'source-08.web-fallback-receipt.json');
if (!fs.existsSync(fallbackPath)) fs.writeFileSync(fallbackPath, JSON.stringify(fallback, null, 2) + '\n', { flag: 'wx' });

const evidence = [
  { key: 'ahmu-soft-recommendation', sourceKeys: ['source-05'], title: '安徽医科大学2026/2027学年高水平研究生项目招生简章',
    quotes: [{ quote: a, locator: '七、注意事项1', interpretation: 'Suggested inclusive submission target; not a mandatory hard deadline.' }, { quote: '报到时间为：2026年9月初，具体时间以《录取通知书》为准。', locator: '六、入学报到1', interpretation: 'Entry date context, not an application deadline.' }],
    scope: 'CSC Type B high-level postgraduate route; own2026 master table includes100217麻醉学 and own doctoral table includes1007Z1临床药学. The other-intake duplicate is not reclassified as autumn.' },
  { key: 'ahu-undated-general-brochure', sourceKeys: ['source-02', 'source-03'], title: 'Anhui University international admission brochure and undergraduate major list',
    quotes: [{ quote: 'The Deadline for application of degree programs is May 15th.', locator: 'source-03 PDF p4 Note2', interpretation: 'Annual month/day only; no admission year is printed on the visual cover or extracted body.' }],
    scope: 'Four bachelor fee-reference records retain unknown date. CSCA language or current download URL does not establish the applicable intake year.' },
  { key: 'bjfu-2026-undergraduate', sourceKeys: ['source-04'], title: 'Beijing Forestry University2026 Undergraduate International Prospectus',
    quotes: [{ quote: '2026-2027', locator: 'PDF p4 and p6 programme catalogues', interpretation: 'Explicit academic year.' }, { quote: 'APPLICATION DEADLINE 申请截止日期 June 15, 2026 2026年6月15日', locator: 'PDF p7, visually inspected', interpretation: 'Student undergraduate admission deadline; not the scholarship date.' }],
    scope: 'Same original full2026 admissions prospectus names Forestry, International Economics and Trade and Landscape Architecture in its2026-2027 catalogue. Date binding is based on exact degree/programme/year/source, not fee-reference naming alone.' },
  { key: 'bjfu-2026-bgs', sourceKeys: ['source-04'], title: 'Beijing Government Scholarship at BFU2026',
    quotes: [{ quote: 'Beijing Government Scholarship (BGS) - Application Deadline: June 8, 2026', locator: 'PDF p8, visually inspected', interpretation: 'BGS student application cutoff. CGS Type A instead depends on the home-country Embassy/Consulate; EBS is a separate award.' }],
    scope: 'Exact named2026BGS scholarship, undergraduate eligibility printed in the same section; no annual-review or institution recommendation deadline substituted.' },
  { key: 'bit-2026-undergraduate', sourceKeys: ['source-01'], title: 'How to apply for2026 BIT Undergraduate Program',
    quotes: [{ quote: '2026 International Students Admission Book', locator: 'HTML article heading', interpretation: 'Entry-year scope2026.' }, { quote: 'Application Deadline: June 1, 2026', locator: 'VI.Application Procedure', interpretation: 'General student application deadline for the listed undergraduate programmes.' }],
    scope: 'The same2026 undergraduate admissions article lists all four assigned English-taught Beijing-campus programmes by name. There is one article-wide general application cutoff. Autumn is the stored intake label, not separately printed in this article; binding uses the universal2026undergraduate application scope, exact programme names and degree. May1 scholarship dates and embassy-dependent CSC dates are excluded.' },
  { key: 'bisu-historical-only', sourceKeys: ['source-07', 'source-08', 'source-10'], title: 'BISU historical general guide and2024/2025CSC guide; target spring PDF inaccessible',
    quotes: [{ quote: '开放报名时间：2024年3月1日至5月31日（秋季学期）、2024年9月1日至11月30日（春季学期）', locator: 'source-07 PDF p7', interpretation: 'Explicit2024application windows; not target2025/26spring or2026/27other cycles.' }, { quote: '时间：即日至2023年12月20日（北京时间）', locator: 'source-10 PDF p4 五、报名时间（一）', interpretation: 'BISU-stage2024/25CSC deadline only.' }, { quote: '时间2024年1月5日至2024年1月15日（北京时间）', locator: 'source-10 PDF p4 五、报名时间（二）', interpretation: 'Subsequent applicant CSC portal stage for prior-admitted applicants, not course completion2026/2027.' }],
    scope: 'The four selected fee-reference records have different target years. General recurring November30/May31 cannot be rolled forward. International Chinese Education naming in the old guide does not prove current programme identity or deadline. Source08 returned404 then one web fallback also failed.' },
  { key: 'bjtu-2018-only', sourceKeys: ['source-06'], title: '北京交通大学2018国际学生招生简章',
    quotes: [{ quote: '2018', locator: 'PDF p1 cover, visually inspected; cover is image-only in text extraction', interpretation: 'Actual brochure year;2024-05URL path is not the admission year.' }, { quote: '秋季学期一般从9月1日开始，1月15日结束，报名时间不晚于7月15日', locator: 'PDF p7 时间安排', interpretation: 'Recurring historical student admission month/day, not2026proof.' }, { quote: '4月10日前将申请材料寄至北京交通大学。', locator: 'PDF p9 scholarship 怎样申请3(2)', interpretation: 'Historical applicant scholarship materials submission, before wording retained.' }, { quote: '每年的申请时间略有不同', locator: 'PDF p9 scholarship 注', interpretation: 'The brochure itself warns yearly timing differs; do not roll forward.' }],
    scope: 'All three programme fee-reference records and one combined CSC/SilkRoad framework scholarship remain unknown;May31pre-admission result notification andJulyformal result dates are institutional output dates, not applicant deadlines.' },
  { key: 'bsu-2026-autumn-nondegree', sourceKeys: ['source-09'], title: '北京体育大学2026年来华留学生招生简章',
    quotes: [{ quote: sportAutumn, locator: 'HTML 二、申请方式和时间', interpretation: 'Autumn2026 general applicant window includes non-degree Chinese language and Wushu programmes listed in the same guide.' }],
    scope: 'Two exact2026-2027autumn non-degree records. January27deadline is for spring2026only;June1under18age assessment andSeptemberregistration are different actions. New opening2025-12-01is candidate only while canonical opensOn staysnull.' },
  { key: 'bsu-2026-master-funded-scope', sourceKeys: ['source-09', 'source-11'], title: 'BSU2026International Chinese Education master with separate general and CSC windows',
    quotes: [{ quote: sportCsc, locator: 'source-11 HTML 五、申请流程1', interpretation: 'Applicant BSU-system CSC high-level postgraduate stage, strictly beforeMarch1asworded; not a universal general-admission deadline.' }, { quote: sportAutumn, locator: 'source-09 HTML 二、申请方式和时间', interpretation: 'General programme admission separately runs toJune1. Both2026routes are already expired.' }],
    scope: 'StoredMarch1comes from the CSC-specific supporting notice and is retained. The same master is named in both2026notices; no same-scope official contradiction is invented. GeneralJune1is a separate candidate scope, not a correction to the funded cutoff.' }
];

const groups = [];
const idsFor = school => selection.records.filter(x => x.universityId === school).map(x => x.recordId);
function group(key, ids, assess) {
  const ev = evidence.find(x => x.key === key);
  const records = ids.map(id => {
    const s = selection.records.find(x => x.recordId === id), row = s.row;
    const sourcePins = s.sources.filter(x => ev.sourceKeys.some(k => receipt(k.slice(-2)).url === x.row.url)).map(x => ({ sourceId: x.row.id, sourceSha256: x.sha256, url: x.row.url, official: x.row.official }));
    assert.ok(sourcePins.length && sourcePins.every(x => x.official));
    const result = assess(s);
    if (result.result === 'closed') assert.ok(result.officialDeadline < '2026-10-19');
    if (result.result === 'unknown') assert.equal(result.officialDeadline, null);
    return { collection: s.collection, recordId: id, universityId: s.universityId, programId: s.program?.id ?? null,
      programmeNameZh: s.program?.name.zh ?? row.name.zh, degreeLevel: s.program?.degreeLevel ?? null,
      academicYear: row.academicYear ?? null, intake: row.intake ?? null,
      storedOpensOn: row.opensOn ?? null, storedDeadline: s.collection === 'admissionCycles' ? row.closesOn : row.deadline,
      storedDateStatus: row.dateStatus ?? null, storedStatus: row.status, storedVerifiedAt: row.verifiedAt, storedReviewAfter: row.reviewAfter,
      storedEvidenceBasis: row.evidenceBasis ?? null, storedFactScope: row.factScope ?? null,
      canonicalRecordSha256: s.canonicalRecordSha256, ...(s.collection === 'admissionCycles' ? { canonicalCycleSha256: s.canonicalRecordSha256, canonicalProgramSha256: s.canonicalProgramSha256 } : {}),
      sourceIds: row.sourceIds, evidenceSourcePins: sourcePins, evidenceKey: key,
      officialOpensOn: null, candidateOnly: true, dateOnly: true, fullFactsCertified: false, freshnessRenewed: false,
      canonicalWritePerformed: false, rawRecordPreservedIn: 'selection.json#records[row.id=' + id + ']',
      requiresIndependentApprovalAndCasBeforeCanonicalDateChange: true, ...result };
  });
  groups.push({ key, universityId: records[0].universityId, evidenceKey: key, records });
}
group('ahmu-soft-recommendation', idsFor(selection.universityIds[0]), () => ({ result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null,
  candidateRecommendedSubmissionOn: '2026-02-25', recommendationBoundary: 'inclusive-date-as-worded', recommendationMandatory: false,
  reason: 'The exact2026/27scholarship route prints a recommendation rather than a mandatory application cutoff. September2026enrolment does not itself prove an exact deadline.' }));
group('ahu-undated-general-brochure', idsFor(selection.universityIds[1]), () => ({ result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null,
  candidateRecurringDeadline: { month: 5, day: 15, year: null, scope: 'degree programmes in an undated brochure' },
  reason: 'No explicit applicable intake year in the original cover/body; degree month/day cannot be applied to fee-reference2026/27other-intake rows.' }));
const forestry = idsFor(selection.universityIds[2]);
group('bjfu-2026-undergraduate', forestry.filter(x => x.startsWith('cycle-')), s => ({ result: 'closed', officialDeadline: '2026-06-15', candidateOfficialDeadline: '2026-06-15', deadlineBoundary: 'date-only-no-time-stated',
  applicableEntryYear: 2026, originalAcademicYear: '2026-2027', applicationScope: 'general international undergraduate student admission',
  programmeScopeMatch: { degree: 'bachelor', originalProgrammeName: ({ '林学（本科）': 'Forestry', '国际经济与贸易（本科）': 'International Economics and Trade', '风景园林（本科）': 'Landscape Architecture' })[s.program.name.zh], exactCatalogueAndSourceMatched: true },
  reason: 'Original2026-2027undergraduate catalogue names this exact programme and the same full admissions prospectus printsJune15general deadline; canonical null retained.' }));
group('bjfu-2026-bgs', forestry.filter(x => x.startsWith('sch-')), () => ({ result: 'closed', officialDeadline: '2026-06-08', candidateOfficialDeadline: '2026-06-08', deadlineBoundary: 'date-only-no-time-stated', applicableEntryYear: 2026,
  applicationScope: 'named Beijing Government Scholarship undergraduate student applicants; not CGS TypeAor EBS', reason: 'Exact named2026BGS applicant cutoff printed on originalp8; canonical deadline null retained.' }));
const bitNames = { '航空航天工程本科项目': 'Aeronautical and Astronautical Engineering', '自动化本科项目': 'Automation', '电子科学与技术本科项目': 'Electronics Science and Technology', '国际经济与贸易本科项目': 'International Economics and Trade' };
group('bit-2026-undergraduate', idsFor(selection.universityIds[3]), s => ({ result: 'closed', officialDeadline: '2026-06-01', candidateOfficialDeadline: '2026-06-01', deadlineBoundary: 'date-only-no-time-stated', applicableEntryYear: 2026,
  programmeScopeMatch: { degree: 'bachelor', campus: 'Beijing', teachingLanguage: 'English', originalProgrammeName: bitNames[s.program.name.zh], exactTableAndSourceMatched: true, intakeLabelExplicitInSource: false },
  applicationScope: 'article-wide2026international undergraduate admissions cutoff for all four exact named programmes; no semester-specific exception stated',
  excludedScholarshipDates: [{ date: '2026-05-01', meaning: 'Beijing/Guangdong/BIT scholarship applicant dates, separate from general admission' }],
  reason: 'Exact programme, degree, campus, language, entry-year and article-wide general-deadline scope match. The original does not separately print autumn; closure is limited to2026entry and not inferred from fee-reference alone. Canonical null retained.' }));
group('bisu-historical-only', idsFor(selection.universityIds[4]), () => ({ result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null,
  excludedHistoricalWindows: [{ applicationYear: 2024, intake: 'autumn', opensOn: '2024-03-01', deadline: '2024-05-31' }, { applicationYear: 2024, intake: 'spring', opensOn: '2024-09-01', deadline: '2024-11-30' }, { academicYear: '2024-2025', route: 'CSC high-level postgraduate, BISU admission-stage', deadline: '2023-12-20' }, { academicYear: '2024-2025', route: 'CSC portal stage for already preadmitted candidates', opensOn: '2024-01-05', deadline: '2024-01-15' }],
  sourceFailureKeys: ['source-08', 'source-08-web-fallback'],
  reason: 'Readable official sources explicitly belong to earlier application years; the exact linked spring guide failed404and one fallback. Target year/intake is unproven; historicalmonth/dayand course end2026/27are not rolled forward.' }));
group('bjtu-2018-only', idsFor(selection.universityIds[5]), s => ({ result: 'unknown', officialDeadline: null, candidateOfficialDeadline: null,
  originalGuideYear: 2018, originalGuideYearEvidence: 'visual coverp1; not2024URLdirectory',
  historicalDateCandidates: s.collection === 'scholarships' ? [{ month: 4, day: 10, year: null, boundary: 'before-date-as-worded', scope: '2018guideCSC/SilkRoadapplicant materials' }] : [{ month: 1, day: 15, year: null, scope: 'springhistoricalrecurringadmission' }, { month: 7, day: 15, year: null, scope: 'autumnhistoricalrecurringadmission' }],
  reason: 'The original handbook cover is2018and warns annual timing varies. Its contents do not certify target2026-2027fee-referencecyclesor a currentyearforcombinedscholarshipframework.' }));
const sport = idsFor(selection.universityIds[6]);
group('bsu-2026-autumn-nondegree', sport.filter(x => !x.includes('master')), () => ({ result: 'closed', officialDeadline: '2026-06-01', candidateOfficialDeadline: '2026-06-01', candidateOfficialOpensOn: '2025-12-01', openingDateResult: 'new-candidate-canonical-null-retained', deadlineBoundary: 'date-only-no-time-stated', applicableEntryYear: 2026,
  applicationScope: 'autumn2026non-degree applicant window, exact ChineseLanguageStudyandWushuTrainingcategories explicitly listed',
  reason: 'Exactyear,Septemberintakeandnon-degreecategorymatch; both new dates are candidates only and canonical fields remainnull.' }));
group('bsu-2026-master-funded-scope', sport.filter(x => x.includes('master')), () => ({ result: 'closed', officialDeadline: '2026-03-01', candidateOfficialDeadline: '2026-03-01', deadlineBoundary: 'before-date-as-worded', applicableEntryYear: 2026,
  applicationScope: '2026CSCTypeBhigh-level postgraduate applicant BSUsystemstage only; not all self-funded master applications', storedDeadlineMatchesScopedOfficialDay: true,
  separateGeneralAdmissionCandidate: { officialDeadline: '2026-06-01', candidateOfficialOpensOn: '2025-12-01', evidenceSourceKey: 'source-09', scope: 'general2026autumnapplicationwindow, separate fromCSCTypeB' },
  publicationRiskFlags: ['StoredMarch1deadlineisCSC-route-specific;do-not-present-as-universal-general-programme-deadline', 'BeforeMarch1wordingdoesnotestablishfull-dayMarch1availability'],
  reason: 'Both fundedMarch1andgeneralJune1windowsareexpired.TheexistingMarch1dayisconfirmedonlywithinCSCscope;noautomaticreplacementorfull-factrenewal.' }));

const records = groups.flatMap(g => g.records);
assert.equal(records.length, 27); assert.equal(new Set(records.map(r => r.recordId)).size, 27);
assert.deepEqual(new Set(records.map(r => r.recordId)), new Set(selection.records.map(r => r.recordId)));
const outcomes = records.reduce((o, r) => (o[r.result] = (o[r.result] || 0) + 1, o), {});
assert.equal(outcomes.closed, 11); assert.equal(outcomes.unknown, 16);
for (const s of selection.records) {
  assert.equal(sha(JSON.stringify(s.row)), s.canonicalRecordSha256);
  if (s.program) assert.equal(sha(JSON.stringify(s.program)), s.canonicalProgramSha256);
  for (const src of s.sources) assert.equal(sha(JSON.stringify(src.row)), src.sha256);
}
for (const name of Object.keys(inputFileSha256)) assert.equal(sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name))), inputFileSha256[name]);
const report = {
  schemaVersion: 1, batchId: selection.batchId, auditDate: '2026-10-19', timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  state: 'completed-date-only-candidates-no-canonical-mutation', snapshotSha256: selection.snapshotSha256, inputFileSha256,
  queuePath: selection.queuePath, queueSha256: selection.queueSha256, selectionSha256: sha(fs.readFileSync(path.join(root, 'selection.json'))),
  scope: 'Exactfirst7schoolsand27selectedrecordsofnext-official-date-targets-v2;notwholecatalogues.',
  acquisition: { newDistinctOfficialUrlsAttempted: 11, originalGets: 11, successfulOriginalUrls: 10, http404OriginalsRetained: 1, boundedWebFallbackAttempts: 1, fallbackNewDateEvidenceSources: 0, totalNetworkAttempts: 12, paidModelCalls: 0, tlsBypasses: 0, automaticRetries: 0 },
  sourceCaptures: captures, supplementalFailureReceipts: [{ path: 'source-08.web-fallback-receipt.json', sha256: sha(fs.readFileSync(fallbackPath)) }],
  visualChecks: [
    { sourceKey: 'source-03', page: 1, path: 'source-03-page-1.png', finding: 'AHUcovercontainsnocalendaryear;no2026inference' },
    { sourceKey: 'source-04', page: 7, path: 'source-04-page-7.png', finding: 'BilingualgeneralundergraduateJune15,2026deadline' },
    { sourceKey: 'source-04', page: 8, path: 'source-04-page-8.png', finding: 'BGSJune8,2026separatefromCGSTypeAandEBS' },
    { sourceKey: 'source-06', page: 1, path: 'source-06-page-1.png', finding: 'Actualbrochurecoverstates2018;URL2024isnotintakeyear' }
  ], evidence, groups,
  summary: { schoolsAttempted: 7, recordsAssessed: 27, recordResults: outcomes, newExactDeadlineCandidatesFromCanonicalNull: 10, alreadyStoredExpiredDeadlineScoped: 1, newOpeningCandidatesFromCanonicalNull: 2, unknownDatesNotClosedByInference: 16,
    canonicalWrites: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0, freshnessRenewals: 0, gitMutations: 0, sharedProgressWrites: 0, publicationActions: 0, paidModelCalls: 0 },
  cooldowns: [{ sourceKey: 'source-08', url: receipt('08').url, reason: 'HTTP404thenoneboundedwebfallbackunavailable', immediateRetryAllowed: false, retryCondition: 'Changedofficialattachmentlinkora laterboundedrecoverywindow' }],
  publicationRiskFlags: [
    'All11closedresultsarecandidate-onlyevidenceanddonotwritecanonicaldatesorrenewstatus.',
    'Fee-referenceprogrammebindingsrequireoriginaldegree/programme/entry-yearandsource;AHU,BISUandBJTUremainunknown.',
    'BITusesarticle-wide2026undergraduatescope;autumnlabelisnotseparatelyprintedandmustnotberolledto2027.',
    'AHMUFeb25isadvice;BFUJune15generaladmissionandJune8BGSaredifferentscopes;BSUMarch1isCSC-specificandbefore-as-worded.',
    'Noapplicantdeadlineisderivedfromenrolment,coursecompletion,oruniversitynotificationdates.'
  ],
  limitations: ['Date-onlyauditonly.All27rawrowsandprogramme/sourcepinsarepreservedinselection.json.', 'NewofficialopeningdatesarestoredascandidateOfficialOpensOnwhileofficialOpensOnandcanonicalopensOnremainnull.', 'No2018/2024yearorrecurringmonth/dayisrolledforward;unknownisnotopenorclosed.', 'Nocanonical/full-factstatus/Git/sharedstate/progress/publicationchanges;futureconsumptionrequiresnarrowreview,independentapproval,andCASagainstpinnedrecords.']
};
const reportPath = path.join(root, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const completion = { schemaVersion: 1, batchId: selection.batchId, completedAt: report.completedAt, reportSha256: sha(fs.readFileSync(reportPath)), snapshotSha256: selection.snapshotSha256, summary: report.summary };
fs.writeFileSync(path.join(root, 'completion.json'), JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'README.md'), `# Official date-only batch 013\n\nSeven assigned schools, 27 exact records: 11 closed candidate scopes and 16 unknown dates. No canonical dates or freshness were changed.\n\nThe 11 captures yielded 10 official originals and one retained HTTP404. One bounded web fallback for the missing BISU attachment also failed. All originals have SHA256, timestamps, text extracts and receipts. selection.json preserves the complete27rawrowsandprogramme/sourcepins. report.json stores records once, under groups[].records[].\n\nImportant scopes: AHMU February25is a recommendation only. AHU has no printed applicable year. BISU sources explicitly belong to2024/25, while BJTU’s image cover says2018. BFU undergraduate June15and BGS June8differ. BIT June1is the2026general undergraduate deadline for the four exact named programmes; its article does not separately print autumn. BSU autumn non-degree June1and CSC master beforeMarch1differ.\n\nReport SHA256: ${completion.reportSha256}\n`, { flag: 'wx' });
console.log(JSON.stringify(completion, null, 2));
