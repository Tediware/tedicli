---
name: release-check
description: Read-only preflight that checks whether the tedi CLI is ready to publish — runs the type-check, tests, the licensed-data guard, and inspects the npm tarball. Changes nothing. Use before cutting a release, or any time you want to confirm the package is publishable.
user_invocable: true
---

# release-check

Confirm the `tedi` package is in a publishable state. **This changes nothing** —
it only runs checks and reports. Safe to run any time.

## What to do

Run each step from the repo root and report the result in plain language. If a
step fails, stop and explain what failed and the likely fix; do not pretend it
passed.

1. **Type-check** — `npm run lint`
2. **Tests** — `npm test` (this also rebuilds `dist/`)
3. **Licensed-data guard** — `npm run check:licensed-data`
   (fails if anything resembling licensed X12 data was committed)
4. **Tarball integrity** — `node scripts/release-preflight.mjs`
   This builds the package and inspects the exact files `npm publish` would ship.
   It confirms the compiled `dist/` (including `dist/commands/*.js`) is present and
   that no source or build-cache files leak. It also reports whether the current
   version is already on npm.

## Reporting

Summarize as a short checklist, e.g.:

```
✓ type-check
✓ tests (51 passing)
✓ licensed-data guard
✓ tarball integrity (82 files; dist included)
ℹ @tediware/tedi@0.0.0 is not yet on npm
```

Then state the bottom line: **ready to release** or **not ready** (with the reason).

If the preflight notes that the current version is *already published*, point out
that a release will bump the version first (via `/release`), so that's expected.

## Notes

- This is the same set of checks `/release` runs before bumping the version.
- It makes no git changes, no commits, no publish. Read-only.
