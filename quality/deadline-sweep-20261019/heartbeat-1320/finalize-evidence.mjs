import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const c='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const d='D:/学过的课程/github_profile_work/StudyInChina';
const base='quality/deadline-sweep-20261019/', dir=base+'heartbeat-1320/';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(root,p)=>JSON.parse(fs.readFileSync(path.join(root,p)));
const {buildHistoricalSummary,normalizeReport}=await import(pathToFileURL(path.join(c,'scripts/quality/summarize-deadline-rechecks.ts')));
if(process.argv[2]==='prepare'){
 const summary=buildHistoricalSummary(c,path.join(d,base),'quality/deadline-sweep-20261020/inventory-20261020T0835/catalog-deadlines.json',45);
 fs.writeFileSync(path.join(d,base+'official-review-summary-v15.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({prepared:true,records:summary.recordsAssessed,outcomes:summary.recordOutcomes,schools:summary.universitiesWithScopedDateChecks}));
} else if(process.argv[2]==='copy'){
 const state=read(c,'quality/recovery-20261018/continuation-state.json'); assert.equal(state.canonicalOwner,'heartbeat-date-first-20261019T1320');assert.equal(state.canonicalWritesReleased,false);
 const relativeFiles=[];function gather(relative){for(const entry of fs.readdirSync(path.join(d,relative),{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const p=relative+'/'+entry.name;if(entry.isDirectory())gather(p);else{assert.equal(entry.isFile(),true);relativeFiles.push(p);}}}
 for(const n of ['043','044','045'])gather(base+'official-batch-'+n);
 for(const f of ['base-dispatch-v1.json','additional-same-source-selection-v1.json','prepare-handoff.cjs','finalize-evidence.mjs','pr40-body.txt','lint-scope-independent-review-20261020-v1.json','merge-unit-20261020-v1.json','merge-coverage-20261020-v1.json','merge-validation-20261020-v1.json','github-ci-result-20261020-v1.json','historical-reader-validation-v1.json','historical-reader-independent-review-v1.json','auto-merge-authorization-20261020-v1.json','auto-merge-readback-20261020-v2.json','deadline-ci-validation-v1.json'])relativeFiles.push(dir+f);
 relativeFiles.push(base+'official-review-summary-v15.json');
 const copied=[];for(const p of relativeFiles){const source=fs.readFileSync(path.join(d,p)),target=path.join(c,p);fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target))assert.equal(sha(fs.readFileSync(target)),sha(source));else fs.writeFileSync(target,source,{flag:'wx'});copied.push({path:p,sha256:sha(source)});}
 const stored=read(c,base+'official-review-summary-v15.json'),fresh=buildHistoricalSummary(c,path.join(c,base),'quality/deadline-sweep-20261020/inventory-20261020T0835/catalog-deadlines.json',45); delete stored.observedAt;delete fresh.observedAt;assert.deepEqual(stored,fresh);
 const q=read(c,base+'next-official-date-targets-v12.json'),extra=read(c,dir+'additional-same-source-selection-v1.json');assert.equal(extra.baseQueueSha256,sha(fs.readFileSync(path.join(c,base+'next-official-date-targets-v12.json'))));
 const dispatch=read(c,dir+'base-dispatch-v1.json');assert.equal(sha(fs.readFileSync(path.join(c,dir+'base-dispatch-v1.json'))),extra.baseDispatchSha256);
 const expected=[...q.selectedRecordIds,...extra.extraRecords.map(r=>r.recordId)].sort(); const actual=[];for(const n of ['043','044','045'])actual.push(...normalizeReport(read(c,base+'official-batch-'+n+'/report.json'),base+'official-batch-'+n+'/report.json').map(r=>r.id));assert.equal(expected.length,30);assert.equal(new Set(actual).size,actual.length);assert.deepEqual(actual.sort(),expected);
 assert.equal(sha(fs.readFileSync(path.join(c,base+'catalog-deadlines.json'))),'a70ed9101ad3d1dfebfc800a45eebfba8bc37d5a5170e3408d3d784e703adf82');
 const method=read(c,dir+'historical-reader-validation-v1.json');assert.equal(method.targetedTestsPassed,16);assert.equal(method.targetedTestsFailed,0);assert.equal(method.scopedLintPassed,true);assert.equal(method.old24CoreCountsAndBindingsUnchanged,true);assert.equal(sha(fs.readFileSync(path.join(c,method.methodPath))),method.methodSha256);assert.equal(sha(fs.readFileSync(path.join(c,method.testsFile))),method.testsSha256);assert.equal(sha(fs.readFileSync(path.join(c,method.historyTestsFile))),method.historyTestsSha256);const historyReview=read(c,dir+'historical-reader-independent-review-v1.json');assert.equal(historyReview.summary.checksFailed,0);assert.ok(JSON.stringify(historyReview).includes(method.methodSha256));
 for(const n of ['043','044','045']){const review=read(c,base+'official-batch-'+n+'/independent-review-v1.json');assert.ok(/^(pass|approved|accepted|source-only-(pass|accepted))/.test(review.decision||review.result||review.verdict||''));assert.ok(JSON.stringify(review).includes(sha(fs.readFileSync(path.join(c,base+'official-batch-'+n+'/report.json')))));assert.equal(review.summary.checksFailed,0);assert.ok(Array.isArray(review.checks));assert.equal(Array.isArray(review.checks)&&review.checks.some(x=>x.passed===false),false);}
 fs.writeFileSync(path.join(c,dir+'copy-validation-v1.json'),JSON.stringify({copiedAt:new Date().toISOString(),files:copied,checks:{freshSummaryMatches:true,exactQueuedAndAdditionalIds:30,allIdsDistinct:true,frozenInventoryUnchanged:true,sixCanonicalHashesMatched:true,methodUnchangedSinceEightRegressionValidation:true,threeFinalReportIndependentReviews:true},canonicalFactsChanged:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({copiedFiles:copied.length,allChecksPassed:true,records:fresh.recordsAssessed,outcomes:fresh.recordOutcomes,schools:fresh.universitiesWithScopedDateChecks}));
} else throw new Error('Expected prepare or copy');
