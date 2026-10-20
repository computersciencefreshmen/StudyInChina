const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const outputDirectory = __dirname;
const primaryRoot = 'C:/Users/Henry/Desktop/学过的课程/github_profile_work/StudyInChina';
const inventoryPath = path.join(primaryRoot, 'quality/deadline-sweep-20261019/catalog-deadlines.json');
const inventoryBytes = fs.readFileSync(inventoryPath);
const inventory = JSON.parse(inventoryBytes);
const observationsBytes = fs.readFileSync(path.join(outputDirectory, 'guide-observations.json'));
const observations = JSON.parse(observationsBytes);
const originalFiles = Object.fromEntries(Object.keys(inventory.inputFileSha256).map(name => [name, fs.readFileSync(path.join(primaryRoot, 'content/data', name))]));
for (const [name, bytes] of Object.entries(originalFiles)) if (digest(bytes) !== inventory.inputFileSha256[name]) throw Error('current_canonical_differs_from_inventory:' + name);
const programs = JSON.parse(originalFiles['programs.json']);
const cycles = JSON.parse(originalFiles['admission-cycles.json']);
const programById = new Map(programs.map(row => [row.id, row]));
const cycleById = new Map(cycles.map(row => [row.id, row]));
const selected = inventory.admissionCycles.filter(row => row.universityId === 'uni-tianjin-university' && row.published && ['master', 'doctorate'].includes(programById.get(row.programId)?.degreeLevel));
if (selected.length !== 244 || new Set(selected.map(row => row.id)).size !== 244) throw Error('target_current_degree_cycle_set_changed');
const groups = observations.map(guide => {
  const records = selected.filter(row => programById.get(row.programId)?.degreeLevel === guide.degreeLevel).map(row => {
    const program = programById.get(row.programId);
    const cycle = cycleById.get(row.id);
    if (!cycle || cycle.programId !== program.id || program.universityId !== 'uni-tianjin-university') throw Error('parent_binding_invalid');
    if (!row.sourceUrls.includes(guide.sourceUrl) || program.programUrl !== guide.sourceUrl) throw Error('own_degree_guide_missing:' + row.id);
    if (cycle.academicYear !== '2027-2028' || cycle.intake !== guide.intake || cycle.dateStatus !== 'published') throw Error('cycle_year_scope_mismatch:' + row.id);
    if (cycle.opensOn !== guide.officialOpensOn || cycle.closesOn !== guide.officialDeadline) throw Error('date_changed_requires_separate_review:' + row.id);
    if (!/B类|Type.?B|Category.?B/i.test(JSON.stringify(cycle.notes))) throw Error('csc_type_b_exception_missing:' + row.id);
    const selectedSourceIds = row.sourceIds.filter(id => {
      const source = inventory.sources.find(source => source.id === id);
      return source && source.url === guide.sourceUrl;
    });
    if (!selectedSourceIds.length) throw Error('selected_official_source_binding_missing:' + row.id);
    return {
      collection: 'admissionCycles', recordId: row.id, programId: program.id, programName: row.programName, degreeLevel: program.degreeLevel,
      academicYear: cycle.academicYear, intake: cycle.intake, storedOpensOn: cycle.opensOn, storedDeadline: cycle.closesOn,
      officialOpensOn: guide.officialOpensOn, officialDeadline: guide.officialDeadline, result: 'unchanged',
      guideId: guide.guideId, evidenceSourceUrl: guide.sourceUrl, evidenceSourceIds: selectedSourceIds,
      canonicalCycleSha256: digest(JSON.stringify(cycle)), canonicalProgramSha256: digest(JSON.stringify(program)),
      publishedBefore: row.published, scholarshipTypeBCautionAlreadyPresent: true, fullFactsCertified: false, canonicalWritePerformed: false,
    };
  });
  const expected = guide.degreeLevel === 'master' ? 119 : 125;
  if (records.length !== expected) throw Error('degree_group_count_changed:' + guide.degreeLevel);
  return { ...guide, boundRecords: records.length, records };
});
const bound = groups.flatMap(group => group.records);
if (bound.length !== selected.length || new Set(bound.map(row => row.recordId)).size !== selected.length || selected.some(row => !bound.some(record => record.recordId === row.id))) throw Error('incomplete_or_duplicate_binding');
// Verify the six source files remained byte-identical during the read-only assessment.
for (const [name, bytes] of Object.entries(originalFiles)) if (digest(fs.readFileSync(path.join(primaryRoot, 'content/data', name))) !== digest(bytes)) throw Error('catalog_changed_during_assessment:' + name);
const completedAt = new Date().toISOString();
const report = {
  schemaVersion: 1, batchId: 'official-date-only-005-tju-degree-20261019', state: 'completed-unchanged-qualified-scope', completedAt,
  auditDate: inventory.today, timeZone: inventory.timeZone, universityId: 'uni-tianjin-university', universityName: '天津大学',
  inventoryPath, inventorySha256: digest(inventoryBytes), snapshotSha256: inventory.snapshotSha256, inputFileSha256: inventory.inputFileSha256,
  guideObservationsSha256: digest(observationsBytes),
  selection: 'Every currently public Tianjin University master/doctorate cycle in the pinned inventory. Match current program degreeLevel, university, own official guide URL, academic year, intake and existing cycle dates; source-list overlap alone is insufficient.',
  acquisition: { method: 'Full web-tool reads of the two official guide HTML pages; date-only semantic assessment', officialGuideUrlsOpened: 2, readableGuides: 2, rawBytesCaptured: false, observedAtMeaning: 'Time returned official-page text was reviewed, not an invented origin-server raw-capture timestamp; tool crawl metadata may be cached.' },
  summary: { institutionsAttempted: 1, currentPublicDegreeCyclesAssessed: bound.length, masterCycles: 119, doctorateCycles: 125, unchangedOpeningDates: bound.length, unchangedDeadlines: bound.length, correctedDates: 0, expiredCycles: 0, heldCycles: 0, undergraduateCyclesAssessed: 0, scholarshipRecordsAssessed: 0, fullFactsCertified: 0, canonicalWrites: 0, paidModelCalls: 0, publicationActions: 0 },
  scopeChecks: { ownDegreeGuideUsedForAllBindings: true, masterGuideUsedAsDoctoralDateEvidence: false, allAcademicYearsMatch2027_2028: true, allIntakesAutumn: true, allExistingCscTypeBCautionsPresent: true, allSixCanonicalFilesStableDuringAssessment: true, allSelectedCyclesBoundExactlyOnce: true },
  groups,
  publishRiskFlags: [
    { severity: 'qualification-retained', reason: 'The September 30 opening and May 31 cutoff describe the general programme application window. CSC Type B availability requires the separate 2027 scholarship notice; do not present these dates as a universal scholarship window.', existingRecordCautionsPresent: 244, correctionRequiredByThisBatch: false },
    { severity: 'provenance-scope', reason: 'Doctoral source lists also contain the master guide. This assessment binds doctoral dates solely to the doctoral guide and must not be reused to approve doctoral facts from a master source.', correctionRequiredByThisBatch: false },
  ],
  exclusions: ['The previously checked Tianjin ICLT spring route was not fetched or counted again.', 'No current-public undergraduate cycle belongs to the selected 244-record set; no undergraduate guide was fetched.', 'Programme catalogue spreadsheets were not fetched because this task rechecks shared dates, not programme identity or catalogue completeness.', 'Scholarship narratives were read to delimit the general application dates, but no award record was newly certified.'],
  continuation: { completedRecordIds: bound.map(row => row.recordId), heldRecordIds: [], pendingCurrentPublicTjuDegreeCycleIds: selected.filter(row => !bound.some(record => record.recordId === row.id)).map(row => row.id), resumePolicy: 'This receipt covers date facts only for the exact pinned snapshot. Reconcile future source or catalogue changes; never renew complete-record dates from this receipt.' },
};
for (const name of ['report.json', 'completion.json', 'README.md']) if (fs.existsSync(path.join(outputDirectory, name))) throw Error('immutable_output_exists:' + name);
const reportBytes = JSON.stringify(report, null, 2) + '\n';
fs.writeFileSync(path.join(outputDirectory, 'report.json'), reportBytes, { flag: 'wx' });
fs.writeFileSync(path.join(outputDirectory, 'completion.json'), JSON.stringify({ schemaVersion: 1, batchId: report.batchId, completedAt, snapshotSha256: report.snapshotSha256, reportSha256: digest(reportBytes), summary: report.summary }, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(outputDirectory, 'README.md'), ['# Official date-only recheck batch 005: Tianjin degree admissions', '', `Completed ${completedAt}. Snapshot: \`${report.snapshotSha256}\`.`, '', 'Two full official guide reads cover every currently public Tianjin University degree cycle in this snapshot: **119 master cycles + 125 doctoral cycles = 244 cycles**.', '', 'Both degree-specific guides confirm the general application window **30 September 2026 through 31 May 2027**, for the 2027 autumn admission cycle. Stored opening and closing dates match for all 244 records.', '', 'Each master cycle is bound to the master guide; each doctoral cycle is bound to the doctoral guide, even though doctoral source lists also include the master guide. Degree level, current parent, own program URL, intake, year, dates, source IDs and all six canonical file hashes were checked.', '', 'CSC Type B applicants must wait for the separate 2027 scholarship notice. These are general programme dates, not a universal scholarship window. All 244 existing cycles already preserve the qualification; no scope correction or date change was required.', '', 'This batch assessed shared dates only. It did not re-certify programme names, teaching languages, eligibility, fees, documents, award facts or catalogue completeness. No catalogue spreadsheet was fetched, no full-record freshness horizon was renewed, and no canonical/Git/cloud/publication write occurred.', '', 'See report.json for all 244 exact cycle/program IDs, per-record hashes, degree-specific source bindings, minimal date quotations and continuation state.', ''].join('\n'), { flag: 'wx' });
console.log(JSON.stringify({ report: path.join(outputDirectory, 'report.json'), reportSha256: digest(reportBytes), ...report.summary }));
