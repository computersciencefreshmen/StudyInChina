# Release Announcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a polished, accessible, localized “what changed” dialog once for the current StudyInChina release.

**Architecture:** The locale layout computes publication-gated counts and passes them to a client dialog. Localized editorial copy lives in one versioned manifest shared with the updates page, while localStorage records only the dismissed announcement ID.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, Testing Library, Vitest.

---

### Task 1: Specify release behaviour with tests

**Files:**
- Create: `tests/unit/release-announcement.test.tsx`

1. Test first display, semantic dialog labelling and localized calls to action.
2. Test dismissal persistence and suppression for the same announcement ID.
3. Test reappearance when the announcement ID changes.
4. Test Escape dismissal, body-scroll restoration and focus containment.
5. Run `npm test -- tests/unit/release-announcement.test.tsx`; expect failure before implementation.

### Task 2: Add the localized release manifest

**Files:**
- Create: `src/i18n/release-announcement.ts`

1. Define a typed announcement contract and stable version ID.
2. Add reviewed English, Chinese, Russian, German, French and Spanish copy.
3. Keep all numerical catalogue totals outside editorial copy.

### Task 3: Build the accessible client dialog

**Files:**
- Create: `src/components/features/ReleaseAnnouncement.tsx`
- Create: `src/components/features/ReleaseAnnouncement.module.css`

1. Read the dismissed ID after hydration and open only for a new version.
2. Implement close, backdrop, Escape, focus trap and focus restoration.
3. Persist only the dismissed announcement ID and fail safely when storage is unavailable.
4. Render dynamic public counts and localized programme/changelog links.
5. Apply responsive editorial styling, reduced motion and forced-colour support.

### Task 4: Connect the release source of truth

**Files:**
- Modify: `src/app/[locale]/layout.tsx`
- Modify: `src/app/[locale]/updates/page.tsx`

1. Select public records with the production publication gate.
2. Pass current counts and the formatted data date to the dialog.
3. Render the same current announcement on the permanent updates page.

### Task 5: Verify and ship

**Files:**
- Modify only if required by findings: tests or accessibility styles.

1. Run the focused component test.
2. Run focused ESLint and `npm run typecheck`.
3. Run the full unit suite and production build.
4. Stage exact files, commit, push, open/merge the PR after CI, and verify the production deployment.
