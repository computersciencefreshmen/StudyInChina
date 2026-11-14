# Separate bootstrap validation from normal dispatch

The old cloud tick could enqueue a raw bootstrap upload for validation, then
continue into ordinary scheduling. With a complete existing seed and no validated
bootstrap pointer, a leftover raw upload added one delivery beyond the ordinary
job bound. Merely returning after that send is insufficient: an old upload that
cannot validate could prevent a healthy existing seed from scheduling forever.

Read the already-required control snapshot before choosing this branch. A complete
seed retains its current owner and controls and runs only normal scheduling; its
unvalidated raw upload and receipt remain byte-for-byte intact. An incomplete or
missing seed instead sends exactly one validation message and returns. The
existing queue handler still verifies raw bytes and creates the actual immutable
pointer/envelope. A later tick performs the normal seed continuation, followed by
the original five-school activation. The scheduler creates no validation receipt,
does not replace an existing seed and cannot reactivate an operator pause.

This change is intentionally a separate optional commit from TICK_JOB_LIMIT.
Its tests cover real complete seeds at default/16/32, unchanged raw intent/control,
successive running ticks, an unchanged paused seed, and actual raw-upload queue
validation through pointer creation, staged seeding and five-school activation.
An unavailable control read stays on the existing backend-wait path; immutable
raw intent is retained for the next verified recovery rather than guessed away.
