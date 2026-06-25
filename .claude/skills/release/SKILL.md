---
name: release
description: Cut a new release of the tedi CLI — run all checks, bump the version, create the git tag, and hand off the push that triggers publishing. Use when the user wants to publish a new version of tedi.
user_invocable: true
---

# release

Cut a new release of `tedi`. Releases are **tag-driven**: bumping the version
creates a git tag, and pushing that tag triggers `.github/workflows/release.yml`,
which publishes to npm (with provenance, via OIDC) and creates the GitHub Release.

## Hard rules

- **Never `git push` and never `npm publish` yourself.** Pushing the tag (which
  triggers the publish) is the user's action. Prepare everything locally, then
  stop and hand the push to the user.
- If anything in the checks fails, **stop** — do not bump the version on a red tree.

## Steps

### 1. Preconditions
- Confirm a clean working tree: `git status --porcelain` (must be empty — commit or
  stash first).
- Confirm the branch and that it's in sync: `git rev-parse --abbrev-ref HEAD` and
  `git status -sb`. Normally release from `main`. If there are unpushed commits,
  note that they'll go up with the tag push.
- If the package has **never been published** (this is the very first release),
  stop and point the user to `/publish-setup` first — the first publish needs
  one-time setup that can't be done by pushing a tag.

### 2. Run the checks
Run `/release-check` (type-check, tests, licensed-data guard, tarball integrity).
Do not proceed unless it passes. Summarize the result.

### 3. Choose the version bump
Ask the user which part to bump, explaining [semver](https://semver.org) briefly:
- **patch** (0.0.x) — bug fixes, no behavior change
- **minor** (0.x.0) — new backwards-compatible features (e.g. a new command)
- **major** (x.0.0) — breaking changes

While pre-1.0 (version starts with `0.`), note that `minor` is the usual choice
for features and `patch` for fixes; breaking changes can still go in a `minor`.

### 4. Bump and tag (local only)
Run: `npm version <patch|minor|major>`

This updates `package.json`, makes a commit, and creates a tag like `v0.1.0`
(matching the workflow's `v*` trigger). Show the user the new version and the tag
name (`git describe --tags --abbrev=0`).

### 5. Hand off the push
Tell the user to push the commit and tag — **they run this**, you do not:

```
git push --follow-tags
```

Mention they can run it directly in the session with the `!` prefix:
`!git push --follow-tags`

Explain what happens next: pushing the `v*` tag starts the Release workflow, which
runs the checks again, publishes `@tediware/tedi` to npm with provenance, and
creates the GitHub Release whose notes power `tedi update`'s changelog.

### 6. (Optional) Watch the release
After the user has pushed, offer to watch the workflow:
- `gh run list --workflow=release.yml --limit 3`
- `gh run watch` (watches the latest run)

### 7. Verify
Once the run is green, suggest `/release-status` to confirm the version is live on
npm, the tag exists, and the GitHub Release was created.

## If something goes wrong

- **`npm version` fails on a dirty tree** → commit/stash first (step 1).
- **Pushed a bad tag** → the user can delete it locally and remotely
  (`git tag -d vX.Y.Z` and `git push origin :refs/tags/vX.Y.Z`), fix, and re-tag.
  Don't do the remote deletion yourself; guide the user.
- **The workflow fails at publish** → most often the one-time npm trusted-publisher
  setup is missing or this is the first-ever publish; see `/publish-setup`.
