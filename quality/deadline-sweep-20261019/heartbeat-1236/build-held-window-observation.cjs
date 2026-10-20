const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const c='C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const base='quality/deadline-sweep-20261019/',batch=base+'official-batch-039/';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=p=>fs.readFileSync(p),read=p=>JSON.parse(bytes(p));
const normalize=s=>s.replace(/\s+/g,'').normalize('NFKC');
const reportPath=batch+'report.json',report=read(reportPath);
assert.equal(sha(bytes(reportPath)),'82f000484e1b310f4101e0bf377c1d9ce3da9dd3f05b37159c54acd4c8664380');
const sourcePath=batch+'bfsu-spring-window-observation-v1.json',observation=read(sourcePath);
assert.equal(sha(bytes(sourcePath)),'c271cd27c32cd785abafe5a239d3b0a039d77e2c77510712e0f915ee256621f6');
assert.ok(JSON.stringify(report).includes(sha(bytes(sourcePath))));
assert.equal(observation.targetSpring2027Established,false);
assert.equal(observation.currentOpenStatusCertified,false);
assert.equal(observation.canonicalWritePerformed,false);
const originalPins=[observation.source.raw,observation.source.text,observation.selection].map(pin=>({path:batch+pin.path,sha256:pin.sha256}));
for(const pin of originalPins)assert.equal(sha(bytes(pin.path)),pin.sha256);
const text=bytes(batch+observation.source.text.path).toString('utf8');
for(const quote of Object.values(observation.quotes))assert.ok(normalize(text).includes(normalize(quote)));
const previous=base+'heartbeat-1200/successor-date-observations-v1.json';
const previousBytes=bytes(path.join(c,previous));
const result={schemaVersion:1,observedAt:new Date().toISOString(),
  previousObservationReceipt:{path:previous,sha256:sha(previousBytes)},
  sourceReport:{path:reportPath,sha256:sha(bytes(reportPath))},
  sourceObservation:{path:sourcePath,sha256:sha(bytes(sourcePath))},
  newAnnualWindowObservations:[{
    kind:'held-application-window-observation-intake-year-ambiguous',
    universityId:observation.universityId,
    sourceUrl:observation.source.url,sourceObservedAt:observation.source.observedAt,originalPins,
    observedApplicationWindow:observation.statedApplicationWindow,
    quotes:Object.fromEntries(Object.entries(observation.quotes).map(([key,value])=>[key,{text:value,sha256:sha(value)}])),
    statedGeneralEnrollmentYear:observation.statedGeneralEnrollmentYear,
    springCommencementYear:null,candidateAcademicYear:null,
    targetIntakeYearCertain:false,targetSpring2027Established:false,
    storedScopes:observation.storedRows.map(row=>({recordId:row.recordId,collection:row.collection,academicYear:row.academicYear,intake:row.intake,storedDeadline:row.storedDeadline,canonicalRecordSha256:row.canonicalRecordSha256})),
    status:observation.status,reason:observation.reason,
    canonicalDateCandidateApproved:false,appliesToStoredRecord:false,
    noYearRollover:true,canonicalDateChanged:false,
    quoteMatching:'Whitespace-normalized against archived extracted text; raw/text, original quotation and full stored-row hashes retained.'
  }],canonicalFactsChanged:false,freshnessRenewed:false,newCycleOrAwardCreated:false,applicationsCurrentlyOpenEstablished:false};
const output=base+'heartbeat-1236/successor-date-observations-v1.json';
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({path:output,sha256:sha(bytes(output)),storedScopes:observation.storedRows.length,allOriginalQuoteAndReceiptChecksPassed:true}));
