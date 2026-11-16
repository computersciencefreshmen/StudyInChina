# MiniMax public read-only monitor

The user authorized a password-free `/minimax` page on the existing website. It is public, with `noindex` metadata rather than access control. `/admin` and every existing administrative permission remain unchanged.

The page reads only `/api/minimax/status`. Its server module reuses the existing protected cloud-monitor reader and server-side `ADMIN_TELEMETRY_TOKEN`; it forwards no browser cookies or authorization. The existing transport limits remain eight seconds and64KiB, with a45-second upstream cache. A public20-second cache coalesces requests per isolate; CDN lifetime is capped at20seconds and shortened before quota or evidence expiry. This is request reduction, not a global rate-limit guarantee.

Every public object is explicitly reconstructed. It includes today/five-hour aggregate counts and reported tokens, fixed model/pass/status labels, call and completion timestamps, numeric task counters, and coverage totals. Ledger IDs, free-form errors/reasons, source URLs, environment values, raw provider bodies and administrative controls are excluded. Read failures retain only the already-redacted last observation with stale labels. Refresh time never renews evidence timestamps; null usage is unknown, never zero.

The mobile page checks about every45seconds and ages observations locally. A completed model request is distinct from an accepted fact or published programme; task inflight counts are distinct from provider calls. Coverage reports condition-complete opportunities separately from identities. No model calls, D1 writes, queue changes, or Cloudflare Worker changes are introduced.

Verification covers recursive redaction, GET-only routing, cache coalescing and expiry boundaries, unavailable/stale UI, exact locale-router exclusion, and a mobile-width browser check. Production deployment and protected upstream configuration verification remain the normal release process.
