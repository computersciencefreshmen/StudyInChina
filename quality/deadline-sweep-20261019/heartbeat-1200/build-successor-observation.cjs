const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const primary = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const relative = 'quality/deadline-sweep-20261019/';
const batch = relative + 'official-batch-032/';
const bytes = p => fs.readFileSync(p);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(bytes(p));
const normalize = s => s.replace(/\s+/g, '').normalize('NFKC');
const reportPath = batch + 'report.json';
const report = read(reportPath);
assert.equal(sha(bytes(reportPath)), '7ca2417531ff19ae0b9c7b348bf40be89d9029a48b7930172d876488b663b982');
const group = report.groups.find(g => g.key.startsWith('sztu-successor2027-'));
assert.ok(group);
assert.equal(group.records.length, 6);
assert.ok(group.records.every(r => r.result === 'unknown' && !r.canonicalDateChanged));
const observationPath = batch + group.successorObservation.path;
assert.equal(sha(bytes(observationPath)), group.successorObservation.sha256);
const observation = read(observationPath);
const pins = observation.sourcePins.map(pin => {
  const p = batch + pin.path;
  assert.equal(sha(bytes(p)), pin.sha256);
  return {path:p, sha256:pin.sha256};
});
const admission = bytes(batch+'sztu-admission.txt').toString('utf8');
const procedure = bytes(batch+'sztu-procedure.txt').toString('utf8');
assert.ok(normalize(admission).includes(normalize(observation.yearTitle)));
assert.ok(normalize(admission).includes(normalize(observation.releaseTitleDate)));
assert.ok(normalize(procedure).includes(normalize(observation.applicationPeriodQuote)));
assert.ok(normalize(procedure).includes(normalize(observation.staleProcessQuote)));
const previous = relative + 'heartbeat-0900/successor-date-observations-v1.json';
const previousBytes = bytes(path.join(primary, previous));
const result = {
  schemaVersion:1, observedAt:new Date().toISOString(),
  previousObservationReceipt:{path:previous, sha256:sha(previousBytes)},
  sourceReport:{path:reportPath, sha256:sha(bytes(reportPath))},
  sourceObservation:{path:observationPath, sha256:sha(bytes(observationPath))},
  newAnnualWindowObservations:[{
    universityId:group.universityId,
    observedAt:observation.observedAt,
    originalPins:pins,
    sources:group.evidence.map(e=>({url:e.url, observedAt:e.observedAt, rawPath:batch+e.rawPath, rawSha256:e.rawSha256, textPath:batch+e.textPath, textSha256:e.textSha256})),
    yearTitle:observation.yearTitle,
    publicationDateQuote:observation.releaseTitleDate,
    applicationPeriodQuote:observation.applicationPeriodQuote,
    applicationPeriodQuoteSha256:sha(observation.applicationPeriodQuote),
    candidateOpensOn:observation.observedSuccessorOpensOn,
    candidateDeadline:observation.observedSuccessorDeadline,
    candidateIntakeYear:2027,
    internalDateConflict:{quote:observation.staleProcessQuote, quoteSha256:sha(observation.staleProcessQuote), reason:'July 2026 processing step predates the explicit November 2026 opening in the same official procedure.'},
    storedScopes:group.records.map(r=>({recordId:r.recordId, collection:r.collection, canonicalRecordSha256:r.canonicalRecordSha256, academicYear:r.academicYear||null, storedDeadline:r.storedDeadline, result:r.result})),
    appliesToStoredRecord:false,
    status:'held-unapplied-successor-observation-with-source-date-conflict',
    independentScholarshipDatesEstablished:false,
    futureOpeningAsOfAuditDate:true,
    auditDate:'2026-10-19',
    noYearRollover:true,
    canonicalDateChanged:false,
    quoteMatching:'Whitespace-normalized against archived extracted text; original body/text and original quotation hashes retained.'
  }],
  canonicalFactsChanged:false, freshnessRenewed:false,
  newCycleOrAwardCreated:false, applicationsCurrentlyOpenEstablished:false
};
const target = relative + 'heartbeat-1200/successor-date-observations-v1.json';
fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({path:target,sha256:sha(bytes(target)),sourceRows:group.records.length,quoteAndOriginalChecksPassed:true}));
