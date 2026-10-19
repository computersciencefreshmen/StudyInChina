const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');
const d=__dirname,read=n=>JSON.parse(fs.readFileSync(p.join(d,n))),hash=n=>crypto.createHash('sha256').update(fs.readFileSync(p.join(d,n))).digest('hex');
const report=read('report.json');
const receipt={
 schemaVersion:1,reviewId:'independent-date-only-022-v1',reviewedAt:new Date().toISOString(),reviewer:'deployment_audit subagent; did not author batch022',
 reviewedReportSha256:hash('report.json'),reviewedSelectionSha256:hash('selection.json'),reviewedRootExtensionSha256:report.selection.additionalSelectionReceiptSha256,
 decision:'source-only-accepted-with-explicit-HMU-offline-original-limitations',
 scope:'Independent offline full HTML-body reads, all six original scanned GMC PDF page images, exact row/program/source/queue/extension/input pin checks. No network rereads. HMU web observations are reviewed for internal consistency only; full tool response and origin bytes are not retained.',
 counts:{schools:7,records:29,baseQueueRecords:22,additionalSameSourceRecords:7,closedCandidateScopes:16,originalBodySupportedClosedCandidates:13,webObservationOnlyClosedCandidates:3,unknown:11,blocked:2,canonicalInputHashes:6,canonicalRecordHashes:29,programmePins:29,sourceRecordPins:46,rawBodies:11,textPins:11,failureReceiptsWithoutBody:2,webObservationPins:3,pdfImagePins:6,priorRecordOverlap:0},
 checks:{exact22BasePlus7AdditionalIdsMatch:true,allSixCanonicalInputsUnchanged:true,fullSelectionRowsAndParentAndSourcePinsMatch:true,rootExtensionExactHashesMatch:true,rawAndTextAndObservationHashesMatch:true,allSixPdfImagesIndependentlyViewed:true,singleGroupsRecordsRepresentation:true,allClosedResultsCandidateOnly:true,noCanonicalDateOrOpeningEqualityCertified:true,noWholeSchoolCompletionClaim:true,noAnnualOrPublicationYearRolledForward:true,noAwardDeadlineBorrowedFromGeneralAdmission:true,publishedInInputSnapshot:false},
 sourceFindings:[
  {school:'Guizhou Medical University',finding:'2026 PDF cover and p5 Application Time confirm till 30 September 2026. All six rendered pages independently viewed. Clinical Medicine is 1+5 years with preparatory Chinese; BDS is five years but selected Chinese-language route is not explicit. Both exact canonical routes correctly remain unknown, with an unbound September30 candidate.'},
  {school:'Guizhou Normal University',finding:'Actual 2026 fall semester/year language notice gives Chinese before May30 and English by May30. Both formulations and absence of clock time are preserved. School scholarship is listed without an independent applicant cutoff and correctly remains unknown.'},
  {school:'Hainan Medical University',finding:'Actual bilingual 2026 guide names five-year Chinese Clinical Medicine. July15 is explicit self-funded submission, May20 names Hainan Government Scholarship, September15 is registration. ASEAN remains unknown because broader before-May20 guidance is not an independently explicit dated ASEAN deadline.'},
  {school:'Hangzhou Dianzi University',finding:'Full actual 2026 guide contains exact nine degree/language programme bindings and one shared June15/when-seats-full applicant cutoff. Mechanical bachelor exact Chinese title differs from shorter English label but matches the actual table. Earlier capacity closure is possible; no capacity date is invented. SONIS first-year award correctly has no borrowed independent cutoff.'},
  {school:'Harbin Medical University',finding:'Three named scholarship branches retain November1 2025 to March5 2026 as author-observed official full-notice evidence only. Native403 body is captured but is not deadline proof. No full web return or original successful body exists for independent replay; observation SHA identifies the retained excerpt/summary only. Two general master/doctoral rows remain unknown because scholarship period does not certify general/self-funded routes and the generic guide PDF was captcha-held.'},
  {school:'Harbin Normal University',finding:'Native TLS timeout plus one web timeout are retained. Both award rows are blocked; no date, applicant year, rolling or open state is inferred.'},
  {school:'Hebei Medical University',finding:'Annual early September to following February CSC process is month-level recurring guidance, not an exact 2026/2027 date. Current degree-guide landing links an oversized PDF; the stopped partial capture is not represented as full bytes or date proof. Three degree rows and the generic award correctly remain unknown.'}
 ],
 limitedRecordIds:['sch-gap-wave3-sch-hmu-csc-high-level-graduate','sch-gap-wave3-sch-hmu-csc-silk-road','sch-gap-wave3-sch-hmu-moe-heilongjiang-eurasia'],
 limitations:[
  'The three HMU past-date observations are source-only accepted with limitations; this independent reviewer did not replay or independently verify the missing full official body. Retained observation hashes must never be called origin body hashes.',
  'This receipt grants no canonical mutation, freshness renewal, public date change or publication approval. A future exact-row consumer needs its own applicability and CAS gate.',
  'An expired application window does not establish programme discontinuation. Unknown and blocked records remain unresolved.',
  'Before/by ambiguity, when-seats-full conditions, separate scholarship scopes, registration dates and unsupported exact programme languages/durations must remain visible.'
 ],
 reviewedRecordIds:report.groups.flatMap(g=>g.records.map(r=>r.recordId)),
 reviewedVisualArtifacts:[1,2,3,4,5,6].map(n=>`source-12-page-${n}.png`),
 checksScript:'independent-review-check.cjs',checksScriptSha256:hash('independent-review-check.cjs'),networkRequestsByReviewer:0,canonicalWrites:0,sharedProgressWrites:0,gitMutations:0,paidCalls:0
};
if(receipt.reviewedReportSha256!=='2d53347f63edde1efc6817ddccd2b5e6ebd7e72fca45582688fb313aa65ddab8')throw new Error('Frozen report changed');
fs.writeFileSync(p.join(d,'independent-review-v1.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({reviewSha256:hash('independent-review-v1.json'),reportSha256:receipt.reviewedReportSha256,decision:receipt.decision,counts:receipt.counts}));
