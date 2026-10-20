# Batch 010 — seven existing dates at six schools

Date-only outcome: **4 unchanged, 2 held conflicts, 1 blocked**. Every selected row is unpublished in the input snapshot. No canonical file, publication status, freshness field, Git state, or shared progress was changed.

- Hainan Normal: current school PDF confirms October 31, 2026 for students entering March 2027; November 10 is the institutional review deadline.
- PKU: October 31, 2026 applies to the **February 2027** ordinary visiting / preparatory intake and both online systems. Paper documents must arrive before the deadline.
- Sichuan International ICLT: full official web text confirms March 2027 / October 31, 2026. Native HTML timed out; saved text is honestly marked tool-returned, possibly cached, without origin-byte claims.
- Chongqing: school host returned HTTP 412. A complete CQU-authored 2026 PDF hosted by Università per Stranieri di Siena confirms March 2027 / October 31, 2026. Partner provenance is explicit; it does not certify a successful current CQU-host read or publication approval. September deadline is May 11.
- Sichuan Normal: the same bilingual official notice says March 2027 in Chinese and March 2025 in English. Held, with `officialDeadline: null`; no silent year repair.
- Sichuan International language cycle: March 2027 deadline is December 15, 2026; May 2027 deadline is March 30, 2027. The existing generic spring row and notes do not determine which session it represents. Held, with `officialDeadline: null` and no automatic correction.
- Central China Normal: original page blocked; the alternate official department guide attachment returned a verification-code HTML form. HTTP 200 was not counted as guide/date evidence. No captcha bypass or repeated retries.

Raw native bodies and SHA receipts, actual SISU full-page web text, extracted PDFs and visually inspected date pages are retained here. `report.json` binds each exact record with `JSON.stringify` SHA-256 and verifies all six canonical input-file hashes against the pinned inventory. The two PDF date pages were rendered and inspected. `completion.json` pins the report. No central generic deadline replaces a school-specific deadline.
