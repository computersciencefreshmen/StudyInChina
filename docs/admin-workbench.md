# Administrator workbench

The `/admin` workbench separates the website's control surface from catalog verification. The website authenticates the administrator, displays observations, and accepts a fixed set of task options. The existing MiniMax CLI captures official evidence and writes comparison checkpoints. A supported or contradicted model field is a review candidate; starting a task never publishes findings or changes `content/data`.

## Configure access

Set two independent random server-only values in `.env.local` or your hosting provider's environment settings:

```dotenv
ADMIN_ACCESS_TOKEN=<at least 32 random characters used to sign in>
ADMIN_SESSION_SECRET=<a different random value of at least 32 characters>
```

There is no default administrator password. Until both values are configured, login stays locked. Restart the development server after changing configuration. These values must never use the `NEXT_PUBLIC_` prefix, appear in browser code, or be committed.

For a small private administrator deployment, explicitly select the simple mode:

```dotenv
ADMIN_LOGIN_RATE_LIMIT_MODE=memory
```

This mode needs no Redis account. It allows five login attempts per hashed client IP per hour in each running server instance, with counters isolated from public feedback submissions. It is best-effort on serverless hosting: counters reset when the process restarts or a cold start creates a new instance, and different instances do not share counts. The password, signed session, same-origin validation, and secure cookie protections still apply.

The default mode (unset or `distributed`) requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in production so attempts are limited across instances. Missing configuration or Redis failures refuse login rather than silently selecting memory. Local development uses the existing in-memory limiter. Login attempts use a separate hashed namespace from feedback requests. The explicit administrator memory mode does not change feedback's distributed production requirements. Change the mode to `distributed` and add the two Redis settings when shared production limits are needed. Hosting environment changes require a new deployment.

Authentication creates an eight-hour signed session in an HttpOnly, SameSite=Strict cookie. HTTPS adds the Secure cookie attribute. POST and DELETE require the exact site origin. Each status, stream, and start endpoint validates the session before observing or executing work. Logout clears the browser cookie; rotating `ADMIN_SESSION_SECRET` invalidates all issued sessions.

## Observe and launch local verification

Enable this only on the Node machine that owns the catalog verifier and its saved results:

```dotenv
ADMIN_LOCAL_VERIFICATION_ENABLED=true
ADMIN_VERIFICATION_USE_CCSWITCH=true
```

The CC Switch option reads only the current official MiniMax provider through the existing CLI. Alternatively leave it false and configure `MINIMAX_API_KEY`, `MINIMAX_API_URL`, and `MINIMAX_MODEL` on the server. Keys and provider configuration never appear in dashboard responses. A zero-call configuration audit runs before a launch; it validates configuration, but cannot prove account entitlement or live API availability.

The start action accepts a collection, sample/full scope, model, and supported effort. Sample mode defaults to 20 records and allows 1–200. Full mode is explicit. M3.1 Flash supports adjustable effort; selecting M3 enables adaptive thinking without an effort parameter. The configured-model choice preserves the configured runner options. Existing running jobs are preserved, and an active process blocks another launch. The subprocess uses a fixed executable and argument array with no shell interpolation or user-provided paths.

Vercel, Cloudflare Pages, and AWS Lambda cannot observe or start the CLI on your computer. They therefore disable local monitoring/launching, while the authenticated catalog overview still loads from the configured catalog repository. A deployed control surface requires an independently hosted authenticated executor before it can launch remote tasks. This implementation intentionally does not pretend that local files are cloud telemetry.

Local telemetry filesystem calls use `turbopackIgnore` annotations so Next.js does not trace or package `.official-harvest` snapshots, local provider databases, or local executables into a cloud deployment. These accesses remain behind the authenticated local opt-in path.

## Refresh and measurements

`GET /api/admin/events` streams named `snapshot` events every three seconds and heartbeat comments. Connections close after approximately 50 seconds for a bounded server lifetime; EventSource reconnects. The UI can fall back to `GET /api/admin/status` while preserving its cards, focus, and scroll. Catalog aggregates are cached for 30 seconds and saved response usage for five seconds.

The dashboard shows raw catalog counts, stored content states, overdue verified records, official source counts, saved task progress, and candidate field summaries. `needsReview` includes drafts, stale records, and overdue verified records, so it overlaps the stored states rather than forming another exclusive status.

Token figures sum usage metadata from currently saved response files. OpenAI-compatible prompt counts already include cached input; Anthropic-compatible input counts exclude cache reads/writes and are adjusted accordingly. A repeated batch can overwrite an earlier response file, so these figures are observed saved usage, not lifetime billing. Failed responses that did not save usage are not included. There is no provider quota source; `budgetTokens` stays null and remaining quota must not be invented. Field summaries retain their report timestamp because they may be older than live progress.

## API contract

| Endpoint | Behavior |
| --- | --- |
| `GET /api/admin/session` | Configuration state, authentication state, expiration |
| `POST /api/admin/session` | `{ password }`, rate-limited cookie login |
| `DELETE /api/admin/session` | Same-origin browser logout |
| `GET /api/admin/status` | Authenticated `AdminSnapshot` |
| `GET /api/admin/events` | Authenticated SSE snapshots and heartbeat comments |
| `POST /api/admin/verification` | Authenticated typed task request; 202 accepted, 409 already running, 503 unavailable |

Shared request/response definitions are in `src/lib/admin/types.ts`. The backend uses the installed Next.js route-handler conventions and Node runtime. These endpoints return private, no-store responses and fixed sanitized errors; model content, source snapshots, credentials, arbitrary file names, and error stack traces are not projected.

Validation covers session tampering/expiration, missing configuration, mutation origin, body limits, typed command scope, model/effort compatibility, managed-runtime guards, route authorization before I/O, sanitized errors, SSE cancellation, cache-token counting, and bounded checkpoint projections. Tests mock all launches and make no MiniMax calls.
