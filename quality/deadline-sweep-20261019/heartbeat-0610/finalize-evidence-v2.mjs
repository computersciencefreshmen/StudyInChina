import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const c='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const d='D:/学过的课程/github_profile_work/StudyInChina';
const base='quality/deadline-sweep-20261019/', dir=base+'heartbeat-0610/';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(root,p)=>JSON.parse(fs.readFileSync(path.join(root,p)));
const {buildSummary,normalizeReport}=await import(pathToFileURL(path.join(c,'scripts/quality/summarize-deadline-rechecks.ts')));
if(process.argv[2]==='prepare'){
 const summary=buildSummary(c,path.join(d,base),'2026-10-19',24);
 fs.writeFileSync(path.join(d,base+'official-review-summary-v8.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({prepared:true,records:summary.recordsAssessed,outcomes:summary.recordOutcomes,schools:summary.universitiesWithScopedDateChecks}));
} else if(process.argv[2]==='copy'){
 const state=read(c,'quality/recovery-20261018/continuation-state.json'); assert.equal(state.canonicalOwner,'heartbeat-date-first-20261019T0610');assert.equal(state.canonicalWritesReleased,false);
 const relativeFiles=[];function gather(relative){for(const entry of fs.readdirSync(path.join(d,relative),{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const p=relative+'/'+entry.name;if(entry.isDirectory())gather(p);else{assert.equal(entry.isFile(),true);relativeFiles.push(p);}}}
 for(const n of ['022','023','024'])gather(base+'official-batch-'+n);
 for(const f of ['additional-same-source-selection-v1.json','prepare-handoff.cjs','finalize-evidence.mjs','prepare-handoff-v2.cjs','finalize-evidence-v2.mjs','pr40-body.txt'])relativeFiles.push(dir+f);
 relativeFiles.push(base+'official-review-summary-v8.json');
 const copied=[];for(const p of relativeFiles){const source=fs.readFileSync(path.join(d,p)),target=path.join(c,p);fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target))assert.equal(sha(fs.readFileSync(target)),sha(source));else fs.writeFileSync(target,source,{flag:'wx'});copied.push({path:p,sha256:sha(source)});}
 const stored=read(c,base+'official-review-summary-v8.json'),fresh=buildSummary(c,path.join(c,base),'2026-10-19',24); delete stored.observedAt;delete fresh.observedAt;assert.deepEqual(stored,fresh);
 const q=read(c,base+'next-official-date-targets-v5.json'),extra=read(c,dir+'additional-same-source-selection-v1.json');assert.equal(extra.baseQueueSha256,sha(fs.readFileSync(path.join(c,base+'next-official-date-targets-v5.json'))));
 const expected=[...q.selectedRecordIds,...extra.extraRecords.map(r=>r.recordId)].sort(); const actual=[];for(const n of ['022','023','024'])actual.push(...normalizeReport(read(c,base+'official-batch-'+n+'/report.json'),base+'official-batch-'+n+'/report.json').map(r=>r.id));assert.equal(expected.length,70);assert.equal(new Set(actual).size,actual.length);assert.deepEqual(actual.sort(),expected);
 assert.equal(sha(fs.readFileSync(path.join(c,base+'catalog-deadlines.json'))),'a70ed9101ad3d1dfebfc800a45eebfba8bc37d5a5170e3408d3d784e703adf82');
 const old=read(c,base+'heartbeat-0524/copy-validation-v1.json').files.find(r=>r.path==='scripts/quality/summarize-deadline-rechecks.ts');assert.ok(old);assert.equal(sha(fs.readFileSync(path.join(c,old.path))),old.sha256);
 for(const n of ['022','023','024']){const review=read(c,base+'official-batch-'+n+(n==='024'?'/independent-review-v2.json':'/independent-review-v1.json'));assert.ok(/^(pass|approved|accepted|source-only-(pass|accepted))/.test(review.decision||review.result||review.verdict||''));assert.ok(JSON.stringify(review).includes(sha(fs.readFileSync(path.join(c,base+'official-batch-'+n+'/report.json')))));assert.equal(review.summary?.checksFailed??0,0);assert.equal(Array.isArray(review.checks)&&review.checks.some(x=>x.passed===false),false);if(n==='024'){assert.equal(review.summary.checksFailed,0);assert.ok(Array.isArray(review.checks));assert.ok(JSON.stringify(review).includes(sha(fs.readFileSync(path.join(c,base+'official-batch-024/independent-review-v1.json')))));}}
 fs.writeFileSync(path.join(c,dir+'copy-validation-v2.json'),JSON.stringify({copiedAt:new Date().toISOString(),files:copied,checks:{freshSummaryMatches:true,exactQueuedAndAdditionalIds:70,allIdsDistinct:true,frozenInventoryUnchanged:true,sixCanonicalHashesMatched:true,priorPassingMethodUnchanged:true,threeFinalReportIndependentReviews:true},canonicalFactsChanged:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({copiedFiles:copied.length,allChecksPassed:true,records:fresh.recordsAssessed,outcomes:fresh.recordOutcomes,schools:fresh.universitiesWithScopedDateChecks}));
} else throw new Error('Expected prepare or copy');
