---
name: release-status
description: Verify that a tedi release actually landed — checks the version is live on npm (with provenance), the git tag exists, and the GitHub Release was created. Read-only. Use after cutting a release to confirm it worked.
user_invocable: true
---

# release-status

Confirm a release actually published successfully. **Read-only** — only inspects
local git and remote registries. Report a clear pass/fail for each item.

## What to check

Let `VERSION` be the version in `package.json` (`node -p "require('./package.json').version"`)
and the tag be `vVERSION`.

1. **Published on npm** — `npm view @tediware/tedi version` and
   `npm view @tediware/tedi dist-tags`. Confirm the `latest` dist-tag equals the
   expected version. If `npm view @tediware/tedi@VERSION version` returns the
   version, that exact version is live.
2. **Provenance** — `npm audit signatures` (run in the repo, read-only) reports
   whether the installed/published package has a verified provenance attestation.
   You can also confirm via the provenance badge on the package page
   `https://www.npmjs.com/package/@tediware/tedi`. (`npm view --json` does NOT expose
   provenance, so don't rely on it.) A missing attestation usually means the publish
   didn't run through the trusted-publishing workflow.
3. **Git tag** — `git tag -l vVERSION` (and `git ls-remote --tags origin vVERSION`
   to confirm it's on the remote).
4. **GitHub Release** — `gh release view vVERSION` (needs the `gh` CLI authenticated).
   Confirm it exists and has notes (these feed `tedi update`'s changelog).
5. **Recent workflow run** — `gh run list --workflow=release.yml --limit 3` to see
   whether the Release workflow succeeded or failed.

## Reporting

Summarize as a checklist with the actual values, e.g.:

```
✓ npm: @tediware/tedi@0.1.0 is live (latest)
✓ provenance: present
✓ git tag v0.1.0 (local + remote)
✓ GitHub Release v0.1.0 exists
✓ release.yml run: success
```

If any item fails, say which and the likely cause:
- npm version missing / workflow failed → check `gh run view` for the failed step;
  often the trusted-publisher setup (`/publish-setup`) or a brand-new package name.
- Tag exists but no npm version → the workflow didn't run or failed before publish.
- No GitHub Release → the `gh release create` step failed (permissions) but npm may
  still have published; the changelog feature won't have notes to show.
