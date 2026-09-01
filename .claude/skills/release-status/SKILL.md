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
2. **Provenance** — ask the registry about this exact version:

   ```
   curl -s "https://registry.npmjs.org/-/npm/v1/attestations/@tediware/tedi@VERSION" \
     | python3 -c "import json,sys; d=json.load(sys.stdin); a=d.get('attestations',[]); print(len(a),'attestations'); [print(' ',x.get('predicateType')) for x in a]"
   ```

   Pipe it through that filter — the raw response is ~15 KB of Sigstore bundles
   and certificates, and dumping it whole buries the answer.

   A published-with-provenance version prints two entries:
   `.../npm/attestation/.../publish/v0.1` and `https://slsa.dev/provenance/v1`.
   No attestation prints `0 attestations` — the registry answers `404
   {"error":"Not found"}`, which is still valid JSON, so the filter reports an
   empty list rather than erroring. That usually means the publish didn't run
   through the trusted-publishing workflow — see `/publish-setup`.

   **A `404` is ambiguous on its own:** a version that doesn't exist returns the
   same thing. Only read it as "no provenance" once step 1 has confirmed that
   version is actually live on npm.

   **Do not use `npm audit signatures` for this.** It audits the *installed
   dependency tree* in `node_modules`, so its counts ("N packages have verified
   attestations") describe this project's dependencies and say nothing about
   `@tediware/tedi`, which is not a dependency of itself. It will happily print a
   reassuring summary for a release that published with no provenance at all.
   `npm view --json` does not expose provenance either. The provenance badge on
   `https://www.npmjs.com/package/@tediware/tedi` is a valid manual cross-check.
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
✓ provenance: 2 attestations (npm publish + SLSA provenance v1)
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
