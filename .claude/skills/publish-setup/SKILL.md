---
name: publish-setup
description: One-time setup to make the tedi CLI publishable to npm — GitHub remote, npm account/org, the OIDC trusted publisher on npmjs.com, and the first manual publish. Use before the very first release, or when releases fail because publishing was never set up.
user_invocable: true
---

# publish-setup

A guided, **one-time** checklist to get `@tediware/tedi` publishing to npm. After
this is done once, every future release is just `/release` (push a tag; CI does the
rest). Work through the steps with the user, checking current state where you can.

Publishing uses **npm trusted publishing (OIDC)** — there is no `NPM_TOKEN` secret
to manage. But the *first ever* publish of a new package name usually can't be done
by OIDC, so it's done manually once to bootstrap.

## Hard rule

You (the assistant) must **not** run `npm publish` or `git push` yourself — those
are the user's actions. Check state, explain, and give exact commands for the user
to run (they can use the `!` prefix to run them in the session).

## Steps

### 1. GitHub repository + remote
- Check: `git remote -v`. If there's no `origin`, the user needs to create the repo
  `github.com/tediware/tedicli` (public) and add it:
  `git remote add origin https://github.com/tediware/tedicli.git`
- Confirm the `repository.url` in `package.json` matches the real repo — this is
  required for npm provenance.
- The user pushes `main` once: `git push -u origin main`.

### 2. npm account and the @tediware org
- The user needs an npmjs.com account and the **@tediware** scope/org (create it at
  npmjs.com → "Add Organization", free for public packages).
- Locally, the user logs in once: `npm login` (this is for the manual bootstrap
  publish only; CI won't use it).

### 3. Bootstrap the first publish (manual, once)
OIDC trusted publishing generally cannot create a brand-new package name, so do the
first publish by hand. The user runs (from the repo root):

```
npm publish --access public
```

`prepack` builds and generates the manifest automatically; `publishConfig` in
`package.json` sets `access: public`. Before they run it, suggest `/release-check`
so the tarball is verified first.

> Note: do **not** add `--provenance` to this manual publish — provenance can only
> be generated from CI, so it would fail locally. The automated release workflow
> adds provenance itself; the manual bootstrap publish intentionally goes without it.

> Note: if the package version is still `0.0.0`, suggest bumping to a real first
> version with `/release` (or `npm version` then publish) so `0.0.0` isn't the
> published baseline. Either order works; just don't publish a version you don't
> want as the public history.

### 4. Configure the OIDC trusted publisher (enables automated releases)
This is what lets the GitHub Actions workflow publish without a token. The user does
this on the web, once the package exists:

- npmjs.com → the **@tediware/tedi** package → **Settings** → **Trusted Publisher**
- Add a GitHub Actions publisher with:
  - Organization/owner: `tediware`
  - Repository: `tedicli`
  - Workflow filename: `release.yml`
  - (Leave environment blank — the workflow doesn't use one.)

### 5. Done — verify
- From now on, releasing is just `/release` (bump + push a `v*` tag; the workflow
  publishes via OIDC and creates the GitHub Release).
- Run `/release-status` after the first automated release to confirm everything
  landed (npm version live, tag present, GitHub Release created).

## Quick state check you can run now

```
git remote -v                 # is there an origin?
npm whoami                    # is the user logged in to npm?
npm view @tediware/tedi version   # does the package exist on npm yet?
```

Use these to tell the user which of the steps above are already done and which
remain.
