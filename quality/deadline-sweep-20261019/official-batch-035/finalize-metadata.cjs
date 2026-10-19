/* Pre-freeze precision repair only: retain originals and do not change any result. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir=__dirname,sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const reportPath=path.join(dir,'report.json'),obsPath=path.join(dir,'smu-web-fallback-observation.json'),reportBytes=fs.readFileSync(reportPath),obsBytes=fs.readFileSync(obsPath),r=JSON.parse(reportBytes),o=JSON.parse(obsBytes);
assert.equal(sha(reportBytes),'4b2517928773508f899becc1f3ed3b3928f17c205c35b8f5cceed923ab1f47f9');
fs.writeFileSync(path.join(dir,'report-pre-finalization-v1.json'),reportBytes,{flag:'wx'});fs.writeFileSync(path.join(dir,'smu-web-fallback-observation-pre-finalization-v1.json'),obsBytes,{flag:'wx'});
delete o.observedAt;delete o.observedAtPrecision;
o.observedAtInterval={notBefore:'2026-10-19T12:19:49.240417+00:00',notAfter:'2026-10-19T12:22:27.484294+00:00',basis:'The fallback tool read occurred after the native SMU TLS failure and before the following successful TYUT page capture. The web tool did not return its own exact timestamp; no exact timestamp is invented.'};
const nextObsBytes=Buffer.from(JSON.stringify(o,null,2)+'\n');fs.writeFileSync(obsPath,nextObsBytes);
const oldHash=sha(obsBytes),newHash=sha(nextObsBytes);
const replace=v=>{if(Array.isArray(v))return v.map(replace);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,replace(v)]));return v===oldHash?newHash:v};
const final=replace(r),note={schemaVersion:1,recordedAt:new Date().toISOString(),scope:'Pre-freeze observation-time precision repair only. All twenty result, date and canonical bindings remain identical.',provisionalReport:{path:'report-pre-finalization-v1.json',sha256:sha(reportBytes)},provisionalObservation:{path:'smu-web-fallback-observation-pre-finalization-v1.json',sha256:oldHash},finalObservation:{path:'smu-web-fallback-observation.json',sha256:newHash},resultsUnchanged:true,allSixInputHashesUnchanged:true};
const noteBytes=Buffer.from(JSON.stringify(note,null,2)+'\n');fs.writeFileSync(path.join(dir,'pre-freeze-metadata-finalization.json'),noteBytes,{flag:'wx'});final.validation.preFreezeMetadataFinalization={path:'pre-freeze-metadata-finalization.json',sha256:sha(noteBytes)};
assert.deepEqual(final.groups.flatMap(g=>g.records).map(v=>[v.recordId,v.result,v.officialDeadline]),r.groups.flatMap(g=>g.records).map(v=>[v.recordId,v.result,v.officialDeadline]));
const finalBytes=Buffer.from(JSON.stringify(final,null,2)+'\n');fs.writeFileSync(reportPath,finalBytes);console.log(JSON.stringify({finalReportSha256:sha(finalBytes),results:final.summary.recordResults,records:final.summary.recordsAssessed}));
