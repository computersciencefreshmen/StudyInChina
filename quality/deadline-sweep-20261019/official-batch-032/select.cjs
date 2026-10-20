/* Candidate evidence only. The C primary workspace stays read-only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina',dir=__dirname;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const statePath='quality/recovery-20261018/continuation-state.json',stateBytes=fs.readFileSync(path.join(root,statePath)),state=JSON.parse(stateBytes);
const queuePath=state.deadlineMaintenance.nextQueue,queueBytes=fs.readFileSync(path.join(root,queuePath)),q=JSON.parse(queueBytes);
const summaryPath=state.deadlineMaintenance.summary,summaryBytes=fs.readFileSync(path.join(root,summaryPath)),s=JSON.parse(summaryBytes);
assert.equal(summaryPath,'quality/deadline-sweep-20261019/official-review-summary-v10.json');assert.equal(queuePath,'quality/deadline-sweep-20261019/next-official-date-targets-v8.json');assert.equal(sha(summaryBytes),state.deadlineMaintenance.summarySha256);
const invPath='quality/deadline-sweep-20261019/catalog-deadlines.json',invBytes=fs.readFileSync(path.join(root,invPath)),inv=JSON.parse(invBytes);
const tables={};for(const [n,h]of Object.entries(inv.inputFileSha256)){const b=fs.readFileSync(path.join(root,'content/data',n));assert.equal(sha(b),h);tables[n]=JSON.parse(b)}
assert.equal(q.snapshotSha256,inv.snapshotSha256);assert.equal(s.snapshotSha256,inv.snapshotSha256);
const ps=new Map(tables['programs.json'].map(r=>[r.id,r])),src=new Map(tables['sources.json'].map(r=>[r.id,r]));
const universities=q.selectedUniversityIds.slice(6,12),excluded=new Set([...s.dateCheckedRecordIds,...s.carriedApprovedCycleIds,...s.carriedApprovedScholarshipIds]);
const cy=tables['admission-cycles.json'],aw=tables['scholarships.json'],uni=r=>r.programId?ps.get(r.programId).universityId:r.universityIds.find(u=>universities.includes(u));
const baseIds=q.selectedRecordIds.filter(id=>[...cy,...aw].some(r=>r.id===id&&universities.includes(uni(r))));
const extensionIds=['sch-gap-wave3-sztu-guangdong-government-scholarship','sch-gap-wave3-sztu-freshman-scholarship','cycle-gap-mew-0805-scw-scfai-art-studies-master-2026-2027-other-fee-reference','cycle-gap-mew-0805-scw-scfai-painting-bachelor-2026-2027-other-fee-reference'];
assert.equal(baseIds.length,16);const ids=[...baseIds,...extensionIds];for(const id of ids)assert.ok(!excluded.has(id),id+' already assessed');
const records=ids.map(id=>{const row=cy.find(r=>r.id===id)||aw.find(r=>r.id===id),program=row.programId?ps.get(row.programId):null;return{recordId:id,collection:program?'admissionCycles':'scholarships',universityId:uni(row),canonicalRecordSha256:sha(JSON.stringify(row)),row,program,canonicalProgramSha256:program?sha(JSON.stringify(program)):null,linkedPrograms:(program?[program]:(row.programIds||[]).map(id=>ps.get(id))).map(row=>({row,sha256:sha(JSON.stringify(row))})),sources:row.sourceIds.map(id=>{const row=src.get(id);assert.equal(row.official,true);return{row,sha256:sha(JSON.stringify(row))}})}});
const out={schemaVersion:1,batchId:'official-date-only-032-20261019',createdAt:new Date().toISOString(),primaryWorkspace:root,statePath,stateSha256:sha(stateBytes),summaryPath,summarySha256:sha(summaryBytes),queuePath,queueSha256:sha(queueBytes),inventoryPath:invPath,inventorySha256:sha(invBytes),snapshotSha256:inv.snapshotSha256,inputFileSha256:inv.inputFileSha256,selectedUniversityIds:universities,baseQueueRecordIds:baseIds,additionalSameSourceRecordIds:extensionIds,additionalSameSourceRecords:4,selectedRecordIds:ids,records};
fs.writeFileSync(path.join(dir,'selection.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({selectionSha256:sha(fs.readFileSync(path.join(dir,'selection.json'))),records:records.length,urls:[...new Set(records.flatMap(r=>r.sources.map(s=>s.row.url)))]},null,2));
