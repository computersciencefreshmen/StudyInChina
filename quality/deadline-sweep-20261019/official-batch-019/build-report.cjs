const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const root = __dirname;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const rowSha = x => sha(JSON.stringify(x));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const selection = read(path.join(root, 'selection.json'));
const captures = read(path.join(root, 'capture-summary.json'));
const supplement = read(path.join(root, 'gdufe-2026-original-guide.receipt.json'));
const allCaptures = [...captures, supplement];
const source = key => allCaptures.find(x => x.key === key);
const text = key => fs.readFileSync(path.join(root, source(key).textPath), 'utf8');
const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
const quotePresent = (key, quote) => assert.ok(compact(text(key)).includes(compact(quote)), `Missing original quote: ${key} ${quote}`);
assert.equal(selection.records.length, 15);
assert.equal(selection.baseQueueRecordIds.length, 12);
assert.equal(selection.additionalSameSourceRecordIds.length, 3);
const fileHashes = Object.fromEntries(Object.keys(selection.inputFileSha256).map(name => [name, sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name)))]));
assert.deepEqual(fileHashes, selection.inputFileSha256);
assert.equal(sha(JSON.stringify(fileHashes)), selection.snapshotSha256);
const planPath = path.join(selection.primaryWorkspace, selection.queuePath);
assert.equal(sha(fs.readFileSync(planPath)), selection.queueSha256);
assert.deepEqual(read(planPath).selectedUniversityIds.slice(0, 7), selection.universityIds);
const extensionPath = path.resolve(root, '../../..', selection.additionalSelectionReceipt);
const extensionBytes = fs.readFileSync(extensionPath);
const extension = JSON.parse(extensionBytes);
assert.equal(sha(extensionBytes), selection.additionalSelectionReceiptSha256);
assert.equal(extension.baseQueueSha256, selection.queueSha256);
for (const id of selection.additionalSameSourceRecordIds) assert.ok(extension.extraRecords.some(x => x.recordId === id && x.canonicalRecordSha256 === selection.records.find(x => x.recordId === id).canonicalRecordSha256));
for (const capture of allCaptures.filter(x => x.rawPath)) {
  assert.equal(sha(fs.readFileSync(path.join(root, capture.rawPath))), capture.rawSha256);
  assert.equal(sha(fs.readFileSync(path.join(root, capture.textPath))), capture.textSha256);
  assert.equal(fs.readFileSync(path.join(root, capture.rawPath)).length, capture.bytes);
}
assert.equal(captures.length, 10);
assert.equal(captures.filter(x => x.httpStatus === 200).length, 9);
assert.match(source('source-09').error, /UNEXPECTED_EOF_WHILE_READING/);
assert.equal(supplement.httpStatus, 200);
assert.equal(supplement.sourceRawSha256, source('source-04').rawSha256);
const landingDoc = new JSDOM(fs.readFileSync(path.join(root, 'source-04.html'), 'utf8')).window.document;
assert.equal(new URL(landingDoc.querySelector('[pdfsrc]').getAttribute('pdfsrc'), source('source-04').url).href, supplement.url);
quotePresent('source-10', '2026-2027 ChineseLanguageTrainingProgram of East China University ofPoliticalScience andLaw');
quotePresent('source-06', 'Automatic Consideration for School Scholarships');
quotePresent('source-06', 'Additional Scholarship Opportunities (Application Required)');
quotePresent('source-02', '(Bachelor of Chinese Language)');
quotePresent('source-02', 'From now until May 30, 2026. Applications submitted after the deadline will not be accepted.');
quotePresent('source-01', "2026 Admission Brochure of Fuzhou University for International Master's and Doctoral Students");
quotePresent('source-01', 'From now until May 15, 2026. Applications submitted after the deadline will not be accepted.');
quotePresent('source-01', 'by February 20, 2026');
const masterSection = compact(text('source-01').split("(I) Master's Degree Programs:")[1].split('(II) Doctoral Degree Programs:')[0]);
const doctoralSection = compact(text('source-01').split('(II) Doctoral Degree Programs:')[1].split('IV. Application Materials')[0]);
assert.ok(masterSection.includes('English-taughtprograms') && masterSection.includes('GeotechnicalEngineering') && masterSection.includes('MunicipalEngineering'));
assert.ok(doctoralSection.includes('English-taughtprograms') && doctoralSection.includes('ElectricalTheoryandNewTechnology'));
quotePresent('source-01', 'Applicants may simultaneously apply for the Fujian Provincial Government Scholarship for International Students and the Fuzhou University Scholarship for International Students. No additional materials are needed.');
quotePresent('source-08', 'date：2024-05-13');
quotePresent('source-08', 'Application Deadline:10thJuly');
quotePresent('source-05', 'Release Date：2022-11-05');
quotePresent('gdufe-2026-original-guide', '2026 International Students Enrollment Guide of Full–time Undergraduate Programs');
quotePresent('gdufe-2026-original-guide', 'VII. Application Deadlines: June 1, 2026');

const fallback = { schemaVersion: 1, sourceKey: 'source-09', url: source('source-09').url, method: 'web.open', boundedFallbackNumber: 1,
  recordedAt: new Date().toISOString(), result: 'Failed to fetch: (502) Bad Gateway', succeeded: false, rawOriginalAvailableFromWebTool: false,
  timingQualification: 'recordedAt is the transcription time. The web tool did not expose an origin response timestamp.',
  retryPolicy: 'One normal bounded fallback exhausted; wait for changed source/network conditions or a later bounded recovery window. No TLS bypass.' };
const fallbackPath = path.join(root, 'ecust-web-fallback.receipt.json');
if (!fs.existsSync(fallbackPath)) fs.writeFileSync(fallbackPath, JSON.stringify(fallback, null, 2) + '\n', { flag: 'wx' });
const evidence = [
  { key: 'ecupl-language-no-deadline', sourceKeys: ['source-10'], dateQuotes: [],
    scope: 'The visible body explicitly identifies academic year2026-2027, despite the2024wrapper/date. The programme outline only describes classes, semesters and study timetable.',
    programmeQuote: '2026-2027 Academic Year',
    nonDeadlineQuote: 'Usually starts in early Septemberand ends at the end of June of the following year.',
    interpretation: 'No application cutoff or official rolling-application statement is printed. Course finish is not an application deadline.' },
  { key: 'ecust-tls-source-blocked', sourceKeys: ['source-09'], dateQuotes: [],
    scope: 'Exact stored Shanghai Government Scholarship source could not be read with normal trusted TLS; web fallback502also failed.',
    interpretation: 'No award dates, year or open/closed status is certified from source metadata or the failed response.' },
  { key: 'fjmu-award-table-no-deadline', sourceKeys: ['source-06'], dateQuotes: [],
    scope: 'One-page graduate fees and scholarship schedule; no admission/award calendar dates appear.',
    programmeQuotes: ['Automatic Consideration for School Scholarships', 'Additional Scholarship Opportunities (Application Required)'],
    interpretation: 'Freshman school awards are automatic consideration; Fujian provincial co-funding requires application. Neither receives a numeric cutoff from annual benefit amounts or the application-platform link.',
    visualPageInspected: 1 },
  { key: 'fzu-2026-chinese-bachelor', sourceKeys: ['source-02', 'source-07'],
    dateQuotes: [{ quote: 'From now until May 30, 2026. Applications submitted after the deadline will not be accepted.', locator: 'source-02 II. Application Time', meaning: 'General applicant deadline for the exact2026BachelorofChineseLanguagecall.' }],
    scope: '2026 Chinese Language bachelor admission. The old tuition page supports fees only; it supplies no application deadline.',
    openingQualifier: 'From now is relative and does not establish a numeric opening date.' },
  { key: 'fzu-2026-postgraduate-general', sourceKeys: ['source-01'],
    dateQuotes: [{ quote: 'From now until May 15, 2026. Applications submitted after the deadline will not be accepted.', locator: 'II. Application Time', meaning: 'General programme application period and paper-materials submission endpoint.' },
      { quote: 'Applicants for the Chinese Government Scholarship must complete the online application on the China Scholarship Council website and send all paper application materials to Fuzhou University by February 20, 2026.', locator: 'II. Application Time / Please note', meaning: 'Earlier applicant CSC-specific branch, not the deadline of every provincial/university award or general programme route.' }],
    scope: 'Exact English-taught master programmes GeotechnicalEngineeringandMunicipalEngineeringare listed underIII(I);ElectricalTheoryandNewTechnologyis underIII(II)English-taughtdoctoralprogrammes in the same2026guide.',
    fundingQualification: 'The May15observation concerns the general programme admission route only. It does not give a CSC applicant permission to wait past the earlierFebruary20requirement.',
    excludedInstitutionDate: 'The result-release paragraph contains endofJune2025inside a2026guide; it is not used as an applicant date or year anchor.' },
  { key: 'fzu-broad-awards-no-single-date', sourceKeys: ['source-01', 'source-02'],
    dateQuotes: [],
    scope: 'Generic Fujian provincial and Fuzhou University scholarships span undergraduate/master/doctoral admission categories.',
    applicationRuleQuote: 'Applicants may simultaneously apply for the Fujian Provincial Government Scholarship for International Students and the Fuzhou University Scholarship for International Students. No additional materials are needed.',
    interpretation: 'Guides allow simultaneous award consideration but have different degree-route deadlines (bachelorMay30, postgraduateMay15; CSCearlierFebruary20is a different award). No single independent award cutoff is selected for these broad award records.' },
  { key: 'gdmu-historical-admission-not-award-date', sourceKeys: ['source-08'],
    dateQuotes: [{ quote: 'V. Application Deadline: 10th July', locator: 'V. Application Deadline', meaning: 'Month/day in a2024published undergraduate admission brochure, not an exact current scholarship cutoff.' }],
    scope: 'The page links an International Freshmen Scholarship form. It does not publish a separately bound current scholarship application year or deadline.',
    interpretation: 'Do not transfer an old general-admission month/day to this scholarship.' },
  { key: 'gdou-old-programme-list-no-dates', sourceKeys: ['source-05'], dateQuotes: [],
    scope: '2022published undergraduate catalogue names AquacultureandTCSoLwith fees. No application dates or current2026entry window are stated.',
    interpretation: 'Programme existence and fees alone are not deadline evidence; no rolling or open status is inferred.' },
  { key: 'gdufe-2026-original-pdf', sourceKeys: ['source-03', 'source-04', 'gdufe-2026-original-guide'],
    dateQuotes: [{ quote: 'VII. Application Deadlines: June 1, 2026', locator: 'Embedded official PDF p14; Chinese equivalentp5', meaning: '2026undergraduate general applicant deadline, verified in the actual original rather than the landing page.' }],
    scope: 'The current bilingual2026PDFenrollment tablep2/p12 lists only InternationalBusiness(English,BachelorofManagement,4years) and ChineseLanguageLiterature(BusinessChinese).',
    exactProgrammeVisualObservation: { page: 12, rows: [{ programme: 'International Business', degree: 'Bachelor of Management', language: 'English', duration: '4 Years' }, { programme: 'Chinese Language Literature(Business Chinese)', degree: 'Bachelor of Arts', language: 'Chinese', duration: '4 Years' }] },
    unboundLegacyProgramme: 'International Economics and Trade is not in this captured2026enrollment table. Absence is not a formal discontinuation notice, and the June1cutoff is not bound to that legacy row.',
    discovery: { parentSourceKey: 'source-04', parentRawSha256: source('source-04').rawSha256, attribute: 'div.pdfsrc', originalPdfUrl: supplement.url, originalPdfRawSha256: supplement.rawSha256 },
    visualPagesInspected: [12, 14] }
];
const groups = [];
const idsFor = school => selection.records.filter(x => x.universityId === school).map(x => x.recordId);
function add(groupKey, evidenceKey, ids, assess) {
  const ev = evidence.find(x => x.key === evidenceKey);
  const records = ids.map(id => {
    const s = selection.records.find(x => x.recordId === id), row = s.row;
    const pins = s.sources.filter(x => ev.sourceKeys.some(key => source(key).url === x.row.url)).map(x => ({ sourceId: x.row.id, url: x.row.url, canonicalSourceSha256: x.sha256, sourceFullRecord: x.row }));
    assert.ok(pins.length && pins.every(x => x.sourceFullRecord.official));
    const result = assess(s);
    if (result.result === 'closed') assert.ok(result.officialDeadline < '2026-10-19');
    else assert.equal(result.officialDeadline, null);
    return { collection: s.collection, recordId: id, selectionOrigin: s.additionalSameSourceBinding ? 'additionalSameSource3' : 'baseQueue12',
      universityId: s.universityId, ...(s.program ? { programId: s.program.id, programName: s.program.name.en, degreeLevel: s.program.degreeLevel, academicYear: row.academicYear, intake: row.intake, canonicalCycleSha256: s.canonicalRecordSha256, canonicalProgramSha256: s.canonicalProgramSha256 } : { name: row.name.en, programIds: row.programIds, canonicalScholarshipSha256: s.canonicalRecordSha256 }),
      canonicalRowSha256: s.canonicalRecordSha256, canonicalRecordSha256: s.canonicalRecordSha256,
      sourceIds: row.sourceIds, evidenceSourcePins: pins, evidenceKey,
      storedDeadline: s.collection === 'admissionCycles' ? row.closesOn : row.deadline, storedOpensOn: row.opensOn ?? null,
      storedDateStatus: row.dateStatus ?? null, storedStatus: row.status, storedVerifiedAt: row.verifiedAt, storedReviewAfter: row.reviewAfter,
      officialOpensOn: null, candidateOfficialDeadline: null, candidateOnly: true, dateOnly: true,
      canonicalWritePerformed: false, canonicalDateChanged: false, freshnessRenewed: false, fullFactsCertified: false,
      openingDateAssessed: false, canonicalDateEqualityConfirmed: false, programmeDiscontinuedConfirmed: false,
      rawRecordPreservedIn: 'selection.json', requiresIndependentApprovalAndCasBeforeMutation: true, ...result };
  });
  groups.push({ key: groupKey, universityId: records[0].universityId, evidenceKey, records });
}
add('ecupl-language', 'ecupl-language-no-deadline', idsFor(selection.universityIds[0]), () => ({ result: 'unknown', officialDeadline: null,
  reason: 'Actual2026-2027body has course semester dates but no applicant cutoff or explicit rolling rule. Wrapper2024is not the admission year.' }));
add('ecust-award-source-blocked', 'ecust-tls-source-blocked', idsFor(selection.universityIds[1]), () => ({ result: 'blocked', officialDeadline: null,
  reason: 'Normal-TLS original failed with unexpectedEOFand one boundedwebfallbackfailed502; no scholarship date or open status revalidated.' }));
add('fjmu-two-awards', 'fjmu-award-table-no-deadline', idsFor(selection.universityIds[2]), s => ({ result: 'unknown', officialDeadline: null,
  dateRelatedApplicationRule: s.recordId.includes('freshman') ? 'automatic school scholarship consideration; no separate numeric award cutoff published' : 'additional provincial scholarship requires application; no numeric cutoff published',
  reason: 'The one-pagefees/scholarshipschedule has no applicant date or applicablecalendar year; benefit duration and platform URL do not establish a deadline.' }));
const fzu = idsFor(selection.universityIds[3]);
add('fzu-chinese-bachelor-general', 'fzu-2026-chinese-bachelor', fzu.filter(id => id.includes('chinese-language-bachelor')), () => ({ result: 'closed', officialDeadline: '2026-05-30', candidateOfficialDeadline: '2026-05-30', applicableEntryYear: 2026,
  deadlineBoundary: 'date-only-no-cutoff-clock-stated', applicationScope: 'Exact2026BachelorofChineseLanguagegeneralapplicant route, including required paper materials',
  reason: 'Exact degree/programme/year admission guide givesMay30; canonical null remains unchanged and scholarship deadlines are not borrowed.' }));
add('fzu-three-additional-postgraduate-general', 'fzu-2026-postgraduate-general', selection.additionalSameSourceRecordIds, s => ({ result: 'closed', officialDeadline: '2026-05-15', candidateOfficialDeadline: '2026-05-15', applicableEntryYear: 2026,
  programmeScopeMatch: { name: s.program.name.en, degree: s.program.degreeLevel, language: 'English', originalSection: s.program.degreeLevel === 'master' ? 'III(I)MasterEnglish-taught' : 'III(II)DoctorEnglish-taught' },
  applicationScope: 'General programme admission deadline only; applicants using CSCmust separately meet the earlierFebruary20branch',
  excludedEarlierFundingBranch: { route: 'Chinese Government Scholarship applicant', deadline: '2026-02-20', obligation: 'CSCportalcompletionandsubmissionofallpapermaterialstouniversity', adoptedAsGenericProgrammeDeadline: false },
  deadlineBoundary: 'date-only-no-cutoff-clock-stated',
  reason: 'Exact2026Englishprogrammeandcorrectdegreeareexplicitinthesameguide. May15isgeneraladmission; it is not permissionforCSCapplicants to ignoreFebruary20. Fee-reference naming alone was not used.' }));
add('fzu-two-broad-awards', 'fzu-broad-awards-no-single-date', fzu.filter(id => id.startsWith('sch-')), () => ({ result: 'unknown', officialDeadline: null,
  candidateAdmissionWindowsNotSingleAwardCutoff: [{ degreeRoute: 'BachelorofChineseLanguage2026', admissionDeadline: '2026-05-30' }, { degreeRoute: '2026master/doctoral general admission', admissionDeadline: '2026-05-15' }],
  excludedCscDeadline: '2026-02-20', applicationConstraint: 'may apply simultaneously with admission; no additionalmaterials;degree-routewindowvaries',
  reason: 'Broadprovincial/universityawards span degree routes with different deadlines. No independent single award cutoff is printed, and the CSCdatebelongs to another award.' }));
add('gdmu-historical-freshman-award', 'gdmu-historical-admission-not-award-date', idsFor(selection.universityIds[4]), () => ({ result: 'unknown', officialDeadline: null,
  excludedHistoricalGeneralAdmissionMonthDay: { month: 7, day: 10, year: null, sourcePublishedAt: '2024-05-13', appliesToScholarship: false },
  reason: 'The2024page has a general-admissionJuly10month/day and a scholarship form, but no exactcurrentawardyear or separate deadline.' }));
add('gdou-old-catalogue', 'gdou-old-programme-list-no-dates', idsFor(selection.universityIds[5]), () => ({ result: 'unknown', officialDeadline: null,
  reason: '2022programme/fee catalogue has no applicant deadline or current2026entry window; no rolling or open status inferred.' }));
const gd = idsFor(selection.universityIds[6]);
add('gdufe-international-business-2026', 'gdufe-2026-original-pdf', gd.filter(id => id.includes('international-business')), () => ({ result: 'closed', officialDeadline: '2026-06-01', candidateOfficialDeadline: '2026-06-01', applicableEntryYear: 2026,
  applicationScope: 'Exact2026English-taught InternationalBusinessbachelor applicant route', deadlineBoundary: 'date-only-no-cutoff-clock-stated',
  dateEvidenceSourceUrl: supplement.url, dateEvidenceRawSha256: supplement.rawSha256, dateEvidenceObservedAt: supplement.observedAt,
  programmeScopeMatch: { page: 12, programme: 'InternationalBusiness', degree: 'BachelorofManagement', language: 'English', duration: '4Years', visuallyInspected: true },
  reason: 'ActualbilingualPDForiginalp12tableandp14deadline support exactprogramme/year/degree. Landingpage200alone was not date proof.' }));
add('gdufe-legacy-international-economics-trade-unbound', 'gdufe-2026-original-pdf', gd.filter(id => id.includes('international-economics-trade')), () => ({ result: 'unknown', officialDeadline: null,
  candidateDeadlineNotBoundToExactProgramme: '2026-06-01', current2026EnrollmentTableContainsSelectedProgramme: false,
  programmeDiscontinuationInferred: false,
  reason: 'Thecurrent2026PDFenrollmenttablelistsInternationalBusinessandChineseLanguageonly, notInternationalEconomicsandTrade. Sharedsourcesandoldmetadata do not bind its deadline; absence is not a formaldiscontinuationnotice.' }));
const records = groups.flatMap(x => x.records);
assert.equal(records.length, 15);
assert.equal(new Set(records.map(x => x.recordId)).size, 15);
assert.deepEqual(new Set(records.map(x => x.recordId)), new Set(selection.records.map(x => x.recordId)));
assert.ok(records.every(x => x.storedDeadline === null && !x.canonicalWritePerformed && !x.freshnessRenewed));
const counts = records.reduce((out, row) => (out[row.result] = (out[row.result] || 0) + 1, out), {});
assert.equal(counts.closed, 5); assert.equal(counts.unknown, 9); assert.equal(counts.blocked, 1);
for (const row of selection.records) {
  assert.equal(rowSha(row.row), row.canonicalRecordSha256);
  if (row.program) assert.equal(rowSha(row.program), row.canonicalProgramSha256);
  for (const pin of row.sources) assert.equal(rowSha(pin.row), pin.sha256);
}
for (const name of Object.keys(fileHashes)) assert.equal(sha(fs.readFileSync(path.join(selection.primaryWorkspace, 'content/data', name))), fileHashes[name]);
const report = { schemaVersion: 1, batchId: selection.batchId, auditDate: '2026-10-19', timeZone: 'Asia/Shanghai', completedAt: new Date().toISOString(),
  state: 'completed-with-five-expired-route-candidates-nine-unknown-one-source-block', snapshotSha256: selection.snapshotSha256, inputFileSha256: fileHashes,
  targetPlan: selection.queuePath, targetPlanSha256: selection.queueSha256, selectionSha256: sha(fs.readFileSync(path.join(root, 'selection.json'))),
  selection: { baseQueueRecordIds: selection.baseQueueRecordIds, additionalSameSourceRecordIds: selection.additionalSameSourceRecordIds, baseQueueRecordCount: 12, additionalSameSourceRecordCount: 3, totalRecords: 15,
    additionalSelectionReceipt: selection.additionalSelectionReceipt, additionalSelectionReceiptSha256: selection.additionalSelectionReceiptSha256, newSourceReadsForAdditional3: 0 },
  acquisition: { newDistinctOfficialUrlsAttempted: 11, baseNativeGets: 10, derivedPdfGets: 1, successfulOriginalSources: 10, failedOriginalSources: 1, boundedWebFallbackAttempts: 1,
    totalNetworkRequests: 12, successfulFallbackSources: 0, automaticRetries: 0, noTlsOrChallengeBypass: true, paidModelCalls: 0, successfulOriginalSchools: 6,
    currentHardDateSourcesApplicableToAssignedRecords: 3 },
  sourceCaptures: allCaptures, fallbackReceipt: { path: 'ecust-web-fallback.receipt.json', sha256: sha(fs.readFileSync(fallbackPath)) },
  evidence, groups,
  summary: { schoolsAttempted: 7, recordsAssessed: 15, baseQueueRecords: 12, additionalSameSourceRecords: 3, recordResults: counts,
    newExpiredDeadlineCandidatesFromCanonicalNull: 5, allCanonicalDeadlinesStillNull: 15, newOpeningDateCandidates: 0,
    canonicalWrites: 0, canonicalDateEqualitiesCertified: 0, freshnessRenewals: 0, fullFactsCertified: 0, wholeSchoolCataloguesCertified: 0, gitMutations: 0, sharedStateWrites: 0, publicationActions: 0 },
  publicationRiskFlags: [
    'GDUFE2026original does not list the legacyInternationalEconomicsandTradeprogramme; do not renew it from the sharedJune1deadline or infer discontinuation.',
    'FZUgeneralpostgraduateMay15doesnotreplaceCSCFeb20. BachelorMay30andbroadprovincial/universityawardsaredistinctscopes.',
    'FZUgraduate notice has an institutionalresult-releaseJune2025line; it was excluded from date/year proof.',
    'ECUPLcoursefinish/semesterhours,FJMUbenefitdurations,GDOUfeeamountsandGDMUoldadmissionmonth/dayarenotaward/applicantcutoffs.',
    'All observations remain candidates only; no full facts or freshness are renewed.'
  ],
  cooldowns: [{ sourceKey: 'source-09', reason: 'TrustedTLSunexpectedEOFfollowedbyoneweb502fallback', immediateRetryAllowed: false, retryCondition: 'Changedsource/networkconditionorlaterboundedrecoverywindow' }],
  validation: { exactBase12PlusAdditional3: true, uniqueRecordIds: 15, recordObjectsStoredOnlyInGroupsRecords: true, rawTextShaAndObservedAtPinned: true,
    fullCanonicalRowProgramSourcePinsPreserved: true, canonicalSixFileHashesUnchangedBeforeAfter: true, additionalSelectionReceiptPinned: true,
    pdfDateAndProgrammeTableVisuallyInspected: true, noYearRolledForward: true, noCanonicalOrGitOrSharedStateWrites: true }
};
const file = path.join(root, 'report.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const completion = { schemaVersion: 1, batchId: selection.batchId, completedAt: report.completedAt, snapshotSha256: selection.snapshotSha256, reportSha256: sha(fs.readFileSync(file)), summary: report.summary };
fs.writeFileSync(path.join(root, 'completion.json'), JSON.stringify(completion, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'README.md'), `# Official date-only batch 019\n\nSeven schools,12base queue records plus3explicit same-source additions:15exact records. Results:5closed route candidates,9unknown,1blocked. All15canonical deadlines remainnulland freshness is unchanged.\n\nFZU2026ChineseLanguagebachelor deadline isMay30. Three exactEnglishpostgraduate programmes are listed in their correctmaster/doctoral sections; generaladmission endsMay15, whileCSCapplicants separately must meetFebruary20. The broadprovincial/universityaward records receive no single borrowed cutoff.\n\nGDUFE actual2026bilingualPDFwas fetched from the canonical page's explicitpdfsrcand visually inspected. Its table listsInternationalBusiness(Englishbachelor), which hasJune1deadline, but does not list the legacyInternationalEconomicsandTradeprogramme. That second record staysunknown; discontinuation is not inferred.\n\nInitial10GETs yielded9originals and1ECUSTTLSfailure. The one derivedPDFGET succeeded; oneECUSTwebfallback502failed. Alloriginals,receipts,SHA256,timestamps,and the15rawrecords/program/sourcepinsare preserved. Reportrecordsappearonlyundergroups[].records[].\n\nReportSHA256:${completion.reportSha256}\n`, { flag: 'wx' });
console.log(JSON.stringify(completion, null, 2));
