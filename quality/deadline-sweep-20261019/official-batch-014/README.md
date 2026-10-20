# Batch 014 — eighteen null-date cycles at seven schools

**6 closed-date candidates and 12 unknown**, all unpublished in the pinned snapshot. No canonical date/status/freshness, shared progress, Git, or deployment was changed. The report has one `groups[].records` representation and no duplicate aliases.

- BTBU: the 2026 international undergraduate guide gives **May 1, 2026**. Business Administration, International Economics and Trade, and Polymer Materials and Engineering match its programme table. Finance is absent from that actual table and remains unknown; no discontinuation is claimed.
- BJUT: the exact English International Economics and Trade bachelor brochure explicitly gives **November 1, 2025–June 15, 2026**. One closed candidate; opening is separately retained as a candidate, not a canonical match.
- Central Academy of Drama: current full 2026 foreign-applicant PDFs give initial undergraduate materials **March 6, 2026 at 09:00 Beijing time**, and foreign doctoral email materials **March 6, 2026 at 17:00**. Undergraduate later major/payment and qualification stages are separate. The doctoral January–February online window belongs to Hong Kong/Macao/Taiwan applicants; foreign students do not participate in that window.
- BUPT: four rows stay unknown. Its 2026 brochure says October 20 to April 20 of the following year, without absolute application years.
- BWU: two rows stay unknown. Fee and generic programme pages give no precise current-cycle deadline; “before class begins” and approximate September entry are not calendar cutoffs.
- CUEB: one row stays unknown. A directly linked rule says autumn applications before June 10 each year, but no absolute applicable year. The December language-only rule does not apply to this bachelor route.
- Central Conservatory: four rows stay unknown. The current page gives annual spring-before-January-1 / autumn-before-June-15 rules, without an explicit selected intake year. Its January 2026 publication date is not used to invent application-year endpoints.

All native originals have SHA-256 and observed timestamps. The PDF date pages and BTBU matching-major table were rendered and inspected. CAD's original detail failed once; the registered official listing led to actual current guides. Its undergraduate redirect to the academy admissions host was explicitly resolved and captured over HTTP, with that provenance retained. No landing title, search snippet, or webpage publication date was counted as a route-specific deadline.

Every record has an exact `JSON.stringify` SHA-256, parent programme SHA, `candidateOnly: true`, `publishedInInputSnapshot: false`, and `openingDateAssessed: false`. All six canonical input hashes and prior-record exclusion were checked. New candidate dates require the parent’s narrow review before any canonical update.
