# Contributing to tedi

Thanks for your interest in improving the Tediware CLI.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. Every commit must be signed off, certifying that you wrote the
patch or otherwise have the right to submit it under the project's license.

Add a `Signed-off-by` line to each commit:

```
git commit -s -m "your message"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

CI verifies that every commit in a pull request carries this line.

## The one hard rule: no licensed X12 data, ever

**Never commit licensed X12 reference data to this repository.** This includes
test fixtures, recorded API responses, and snapshot output. Tests must use
synthetic or mocked data only.

A CI tripwire (`npm run check:licensed-data`) scans tracked files for content
that looks like real reference data and fails the build if it finds any. If you
are adding a genuinely synthetic data file that trips the heuristic, add the
marker `tedi:synthetic-data-ok` to the file. The marker bypasses the density
heuristic but never the publisher/copyright check.

Committing licensed data to a public repo is the single largest licensing risk
this project carries — larger than any code exposure. When in doubt, leave it out.

## Keeping the client thin

`tedi` is a thin client over the Tediware API. Proprietary logic and licensed
data live server-side, behind the API. Please keep new commands thin: relay to
the API rather than embedding platform logic or reference data in the client.

## Development

```bash
npm install
npm run build          # compile TypeScript to dist/
./bin/run.js --help    # run the built CLI
./bin/dev.js --help    # run straight from TypeScript source (no build step)
npm run lint           # type-check
npm test               # run tests
```

### Running `tedi` as a command locally

`npm link` symlinks the `tedi` command to this repo so you can invoke it by name:

```bash
npm link                       # create the global `tedi` symlink
tedi --help
npm rm -g @tediware/tedi       # remove the link when done
```

Two things to know:

- The linked `tedi` runs the built `dist/`, **not** live TypeScript — run
  `npm run build` after editing, or use `./bin/dev.js <args>` to run from source.
- `dist/` is gitignored and (re)built by `npm run build`, `pretest`, and `prepack`.

### Trying it out

By default the CLI talks to the real Tediware API (`api.baseUrl` defaults to the
production host `https://tediware.com`; see [`API.md`](API.md) for the contract).
Every command needs a key — provide one and try a lookup:

```bash
export TEDI_API_KEY=<your-key>     # or `tedi auth login`; never pass keys as flags
tedi x12 releases
tedi x12 seg N1
tedi x12 ele 235 --format markdown
```

For development without a live server or a real key, opt into the synthetic mock
backend with `TEDI_API_MOCK=1` (any non-empty key works as a token there):

```bash
export TEDI_API_MOCK=1
printf 'sk-dev-test\n' | tedi auth login   # or just `tedi auth login` and paste
tedi x12 releases
tedi x12 seg N1
```

Use a throwaway config dir with `TEDI_CONFIG_DIR=/tmp/tedi-scratch tedi <cmd>` to
avoid touching real state.

Maintainers running the Tediware server locally (it lives in a separate, private
repo) can point at it with `tedi config set api.baseUrl http://localhost:5004`.

## Releasing (maintainers)

Releases are tag-driven:

```bash
npm version <patch|minor|major>
git push --follow-tags
```

A `v*` tag runs `.github/workflows/release.yml`, which tests, publishes to npm
with provenance, and creates the GitHub Release.

Publishing uses **npm trusted publishing (OIDC)** — there is no `NPM_TOKEN`
secret. One-time setup, done once the package exists on npm:

1. On npmjs.com → the `@tediware/tedi` package → Settings → Trusted Publisher,
   add the GitHub repo `tediware/tedicli` and the workflow file `release.yml`.
2. **Bootstrap the first publish.** OIDC generally cannot publish a brand-new
   package name, so do the very first `npm publish --access public` once (locally
   or with a temporary automation token), then rely on the workflow thereafter.
   Don't pass `--provenance` for this manual publish — provenance is CI-only and
   would fail locally; the release workflow adds it automatically.
