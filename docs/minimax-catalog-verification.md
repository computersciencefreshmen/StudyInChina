# Batch verification of the current catalog

This tool checks all six `content/data` collections against freshly captured official sources. It produces review candidates and a difference report, while preserving the existing quarantine, human review and strict publication gates. HTTP success and a model saying “supported” never change a record to `verified`.

```powershell
# Inventory and build the complete 6-collection queue; no network or model charge.
npm run minimax:verify -- --prepare

# Inspect public effective configuration without source/model calls or output files.
npm run minimax:verify -- --use-ccswitch --audit-config

# Fetch two records' official sources without a model call.
npm run minimax:verify -- --fetch-only --limit 2

# Smoke test the existing CC Switch MiniMax provider with two records.
npm run minimax:verify -- --use-ccswitch --limit 2

# Run the complete catalog, with two batches at a time. Repeat to resume.
npm run minimax:verify -- --use-ccswitch --all --concurrency 2 --batch-size 2

# Generate an immediate partial review report from checkpoints, even during a full run.
# This needs no credential and makes no model or source calls.
npm run minimax:verify -- --report-only

# Inspect a running frozen snapshot after newer catalog data has changed its hash.
npm run minimax:verify -- --report-only --run 698fd533401f3de8

# Retry unresolved records and optionally restrict to one collection.
npm run minimax:verify -- --use-ccswitch --all --retry-unconfirmed --collection programs

# New M3 job with reasoning explicitly enabled (does not edit CC Switch).
npm run minimax:verify -- --use-ccswitch --model MiniMax-M3 --thinking adaptive --limit 2

# New preview job; requires an eligible Token Plan credential.
npm run minimax:verify -- --use-ccswitch --model MiniMax-M3.1-Flash-Preview --effort high --limit 2
```

`--use-ccswitch` opens `~/.cc-switch/cc-switch.db` read-only and selects only the current Claude provider. It requires that provider to specify an official MiniMax endpoint and MiniMax model. The current provider's credential stays in memory and is sent directly to its official endpoint; the script neither changes CC Switch/Claude settings nor starts Claude tools or shell commands. It respects the provider's configured model (currently MiniMax-M3 when configured by the user).

On 2026-09-30, the local live receipt and CC Switch provider both selected `MiniMax-M3`; the checked-in ingestion and localization Worker configurations still select `MiniMax-M2.7`. This establishes local execution and repository defaults, not the model currently deployed in a remote Worker. MiniMax lists `MiniMax-M3.1-Flash-Preview` as its newest M-series model with a 1M context window, currently available only through Token Plan and MiniMax Code. The model name alone does not establish that a particular credential is eligible or that its catalog comparison quality is better. [Official model overview](https://platform.minimax.cn/docs/guides/models-intro).

Explicit `--model` overrides are allowlisted to M3.1-Flash-Preview, M3, M2.7 and M2.7-highspeed. `--effort low|medium|high|xhigh|max` applies only to M3.1 Flash; omission means `max`, and thinking cannot be disabled. `--thinking adaptive` explicitly enables M3 reasoning; `--thinking disabled` is accepted only for M3. M3 defaults to thinking **disabled on Anthropic**, but **adaptive on OpenAI**, so interface choice affects its effective behavior. Existing commands without overrides keep their previous request defaults. Thinking tokens count against the existing 16,384 output limit, and deeper effort can increase runtime and token use. [Anthropic thinking and effort](https://platform.minimax.cn/docs/api-reference/text-anthropic-api), [OpenAI thinking and effort](https://platform.minimax.cn/docs/api-reference/text-openai-api).

`--audit-config` validates the configured official endpoint and model options, prints only public metadata, and exits before loading catalog data, making network calls or writing task files. It does not probe account entitlement or charge tokens. An absent credential or invalid configuration exits nonzero. For a new task with any explicit model/thinking/effort option, the run directory is `<input-hash16>-<model-config-hash12>`, separate from the running legacy `<input-hash16>` directory. Manifest, receipts, responses, checkpoints and status record effective `model`, `effort`, `thinking` and `modelConfigSha256`; checkpoints from different reasoning configurations are never reused. Use `--report-only --run <input-hash16>-<model-config-hash12>` to inspect these runs. A changed model or effort starts fresh comparison checkpoints, which can consume additional tokens; it does not stop or silently upgrade an existing process.

CC Switch may point the live Claude settings at a local takeover proxy (`http://127.0.0.1:...`) and set a Claude alias such as `haiku`. The current provider stored in CC Switch establishes the official upstream endpoint and actual MiniMax model; this verifier uses that provider directly. Consequently the local proxy credential is never forwarded to a guessed public endpoint, and an additional Claude Code subprocess is unnecessary.

Alternatively, set `MINIMAX_API_KEY` locally, `MINIMAX_MODEL=MiniMax-M2.7` and an official `MINIMAX_API_URL`, such as `https://api.minimaxi.com/v1/chat/completions`, `https://api.minimax.cn/v1/chat/completions` or `https://api.minimax.io/v1/chat/completions`. The script loads `.env.local` without printing its values; use `--env-file` for another locally supplied environment file. It also supports an official `ANTHROPIC_BASE_URL` ending in `/anthropic` with `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. A local Claude proxy is not automatically treated as MiniMax: the provider and credential destination must be established separately.

Only public catalog records and official source text leave the computer. Environment files, repository files and API credentials are not part of the model prompt. Credentials are used only in the authorization header sent to one of the allowlisted official MiniMax API hosts. Source redirects are restricted to registered official hosts, use no API authorization header, and honor robots.txt. Capture has a byte limit, timeout and bounded retry. PDF extraction uses existing `pdftotext`/`PDFTOTEXT_PATH`; a missing extractor yields `unconfirmed`.

Output is in the ignored `.official-harvest/minimax-verification/<input-hash>/` directory. `manifest.json` contains counts and the input hash; `input-snapshot.json` freezes the six input collections; `queue.json` inventories every record; `run-receipt.json` records the PID, provider, model, concurrency and resumed count without credentials; `progress.json`/`status.json` atomically update after every batch; `sources/` contains retrieval receipts and bounded source text; `snapshots/` contains original bytes with SHA-256 hashes; `responses/` contains model results, usage and request hashes; `records/` contains atomic checkpoints; `report.json`, `report.md` and `differences.json` report field-level results. Matching checkpoints and source receipts are reusable for 24 hours. A changed input, prompt version or model triggers re-evaluation. Different selection sizes can share checkpoints. Ranking publisher/own-university URLs accepted by the production schema receive separate synthetic evidence sources; ranking fields cannot use unrelated admissions snapshots. These synthetic sources do not change the production source registry or add catalog tasks. To force refetching an inaccessible source immediately, remove only its known receipt file or start again after its 24-hour cache window.

Exact quote validation rejects missing/duplicate verdicts, quotes absent from the captured text, unsupported nulls/composites, mismatching numeric evidence and ambiguous dates. Replacement strings must themselves appear in the quote: missing evidence cannot become a contradiction. `supported` and `contradicted` mean candidate comparison only. Findings can still be semantically incorrect or refer to an unrelated passage; human review must match the exact program, intake, currency and billing period before existing promotion procedures are used. Long source text is explicitly marked truncated, and absence outside the sent text remains unconfirmed. Authentication, configuration and rate-limit errors stop further batches after bounded retries and record a fatal/incomplete receipt; repeat the same command to resume, including failed model requests. Full runs can consume substantial time and API tokens; the default command processes two records and `--all` explicitly selects the complete catalog.

`--report-only` defaults to the complete current catalog and can use `--collection`. Add `--run <16-character-input-hash>` to read that run's frozen `input-snapshot.json` after the catalog changes; the snapshot hash and prompt version are validated before using its checkpoints. It reads only checkpoints matching the chosen input hash, writes `partial-report.json`, `partial-report.md` and `partial-differences.json`, and leaves the live audit's manifest, status and final reports alone. Its counts distinguish attempted records, candidate field support/differences, unconfirmed fields, records needing review and model errors. An attempted record does not mean that every field was verified. These partial reports are snapshots; run the command again for newer results. `publicationApprovedRecords` always remains zero. A frozen run does not automatically audit later catalog edits, which require a subsequent run; evidence or findings from different input hashes must not be silently combined.

Protocol references: [MiniMax OpenAI compatibility](https://platform.minimax.io/docs/api-reference/text-openai-api), [MiniMax domestic Anthropic compatibility](https://platform.minimax.cn/docs/api-reference/text-anthropic-api).
