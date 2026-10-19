/* Evidence preparation only. Canonical workspace is strictly read-only. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina',dir=__dirname;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const statePath='quality/recovery-20261018/continuation-state.json',stateBytes=fs.readFileSync(path.join(root,statePath)),state=JSON.parse(stateBytes);
const queuePath=state.deadlineMaintenance.nextQueue,queueBytes=fs.readFileSync(path.join(root,queuePath)),q=JSON.parse(queueBytes);
const summaryPath=state.deadlineMaintenance.summary,summaryBytes=fs.readFileSync(path.join(root,summaryPath)),s=JSON.parse(summaryBytes);
assert.equal(sha(summaryBytes),state.deadlineMaintenance.summarySha256);assert.ok(queuePath.endsWith('v9.json'));assert.ok(summaryPath.endsWith('v11.json'));
const inventoryPath='quality/deadline-sweep-20261019/catalog-deadlines.json',inventoryBytes=fs.readFileSync(path.join(root,inventoryPath)),inv=JSON.parse(inventoryBytes);
const tables={};for(const[n,h]of Object.entries(inv.inputFileSha256)){const b=fs.readFileSync(path.join(root,'content/data',n));assert.equal(sha(b),h);tables[n]=JSON.parse(b)}
assert.equal(q.snapshotSha256,inv.snapshotSha256);assert.equal(s.snapshotSha256,inv.snapshotSha256);
const ps=new Map(tables['programs.json'].map(r=>[r.id,r])),src=new Map(tables['sources.json'].map(r=>[r.id,r]));
const universities=q.selectedUniversityIds.slice(7,14),excluded=new Set([...s.dateCheckedRecordIds,...s.carriedApprovedCycleIds,...s.carriedApprovedScholarshipIds]);
const cy=tables['admission-cycles.json'],aw=tables['scholarships.json'],uni=r=>r.programId?ps.get(r.programId).universityId:r.universityIds.find(u=>universities.includes(u));
const baseIds=q.selectedRecordIds.filter(id=>[...cy,...aw].some(r=>r.id===id&&universities.includes(uni(r))));
const extensions=[];assert.equal(baseIds.length,16);const ids=[...baseIds];for(const id of ids)assert.ok(!excluded.has(id),id+' already assessed');
const records=ids.map(id=>{const row=cy.find(r=>r.id===id)||aw.find(r=>r.id===id),program=row.programId?ps.get(row.programId):null;return{recordId:id,collection:program?'admissionCycles':'scholarships',universityId:uni(row),canonicalRecordSha256:sha(JSON.stringify(row)),row,program,canonicalProgramSha256:program?sha(JSON.stringify(program)):null,linkedPrograms:(program?[program]:(row.programIds||[]).map(id=>ps.get(id))).map(row=>({row,sha256:sha(JSON.stringify(row))})),sources:row.sourceIds.map(id=>{const row=src.get(id);assert.equal(row.official,true);return{row,sha256:sha(JSON.stringify(row))}})}});
const out={schemaVersion:1,batchId:'official-date-only-035-20261019',createdAt:new Date().toISOString(),primaryWorkspace:root,statePath,stateSha256:sha(stateBytes),summaryPath,summarySha256:sha(summaryBytes),queuePath,queueSha256:sha(queueBytes),inventoryPath,inventorySha256:sha(inventoryBytes),snapshotSha256:inv.snapshotSha256,inputFileSha256:inv.inputFileSha256,selectedUniversityIds:universities,baseQueueRecordIds:baseIds,additionalSameSourceRecordIds:extensions.map(r=>r.id),selectedRecordIds:ids,records};
fs.writeFileSync(path.join(dir,'selection.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({selectionSha256:sha(fs.readFileSync(path.join(dir,'selection.json'))),records:records.map(r=>({id:r.recordId,school:r.universityId,year:r.row.academicYear,deadline:r.row.closesOn??r.row.deadline??null,programme:r.program?.name,degree:r.program?.degreeLevel,language:r.program?.languageOfInstruction,sources:r.sources.map(s=>({id:s.row.id,url:s.row.url}))}))},null,2));

