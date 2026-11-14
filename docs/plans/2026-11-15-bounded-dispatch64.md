# Explicit 64-job dispatch

Supply existing, useful queued work to the four-concurrent-model admission lane
without changing the 15-minute schedule or buying provider capacity. Preserve
the default eight jobs and exact 16/32 behavior. Only the literal `"64"` opts in;
all other strings, including `"128"`, decimals, whitespace and SQL-like input,
still select eight. The checked-in Wrangler example stays at eight.

The 64 setting selects at most 64 due sources and sends at most 64 ordinary jobs.
Raise only its candidate reservoirs to 64 sources and 64 per maintenance,
programme-expansion and scholarship-expansion lane (192 total). Retain the
existing priority, low-coverage ranking, per-school rotation, cumulative 70%
expansion share, 2:1 programme/scholarship rotation and empty-share borrowing.
SQL interpolation uses only parser-derived numeric constants. The 8/16/32
settings continue generating the original 40/120 bounds.

Admission, four-model concurrency, 5%/20% quota reserve, unknown-result deny,
429 cooldown, provider evidence and the sole canonical publisher are unchanged.
Dispatch never calls the provider. More queued jobs do not establish more
accepted facts or guarantee more model calls. Administrative continuations
retain their separate existing bounds and are not an additional 64 ordinary jobs.

Keep individual durable INSERT/send/UPDATE ordering: a crash must retain a job
for later delivery. A full ordinary 64-capture fixture measured 137 prepared D1
statements in SQLite and 136 in real workerd/D1/R2, with maximum eight parameters
per statement. These measured paths have no pending followup/native proof work;
those existing bounded checks consume additional queries. Paid supports 1,000
queries per invocation and 100 bound parameters per query; Free's 50-query limit
does not support this worst-case path. See the [official D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
No migration, extra fact scan, new timer or cloud configuration change is needed.

Verify 272/295 registries, actual cloud ticks, exact default/invalid behavior,
64 distinct school sends, 30 ticks of proportional fairness, empty scholarship
borrowing, urgent priority and canary/model-disabled controls. Native D1/R2
executes the real scheduling queries and durable writes; an existing quota wait
then makes zero D1 preparations and zero sends. External requests are forbidden,
and no model attempt is created. Run existing admission/unknown guard tests
alongside the scheduler suite. Root chooses live opt-in only after full CI.
