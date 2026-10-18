"""Rebuild two unapproved candidates from recovered rows plus fresh official bytes."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[4]
BASE = ROOT / 'quality/recovery-20261018'
RECOVERED = BASE / 'remote-wave-2/content/data'

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def norm(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value)).strip()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_once(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write('\n')

def main():
    programs = load(RECOVERED / 'programs.json')
    cycles = load(RECOVERED / 'admission-cycles.json')
    sources = load(RECOVERED / 'sources.json')
    assignments = [
        ('shu', 'shu-spring-2027', 'program-shu-international-foundation-one-semester-spring-2027', 'recovery-shu-foundation-spring-2027-20261018-v1'),
        ('bnu', 'bnu-spring-2027', 'program-beijing-normal-university-chinese-taught-undergraduate-credit-nondegree', 'recovery-bnu-credit-spring-2027-20261018-v1'),
    ]
    for school, name, program_id, batch_id in assignments:
        directory = BASE / 'official' / school
        receipt = load(directory / (name + '.receipt.json'))
        review = load(directory / 'source-review.json')
        raw_path, text_path = Path(receipt['rawPath']), Path(receipt['textPath'])
        assert digest(raw_path) == receipt['sha256'] == review['sourceSha256']
        assert digest(text_path) == receipt['textSha256'] == review['textSha256']
        assert receipt['status'] == 200 and receipt['robots']['canFetch']
        text = norm(text_path.read_text(encoding='utf-8'))
        p = copy.deepcopy(next(p for p in programs if p['id'] == program_id))
        c = copy.deepcopy(next(c for c in cycles if c['programId'] == program_id and c['intake'] == 'spring'))
        record_sources = set(p['sourceIds'] + c['sourceIds'])
        ss = copy.deepcopy([s for s in sources if s['id'] in record_sources])
        assert len(ss) == 1 and ss[0]['url'] == receipt['url']
        for record in (p, c):
            record.update({'verifiedAt': '2026-10-18', 'reviewAfter': '2026-10-25', 'status': 'verified'})
        ss[0]['accessedAt'] = '2026-10-18'
        source_id = ss[0]['id']
        proofs = []

        def proof(field, quote, locator, derivation=None):
            quote = norm(quote)
            assert quote in text, (school, field, quote)
            item = {'field': field, 'sourceId': source_id, 'quote': quote, 'locator': locator}
            if derivation:
                item['derivation'] = derivation
            proofs.append(item)

        def span(start, end):
            left = text.index(norm(start))
            right = text.index(norm(end), left) + len(norm(end))
            return text[left:right]

        if school == 'shu':
            c['tuitionSchedule'] = {
                'en': 'CNY26,000 per semester, including tuition, CSCA preparation, HSK mock tests and undergraduate-application guidance. The separate non-refundable application fee is CNY500 and required group comprehensive insurance costs CNY400 per semester; accommodation and other charges are additional.',
                'zh': '26000元/学期，包含学费、CSCA备考、HSK模考及本科申请指导；另有不退还申请费500元、每学期团体综合保险400元，住宿及其他费用另计。',
            }
            proof('program.name', '国际预科项目（一学期）', 'PDF page 4, application process item 3')
            proof('program.degreeLevel', '本科学前预备教育非学历项目。', 'PDF page 2, project introduction', 'The university explicitly calls the route non-degree pre-university education; foundation is the catalog category, not a bachelor degree.')
            proof('program.teachingLanguages', '主要为中文授课。', 'PDF page 5, curriculum note 1')
            proof('program.applyUrl', 'https://apply.shu.edu.cn', 'PDF page 4, application process item 1')
            proof('program.languageRequirements', span('原则上，申请人汉语水平需要达到', '根据学生情况另行安排。'), 'PDF page 3, eligibility item 5 and exception')
            proof('program.supplementaryDetails.eligibility', span('（二）申请资格', '（三）申请材料'), 'PDF page 3, entire eligibility section')
            proof('program.supplementaryDetails.applicationMaterials', span('申请人应保证所提供的申请材料', '开学报到时需提供原件备查。'), 'PDF pages 3–4, all 11 listed materials and document conditions')
            proof('cycle.closesOn', '2026 年 9 月 30 日至 2026 年 12 月 30 日', 'PDF page 3, application period')
            proof('cycle.opensOn', '2026 年 9 月 30 日至 2026 年 12 月 30 日', 'PDF page 3, application period')
            proof('cycle.tuitionCny', '2.6 万元/学期（人民币）', 'PDF page 5, tuition fee', '2.6 wan RMB = CNY26,000; no other price is inferred.')
            proof('cycle.tuitionPeriod', '2.6 万元/学期（人民币）', 'PDF page 5, tuition fee')
            proof('cycle.applicationFeeCny', '500 元（人民币）（申请费一经缴纳不予退还）', 'PDF page 5, application fee')
            proof('program.durationText.zh', '国际预科项目（一学期）', 'PDF page 4, application process item 3')
            proof('cycle.tuitionSchedule', span('2.6 万元/学期（人民币）', '400 元/一学期（人民币）'), 'PDF page 5, fee schedule')
            proof('cycle.tuitionSchedule', '500 元（人民币）（申请费一经缴纳不予退还）', 'PDF page 5, application fee separate from tuition')
            extra_notes = 'Fresh PDF and official index were recaptured on 18 October 2026; the six rendered PDF pages and fee/course tables were read again. Exact one-semester wording is retained without a month conversion. Independent review of this rebuilt batch is pending.'
        else:
            # The previous portal-attempt artifacts were not recovered. Do not retain
            # an uncheckable historical claim about that separate request.
            c['notes']['en'] = c['notes']['en'].replace('The official brochure supplies the HTTPS apply URL; a separate portal fetch stopped at an HTTP robots redirect, so portal login/access was not verified.', 'The fresh official brochure supplies the HTTPS application URL; the portal was not independently fetched or its login tested in this recovery batch.')
            c['notes']['zh'] = c['notes']['zh'].replace('HTTPS申请链接来自官方简章；独立门户访问在HTTP robots跳转处停止，未验证登录或实际申请可达性。', 'HTTPS申请链接来自本次新抓取的官方简章；本恢复批次未独立抓取门户或验证其登录。')
            proof('program.name', 'CHINESE-TAUGHT UNDERGRADUATE CREDIT PROGRAM', 'Article heading and 2027 body title')
            proof('program.degreeLevel', 'Non-Degree Program', 'Official navigation and nondegreeprogram URL', 'Undergraduate credit study is non-degree general advanced study; it is not bachelor-degree admission.')
            proof('program.teachingLanguages', 'CHINESE-TAUGHT UNDERGRADUATE CREDIT PROGRAM', 'Article heading')
            proof('program.applyUrl', 'https://international.bnu.edu.cn/', 'III. Application Procedures item 1')
            proof('program.languageRequirements', span('Applicant’s Chinese proficiency', 'exempt from submitting HSK score reports.'), 'I. Application Requirements item 4, both HSK thresholds and exemption')
            proof('program.supplementaryDetails.eligibility', span('I. Application Requirements', 'II. Application Period'), 'All four official requirements')
            proof('program.supplementaryDetails.applicationMaterials', span('IV. Application Documents', 'V. List of Enrollment Majors'), 'All eight numbered materials and additional conditions')
            proof('cycle.closesOn', 'Spring Semester (starting in March 2027) : October 10, 2026 -- December 15, 2026', 'II. Application Period, spring intake', 'December 20 is separately stated only for requested resubmissions, not initial applications.')
            proof('cycle.opensOn', 'Spring Semester (starting in March 2027) : October 10, 2026 -- December 15, 2026', 'II. Application Period, spring intake')
            proof('cycle.tuitionCny', 'Liberal Arts: RMB 11600 per semester; RMB 22400 per academic year.', 'VI. Tuition Fee', 'The catalog numeric semester amount is the Liberal Arts rate; all subject-dependent rates remain in tuitionSchedule and public notes.')
            proof('cycle.tuitionPeriod', 'Liberal Arts: RMB 11600 per semester; RMB 22400 per academic year.', 'VI. Tuition Fee')
            proof('cycle.applicationFeeCny', 'pay the application fee of 450 RMB.', 'III. Application Procedures item 1; IV.8 states conditional exchange waiver')
            proof('program.durationText.en', 'The study period is one semester or one academic year.', '2027 brochure introductory paragraph')
            proof('cycle.tuitionSchedule', span('Liberal Arts: RMB 11600 per semester;', 'RMB 25300 per academic year.'), 'VI. Tuition Fee, both subject groups and both study periods')
            extra_notes = 'Fresh official page was recaptured and fully read on 18 October 2026. Its old 2020 publication stamp and already closed 2026 autumn paragraph are preserved as caveats; only the explicit March 2027 spring offering is proposed. Independent review of this rebuilt batch is pending.'

        capture = {
            'sourceId': source_id, 'url': ss[0]['url'],
            'rawPath': raw_path.relative_to(ROOT).as_posix(), 'rawSha256': receipt['sha256'],
            'textPath': text_path.relative_to(ROOT).as_posix(), 'textSha256': receipt['textSha256'],
            'retrievedAt': receipt['retrievedAt'], 'httpStatus': receipt['status'],
        }
        entry = {'program': p, 'cycle': c, 'evidence': proofs, 'reviewedAt': None, 'reviewer': 'pending-independent-review', 'notes': extra_notes}
        batch = {'schemaVersion': 1, 'batchId': batch_id, 'sources': ss, 'captures': [capture], 'entries': [entry]}
        output = directory / 'full-program-batch-draft.json'
        write_once(output, batch)
        write_once(directory / 'batch-preparation-check.json', {
            'preparedAt': datetime.now(timezone.utc).isoformat(), 'batchSha256': digest(output),
            'sourceSha256': receipt['sha256'], 'textSha256': receipt['textSha256'],
            'allEvidenceQuotesFoundUnderConsumerNormalization': True,
            'proofs': len(proofs), 'programId': p['id'], 'cycleId': c['id'],
            'proposedVerifiedAt': '2026-10-18', 'proposedReviewAfter': '2026-10-25',
            'independentBatchReview': 'pending; parent must compare the complete rebuilt rows with fresh source bytes before approval',
            'canonicalMutation': False,
        })
        print(school, output.relative_to(ROOT).as_posix(), len(proofs), digest(output))

if __name__ == '__main__':
    main()
