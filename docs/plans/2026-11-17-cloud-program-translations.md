# Cached cloud translations for collected program requirements

The unified Programs catalogue remains the source of original text. A separate
translation companion adds English/Chinese first, then Russian, German, French
and Spanish. It never edits source facts, evidence, fees, dates, duration or
language thresholds. This is language assistance, not new factual verification.

Each translation is addressed by the exact source-content hash, target locale
and version. Shared source passages reuse one entry across programmes. The
reader validates this binding and critical original fact spans before displaying a
translation; absent or rejected entries fall back to the original. Every
translated section retains an expandable original. New source text gets a new
key, so an old translation cannot silently follow changed admissions conditions.

Fixed labels use dictionaries. Long prose is translated in bounded batches;
numbers, dates, money, URLs, exam requirements and qualifying phrases are
protected verbatim. Some critical fact spans therefore intentionally remain in
their original language. Long fields reuse sentence/paragraph chunks and are
published in full only once all chunks pass validation.

The existing public data branch stores translations and sanitized attempt
journals. The translation and collection workflows share one writer lock.
Before each model wave, the runner pushes reservations, checks fresh MiniMax
subscription quota and uses only the existing subscription secret. Ambiguous
requests remain quarantined instead of being automatically charged again.
Known failures have bounded retries. No paid API key fallback or upgrade exists.
The existing five-percent overflow margin remains in force.

The cloud schedule runs every fifteen minutes with up to eight model requests
in flight, a bounded eight-minute checkpoint and up to 120 useful calls. It
works with the user's computer turned off. Validated data commits become visible
without an application rebuild; missing translations refresh after sixty seconds.

Acceptance requires model/quota/critical-clause and idempotency tests, production
CI, an actual cloud translation checkpoint with usage evidence, and public
detail/API readback showing translated text alongside unchanged originals.
