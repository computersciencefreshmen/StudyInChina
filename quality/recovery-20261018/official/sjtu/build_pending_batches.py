"""Construct source-backed proposals only; independent review and CAS apply are separate."""
from pathlib import Path
import copy
import hashlib
import json
import unicodedata

ROOT = Path.cwd()
BASE = ROOT / "quality/recovery-20261018"
RECOVERED = BASE / "remote-wave-2/content/data"
PROGRAMS = json.loads((RECOVERED / "programs.json").read_text(encoding="utf-8"))
CYCLES = json.loads((RECOVERED / "admission-cycles.json").read_text(encoding="utf-8"))
SOURCES = json.loads((RECOVERED / "sources.json").read_text(encoding="utf-8"))
DAY, REVIEW = "2026-10-18", "2026-10-25"


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def section(text, start, end):
    left = text.index(start)
    right = text.index(end, left + len(start))
    return text[left:right].strip()


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")


def capture(school, name, source_id):
    receipt = json.loads((BASE / "official" / school / (name + ".receipt.json")).read_text(encoding="utf-8"))
    raw, text = Path(receipt["rawPath"]), Path(receipt["textPath"])
    assert receipt["status"] == 200 and receipt["robots"]["canFetch"]
    assert digest(raw.read_bytes()) == receipt["sha256"]
    assert digest(text.read_bytes()) == receipt["textSha256"]
    source = copy.deepcopy(next(item for item in SOURCES if item["id"] == source_id))
    assert source["url"] == receipt["requestedUrl"] == receipt["url"]
    source["accessedAt"] = DAY
    proof = {"sourceId": source_id, "url": source["url"], "rawPath": raw.relative_to(ROOT).as_posix(),
             "rawSha256": receipt["sha256"], "textPath": text.relative_to(ROOT).as_posix(),
             "textSha256": receipt["textSha256"], "retrievedAt": receipt["retrievedAt"], "httpStatus": 200}
    return source, proof, normalized(text.read_text(encoding="utf-8"))


def evidence(field, sid, quote, text, locator, derivation=None):
    quote = normalized(quote)
    assert quote and quote in text, (field, quote[:100])
    value = {"field": field, "sourceId": sid, "quote": quote, "locator": locator}
    if derivation:
        value["derivation"] = derivation
    return value


def proposed(program):
    p = copy.deepcopy(program)
    c = copy.deepcopy(next(item for item in CYCLES if item["programId"] == p["id"] and item["verifiedAt"] == "2026-10-17"))
    for record in [p, c]:
        record.update(verifiedAt=DAY, reviewAfter=REVIEW)
    return p, c


sjtu_id = "source-sjtu-pre-university-spring-2027-en-20261017"
sjtu_source, sjtu_capture, sjtu_text = capture("sjtu", "sjtu-spring-2027", sjtu_id)
sjtu_entries = []
for old in PROGRAMS:
    if not old["id"].startswith("program-sjtu-pre-university-"):
        continue
    p, c = proposed(old)
    language = p["teachingLanguages"][0]
    details = p["supplementaryDetails"]
    # Preserve all nationality subclauses, 14 source categories, language alternatives and translations.
    for row in details["applicationMaterials"]:
        if "The notice does not resolve the application-year" in row.get("en", ""):
            row["en"] = row["en"].replace("The notice does not resolve the application-year term into a calendar year here.",
                                         "Confirm the applicable application-year reference with SJTU.")
    c["notes"] = {"en": (
        "Spring registration is in mid-February 2027; the exact date will appear in the Admission Notice. "
        "The 0.5-year route is one semester joining the ongoing one-year cohort, with limited places for outstanding mid-term transfer students. "
        "The curriculum table lists the second semester as 10 weeks including examinations. "
        "Each language route offers three subject tracks: science, engineering and agriculture; medicine; and humanities and social sciences. "
        "Listed undergraduate majors describe future study interests. Admission to a bachelor programme requires its own assessment; the notice describes priority after passing the official assessment. "
        "The curriculum may change for progression requirements and student ability; select one or two major electives and one general elective each semester. "
        "Applications receive comprehensive review and may require an integrative test or interview, with arrangements emailed. "
        "Pay the non-refundable CNY800 application fee before submitting. After pre-admission, confirm enrollment by paying tuition within two weeks. "
        "Spring Admission Notices are issued in batches from the end of January. Download the electronic notice from the application system; paper copies are supplied at registration. "
        "Tuition includes CSCA preparation, HSK mock examinations and undergraduate application guidance. "
        "Group Comprehensive Insurance in Mainland China is required for registration; the published standard is CNY800 per academic year. "
        "Qibao Campus guarantees university-assigned four-person accommodation at CNY700 per month. "
        "At least ten students must enroll in each programme; otherwise the programme is canceled and tuition refunded in full. "
        "Freshman Scholarships are restricted to new one-year autumn-start students. Outstanding Student Scholarships depend on semester examination results; scholarships cannot be applied to tuition fees. "
        "False, inaccurate or incomplete application information can cancel application, enrollment or study eligibility. "
        "Check the nationality documentation and spring guardian reference date in the application checklist."
    )}
    lang_quote = (section(sjtu_text, "Chinese Program (0.5 year) applicants should provide HSKcertificate", "8.2 English Program")
                  if language == "Chinese" else section(sjtu_text, "English Program (0.5 year) applicants should provideone", "9. Applicant's birth certificate."))
    fee_quote = section(sjtu_text, "2. TuitionFee", "Note: The above fees include tuition")
    ev = [
        ("name", f"{language} Program (0.5 year)", "Curriculum / spring route", "Display name identifies the published language route and exact duration."),
        ("degreeLevel", "The above program is an extension program, not related to any credit ordegree.", "Introduction / qualification", "Non-degree pre-university preparation maps to foundation."),
        ("teachingLanguages", f"2. {language}is the primary language of instruction.", f"Curriculum / {language} Program / note 2", None),
        ("durationText.en", "0.5 year", f"Curriculum / {language} Program", "Exact official duration wording; no month conversion."),
        ("applyUrl", "https://elearning.sjtu.edu.cn/register", "Application Procedures / item 1", None),
        ("languageRequirements", lang_quote, "Application Materials / item 8 / half-year route", "Use the spring route thresholds rather than the lower one-year thresholds."),
        ("eligibility", section(sjtu_text, "Eligibility", "Curriculum"), "Eligibility / all four items", None),
        ("applicationMaterials", section(sjtu_text, "ApplicationMaterials", "Application Procedures"), "Application Materials / items 1-14, subclauses and notes", "Checklist preserves all conditional nationality and guardian requirements."),
        ("closesOn", "TheSpring intake programs: 2027 January 15th", "Application Deadline / spring", None),
        ("tuitionCny", fee_quote, f"Fee Structure / {language} half-year spring row", f"The {language} half-year row is CNY{c['tuitionCny']:,}."),
        ("tuitionPeriod", fee_quote, f"Fee Structure / {language} half-year spring row", "The price applies to the entire published half-year programme."),
        ("applicationFeeCny", "CNY800. The application fee is non-refundable once paid.", "Fee Structure / application fee", None),
        ("programUrl", "2026 Pre-University Program for International Student", "Page title and current spring 2027 sections", "The 2026 launch article explicitly contains spring 2027 admissions and fees."),
    ]
    sjtu_entries.append({"program": p, "cycle": c,
                         "evidence": [evidence(f, sjtu_id, q, sjtu_text, loc, d) for f, q, loc, d in ev],
                         "reviewer": "pending-independent-review", "reviewedAt": None,
                         "notes": "Fresh primary-source proposal. Requires a separate semantic review of both language routes, all material subclauses and HTML tuition-table alignment before approval."})

save(BASE / "official/sjtu/full-program-batch-draft-v1.json",
     {"schemaVersion": 1, "batchId": "sjtu-spring-2027-fresh-20261018-v1", "sources": [sjtu_source], "captures": [sjtu_capture], "entries": sjtu_entries})

xjtu_ids = ["source-xjtu-2027-foundation-full-guide-official-20261017", "source-xjtu-2027-foundation-brochure-official-20261017", "source-xjtu-official-application-route-official-20261017"]
xjtu_data = [capture("xjtu", name, sid) for name, sid in zip(
    ["xjtu-full-guide-2027-direct", "xjtu-brochure-2027-direct", "xjtu-application-route-direct"], xjtu_ids)]
xt = xjtu_data[0][2]
xjtu_entries = []
for old in PROGRAMS:
    if not old["id"].startswith("program-xjtu-ifp-"):
        continue
    p, c = proposed(old)
    advanced = "advanced" in p["id"]
    label, weeks, start = ("Advanced", 18, "February") if advanced else ("Intensive", 11, "April")
    minimum = "HSK2~3 or equivalent" if advanced else "HSK4 or above or equivalent"
    details = p["supplementaryDetails"]
    details["eligibility"][0]["en"] = "Under 24 years old and in good health. Applicants under 18 require guardian authorization."
    details["eligibility"][3]["en"] = "The International Foundation Program (IFP) requires an average high-school grade of 60%. The separate “1+4” Foundation-Bachelor pathway requires 70% and its own undergraduate assessment."
    details["eligibility"][4]["en"] = minimum + ". A Chinese-native-language exemption from HSK requires XJTU approval."
    c["notes"] = {"en": (
        f"The {label} Program starts in {start} 2027 and lasts {weeks} weeks. Confirm the exact registration date with XJTU. "
        f"Tuition is CNY{c['tuitionCny']:,} for the full programme in either Humanities (Business and Social Science) or Science and Engineering. "
        "The ordinary International Foundation Program (IFP) requires an average high-school grade of 60%. "
        "The separate “1+4” Foundation-Bachelor pathway requires 70% and comprehensive undergraduate review and interview. "
        "That pathway's conditional undergraduate admission also requires successful foundation completion, Chinese proficiency equivalent to HSK4 and a qualifying CSCA report. "
        "Ordinary IFP students apply for a bachelor programme during foundation study and participate in the undergraduate review; foundation enrollment does not guarantee a bachelor place. "
        f"The language requirement for this {label.lower()} route is {minimum}. A Chinese-native-language HSK exemption requires XJTU approval. "
        "The standard application fee is CNY500. Applicants for the “Five Central Asian Countries” International Student Education and Training Program Scholarship pay CNY800 instead. "
        "The application fee is non-refundable regardless of admission outcome; payment becomes available in the system after initial review. "
        "Graduating applicants may apply with mock-examination transcripts. The document checklist also requests the original and notarized diploma and entrance-examination transcripts; confirm the required timing and acceptable substitutions with XJTU. "
        "Submit a complete, authentic and accurate application online in Chinese or English; paper applications are not accepted. "
        "Under-18 applicants need guardian authorization. Classes are small and grouped by intended major and current Chinese proficiency. "
        "Study covers general and academic Chinese, core subjects and intercultural skills, with visa, application, scholarship-policy and university-life guidance."
    )}
    deadline_quote = section(xt, label + " Program " + start + ", 2027", "Intensive Program" if advanced else "Tuition Fee")
    fee_quote = section(xt, "Foundation Programs (Unit: RMB)", "Application Documents")
    ev = [
        ("name", label + " Program", "Eligibility / programme row", "Stable display identity combines the official route, week length and Chinese-taught title."),
        ("degreeLevel", "International Foundation Program (IFP)", "Program Introduction / ordinary IFP", "Non-degree pre-university preparation maps to foundation; separate 1+4 is disclosed."),
        ("teachingLanguages", "Xi’an Jiaotong University (Chinese-taught)", "Full-guide title", None),
        ("durationText.en", f"{weeks} weeks", f"Eligibility / {label} row", "Exact official wording, without guessing a month count."),
        ("applyUrl", "http://isso.xjtu.edu.cn/recruit/login", "Application Procedure / official application route", "Same official host and path are freshly retrieved over verified HTTPS with HTTP200 and no redirects; use the secure scheme."),
        ("languageRequirements", minimum, f"Eligibility / {label} row", "Keep the published HSK wording without inventing a numerical examination score."),
        ("eligibility", section(xt, "Eligibility Under the age of 24", "Start Time & Application Deadline"), "Eligibility / conditions and grade table", "PDF rendered table confirms merged IFP60% and separate 1+4 70% columns across programme rows."),
        ("applicationMaterials", section(xt, "Application Documents", "Application Procedure"), "Application Documents / all nine items and note", None),
        ("closesOn", deadline_quote, f"Start Time & Application Deadline / {label} row", None),
        ("tuitionCny", fee_quote, f"Tuition Fee / {weeks}-week column / both fields", f"Rendered PDF and full-guide tables agree on CNY{c['tuitionCny']:,}."),
        ("tuitionPeriod", fee_quote, f"Tuition Fee / {weeks}-week column", "A total for the named week-length programme, not an annual price."),
        ("applicationFeeCny", section(xt, "a. Application fee is RMB 500.", "b. Applications must"), "Application Procedure / note a", "CNY500 is ordinary application fee; retain CNY800 scholarship exception and application-fee-only nonrefund rule."),
        ("opensOn", deadline_quote, f"Start Time & Application Deadline / {label} row", None),
    ]
    proofs = [evidence(f, xjtu_ids[0], q, xt, loc, d) for f, q, loc, d in ev]
    proofs.append(evidence("applyUrl", xjtu_ids[2], "Application & Admission System for International Student", xjtu_data[2][2], "Fresh HTTPS application-system title", "HTTPS200 and exact official host/path corroborate the secure application route."))
    proofs.append(evidence("tuitionCny", xjtu_ids[1], "13,800" if advanced else "8800", xjtu_data[1][2], f"Rendered PDF page 1 / {weeks}-week tuition column", "Independently inspect the rendered table so a number alone cannot establish column alignment."))
    xjtu_entries.append({"program": p, "cycle": c, "evidence": proofs,
                         "reviewer": "pending-independent-review", "reviewedAt": None,
                         "notes": "Fresh primary-source proposal. Review requires the rendered PDF eligibility/tuition columns, all nine materials, ordinary IFP versus 1+4 scope, and application-fee-only nonrefund wording. All archived maintenance-language text has been removed from applicant-facing fields."})

save(BASE / "official/xjtu/full-program-batch-draft-v1.json",
     {"schemaVersion": 1, "batchId": "xjtu-spring-2027-fresh-20261018-v1", "sources": [item[0] for item in xjtu_data], "captures": [item[1] for item in xjtu_data], "entries": xjtu_entries})

for school in ["sjtu", "xjtu"]:
    path = BASE / "official" / school / "full-program-batch-draft-v1.json"
    print(json.dumps({"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path.read_bytes()), "entries": len(json.loads(path.read_text(encoding="utf-8"))["entries"])}))
