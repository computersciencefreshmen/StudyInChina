"""Prepare, but never approve/apply, the single current Fudan semester route."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[4]
DIRECTORY = Path(__file__).resolve().parent

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def norm(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text)).strip()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path, obj):
    with path.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(obj, output, ensure_ascii=False, indent=2)
        output.write('\n')

def main():
    names = ['fdu-ices-index', 'fdu-spring-2027-en', 'fdu-spring-2027-zh', 'fdu-iso-index']
    receipts = {name: load(DIRECTORY / (name + '.receipt.json')) for name in names}
    for r in receipts.values():
        assert r['status'] == 200 and r['robots']['canFetch']
        assert sha(Path(r['rawPath'])) == r['sha256']
        assert sha(Path(r['textPath'])) == r['textSha256']
    assert receipts['fdu-spring-2027-en']['sha256'] == '79590e27e8a092013db2c208718c00b1af2ba6e9cdec2d29b6d5be9ffac68351'
    assert receipts['fdu-spring-2027-zh']['sha256'] == '2f5b09cc02fed3753bf0b662f60242cfcd56f21eeb8f7904b5bc48464d30bef2'

    # Keep the original immutable extraction. This separate extraction exposes
    # exactly the href present in the captured official DOM, not a guessed upgrade.
    iso = receipts['fdu-iso-index']
    raw_html = Path(iso['rawPath']).read_text(encoding='utf-8')
    anchor = re.search(r'<a\b[^>]*href="https://istudent\.fudan\.edu\.cn/apply"[^>]*>.*?</a>', raw_html, re.S | re.I)
    assert anchor and 'Online Application' in anchor.group(0)
    dom_path = DIRECTORY / 'fdu-iso-index.dom.text.txt'
    with dom_path.open('x', encoding='utf-8', newline='\n') as output:
        output.write(Path(iso['textPath']).read_text(encoding='utf-8'))
        output.write('\nOriginal raw HTML anchor from this capture:\n' + anchor.group(0) + '\n')
    write(DIRECTORY / 'fdu-iso-index.dom-extraction.json', {
        'schemaVersion': 1, 'extractedAt': datetime.now(timezone.utc).isoformat(),
        'sourceReceipt': 'quality/recovery-20261018/official/fdu/fdu-iso-index.receipt.json',
        'rawSha256': iso['sha256'], 'rawAnchor': anchor.group(0),
        'originalTextSha256': iso['textSha256'], 'domTextSha256': sha(dom_path),
        'method': 'Original immutable HTML text plus a verbatim raw DOM anchor from the same captured HTML; the href is not synthesized or upgraded from the PDF HTTP link.',
    })

    source_ids = {name: 'source-' + name + '-official-20261018' for name in names}
    titles = {
        'fdu-ices-index': '2027 Spring Intake Chinese Language Program — published 13 October 2026',
        'fdu-spring-2027-en': '2027 Fudan University Chinese Language Program for International Students — Spring Semester Intake',
        'fdu-spring-2027-zh': '2027年复旦大学外国留学生汉语进修项目招生简章 — 2027年春季入学',
        'fdu-iso-index': 'Fudan International Students Office — official Non-Degree index and HTTPS online application anchor',
    }
    sources, captures, texts = [], [], {}
    for name in names:
        r = receipts[name]
        text_path = dom_path if name == 'fdu-iso-index' else Path(r['textPath'])
        sources.append({'id': source_ids[name], 'url': r['url'], 'title': titles[name], 'publisher': 'Fudan University, International Cultural Exchange School' if name != 'fdu-iso-index' else 'Fudan University, International Students Office', 'kind': 'program' if name in ('fdu-spring-2027-en', 'fdu-spring-2027-zh') else 'admissions', 'language': 'zh' if name in ('fdu-spring-2027-zh', 'fdu-ices-index') else 'en', 'official': True, 'accessedAt': '2026-10-18'})
        captures.append({'sourceId': source_ids[name], 'url': r['url'], 'rawPath': Path(r['rawPath']).relative_to(ROOT).as_posix(), 'rawSha256': r['sha256'], 'textPath': text_path.relative_to(ROOT).as_posix(), 'textSha256': sha(text_path), 'retrievedAt': r['retrievedAt'], 'httpStatus': 200})
        texts[name] = norm(text_path.read_text(encoding='utf-8'))

    localized = lambda en, zh: {'en': en, 'zh': zh}
    program_id = 'program-fudan-university-chinese-language-program-language'
    p = {
        'sourceIds': list(source_ids.values()), 'verifiedAt': '2026-10-18', 'reviewAfter': '2026-10-25', 'status': 'verified',
        'id': program_id, 'slug': 'fudan-university-chinese-language-program', 'universityId': 'uni-fudan-university',
        'name': localized('Chinese Language Program — Spring 2027 (One Semester)', '2027年春季汉语进修项目（一学期）'),
        'degreeLevel': 'language', 'discipline': 'chinese-education', 'teachingLanguages': ['Chinese'],
        'durationMonths': None, 'durationMonthsMax': None, 'durationText': localized('one semester', '一学期'),
        'programUrl': receipts['fdu-spring-2027-en']['url'], 'applyUrl': 'https://istudent.fudan.edu.cn/apply',
        'languageRequirements': [{'test': 'other', 'minimum': 'Students take an online Chinese placement test on arrival and enter the corresponding level. The brochure does not publish a minimum entry HSK score; this is not a promise of admission without a language requirement.'}],
        'verificationScope': 'facts',
        'supplementaryDetails': {
            'faculty': localized('International Cultural Exchange School (ICES), Fudan University', '复旦大学国际文化交流学院（ICES）'),
            'overview': localized('One-semester Chinese language study for international students entering in spring 2027. Students are placed across ten levels from fundamental to advanced, normally covering two levels in a semester with about 18 class hours per week.', '面向国际学生的2027年春季一学期汉语进修项目。基础至高级共十个级次，抵校后通过在线汉语测试分班，通常每学期完成两个级次、每周约18课时。'),
            'qualification': localized('Non-degree Chinese language study as a language student.', '以语言生身份修读的非学历汉语进修。'),
            'languagePolicy': localized('Chinese is the stated teaching language in the official application instructions. An online Chinese placement test on arrival determines the appropriate level. The brochure does not state a minimum entry HSK score or an academic-qualification threshold; confirm any additional admissions requirements with ICES.', '官方申请说明明确选择授课语言“汉语”。到校后通过在线汉语测试确定相应级次；简章未公布最低入学HSK分数或最低学历门槛，其他录取要求请向学院确认。'),
            'curriculumHighlights': [
                localized('Intensive and extensive reading, listening and speaking, and writing; each level lasts about nine weeks, and a semester normally covers two levels.', '汉语精读、泛读、听说与写作；每级约9周，一学期通常完成两级内容。'),
                localized('Optional language and culture classes cover Chinese proverbs, tourism, culture, film, music and poetry. Some undergraduate electives open to advanced-level students. About 18 class hours are scheduled weekly for each level.', '可选成语与中国文化、旅游文化、文化通论、电影、汉语诗乐等课程；高级班可选部分本科生选修课，各级次每周约18课时。'),
            ],
            'eligibility': [
                localized('A foreign citizen aged 17–60 in good mental and physical health and fit to study in China.', '17—60周岁、身心健康并适合来华留学的外国籍公民。'),
                localized('Applicants who are 17 and under 18 must provide the required Guarantee Statement and related materials. The guarantor must be an adult residing in Mainland China with a source of income. The final application result appears in the application system.', '年满17周岁但未满18周岁者须按要求提交监护人保证书等材料；监护人须是在中国大陆居住、有经济来源的成年人，最终申请结果以系统公布为准。'),
                localized('The brochure does not state a minimum academic qualification or minimum entry HSK score. Placement is determined by the online Chinese test on arrival, and the university may request additional documents.', '简章未列最低学历或最低入学HSK分数；抵校后在线汉语分班测试决定级次，学校必要时可要求补充材料。'),
            ],
            'applicationMaterials': [
                localized('Complete the online application, including educational background, family members and an emergency contact, and upload all documents requested in the system.', '在网上申请系统完整填写学习经历、家庭情况、紧急事务联系人等信息，按系统要求上传文件。'),
                localized('One copy of the ordinary passport personal-information page. Passport validity must cover the study period. Enter the name, passport number, birth details, issue date and expiry date exactly as on the valid passport.', '普通护照个人信息页复印件一份，有效期须覆盖学习期间；姓名、护照号码、出生日期及地点、护照签发及有效期等须与有效护照完全一致。'),
                localized('Do not renew the passport or change its number before campus registration; otherwise the electronic JW202/DQ document becomes invalid.', '入学报到前不可更新护照或变更护照号码，否则原JW202/DQ电子证照将失效。'),
                localized('Applicants aged 17 but under 18 submit the required Guarantee Statement and any other requested guardian documents. The adult guarantor must live in Mainland China and have a source of income.', '17周岁至未满18周岁者提交监护人保证书等所需材料；成年监护人须居住在中国大陆且有经济来源。'),
                localized('The university may request additional materials. Check application feedback regularly, revise or supplement documents within the stated deadlines, and keep submitted information consistent with the passport.', '学校可要求补充材料；须定期查看系统反馈，在规定时间内修改或补件，并确保证件信息一致。'),
            ],
            'campus': localized('International Cultural Exchange School, Handan Campus, Fudan University, Shanghai.', '复旦大学国际文化交流学院，上海邯郸校区。'),
        },
    }
    notes_en = ('The one-semester timetable is tentative: 15 February–25 June 2027. Check the ICES calendar for final term dates. Tuition is a reference CNY10,500 per semester; the final amount follows the Fudan Financial Office pricing at enrollment. The CNY400 application fee and submitted materials are not returned. The brochure also lists a separate one-year choice from February 2027 to January 2028 at reference tuition CNY21,000 per year; this page describes the one-semester choice. Apply from 16 October to 13 December 2026. In the application system select Personal Application, Language Student, International Cultural Exchange School and teaching language Chinese; leave Program Name blank, search and choose Chinese Language Program. Register and activate the account, complete and submit the application, pay the application fee, then follow system feedback and supply any requested corrections before their deadlines. After admission, download the admission notice and use the admission documents and China Visa Application Form to apply through a Chinese embassy or consulate overseas. The brochure advises arrival only one or two days before registration and warns that early entry may cause visa expiry; Fudan provides visa assistance only after school registration. It states that study of at least 180 days uses JW202 and shorter study uses DQ; the electronic form is available after admission and related procedures through Study in China using the student’s name, passport number and email. Passport validity must cover the study period; do not renew the passport or change its number before registration, or the electronic form becomes invalid. Housing is arranged by the student; the guide provides nearby housing information for reference and does not guarantee a room or state a housing price. A minimum academic qualification and entry HSK score are not published in this brochure; the online arrival placement test assigns the learning level. Contact ICES at yuyansheng@fudan.edu.cn or +86-21-55664859 for additional requirements and arrangements.')
    notes_zh = ('本一学期项目预计2027年2月15日至6月25日学习，具体学期安排请以学院院历为准。学费为参考标准10500元/学期，最终以入学时学校财务定价为准；400元报名费与提交的申请材料均不退还。简章另列2027年2月至2028年1月的一学年选择，参考学费21000元/年；本页介绍一学期选择。申请期为2026年10月16日至12月13日。网申选择个人申请、学生类型语言生、招生单位国际文化交流学院、授课语言汉语，项目名称留空，查询后勾选外国留学生汉语进修项目。注册并激活账号、填写提交申请、支付报名费后，持续查看系统反馈，在要求期限内修改或补件。录取后在系统下载录取通知书，持录取文件和来华签证申请表到中国驻外使领馆申请签证。简章提示通常在报到前一至两日入境，过早入境可能导致签证过期；复旦仅在完成校内报到后提供签证协助。按简章所述，学习180天及以上为JW202表，不满180天为DQ表；学校录取及相关程序完成后，可在留学中国网使用姓名、护照号、邮箱查看下载电子表。护照有效期须覆盖学习期间，报到前不可更新护照或变更号码，否则电子证照失效。住宿由学生自主安排，简章仅提供周边信息参考，未承诺宿位或列明住宿价格。简章未公布最低学历及最低入学HSK成绩，到校后在线分班测试确定级次。其他要求和安排可联系学院：yuyansheng@fudan.edu.cn，+86-21-55664859。')
    c = {
        'sourceIds': list(source_ids.values()), 'verifiedAt': '2026-10-18', 'reviewAfter': '2026-10-25', 'status': 'verified',
        'id': 'cycle-fudan-chinese-language-one-semester-spring-2027', 'programId': program_id,
        'academicYear': '2026-2027', 'intake': 'spring', 'opensOn': '2026-10-16', 'closesOn': '2026-12-13',
        'dateStatus': 'published', 'tuitionCny': 10500, 'tuitionPeriod': 'semester', 'tuitionStatus': 'reference',
        'tuitionSchedule': localized('Reference tuition: CNY10,500 per semester. The final tuition follows Fudan University Financial Office pricing at enrollment. The CNY400 application fee is separate and non-refundable.', '参考学费10500元/学期，最终以入学时复旦大学财务定价为准；另有400元报名费，报名费不退。'),
        'evidenceBasis': 'cycle-specific', 'factScope': 'complete', 'applicationFeeCny': 400,
        'notes': localized(notes_en, notes_zh),
    }
    proofs = []
    def proof(field, name, quote, locator, derivation=None):
        q = norm(quote)
        assert q in texts[name], (field, name, q)
        value = {'field': field, 'sourceId': source_ids[name], 'quote': q, 'locator': locator}
        if derivation:
            value['derivation'] = derivation
        proofs.append(value)
    def span(name, start, end):
        t = texts[name]
        l = t.index(norm(start))
        r = t.index(norm(end), l) + len(norm(end))
        return t[l:r]
    en, zh, index, iso_name = names[1], names[2], names[0], names[3]
    proof('program.name', index, '2027 Spring Intake Chinese Language Program 2027年春季学期/学年汉语进修项目', 'Official current notice title')
    proof('program.degreeLevel', en, 'Student Type: Language Student', 'EN PDF page 12, application filter')
    proof('program.teachingLanguages', en, 'Teaching Language: Chinese.', 'EN PDF page 12, application filter')
    proof('program.applyUrl', iso_name, 'href="https://istudent.fudan.edu.cn/apply"', 'Captured original HTML line 226, actual Online Application anchor', 'Exact original HTTPS href from the official ISO DOM, preserved in separate derived text. The PDF HTTP URL was not upgraded by inference.')
    proof('program.languageRequirements', en, 'Students will get into appropriate levels according to the results of online placement test on arrival.', 'EN PDF page 6, placement process', 'The official text establishes arrival placement, not an HSK entry exemption or a zero-language guarantee; the missing minimum threshold is explicitly disclosed.')
    proof('program.supplementaryDetails.eligibility', en, span(en, 'Application Requirements:', 'physical health.'), 'EN PDF page 11, age/nationality/health requirement')
    proof('program.supplementaryDetails.eligibility', en, span(en, 'Minor applicants aged 17', 'application system.'), 'EN PDF page 11, guardian condition')
    proof('program.supplementaryDetails.applicationMaterials', en, span(en, 'Online Application Materials:', 'submit extra materials.'), 'EN PDF page 11, full online materials and conditional guardian/additional materials')
    proof('cycle.closesOn', en, 'Spring Semester Intake: Applications begin on October 16. Deadline of submitting application is December 13.', 'EN PDF page 11, application period; year resolved against the 2027 spring guide and dated current notice', 'The official current notice was published 2026-10-13, before the October 16 opening for the February 2027 intake.')
    proof('cycle.opensOn', index, '发布时间: 2026-10-13', 'Current official notice publication date')
    proof('cycle.opensOn', en, 'Spring Semester Intake: Applications begin on October 16. Deadline of submitting application is December 13.', 'EN PDF page 11, current 2027 spring application period')
    proof('cycle.tuitionCny', en, 'Tuition (for reference): 10500RMB/Semester, 21000RMB/Year', 'EN PDF page 11, reference tuition', 'Only the per-semester option is represented by this cycle numeric fee.')
    proof('cycle.tuitionPeriod', en, 'Tuition (for reference): 10500RMB/Semester, 21000RMB/Year', 'EN PDF page 11, reference tuition')
    proof('cycle.tuitionStatus', en, span(en, 'Tuition (for reference):', 'Financial Office of Fudan.'), 'EN PDF page 11, explicit reference status and final pricing reservation')
    proof('cycle.applicationFeeCny', en, 'Application fee: 400 RMB', 'EN PDF page 11, fee')
    proof('program.durationText.en', en, '2027 Spring Semester, one semester Program:', 'EN PDF page 11, single-semester duration')
    proof('program.durationText.zh', zh, '2027年春季学期，一学期项目:', 'ZH PDF page 10, single-semester duration')
    proof('cycle.tuitionSchedule', en, span(en, 'Tuition (for reference):', 'Financial Office of Fudan.'), 'EN PDF page 11, tuition schedule status')
    proof('cycle.tuitionSchedule', en, 'APPLICATION FEES AND MATERIALS ARE NON-RETURNABLE.', 'EN PDF page 15, non-returnable application fee/materials')
    batch = {'schemaVersion': 1, 'batchId': 'recovery-fdu-chinese-language-spring-2027-20261018-v1', 'allowOfficialReferenceTuition': True, 'sources': sources, 'captures': captures, 'entries': [{'program': p, 'cycle': c, 'evidence': proofs, 'reviewedAt': None, 'reviewer': 'pending-independent-review', 'notes': 'Both current official PDFs and both official indexes were freshly captured and reviewed. The EN 15 pages and ZH 13 pages were fully read and rendered/viewed. This draft reuses the stable Chinese-language program ID and proposes one explicit semester cycle; existing stale autumn records are not renewed. AcademicYear 2026-2027 is the catalog spring classification. Independent batch review is pending; no canonical or cloud mutation is performed.'}]}
    out = DIRECTORY / 'full-program-batch-draft.json'
    write(out, batch)
    write(DIRECTORY / 'source-review.json', {
        'schemaVersion': 1, 'reviewer': 'codex-subagent-refresh-official', 'reviewedAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'Full fresh-source preparation and semantic review, not independent approval of this author’s batch',
        'sourceDigestsMatchProvidedPriorPdfDigests': True, 'all28RenderedPdfPagesViewed': True,
        'sources': [{'name': name, 'rawSha256': r['sha256'], 'textSha256': r['textSha256'], 'retrievedAt': r['retrievedAt'], 'httpStatus': r['status']} for name,r in receipts.items()],
        'rawDomApplyHref': anchor.group(0), 'evidenceQuotesAllFoundAfterConsumerNormalization': True, 'proofCount': len(proofs),
        'batchSha256': sha(out), 'expectedOnlyBlockerBeforeIndependentReview': 'independent_review_missing',
        'reviewPoints': ['Age 17–60 and special guardian condition for applicants aged 17 but under 18.', 'Teaching language explicitly Chinese in the application filter, not inferred from learning Chinese.', 'No stated minimum HSK or academic qualification; arrival placement is not an exemption guarantee.', 'One semester exact EN/ZH duration text; no guessed month duration and no level-based route multiplication.', 'Spring dates are tentative; application year is grounded in the dated October 2026 notice and explicit spring 2027 guide.', 'Tuition 10500/semester is reference with final finance pricing reservation; allowOfficialReferenceTuition is explicit and separate from the actual tuitionStatus proof.', 'Application fee 400 and materials are not returnable.', 'Ordinary passport must cover study; no renewal/number change until registration or electronic visa form becomes invalid.', 'JW202 threshold 180 days or longer; DQ below 180; arrival advice and visa help only after registration are preserved.', 'Housing is self-arranged with nearby information for reference, without a room or price guarantee.', 'Annual 21000 option is retained only as brochure context in notes.'],
        'renderedImages': [{'path': p.relative_to(ROOT).as_posix(), 'sha256': sha(p)} for p in sorted(DIRECTORY.glob('*-page-*.png'))],
    })
    print(json.dumps({'batch': out.relative_to(ROOT).as_posix(), 'sha256': sha(out), 'proofs': len(proofs), 'sources': len(sources)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
