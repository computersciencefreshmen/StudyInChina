"""Bind independently read date findings to captured official source bytes."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
inventory = json.loads((ROOT.parent / 'catalog-deadlines.json').read_text(encoding='utf-8'))
captures = json.loads((ROOT / 'captures.json').read_text(encoding='utf-8'))['rows']
supplement = json.loads((ROOT / 'supplement-capture.json').read_text(encoding='utf-8'))
by_key = {row['key']: row for row in captures + [supplement]}
specs = [
    ('sjtu-current', 'uni-shanghai-jiao-tong-university', 'October 31, 2026, for programs starting in March 2027', '2026 Application Guide for SJTU International Chinese Language Teachers Scholarship', '2026 notice and explicit 2026 deadline / March 2027 intake', ['Saved source PDF returned HTTP404. Current full university-hosted English notice proves the same deadline. Candidate source-URL replacement only; no canonical source changed.']),
    ('dut', 'uni-dalian-university-of-technology', 'applicants must complete their applications by October 31', 'Application Guidelines for DUT International Chinese Language Teachers Scholarship 2026', '2026 scheme; paragraph explicitly scopes this deadline to 2027 March', ['Student deadline is October31; institutional review November10 is a separate event.']),
    ('shnu', 'uni-shanghai-normal-university', '申请截止日期： 2026 年 10 月 31 日', '2026年上海师范大学国际学生“国际中文教师奖学金”招生简章', '2026 deadline explicitly printed under March2027 spring category', []),
    ('blcu', 'uni-beijing-language-and-culture-university', 'Oct 31, 2026 (for programs commencing in March 202 7 )', '2026 BLCU International Chinese Language Teachers Scholarship Application Guide', 'Explicit2026 deadline and March2027 intake; embedded text splits 2027 with whitespace', []),
    ('xmu', 'uni-xiamen-university', 'student application must complete before October 31th, 2026', 'International Chinese Language Teachers Scholarship 2026, Xiamen University', 'Explicit2026 deadline in March2027 one-semester paragraph', ['The source says before October31th; exact end-of-day inclusivity is not independently clarified. Preserve wording.']),
    ('dhu', 'uni-donghua-university', 'For programs commencing in March 2027, student application must complete before October 31 st', 'Application Guide for International Chinese Language Teachers Scholarship', '2026 online-registration year plus explicit March2027 intake; deadline year contextually2026', ['Old-looking2021 URL currently contains2026/2027 body; URL path year is not intake evidence.', 'The source says before October31st; exact end-of-day inclusivity is not independently clarified. Preserve wording.']),
    ('xju', 'uni-xinjiang-university', '202 7 年3月入学：截止日期为10月31日', '新疆大学国际中文教师奖学金招生简章（2026年）', '2026 notice,2026 opening and March2027 intake; deadline year contextually2026', ['The school explicitly defers to final CLEC dates. No live applicant account or portal availability was tested.']),
    ('snnu', 'uni-shaanxi-normal-university', '2027年3月入学：学生申请截止日期为10月31日', '国际中文教师奖学金2026年申请办法', '2026 title / body,March2027 intake; deadline year contextually2026', ['Page publication metadata says2025-04-15 while title/body describe2026/2027. This conflict remains disclosed; no metadata year is rewritten.', 'Students must apply through both systems; November10 is institutional review, not student deadline.']),
    ('shu', 'uni-shanghai-university', '2027 年 3 月入学：学生申请截止日期为 10 月 31 日', 'Application Guide for International Chinese Language Teachers Scholarship of Shanghai University2026', '2026 bilingual guide and explicit March2027 intake; deadline year contextually2026', ['Downloaded full13-page official PDF. Deadline row on physical page8 was text-extracted and visually inspected.', 'November10 is institutional review, not student deadline.']),
    ('nankai', 'uni-nankai-university', 'October 31, 2026 (March 2027Admission)', 'International Chinese Language Teachers Scholarship of Nankai University (2026)', 'Explicit2026 deadline and March2027 deadline-column intake', ['Funding-duration cell has a March20267 typographical error; the separate application-deadline cell explicitly says March2027. This source error is retained.']),
]
excluded = ['uni-tongji-university', 'uni-nanjing-university-of-information-science-and-technology', 'uni-minzu-university-of-china', 'uni-fudan-university', 'uni-inner-mongolia-university', 'uni-soochow-university', 'uni-tianjin-university', 'uni-changan-university', 'uni-guangdong-university-of-foreign-studies', 'uni-shenzhen-university']
assert len(specs) == 10 and not set(excluded).intersection(spec[1] for spec in specs)
normalize = lambda text: re.sub(r'\s+', '', text)
schools = {school['id']: school for school in inventory['universities']}
rows = []
for key, university, quote, title, year_basis, caveats in specs:
    capture = by_key[key]
    body = ROOT / capture['bodyPath']
    assert hashlib.sha256(body.read_bytes()).hexdigest() == capture['sha256']
    text_path = ROOT / (key + '.txt')
    text = text_path.read_text(encoding='utf-8')
    assert normalize(quote) in normalize(text), (key, 'quote does not bind to captured full text')
    records = []
    for kind, collection in [('admissionCycle', inventory['admissionCycles']), ('scholarship', inventory['scholarships'])]:
        for record in collection:
            parents = [record.get('universityId')] if kind == 'admissionCycle' else record['universityIds']
            if university in parents and record['assessment']['deadline'] == '2026-10-31':
                records.append({'type': kind, 'recordId': record['id'], 'programId': record.get('programId'), 'storedDeadline': record['assessment']['deadline'], 'publishedInInputSnapshot': record['published'], 'previousVerificationStatus': record['status'], 'outcome': 'unchanged', 'officialDeadline': '2026-10-31'})
    assert records, university
    rows.append({'universityId': university, 'universityName': schools[university]['name'], 'outcome': 'unchanged', 'observedAt': capture['observedAt'], 'officialWebsiteRead': True, 'scope': '2027-March one-semester International Chinese Language Teachers Scholarship application deadline only', 'officialDeadline': '2026-10-31', 'deadlineStateOnAuditDate': 'not-expired', 'applicationsOpenNow': 'not-assessed', 'noticeTitle': title, 'noticeYearBasis': year_basis, 'source': {'url': capture['url'], 'finalUrl': capture['finalUrl'], 'httpStatus': capture['status'], 'bodyPath': capture['bodyPath'], 'bodySha256': capture['sha256'], 'bytes': capture['bytes'], 'textPath': text_path.name}, 'dateQuote': quote, 'quoteNormalization': 'Whitespace removed only for substring binding; raw saved text and original bytes preserved.', 'records': records, 'caveats': caveats, 'allSchoolProjectsVerified': False, 'allRecordFactsVerified': False, 'dateChangeNeeded': False, 'mayRenewVerifiedAtOrReviewAfter': False, 'mayAutoPublishHeldRecords': False})
summary = {'schoolsReviewed': len(rows), 'scopedAdmissionCycles': sum(r['type'] == 'admissionCycle' for row in rows for r in row['records']), 'scopedScholarships': sum(r['type'] == 'scholarship' for row in rows for r in row['records']), 'unchangedSchools': 10, 'correctedDeadlineSchools': 0, 'closedScopedWindows': 0, 'unknownSchools': 0, 'blockedSchools': 0, 'sourceFailuresPreserved': 1, 'sourceFailuresRecoveredViaAlternateOfficialNotice': 1, 'deduplicatedCapturedSourceRequests': 11, 'canonicalWrites': 0, 'gitMutations': 0, 'deploymentMutations': 0, 'paidCalls': 0, 'newVerifiedRecords': 0}
report = {'schemaVersion': 1, 'batchId': 'official-batch-002', 'auditType': 'independent-official-date-only-recheck', 'completedAt': datetime.now(timezone.utc).isoformat(), 'today': inventory['today'], 'timeZone': 'Asia/Shanghai', 'inputSnapshotSha256': inventory['snapshotSha256'], 'inputGeneratedAt': inventory['generatedAt'], 'selection': 'Ten schools with explicit unexpired ICLT deadlines, excluding all first10 schools reserved by official-batch-001 owner.', 'excludedUniversityIds': excluded, 'summary': summary, 'rules': ['Unchanged means the selected deadline matches its official full notice; it does not approve a whole record or entire school.', 'No absence of discontinuation is inferred. A missing source or closed intake does not mean a programme has ceased.', 'Official date rechecks do not renew fact verification or review dates and do not publish stale/held records.', 'Application opening and actual portal acceptance are not assessed. Student deadlines are kept separate from institutional review deadlines.', '2026 contextual years and source metadata/wording conflicts remain explicit; unknown dates are never guessed.', 'Canonical histories, shared progress, Git and deployments are untouched.'], 'rows': rows}
with (ROOT / 'report.json').open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
markdown = '# Official date-only recheck batch002\n\n10 schools;18 scoped records (8 admission cycles and10 scholarships). All selected March2027 ICLT student deadlines match October31,2026. This is date verification only; stale/held publication and all other facts remain untouched.\n\n|School|Deadline|Outcome|Scope|\n|---|---|---|---|\n' + '\n'.join(f"|{row['universityName']}|2026-10-31|unchanged|March2027 ICLT only|" for row in rows) + '\n\nSJTU old PDF returned404; its current university-hosted full2026 guide confirms the same deadline. SNNU publication metadata2025 conflicts with explicit2026/2027 body; Nankai has one20267 typo alongside an explicit2027 deadline cell; both are preserved. XMU/DHU say before October31, so exact end-of-day inclusivity remains uncertain. SHU PDF page8 was visually checked. Eleven distinct bounded requests, max2 simultaneous, no paid calls, no canonical changes, no Git/deployment writes. Raw bodies, decoded/extracted texts, SHA256 pins and per-record IDs are in this folder.\n'
with (ROOT / 'summary.md').open('x', encoding='utf-8') as handle:
    handle.write(markdown)
print(json.dumps(summary))
