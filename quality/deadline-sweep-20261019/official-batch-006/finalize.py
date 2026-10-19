"""Bind all precisely applicable public XMU degree cycles to full2027 guides."""
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INVENTORY_PATH = ROOT.parent / 'catalog-deadlines.json'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
inventory = json.loads(INVENTORY_PATH.read_text(encoding='utf-8'))
captures_path = ROOT / 'captures.json'
captures = json.loads(captures_path.read_text(encoding='utf-8'))
programs = {row['id']: row for row in inventory['programs']}
sources = {row['id']: row for row in inventory['sources']}
university = 'uni-xiamen-university'
labels = {'bachelor': '本科', 'master': '硕士', 'doctorate': '博士'}
expected = {'bachelor': 4, 'master': 143, 'doctorate': 188}
normalize = lambda text: re.sub(r'\s+', '', text)

def expand_table(table):
    grid = {}
    for r, row in enumerate(table):
        c = 0
        for cell in row:
            while (r, c) in grid:
                c += 1
            for dr in range(cell['rowspan']):
                for dc in range(cell['colspan']):
                    assert (r + dr, c + dc) not in grid, 'overlapping_table_cells'
                    grid[r + dr, c + dc] = cell['text']
            c += cell['colspan']
    return [[grid[r, c] for c in range(3)] for r in range(len(table))]

current_input_hashes = {}
for filename, wanted in inventory['inputFileSha256'].items():
    actual_path = Path(inventory['inputDir']) / filename
    current_input_hashes[filename] = sha(actual_path)
    assert current_input_hashes[filename] == wanted, 'current_canonical_input_changed_since_inventory'

prior_ids = set()
for path in ROOT.parent.glob('official-batch-*/report.json'):
    if path.parent == ROOT:
        continue
    previous = json.loads(path.read_text(encoding='utf-8'))
    for school in previous.get('schools', previous.get('rows', [])):
        for record in school.get('recordResults', school.get('records', [])):
            prior_ids.add(record['recordId'])

guide_rows = []
record_results = []
for capture in captures['rows']:
    level = capture['degreeLevel']
    assert capture.get('httpStatus') == 200 and 'error' not in capture
    assert sha(ROOT / capture['bodyPath']) == capture['bodySha256']
    assert sha(ROOT / capture['dateTablePath']) == capture['dateTableSha256']
    full_text = (ROOT / capture['textPath']).read_text(encoding='utf-8')
    title = f'厦门大学2027年国际学生（{labels[level]}）招生简章'
    assert normalize(title) in normalize(full_text)
    assert '中文授课项目' in normalize(full_text) and '英文授课项目' in normalize(full_text)
    assert '以上申请时间适用在“厦门大学境外学生申请系统”报名的学历生项目，均为北京时间，逾期不受理。' in normalize(full_text)
    table = json.loads((ROOT / capture['dateTablePath']).read_text(encoding='utf-8'))
    expanded = expand_table(table)
    self_funded = [row for row in expanded[1:] if row[2] == '自费生']
    assert self_funded == [['2026年12月1日', '2027年5月31日', '自费生']]
    category_windows = [{'applicationType': row[2], 'opensOn': '2026-12-01', 'closesOn': {'2027年2月20日': '2027-02-20', '2027年4月30日': '2027-04-30', '2027年5月31日': '2027-05-31'}[row[1]], 'scope': 'Date table context only; no scholarship record approved or updated.'} for row in expanded[1:]]
    for window in category_windows:
        if window['applicationType'] != '自费生':
            assert window['closesOn'] != '2027-05-31', 'scholarship_deadline_must_not_use_self_funded_deadline'
    selected = [row for row in inventory['admissionCycles'] if row['universityId'] == university and row['published'] and programs[row['programId']]['degreeLevel'] == level]
    assert len(selected) == expected[level]
    matched_source_ids = set()
    for cycle in selected:
        assert cycle['id'] not in prior_ids, 'date_record_already_counted_in_previous_batch'
        assert cycle['academicYear'] == '2027-2028' and cycle['intake'] == 'autumn'
        assert capture['url'] in cycle['sourceUrls'], 'degree_guide_not_bound_to_existing_cycle'
        matched = [source_id for source_id in cycle['sourceIds'] if sources[source_id]['url'] == capture['url']]
        assert matched and all(sources[source_id]['official'] for source_id in matched)
        matched_source_ids.update(matched)
        assert cycle['assessment']['opensOn'] == '2026-12-01'
        assert cycle['assessment']['deadline'] == '2027-05-31'
        record_results.append({'collection': 'admissionCycles', 'recordId': cycle['id'], 'programId': cycle['programId'], 'universityId': university, 'degreeLevel': level, 'academicYear': cycle['academicYear'], 'intake': cycle['intake'], 'storedOpensOn': cycle['assessment']['opensOn'], 'officialOpensOn': '2026-12-01', 'storedDeadline': cycle['assessment']['deadline'], 'officialDeadline': '2027-05-31', 'applicationType': 'self-funded', 'officialApplicationType': '自费生', 'sourceUrl': capture['url'], 'sourceIdsMatched': matched, 'guideEvidenceKey': level, 'result': 'unchanged', 'dateOnly': True, 'appliesToScholarshipDeadline': False, 'publicationBefore': True, 'canonicalWritePerformed': False, 'freshnessRenewed': False})
    guide_rows.append({'guideEvidenceKey': level, 'degreeLevel': level, 'noticeTitle': title, 'noticeYear': 2027, 'source': capture, 'matchedExistingSourceIds': sorted(matched_source_ids), 'applicationTableLocator': '二、申请时间 / 开始时间-截止时间-申请类型', 'selfFundedDateQuote': '2026年12月1日 | 2027年5月31日 | 自费生', 'tableRowspanProof': {'openingCellText': table[1][0]['text'], 'openingCellRowspan': table[1][0]['rowspan'], 'applicationRowsCovered': len(table) - 1, 'rowspanCoversSelfFundedRow': table[1][0]['rowspan'] == len(table) - 1, 'dateTablePath': capture['dateTablePath'], 'dateTableSha256': capture['dateTableSha256']}, 'selfFundedWindow': {'opensOn': '2026-12-01', 'closesOn': '2027-05-31', 'timeZone': 'Asia/Shanghai', 'stateOnAuditDate': 'future'}, 'separateApplicationTypeWindows': category_windows, 'excludedFundingRoutes': ['Chinese Government ScholarshipTypeA: follow CSC or country/embassy receiving authority dates, not this table.', 'International Chinese Language Teachers Scholarship: follow CLEC dates, not self-funded or scholarshipTypeB dates.'], 'boundAdmissionCycles': len(selected), 'boundScholarshipRecords': 0, 'scope': 'Only existing published autumn2027 cycles of this degree level, with exact existing official guide association, and only self-funded application opening/deadline.'})

assert len(record_results) == len({row['recordId'] for row in record_results}) == 335
assert len({row['sourceUrl'] for row in record_results}) == 3
all_public_degree = [row['id'] for row in inventory['admissionCycles'] if row['universityId'] == university and row['published'] and programs[row['programId']]['degreeLevel'] in labels]
assert set(all_public_degree) == {row['recordId'] for row in record_results}
catalog_association_counts = Counter()
for row in record_results:
    cycle = next(c for c in inventory['admissionCycles'] if c['id'] == row['recordId'])
    key = row['degreeLevel']
    if any('/EN_DR.htm' in url or '/EN_MA.htm' in url or '/EN_BA.htm' in url for url in cycle['sourceUrls']):
        key += '-English-catalog-association'
    elif any('/CN_DR.htm' in url or '/CN_MA.htm' in url or '/CN_BA.htm' in url for url in cycle['sourceUrls']):
        key += '-Chinese-catalog-association'
    catalog_association_counts[key] += 1

summary = {'universitiesWithScopedDateChecks': 1, 'universitiesNewlyAttempted': 0, 'guidesRead': 3, 'distinctOfficialGuideUrls': 3, 'publicDegreeCyclesAssessed': 335, 'recordResults': {'unchanged': 335, 'corrected': 0, 'closed': 0, 'unknown': 0, 'blocked': 0}, 'byDegree': expected, 'existingCatalogSourceAssociations': dict(catalog_association_counts), 'scholarshipRecordsAssessed': 0, 'wholeSchoolCataloguesCertified': 0, 'fullFactsCertified': 0, 'canonicalWrites': 0, 'gitMutations': 0, 'publicationActions': 0, 'paidModelCalls': 0}
report = {'schemaVersion': 1, 'batchId': 'official-date-only-006-20261019', 'state': 'completed-self-funded-window-scope-only', 'completedAt': datetime.now(timezone.utc).isoformat(), 'auditDate': inventory['today'], 'timeZone': 'Asia/Shanghai', 'inventoryPath': str(INVENTORY_PATH.relative_to(Path.cwd())).replace('\\', '/'), 'inventorySha256': sha(INVENTORY_PATH), 'snapshotSha256': inventory['snapshotSha256'], 'inputFileSha256': inventory['inputFileSha256'], 'currentCanonicalInputHashesRechecked': current_input_hashes, 'capturesSha256': sha(captures_path), 'selection': 'All335currently published XMU autumn2027 bachelor/master/doctoral cycles whose existing exact official degree guide binds the self-funded application window. XMU ICLT scholarship from batch002 is excluded; no school-level completion is claimed.', 'dateEvidenceMethod': 'Read3full official2027 degree guides, captured exact bytes, extracted application tables retaining rowspans, and matched each existing cycle by university, degree, academicYear,intake,guide URL and stored dates. Programme-name catalogues were not used as deadline evidence.', 'summary': summary, 'guides': guide_rows, 'schools': [{'universityId': university, 'universityName': '厦门大学', 'dateOnly': True, 'fullFactsCertified': False, 'allSchoolProjectsVerified': False, 'result': 'unchanged', 'fundingScope': 'self-funded-only', 'recordResults': record_results}], 'limitations': ['May31,2027 is explicitly the self-funded deadline only. Never apply it to scholarship deadlines or eligibility.', 'China Government ScholarshipTypeB and doctoral New Sinology programme have February20,2027 deadline rows; provincial,newstudent and coastal-sustainability award rows have April30,2027 where listed. These are guide-table context, not independently approved scholarship records.', 'Chinese Government ScholarshipTypeA and ICLT dates are expressly governed by external authorities; prior ICLT work is not repeated.', 'The December1,2026 opening applies across the date-table rows, proven by original HTML rowspans. These selected windows are future on October19,2026; no live applicant portal was tested.', 'All335records are previously public degree identities. This batch verifies only their self-funded date window, not programme existence, eligibility, fees, teaching medium or whole-school catalogue completeness.', 'Existing catalog-source associations describe current input metadata only; those catalogues were not fetched or used as date evidence.', 'No freshness, canonical status, dates, Git, deployment or shared progress were changed.']}
path = ROOT / 'report.json'
with path.open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
completion = {'schemaVersion': 1, 'batchId': report['batchId'], 'completedAt': report['completedAt'], 'snapshotSha256': inventory['snapshotSha256'], 'reportSha256': sha(path), 'summary': summary}
with (ROOT / 'completion.json').open('x', encoding='utf-8') as handle:
    json.dump(completion, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
markdown = '# XMU public degree application dates: official batch006\n\nThree full2027official guides support the unchanged **self-funded** application window **December1,2026–May31,2027** for335existing public autumn2027cycles:4bachelor,143master and188doctoral. Original HTML table rowspans confirm that the shared opening date reaches the self-funded row. Each cycle has an exact existing guide association and a per-record binding in report.json. All335were absent from earlier date-recheck batches.\n\nThis is one previously attempted university and335new scoped record-date checks, not335new projects or a completed school catalogue. The windows are future as ofOctober19,2026.\n\n**Funding deadlines differ.** CSCTypeB closesFebruary20,2027; the doctoral New Sinology row also closesFebruary20. Provincial,newstudent and coastal-sustainability award rows closeApril30where listed. CSCTypeA andICLT deadlines follow their own authorities. No scholarship record was approved andMay31must never be presented as a scholarship deadline.\n\nCaptured only3distinct guideURLs, with original bytes,SHA256,full decoded text and application-table rowspans. The name catalogues were not used as date evidence. The157Chinese/31Englishdoctoral and130Chinese/13Englishmaster breakdowns come only from existing catalogue-source associations. Zero paid calls,canonical/Git/deployments/shared-progress writes.\n'
with (ROOT / 'README.md').open('x', encoding='utf-8') as handle:
    handle.write(markdown)
print(json.dumps({'reportSha256': sha(path), 'summary': summary}, ensure_ascii=False))
