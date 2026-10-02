# MiniMax administrator executor bridge

The online administrator page is `/admin`. It authenticates the administrator
with the existing signed cookie; the browser never receives the machine's
MiniMax credential or the private transport token. Vercel accepts only the
typed `pause`, `resume`, and `start` commands. The local Node bridge polls the
private catalog Worker over HTTPS, claims one command, calls the existing
MiniMax controller, and returns an acknowledgement and a sanitized observation.
This allows control from the website without opening a public port on the PC.

The PC must remain powered and connected. A fresh bridge observation confirms
that the website can reach the executor; the existence of a web page or saved
`running` file alone does not establish execution. A pause can take effect after
an already admitted model request returns, and its observed state distinguishes
that period from a fully acknowledged pause.

For the monitoring deployment, run the bridge with `--telemetry-only`:

```powershell
node --conditions=react-server --import tsx scripts/ingestion/admin-executor-bridge.ts --telemetry-only
```

This mode uploads observations without reading, claiming or executing control
commands. Add `--once` to refresh the ledger and official quota and publish one
complete observation. Keep `ADMIN_REMOTE_CONTROL_ENABLED` unset for read-only
monitoring; the website disables controls explicitly. Invoke Node directly with
both flags because a spawned tsx CLI process may lose the React server condition.

The immutable ledger supplies cumulative and Shanghai-calendar-day API usage.
Missing usage attempts remain separate, and surviving historical responses form
a lower bound. The ledger acquisition time is separate from transport freshness:
a fresh upload cannot make an old ledger or quota observation current. Cache
counters are subsets of input usage and reasoning counters are subsets of output
usage, so neither is added twice. Provider billing and plan debits are not inferred
from API token counts.

## Private transport

The existing catalog Worker implements two private endpoints:

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/internal/v1/admin-telemetry` | GET, PUT | Sanitized task, executor and token observations |
| `/internal/v1/admin-executor` | GET, POST, PATCH | Bounded task queue, claims, lease renewal and acknowledgement |

Both require `ADMIN_TELEMETRY_TOKEN`, return private no-store responses, and
offer no browser CORS. The default machine identity is
`studyinchina-local-minimax`. Set `ADMIN_EXECUTOR_ID` identically on the Worker
and bridge only when changing that identity. These operations use R2 and do
not consume catalog D1 query quota or modify published releases.

A POST accepts the strict shared `ExecutorCommand`: a UUID `commandId`, an
`action`, and, for `start` only, typed verification `options`. Options select
collection, sample/full scope, supported model and effort. Executable names,
filesystem paths, shell strings, API keys and additional properties are refused.

Commands expire five minutes after initial acceptance. A claim binds the
command to its machine identity and a fresh UUID attempt. The bridge renews
the 60-second lease every 20 seconds during execution. Only the matching
attempt can acknowledge its result. A lost claim lease becomes
`execution_outcome_unknown`; it is never automatically redispatched because
the machine may have acted before the network disconnected. The bridge retries
an acknowledgement at most three times and never retries the local execution.
The local controller also retains per-command receipts.

Conditional R2 writes preserve queue consistency under concurrent requests.
There are at most 10 pending/claimed commands and 100 queue/history entries.
Small permanent UUID reservation objects are retained separately to prevent
old commands from executing after queue history is truncated. A reservation
without its queue entry is treated as an uncertain outcome requiring a fresh
user command, rather than reconstructed as pending work.

## Local configuration and activation

The default target is the existing
`https://studyinchina-catalog-api.13022037121.workers.dev` host. The bridge accepts
`ADMIN_TELEMETRY_URL` only with the exact telemetry path, HTTPS, no credentials,
query or fragment, and the explicitly allowed `ADMIN_TELEMETRY_TOKEN_HOST`.
It refuses redirects and bounds private responses. The default host is pinned
when an allowed host is not supplied.

Use a server-only `ADMIN_TELEMETRY_TOKEN` environment value, or the existing
Windows DPAPI file `.tmp/admin-telemetry-secret.dpapi`. The bridge decrypts that
file inside a hidden PowerShell child and never prints the result. This is a
machine transport credential, independent of the administrator login password
and MiniMax billing credential.

Read-only configuration audit, without publishing telemetry or taking commands:

```powershell
node --conditions=react-server --import tsx scripts/ingestion/admin-executor-bridge.ts --audit-config
```

Run the bridge only after the private Worker and website control APIs are
deployed and verified:

```powershell
node --conditions=react-server --import tsx scripts/ingestion/admin-executor-bridge.ts
```

The React server condition allows reuse of the existing server-only sanitized
local run projection; it does not make the PC a public web server. One process
holds the exclusive `admin-executor.lock.json`, which checks operating-system
PID and creation time before any stale-lock recovery. Bridge state is saved to
`.tmp/minimax-verification/admin-executor-bridge-state.json`, with fixed error
codes and no credentials. Ending the bridge releases its lock and leaves the
existing verifier running.

Every cycle publishes local run observations and controller state, normally
about every ten seconds. It refreshes the usage ledger roughly every 60 seconds,
seeding surviving historical response files and aggregating immutable usage
receipts. Only the shared allowlisted ledger projection crosses the network.
Historical response counters remain a lower bound when previous responses were
overwritten. API-reported tokens, Token Plan allowance and provider bill totals
are separate measurements; the bridge does not invent billing amounts.

Tests exercise strict authorization, expiry, duplicate UUIDs, claim identity,
CAS conflicts, no redispatch after lost acknowledgement, failed controller
results, response bounds and HTTPS host pinning. They mock all commands and
make no live MiniMax requests.
