const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const base = __dirname;
const relativeBase = 'quality/deadline-sweep-20261019/';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(primary, name)));
const inventory = read(relativeBase + 'catalog-deadlines.json');
const previous = read(relativeBase + 'official-review-summary-v3.json');
const queue = read(relativeBase + 'next-official-date-targets-v1.json');
const previousIds = new Set([...previous.dateCheckedRecordIds, ...previous.unresolvedDateRecordIds,
  ...previous.carriedApprovedCycleIds, ...previous.carriedApprovedScholarshipIds, ...queue.selectedRecordIds]);
const selected = [...inventory.admissionCycles, ...inventory.scholarships]
  .filter(row => !previousIds.has(row.id) && row.assessment.deadline >= inventory.today);
assert.equal(selected.length, 22);
const cycles = new Map(read('content/data/admission-cycles.json').map(row => [row.id, row]));
const programs = new Map(read('content/data/programs.json').map(row => [row.id, row]));
const scholarships = new Map(read('content/data/scholarships.json').map(row => [row.id, row]));
const captures = JSON.parse(fs.readFileSync(path.join(base, 'capture-manifest.json')));
const inputHashes = Object.fromEntries(Object.keys(inventory.inputFileSha256).map(name => [name, sha(fs.readFileSync(path.join(primary, 'content/data', name)))]));
assert.deepEqual(inputHashes, inventory.inputFileSha256);
const groups = [];
function source(key) {
  const capture = captures.requests.find(row => row.key === key);
  assert.equal(capture.status, 200);
  assert.equal(sha(fs.readFileSync(path.join(base, capture.rawPath))), capture.rawSha256);
  return {...capture, textPath:key + '.txt', textSha256:sha(fs.readFileSync(path.join(base, key + '.txt'))),
    evidenceMode:'new-full-official-html', countsAsNewWebsiteRead:true};
}
function add(universityId, ids, result, evidence, quote, scope, extra = {}) {
  const records = ids.map(id => {
    const candidate = selected.find(row => row.id === id); assert.ok(candidate, id);
    const cycle = cycles.get(id), canonical = cycle || scholarships.get(id);
    assert.ok(canonical);
    return {collection:cycle ? 'admissionCycles' : 'scholarships', recordId:id, universityId,
      ...(cycle ? {programId:cycle.programId, academicYear:cycle.academicYear, intake:cycle.intake,
        storedOpensOn:cycle.opensOn, canonicalCycleSha256:sha(JSON.stringify(cycle)),
        canonicalProgramSha256:sha(JSON.stringify(programs.get(cycle.programId)))} : {canonicalScholarshipSha256:sha(JSON.stringify(canonical))}),
      storedDeadline:cycle ? cycle.closesOn : canonical.deadline,
      officialDeadline:result === 'unchanged' ? candidate.assessment.deadline : null,
      publicationBefore:candidate.published, sourceIds:canonical.sourceIds, result,
      dateOnly:true, fullFactsCertified:false, freshnessRenewed:false, canonicalWritePerformed:false};
  });
  groups.push({universityId, evidence, dateQuote:quote, dateScope:scope, ...extra, records});
}
const idsFor = school => selected.filter(row => (row.universityId || row.universityIds[0]) === school).map(row => row.id);
add('uni-shanghai-jiao-tong-university', idsFor('uni-shanghai-jiao-tong-university'), 'unchanged', [source('sjtu')],
  'Spring: Sep. 15 - Dec. 15', 'Recurring spring language application window; the same current page links the 2027 Spring full-time course and schedule. Exact registration dates are not assessed.');
add('uni-university-of-international-business-and-economics', idsFor('uni-university-of-international-business-and-economics').filter(id => !id.includes('foundation')), 'unchanged', [source('uibe-degree')],
  'Spring Semester: October 20 - December 31 each year', 'Explicit recurring annual spring window; economics, finance and international economics and trade appear in the same English-medium undergraduate list.');
add('uni-university-of-international-business-and-economics', ['cycle-uibe-international-foundation-spring-2027'], 'unchanged', [source('uibe-foundation')],
  'Spring Semester : October 1 to December 31 (closes when seats are filled)', 'Existing recurring-official-rule for February-June spring foundation programme; December31 is a latest calendar boundary, earlier capacity closure remains possible.', {precisionQualification:'Unknown current seat availability; do not infer availability solely from the calendar maximum.'});
for (const [id, key] of [['cycle-2027-bf053c085767','dlut-a'],['cycle-2027-5df1a1f1218d','dlut-b']]) {
  add('uni-dalian-university-of-technology', [id], 'unknown', [source(key)],
    'Starts from first of November 2026, applicants are recommend to complete the application by before the end of June.',
    'Current 2027 undergraduate guide body. It recommends completion before end of June; this is insufficient to certify a hard June30 inclusive cutoff or an exact clock time.', {candidateCalendarBoundary:'2027-06-30', hardDeadlineNotEstablished:true});
}
add('uni-xiamen-university', ['cycle-xmu-long-term-chinese-language-spring-2027'], 'unchanged', [source('xmu-language')],
  'Spring semester: February to June 2027; Spring Semester: December 30, 2026', '2026-2027 long-term Chinese language guide, spring2027 route.');
const centralReceipt = read('quality/recovery-20261019/rapid-expansion/scholarships/central/clec-2026-guide.receipt.json');
add('uni-beijing-foreign-studies-university', idsFor('uni-beijing-foreign-studies-university'), 'conflict', [source('bfsu'), {evidenceMode:'prior-approved-central-guide-reuse', countsAsNewWebsiteRead:false, receiptPath:'quality/recovery-20261019/rapid-expansion/scholarships/central/clec-2026-guide.receipt.json', receipt:centralReceipt}],
  'One-Semester Study Program: December 30th, 2026 | March 2027',
  'School table supports stored December30 but CLEC2026 guidance gives October31 for March2027; school prose also says January2027. Preserve all wording pending authority/intake clarification.',
  {conflictingDateCandidates:['2026-10-31','2026-12-30'], noAutomaticPrecedence:true});
add('uni-chongqing-normal-university', ['cycle-cqnu-chinese-language-spring-2027'], 'conflict', [source('cqnu-cn'),source('cqnu-en')],
  '春季学期（3月-7月）报名时间：9月1日-12月25日; Spring Semester (March - June) application period: September 1, 2026-December 25, 2026.',
  'Both current school language guides give December25; stored December30 and its date-related note no longer match. Record remains unpublished. This is a held narrow date-correction candidate, not an applied change.',
  {heldDateCorrection:{recordId:'cycle-cqnu-chinese-language-spring-2027', field:'closesOn', oldValue:'2026-12-30', proposedValue:'2026-12-25', requiresIndependentReview:true, applied:false,
    reason:'Only use a supported narrow date consumer with current catalogue CAS, preserve original row/history and replace only stale date wording. Do not replay the previous full-record consumer.'}});
add('uni-beijing-institute-of-petrochemical-technology', idsFor('uni-beijing-institute-of-petrochemical-technology'), 'unchanged', [source('bipt')],
  '2026年来华留学生招生简章; 语言生 汉语语言; 报名时间 5月1日-6月30日 11月1日-12月30日',
  'Official 2026 guide, language-student column, second application window. The guide is effective immediately and dated April7,2026; no new intake-month certainty is inferred from that window.');
add('uni-hainan-university', idsFor('uni-hainan-university'), 'unchanged', [source('hainanu')],
  'Spring semester: December 31, 2026 (Semester starts from the beginning of March 2027)', '2026-2027 Chinese Language and Culture programme.');
add('uni-tianjin-university', idsFor('uni-tianjin-university'), 'unchanged', [source('tju')],
  'Program 2 | 1 Year | Fall & Spring Semester | 2027.03.15-2027.07.15 | 2027.09', '2027 autumn-entry one-year foundation route; separate spring one-semester row is not substituted.');
for (const [school, batch, key] of [['uni-nanjing-university','007','nju-bachelor'],['uni-xiamen-university','006','master']]) {
  const ids = idsFor(school).filter(id => !id.includes('long-term'));
  const reportPath = relativeBase + 'official-batch-' + batch + '/report.json';
  const report = read(reportPath), guide = (report.guides || report.guideEvidence).find(row => (row.key || row.guideEvidenceKey) === key);
  const rawPath = relativeBase + 'official-batch-' + batch + '/' + guide.source.bodyPath;
  assert.equal(sha(fs.readFileSync(path.join(primary, rawPath))), guide.source.bodySha256);
  add(school, ids, 'unchanged', [{evidenceMode:'same-day-prior-official-guide-reuse', countsAsNewWebsiteRead:false,
    reportPath, reportSha256:sha(fs.readFileSync(path.join(primary, reportPath))), rawPath, rawSha256:guide.source.bodySha256,
    originalObservedAt:guide.source.observedAt || guide.source.completedAt, guide}],
    school.includes('nanjing') ? '3月1日至5月15日' : '2026年12月1日 | 2027年5月31日 | 自费生',
    'Exact additional existing '+(school.includes('nanjing')?'autumn2027 self-funded bachelor':'autumn2027 self-funded master')+' record dates. Programme offerings, fees and scholarship deadlines are outside this binding.');
}
add('uni-beijing-language-and-culture-university', idsFor('uni-beijing-language-and-culture-university'), 'unchanged', [source('blcu')],
  'If enrolled in March 2027: Please submit your application before January 12, 2027', 'School Beijing International Students Scholarship, March2027 entry.',
  {precisionQualification:'The word before is retained. Calendar-date equality does not authorize extending applications through January12 end-of-day.'});
add('uni-tianjin-foreign-studies-university', idsFor('uni-tianjin-foreign-studies-university'), 'unchanged', [source('tjfsu')],
  '申请人于2026年12月30日前; before 30 December 2026', '2026 China Link scholarship, student university-platform submission first; subsequent CSC submission follows university review.',
  {precisionQualification:'Before December30 is preserved; this does not certify availability throughout December30.'});
const bindings = groups.flatMap(group => group.records);
assert.equal(bindings.length, 22);
assert.equal(new Set(bindings.map(row=>row.recordId)).size, 22);
assert.deepEqual([...bindings.map(row=>row.recordId)].sort(), [...selected.map(row=>row.id)].sort());
for (const name of Object.keys(inputHashes)) assert.equal(sha(fs.readFileSync(path.join(primary,'content/data',name))), inputHashes[name]);
const report = {schemaVersion:1, batchId:'official-date-only-012-20261019', auditDate:inventory.today, timeZone:'Asia/Shanghai', completedAt:new Date().toISOString(),
  state:'source-only-finite-review-with-held-differences', snapshotSha256:inventory.snapshotSha256,inputFileSha256:inputHashes,
  selection:{basis:'Remaining unassessed explicit unexpired raw record dates after v3 and exact next41 IDs',recordIds:selected.map(row=>row.id)},
  summary:{records:22,schools:new Set(groups.map(g=>g.universityId)).size,outcomes:bindings.reduce((o,r)=>(o[r.result]=(o[r.result]||0)+1,o),{}),newOfficialHtmlReads:14,reusedGuideScopes:3,canonicalWrites:0,dateChangesApplied:0},
  groups, precisionIssues:groups.filter(g=>g.precisionQualification||g.heldDateCorrection||g.conflictingDateCandidates||g.hardDeadlineNotEstablished).map(g=>({universityId:g.universityId,recordIds:g.records.map(r=>r.recordId),qualification:g.precisionQualification||g.dateScope})),
  limitations:['Selected record dates only; no full-school catalogue completed and no complete fact renewal.','Raw record discrepancies and imprecise qualifiers remain held/unpublished; a supported narrow consumer and independent review are required before a factual change.','Six same-day guide date rebindings reuse prior bytes, not fresh official website reads.']};
fs.writeFileSync(path.join(base,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({reportSha256:sha(fs.readFileSync(path.join(base,'report.json'))),summary:report.summary}));
