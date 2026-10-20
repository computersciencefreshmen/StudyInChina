const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const assert = require('assert/strict');
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const base = 'quality/deadline-sweep-20261019/';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = relative => fs.readFileSync(path.join(primary, relative));
const read = relative => JSON.parse(bytes(relative));
const write = (relative, value) => fs.writeFileSync(path.join(primary, relative), JSON.stringify(value,null,2)+'\n', {flag:'wx'});
const statePath = 'quality/recovery-20261018/continuation-state.json';
const stateBefore = bytes(statePath), state = JSON.parse(stateBefore);
assert.equal(state.canonicalOwner, 'heartbeat-date-first-20261019T0900');
assert.equal(state.canonicalWritesReleased, false);
const summaryName = 'official-review-summary-v10.json', nextName = 'next-official-date-targets-v8.json';
const summary = read(base+summaryName), inventory = read(base+'catalog-deadlines.json');
assert.equal(summary.snapshotSha256, inventory.snapshotSha256);
assert.equal(summary.sourceReports.length,30);
const progressPath = base+'official-recheck-progress.json', progressBefore = bytes(progressPath), progress = JSON.parse(progressBefore);
const seen = new Set([...summary.dateCheckedRecordIds,...summary.unresolvedDateRecordIds,...summary.carriedApprovedCycleIds,...summary.carriedApprovedScholarshipIds]);
const attempted = new Set();
function records(node, parentSchool, recordIds) {
  if(Array.isArray(node))return node.forEach(row=>records(row,parentSchool,recordIds));
  if(!node || typeof node!=='object')return;
  const universityId=node.universityId||parentSchool;
  if(node.recordId && (node.collection||node.type||node.recordKind)){attempted.add(universityId);recordIds.add(node.recordId);}
  for(const key of ['schools','groups','rows','records','recordResults'])if(Array.isArray(node[key]))records(node[key],universityId,recordIds);
}
const reportRecordIds = new Map();
for (const receipt of summary.sourceReports) {
  assert.equal(sha(bytes(receipt.report)),receipt.reportSha256);
  const report=read(receipt.report), ids=new Set(); records(report, undefined, ids); reportRecordIds.set(receipt.report, ids);
}
for (const number of ['028','029','030']) {
  const review=read(base+'official-batch-'+number+'/independent-review-v1.json');
  assert.ok(/^(pass|approved|accepted|source-only-(pass|accepted))/.test(review.decision||review.result||review.verdict||''),'Independent source-only review did not pass');
  assert.ok(JSON.stringify(review).includes(sha(bytes(base+'official-batch-'+number+'/report.json'))),'Independent review must pin final report bytes');assert.equal(review.summary.checksFailed,0);assert.ok(Array.isArray(review.checks));assert.equal(Array.isArray(review.checks)&&review.checks.some(x=>x.passed===false),false);
}
const all=[...inventory.admissionCycles.map(row=>({...row,collection:'admissionCycles',schoolIds:[row.universityId]})),
  ...inventory.scholarships.map(row=>({...row,collection:'scholarships',schoolIds:row.universityIds}))];
const remaining=all.filter(row=>!seen.has(row.id));
const unexpired=remaining.filter(row=>row.assessment.deadline>=inventory.today);
const undated=remaining.filter(row=>!row.assessment.deadline||row.assessment.windowState==='rolling');
const byDeadline=(a,b)=>(a.assessment.deadline||'9999').localeCompare(b.assessment.deadline||'9999')||a.id.localeCompare(b.id);
const ordered=[...unexpired.sort(byDeadline),...undated.sort((a,b)=>Number(attempted.has(a.schoolIds[0]))-Number(attempted.has(b.schoolIds[0]))||a.schoolIds[0]?.localeCompare(b.schoolIds[0])||a.id.localeCompare(b.id)),
  ...remaining.filter(row=>row.assessment.deadline&&row.assessment.deadline<inventory.today).sort(byDeadline)];
const selectedSchools=[];
for(const row of ordered){const school=row.schoolIds[0];if(school&&!selectedSchools.includes(school))selectedSchools.push(school);if(selectedSchools.length===20)break;}
const selectedIds=[];
for(const school of selectedSchools){const candidates=ordered.filter(row=>row.schoolIds.includes(school));const earliest=candidates[0];
  const sameSource=candidates.filter(row=>row.sourceUrls.some(url=>earliest.sourceUrls.includes(url)));
  for(const row of sameSource.slice(0,4))if(!selectedIds.includes(row.id))selectedIds.push(row.id);
}
const selected=new Set(selectedIds);
const selectedWindowStates = all.filter(row=>selected.has(row.id)).reduce((counts,row)=>{
  const state = row.assessment.windowState; counts[state]=(counts[state]||0)+1; return counts;
},{});
const next={schemaVersion:1,generatedAt:new Date().toISOString(),snapshotSha256:inventory.snapshotSha256,summary:summaryName,
  excludedAssessedOrPriorApprovedRecordIds:seen.size,remainingRawRecordDates:remaining.length,remainingUnexpiredRecordDates:unexpired.length,remainingUnknownOrRolling:undated.length,
  universitiesWithNoScopedDateCheck:inventory.universities.filter(row=>!attempted.has(row.id)).length,
  selectedUniversityIds:selectedSchools,selectedRecordIds:selectedIds,selectedWindowStates,
  officialPages:inventory.officialRecheckPages.map(page=>({...page,admissionCycleIds:page.admissionCycleIds.filter(id=>selected.has(id)),scholarshipIds:page.scholarshipIds.filter(id=>selected.has(id))})).filter(page=>page.admissionCycleIds.length+page.scholarshipIds.length),
  rules:['Exact unassessed record scopes only. Prioritize explicit unexpired dates; then unknown/rolling dates at schools without a scoped check.',
    'At most twenty schools and four same-source records per school in this finite queue; expand a shared date binding only after the source supports its exact scope.',
    'Unknown dates do not establish open or closed. An inspected route does not complete the school catalogue.',
    'Do not repeat blocked/conflicting scopes without new evidence or a due bounded retry. Keep historical records and never roll dates forward.']};
assert.equal(selectedIds.length,new Set(selectedIds).size);
assert.ok(selectedIds.every(id=>!seen.has(id)));
write(base+nextName,next);
const checked=new Set(summary.dateCheckedRecordIds),unresolved=new Set(summary.unresolvedDateRecordIds),carried=new Set([...summary.carriedApprovedCycleIds,...summary.carriedApprovedScholarshipIds]);
for(const batch of progress.batches){const inventoryBatch=[...inventory.batches,...inventory.unattributedScholarshipBatches].find(row=>row.id===batch.batchId);if(!inventoryBatch)continue;
  const ids=new Set([...(inventoryBatch.admissionCycleIds||[]),...(inventoryBatch.scholarshipIds||[])]);
  batch.dateCheckedRecordIds=[...checked].filter(id=>ids.has(id));batch.unresolvedDateRecordIds=[...unresolved].filter(id=>ids.has(id));batch.carriedApprovedRecordIds=[...carried].filter(id=>ids.has(id));
  batch.receipts=summary.sourceReports.filter(receipt=>[...reportRecordIds.get(receipt.report)].some(id=>ids.has(id)))
    .map(receipt=>({path:receipt.report,sha256:receipt.reportSha256}));
  if(batch.dateCheckedRecordIds.length+batch.unresolvedDateRecordIds.length+batch.carriedApprovedRecordIds.length)batch.state='partial-official-date-review';
  batch.completedUniversityIds=[];
}
progress.dateRechecks={updatedAt:new Date().toISOString(),summaryFile:summaryName,scope:summary.scope,attemptedUniversityIds:[...attempted].sort(),wholeSchoolCompletedUniversityIds:[],reportReceipts:summary.sourceReports,
  publicCycleCoverage:summary.publicCycleCoverage,publicScholarshipEvidenceCoverage:summary.publicScholarshipEvidenceCoverage,carriedApprovedCycleIds:summary.carriedApprovedCycleIds,carriedApprovedScholarshipIds:summary.carriedApprovedScholarshipIds,
  nextQueue:nextName,remainingRawRecordDates:remaining.length,remainingUnexpiredRecordDates:unexpired.length};
assert.equal(sha(bytes(progressPath)),sha(progressBefore));
write(base+'heartbeat-0900/progress-update-v10-receipt.json',{observedAt:new Date().toISOString(),oldProgressSha256:sha(progressBefore),summary:base+summaryName,summarySha256:sha(bytes(base+summaryName)),nextQueue:base+nextName,nextQueueSha256:sha(bytes(base+nextName)),allExactIdsDistinct:true,canonicalWrites:0,heldCorrection:'official-batch-012/report.json#cycle-cqnu-chinese-language-spring-2027'});
fs.writeFileSync(path.join(primary,progressPath),JSON.stringify(progress,null,2)+'\n');
state.deadlineMaintenance={...state.deadlineMaintenance,summary:base+summaryName,summarySha256:sha(bytes(base+summaryName)),nextQueue:base+nextName,schoolsAttempted:attempted.size,
  selectedRecordDatesAssessed:summary.recordsAssessed,unchanged:summary.recordOutcomes.unchanged,unknown:summary.recordOutcomes.unknown,blocked:summary.recordOutcomes.blocked,conflicting:summary.recordOutcomes.conflict,
  remainingRawRecordDates:remaining.length,remainingUnexpiredRecordDates:unexpired.length,
  sourceConfirmedPastWindows:summary.recordOutcomes.closed||0,pastDateCandidatesApplied:0,heldDateCorrections:1,heldDateCorrectionReport:base+'official-batch-012/report.json',
  latestSuccessorDateObservations:base+'heartbeat-0900/successor-date-observations-v1.json',
  latestFiniteEvidenceBatch:{reports:summary.sourceReports.slice(-3).map(row=>row.report),records:summary.sourceReports.slice(-3).reduce((sum,row)=>sum+row.recordsAssessed,0),baseQueueRecords:48,additionalSameSourceRecords:10,canonicalDatesChanged:0}};
state.updatedAt=new Date().toISOString();state.canonicalOwner='released-for-date-first-maintenance';state.canonicalWritesReleased=true;
state.canonicalOwnershipRelease={...state.canonicalOwnershipRelease,releasedAt:state.updatedAt,previousOwner:'heartbeat-date-first-20261019T0900'};
assert.equal(sha(bytes(statePath)),sha(stateBefore));
fs.writeFileSync(path.join(primary,statePath),JSON.stringify(state,null,2)+'\n');
write(base+'heartbeat-0900/completion-v1.json',{observedAt:state.updatedAt,recordsAssessed:summary.recordsAssessed,recordOutcomes:summary.recordOutcomes,schoolsAttempted:attempted.size,remainingRawRecordDates:remaining.length,
  remainingUnexpiredRecordDates:unexpired.length,nextSchools:selectedSchools.length,nextRecords:selectedIds.length,canonicalFactsChanged:false,deploymentRequired:false,sourceHead:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:primary,encoding:'utf8'}).trim(),releaseGate:'State must be committed and HEAD synchronized to upstream before another writer.'});
console.log(JSON.stringify({recordsAssessed:summary.recordsAssessed,recordOutcomes:summary.recordOutcomes,schools:attempted.size,remaining:remaining.length,unexpired:unexpired.length,nextSchools:selectedSchools.length,nextRecords:selectedIds.length}));
