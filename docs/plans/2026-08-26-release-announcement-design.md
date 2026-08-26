# Release announcement design

## Product intent

After a meaningful catalogue release, visitors should immediately understand what changed without being interrupted on every visit. The announcement therefore appears once per version, explains both data changes and applicant-facing features, and links directly to the updated programme catalogue and permanent changelog.

## Architecture

The server layout derives public institution, programme and scholarship counts from the same publication gate used by the catalogue. A versioned, localized announcement manifest supplies editorial copy. A small client component combines those inputs, remembers the dismissed announcement ID in local storage and owns accessible dialog behaviour. The updates page reads the same manifest, preventing the popup and changelog from drifting apart.

## Interaction and visual direction

The interface is an editorial release folio: warm paper, deep ink, vermilion seal and jade data accents. It opens after hydration only when the current announcement ID has not been dismissed. Escape, the close control, backdrop click and both calls to action dismiss it. Focus is trapped while open and returned afterward; reduced-motion, forced-colour and narrow-screen modes remain usable.

## Data and privacy boundaries

Only a release-announcement ID is stored locally. No account, identifier or server-side tracking is created. Catalogue totals are computed at render time rather than duplicated in copy. Unknown admissions facts remain unknown; the announcement describes coverage and product capabilities but never implies that every programme is open or complete.

## Verification

Component tests cover first display, persistence, reappearance for a new version, localized links, Escape dismissal and focus containment. Type checking, lint, focused unit tests and a production build guard the integration.
