# NENU shared annual conditions: evidence and a separate future contract

This is a design, not an implemented association or publication route. The
bounded graph repair does not create these bindings, renew 2026 facts or replay
the permanently protected undergraduate document.

## Actual evidence

The three official guides now explicitly describe academic year 2027–2028:

- https://iso.nenu.edu.cn/Admission/Bachelor_Program.htm
- https://iso.nenu.edu.cn/Admission/Master_s_Program.htm
- https://iso.nenu.edu.cn/Admission/Doctora_Program.htm

Read-only target D1 and R2 confirmed the same year in the retained cloud text,
with successful observations on 2026-11-14 at 13:33:03Z, 11:18:02Z and 10:03:13Z
respectively. The bachelor source also has the graph-planning error described
in the separate bounded-graph plan. Direct bindings cover only five older
programmes and five older cycles, not today's 84 new identities.

The master and doctoral guides provide degree/age qualifications, separate
Chinese and English requirements, a June 25, 2027 deadline, official application
portals and an RMB 800 fee. They explicitly point to the corresponding 2027
programme tables, which identify academic year, named programme, degree,
instruction language, duration and annual tuition:

- https://iso.nenu.edu.cn/2027_NENU_Master_EN_PUBLIC.pdf
- https://iso.nenu.edu.cn/2027_NENU_Doctoral_EN_PUBLIC.pdf

The master PDF source is registered with the master-guide parent but had no
successful capture at the audit. The doctoral PDF had a real 14:32:32Z raw capture
but no text derivative yet. Its raw SHA is
b52ffc7e047d905f585e147052676f6f61cd7463b9c6d62425f2f32841e634a9.
The 2027 undergraduate PDF was not registered at that observation. The normal
capture/frontier queue and GET/POST /documents are the existing acquisition and
raw-bound derivative routes. Neither is a programme-applicability approval.

Web table text yields at least five distinct existing master identities worth
formal row verification: Basic Psychological Studies (row 12, English),
Educational Technology (row 65, Chinese), Journalism (row 98, Chinese),
English Language and Literature (row 32, English), Environmental Engineering
(row 97, English). This is research evidence only: the web screenshot endpoint
cache-missed; actual captured PDF rows and headers must be independently checked.
Untranslated Chinese-only names and same-name/different-faculty rows require
official alias/department evidence rather than fuzzy matches or new duplicate IDs.

## Required explicit acquisition binding

A future `OfficialProgramSourceBindingV1` should contain:

    universityId, programId, currentRecordScopeSha256, currentCatalogSha256
    academicYear, degreeLevel, teachingLanguage, applicationRound?
    guide: sourceId, URL, rawSHA, textSHA, snapshotKey, observationId, checkedAt
    catalog: sourceId, URL, rawSHA, textSHA, snapshotKey, observationId, checkedAt
    officialLink: frontierKey, frontierSHA, exact parent/child URLs
    membership: literal name/degree/year/language + exact row/header locators
    applicability: literal guide year/level/track and common-policy locators
    independentReview: immutable review refs, contentSHA

Registration would use authenticated existing native/control gates, exact active
programme pins and same-school official sources. The reader must rehash both
documents and the original link receipt, prove that the named programme exists
in the same annual table, and require the guide to explicitly apply to its
degree/track. It must check every source/raw/text against permanent unknown
denials. A content-addressed binding plus exact control/target CAS event creates
an acquisition candidate only, not a verified condition. Keep original programme
IDs; no school-wide list or caller-supplied `appliesToAll:true` can substitute.

There is currently no dedicated source-applicability registration API. POST
/targets is a projection of canonical record.sourceIds; arbitrary sourceIds
cannot be treated as proof. A separate candidate-binding index/table and receipt
reader would need explicit versioning. Canonical sourceIds should change only
after ordinary fact review/import accepts real leaves, preserving the one publisher.

## A source binding alone cannot publish an annual cycle

Current importAdmissionCycleCandidates requires programme, international and
cycle-scope evidence to reference the same captured document. The real NENU
programme rows are in the PDF while conditions are in the guide. A future
multi-document cycle proposal must carry typed per-document proofs and the
reviewed binding above; the importer must verify each original document/quote,
without concatenating them into a fictitious captured source. Request payload
and cache identities must bind the complete document set, while every existing
unknown/reservation remains protected.

The guides do not explicitly specify autumn/fall intake. September occurs only
in passport-validity and prerequisite-graduation clauses, so it cannot prove an
autumn start. Data already supports intake='other', but the discovery contract
accepts only spring/autumn. Supporting a real explicit academic year with no
stated season needs a reviewed year-only/other contract, not an inferred autumn.
Same-year degree-wide eligibility and portal policies may be shared only through
the explicit applicability proof; English/Chinese language thresholds remain
separate annual tracks. Missing row, annual, season or applicability evidence
continues held and contributes zero to the complete-programme target.
