/* Offline independent structural/source pin review. No canonical/state/Git writes. */
const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto'),a=require('node:assert/strict');
const d=__dirname, root=p.resolve(d,'../../..'), primary='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const bytes=f=>fs.readFileSync(f), sha=b=>c.createHash('sha256').update(b).digest('hex'), j=f=>JSON.parse(bytes(f)), rh=x=>sha(JSON.stringify(x));
const r=j(p.join(d,'report.json')), s=j(p.join(d,'selection.json')), done=j(p.join(d,'completion.json'));
a.equal(sha(bytes(p.join(d,'report.json'))),'2d53347f63edde1efc6817ddccd2b5e6ebd7e72fca45582688fb313aa65ddab8');a.equal(done.reportSha256,sha(bytes(p.join(d,'report.json'))));
a.equal(r.selection.sha256,sha(bytes(p.join(d,'selection.json'))));
for(const [name,h] of Object.entries(r.inputFileSha256))a.equal(sha(bytes(p.join(primary,'content/data',name))),h);
const inventory=j(p.join(primary,s.inventoryPath)), queue=j(p.join(primary,s.queuePath));
a.equal(sha(bytes(p.join(primary,s.inventoryPath))),r.inventorySha256);a.equal(inventory.snapshotSha256,r.snapshotSha256);
a.equal(sha(bytes(p.join(primary,s.queuePath))),r.targetQueueSha256);a.deepEqual(queue.selectedUniversityIds.slice(0,7),r.selectedUniversityIds);
const ext=j(p.join(root,s.additionalSelectionReceipt));a.equal(sha(bytes(p.join(root,s.additionalSelectionReceipt))),r.selection.additionalSelectionReceiptSha256);a.equal(ext.baseQueueSha256,s.queueSha256);
const map=n=>new Map(j(p.join(primary,'content/data',n)).map(x=>[x.id,x]));
const cycles=map('admission-cycles.json'),awards=map('scholarships.json'),programs=map('programs.json'),sources=map('sources.json');
const rows=r.groups.flatMap(g=>g.records),selected=[...s.baseQueueRecordIds,...s.additionalSameSourceRecordIds];
a.equal(rows.length,29);a.equal(new Set(rows.map(x=>x.recordId)).size,29);a.deepEqual(rows.map(x=>x.recordId).sort(),selected.slice().sort());a.equal(s.baseQueueRecordIds.length,22);a.equal(s.additionalSameSourceRecordIds.length,7);
let programPins=0,sourcePins=0;
const inventoryRows=new Map([...inventory.admissionCycles,...inventory.scholarships].map(x=>[x.id,x]));
for(const x of rows){
 const q=s.records.find(y=>y.recordId===x.recordId), raw=(x.collection==='admissionCycles'?cycles:awards).get(x.recordId);
 a.deepEqual(q.row,raw);a.equal(rh(raw),x.canonicalRecordSha256);a.equal(x.canonicalRowSha256,x.canonicalRecordSha256);a.equal(q.canonicalRecordSha256,x.canonicalRecordSha256);
 a.equal(raw.closesOn??raw.deadline??null,x.storedDeadline);a.equal(raw.status,x.storedStatus);a.equal(raw.verifiedAt,x.storedVerifiedAt);a.equal(raw.reviewAfter,x.storedReviewAfter);
 for(const pin of q.programRows){a.deepEqual(pin.row,programs.get(pin.row.id));a.equal(rh(pin.row),pin.canonicalProgramSha256);a.equal(x.canonicalProgramPins.find(y=>y.programId===pin.row.id).canonicalProgramSha256,pin.canonicalProgramSha256);programPins++;}
 a.deepEqual(x.sourcePins.map(y=>y.sourceId).sort(),q.sources.map(y=>y.row.id).sort());
 for(const pin of x.sourcePins){a.deepEqual(pin.sourceFullRecord,sources.get(pin.sourceId));a.equal(rh(pin.sourceFullRecord),pin.canonicalSourceSha256);sourcePins++;}
 if(x.collection==='scholarships')a.equal(x.canonicalScholarshipSha256,x.canonicalRecordSha256);
 if(s.additionalSameSourceRecordIds.includes(x.recordId))a.equal(ext.extraRecords.find(y=>y.recordId===x.recordId).canonicalRecordSha256,x.canonicalRecordSha256);
 a.equal(inventoryRows.get(x.recordId).published,false);
 a.equal(x.candidateOnly,true);a.equal(x.dateOnly,true);a.equal(x.canonicalWritePerformed,false);a.equal(x.canonicalDateChanged,false);a.equal(x.freshnessRenewed,false);a.equal(x.fullFactsCertified,false);a.equal(x.wholeSchoolCatalogueCompleted,false);a.equal(x.openingDateAssessed,false);a.equal(x.officialOpensOn,null);
 if(x.result==='closed'){a.match(x.officialDeadline,/^\d{4}-\d{2}-\d{2}$/);a.ok(x.officialDeadline<'2026-10-19');a.ok(x.quotedDate);}
 else a.equal(x.officialDeadline,null);
 if(x.evidenceSourceType==='web-tool-parsed-official-page-not-origin-raw-bytes'){a.equal(x.evidenceBodySha256,null);a.equal(x.originRawBytesAvailableForDateEvidence,false);a.ok(x.retainedObservationSha256);}
}
const counts=Object.fromEntries(['closed','unknown','blocked'].map(k=>[k,rows.filter(x=>x.result===k).length]));a.deepEqual(counts,{closed:16,unknown:11,blocked:2});
let rawBodies=0,textPins=0,failureReceipts=0;
const native=[...j(p.join(d,'capture-summary.json')),...j(p.join(d,'capture-derived-summary.json'))];
for(const x of native){a.ok(!Number.isNaN(Date.parse(x.observedAt)));if(x.rawPath){a.equal(sha(bytes(p.join(d,x.rawPath))),x.rawSha256);rawBodies++;}else{a.ok(x.error);failureReceipts++;}if(x.textPath){a.equal(sha(bytes(p.join(d,x.textPath))),x.textSha256);textPins++;}}
const web=j(p.join(d,'web-fallback-observations.json'));for(const x of web)a.equal(sha(bytes(p.join(d,x.retainedObservationPath))),x.retainedObservationSha256);
for(const g of r.groups)for(const x of g.records){const ev=[...(g.evidence||[])].find(y=>y.key===x.evidenceSourceKey);if(ev&&x.evidenceBodySha256)a.equal(x.evidenceBodySha256,ev.rawSha256);}
const norm=x=>x.replace(/\s+/g,'');
for(const g of r.groups)for(const x of g.records){if(!x.quotedDate||x.evidenceSourceKey==='source-12'||x.evidenceSourceKey==='web-07')continue;const ev=(g.evidence||[]).find(y=>y.key===x.evidenceSourceKey);if(ev?.textPath)a.ok(norm(bytes(p.join(d,ev.textPath)).toString('utf8')).includes(norm(x.quotedDate)),x.recordId+' quoted date');}
const visual=j(p.join(d,'gmc-visual-reading.json'));const imagePins=[];function walk(v){if(!v||typeof v!=='object')return;if(v.path&&v.sha256&&String(v.path).endsWith('.png'))imagePins.push(v);for(const q of Object.values(v))walk(q);}walk(visual);for(const x of imagePins)a.equal(sha(bytes(p.join(d,x.path))),x.sha256);
const prior=new Set();function ids(x){if(!x||typeof x!=='object')return;if(typeof x.recordId==='string')prior.add(x.recordId);for(const v of Object.values(x))ids(v);}for(const pin of r.validation.priorReportPins){const b=bytes(p.join(root,pin.path));a.equal(sha(b),pin.sha256);ids(JSON.parse(b));}for(const x of rows)a.equal(prior.has(x.recordId),false,x.recordId+' prior overlap');
for(const [name,h] of Object.entries(r.inputFileSha256))a.equal(sha(bytes(p.join(primary,'content/data',name))),h);
console.log(JSON.stringify({reportSha256:done.reportSha256,selectionSha256:sha(bytes(p.join(d,'selection.json'))),counts,recordPins:rows.length,programPins,sourcePins,rawBodies,textPins,failureReceipts,webObservationPins:web.length,imagePins:imagePins.length,priorOverlap:0,publishedInInputSnapshot:false,reviewedRecordIds:rows.map(x=>x.recordId)},null,2));
