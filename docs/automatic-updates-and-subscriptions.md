# Automatic checks and website updates

Visitors can follow universities or programs from their detail pages, or choose up to 20 saved programs at a time. The header links to a notification center where they can inspect updates, mark them read, and remove follows.

## Simple launch architecture

Notifications run entirely in the visitor's browser. Follows, per-target baselines, recent notifications and read state are saved in localStorage. They are not synchronized across devices, and clearing browser storage removes them. No email subscription, signup, third-party subscriber database or mail delivery service is required.

`GET /api/notifications` exposes a read-only snapshot of verified public university, program and admission-cycle facts from the existing catalog repository. It does not include candidate/admin data or accept personal information. The browser checks this snapshot when the website is opened, when the tab becomes visible, or when the visitor refreshes the notification center. Routine checks are throttled to ten minutes. This is an in-website update check, not background push delivery.

Each newly followed target establishes a baseline on its first successful check. Existing catalog records do not generate a flood of notifications. Later new or changed verified records produce local notifications. University follows include program/admission changes at that university; overlapping interests deduplicate notifications. The browser retains up to 100 notifications for 30 days. The time displayed is when the browser detected the change, not the original university announcement date. Changes that happen and revert between visits may not be observed.

## Facts versus bookkeeping

`src/lib/notifications/catalog.ts` builds observations only from public records; fresh verification is required for alerts. Admission cycles have separate observation identities but link to the parent program. `src/lib/notifications/changes.ts` excludes verification timestamps, source audit metadata, status and featured flags from fingerprints, so routine rechecking alone does not create an alert. Expiry and withdrawn data do not produce opportunity alerts. Previous verified fingerprints are retained in the browser so a renewal alone does not imply changed facts.

## Source checking

The existing ingestion Worker retains its hourly heartbeat and queues sources when each persisted next-fetch timestamp is due. `CATALOG_REFRESH_INTERVAL_HOURS=5` caps healthy official admissions, program, catalog and related source intervals at five hours. An hourly heartbeat can introduce up to an hour of scheduling delay, plus queue/fetch/verification time; this is a cadence policy, not a five-hour end-to-end freshness guarantee. Failed sources keep their backoff and blocked sources remain blocked. Existing long intervals are brought forward only when healthy and not already queued/running/retrying.

`INGESTION_MESSAGE_CONCURRENCY=2` runs independent source tasks in a bounded pool. Existing domain leases protect university hosts. Unchanged source content follows the cache/hash path without repeating model extraction. Claude Code Agent Teams are not automatically launched by this Worker.

The model audit found current local verification using MiniMax-M3 and repository cloud defaults using M2.7. Optional verifier jobs support explicit M3 adaptive thinking or M3.1 Flash effort levels. This does not automatically upgrade deployed Worker models.

The Worker cadence changes require a separate Worker deployment to affect production. Website notifications inspect the catalog that is already published; they do not fetch or publish university data themselves.