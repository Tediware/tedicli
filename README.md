# tedi

The official command-line client for the [Tediware](https://tediware.com) platform.

`tedi` is a thin client over the Tediware API — no proprietary logic and no
licensed data live in the CLI. It covers **X12 reference lookup** and **your own
EDI files**: scrubbing personal data out of an interchange on your machine, and
inspecting one against the standard. It is built to grow into a control-plane
companion for the platform.

## Install

```bash
npm install -g @tediware/tedi
```

## Quick start

```bash
tedi auth login            # paste your API key (entered without echo)
tedi x12 seg N1            # look up an X12 segment
tedi x12 txn 856           # look up a transaction set
tedi x12 ele 235           # look up an element and its code list
tedi edi obfuscate f.edi   # scrub personal data from an EDI file (local, no server)
tedi edi inspect f.edi     # check an interchange against the X12 standard
```

## Authentication

All commands that talk to the Tediware platform require an API key; local `edi`
file operations run without one. Create a key in the Tediware dashboard
(sign up and accept the service terms there first, then head to https://tediware.com/app/api-keys), then provide it to the CLI.
The key is never passed as a command-line flag, so it can't leak into shell
history or process listings.

```bash
tedi auth login            # prompts for the key with no echo, then stores it
cat key.txt | tedi auth login   # or pipe it in (CI/non-interactive)
export TEDI_API_KEY=...    # or set it in the environment (one-off / CI; no login needed)

tedi auth status           # show whether you're signed in
tedi whoami                # show the authenticated identity (when available)
tedi auth logout           # clear stored credentials
```

`TEDI_API_KEY` overrides any stored key at request time. Stored credentials live
in a permissioned file in the CLI config directory today; OS-keychain storage is a
planned drop-in. Reference lookup and inspection additionally require that your
account has accepted the current Tediware service terms; the server enforces this
on every request.

> A browser device-flow login is the eventual destination but is deferred; it will
> slot in under the same stored-key model without changing how you use the CLI.

## X12 reference

```bash
tedi x12 seg <id>        # e.g. tedi x12 seg N1   (alias: segment; case-insensitive)
tedi x12 txn <id>        # e.g. tedi x12 txn 856  (alias: transaction; case-insensitive, SH856 also accepted)
tedi x12 ele <id>        # e.g. tedi x12 ele 66   (alias: element; case-insensitive)
tedi x12 releases        # list supported X12 releases
```

Every `x12` command accepts:

- `--release / -r <id>` — the X12 release to look up (e.g. `004010`, `005010`).
  Defaults to the `x12.release` config value, or `004010` if unset.
- `--format console | markdown` — output format (default `console`). The licensed
  X12 standard is presentation-only: `--json` is intentionally **not** offered for
  reference data and returns an explanatory message. Structured `--json` is for
  your own org data in future control- and data-plane commands.

Colored `console` output is requested only when stdout is an interactive terminal
and color hasn't been disabled (`--no-color` / `NO_COLOR`). `markdown` is never
colored, so piped and redirected output stays clean.

## EDI files

Commands for your own EDI files. Locality is a per-command property, stated in
each command's help: `edi obfuscate` runs entirely on your machine and needs no
API key, while `edi inspect` sends the document to the platform.

```bash
tedi edi obfuscate <file>              # obfuscated EDI to stdout ('-' reads stdin)
tedi edi obfuscate claims.edi -o clean.edi   # write to a file instead
tedi edi obfuscate claims.edi --seed s       # reproducible replacements
```

`edi obfuscate` replaces personal data in an X12 interchange with
format-preserving fakes: person names, street addresses, city/ZIP (first three
ZIP digits kept), dates of birth (year kept), phone/fax/email, SSNs, member and
medical-record identifiers, patient account numbers, bank routing/account
numbers, and free-text notes. The same value always maps to the same replacement
within a run, so cross-segment references stay intact.

Everything structural survives byte-for-byte: delimiters, qualifiers, code
values, dates of service, monetary amounts, control numbers, segment counts, and
element lengths (including the fixed-width ISA header) — an obfuscated file
parses exactly like the original. Business identifiers (sender/receiver routing
IDs, organization names, NPIs, tax IDs) are kept so the file stays debuggable.

Faults in a value survive too: each replacement is invalid in the same way the
value it replaces was. A date of birth that isn't a real date stays impossible
rather than being quietly replaced with a valid one, and a date range that ran
backwards still does — so a file you scrub before sending to a partner still
reproduces the problem you're chasing. Relationships *between* values are not
preserved, since the values are scrubbed independently: a date of birth that
fell after the date of service may no longer.

Replacements are randomized per run and not reversible; `--seed` derives them
from the given seed instead, for reproducible output. This is a best-effort
scrub for sharing files in debugging contexts, not a certified HIPAA
de-identification: review the output before sharing, especially free-text-heavy
files.

### Inspecting an interchange

```bash
tedi edi inspect claims.edi                 # report to stdout ('-' reads stdin)
tedi edi inspect claims.edi --no-obfuscate  # upload the file verbatim instead
tedi edi inspect claims.edi --format markdown > report.md
tedi edi inspect claims.edi --fail-on notice  # count notices toward exit 1 too
```

`edi inspect` annotates the interchange, runs framing and envelope checks, and
validates it against the X12 standard; findings anchor to the line numbers of the
report, which reprints the file one segment per line.

**This command uploads your file**, and requires an API key, because neither the
parser nor the licensed reference data it validates against ships in the CLI. It
therefore runs the local scrub described above **by default** — forgetting a flag
should never be what puts personal data on the wire. The scrub is
format-preserving, so the report still describes your original file's structure
exactly; `--seed` applies to it.

What that costs you: findings that quote a personal value quote the replacement
rather than what's in your file. Business identifiers, code values, amounts, and
control numbers are kept as-is, so most quoted values still match.

`--no-obfuscate` uploads the file verbatim. Reach for it when a finding you
expect is missing, or when the scrub can't read the envelope well enough to run
at all — a mangled ISA fails locally, and the server may still be able to
diagnose it.

Reports are `--format console` (default) or `--format markdown`; as with X12
reference, `--json` is not offered.

#### Exit codes

Built for CI: the exit code distinguishes a bad document from a run that never
happened, so a gate can tell "this file is broken" from "the key expired".

| Exit | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | The inspection ran, every check completed, and it found nothing.             |
| `1`  | It found errors — or the server could not read the file as EDI at all.       |
| `2`  | It did not run, or its result cannot be trusted. Nothing was learned.        |

`--fail-on notice` counts notices toward `1` as well; the default, `--fail-on
error`, exits `1` only for errors. Either way the report prints, and a one-line
count goes to stderr so a redirected report still tells you why the build failed.

Exit `2` covers the ordinary tool failures — no key, rate limited, network gone,
a release the platform has no reference data for, a fault on the server — and two
cases where a clean-looking report is not evidence of anything: when the server
says a check did not run (the inspection is fail-soft, so a crashed check takes
its findings with it), and when it reports no finding counts at all. Both warn
loudly on stderr rather than passing quietly.

Findings still outrank an incomplete run: a crashed check loses findings, it
never invents them, so anything that did surface exits `1` with the incompleteness
noted as a caveat.

```bash
tedi edi inspect claims.edi > report.txt
case $? in
  0) echo "clean" ;;
  1) echo "the interchange has problems"; cat report.txt ;;
  *) echo "inspection did not run — do not treat this as a pass" ;;
esac
```

The same split runs through the rest of the CLI: a lookup for a code that doesn't
exist exits `1`, since that is a real answer, while anything that stopped a
command from running — a mistyped flag, no key, an unreachable server — exits `2`.

## Configuration

```bash
tedi config list                       # show all config values and their sources
tedi config get x12.release
tedi config set x12.release 005010
```

| Key           | Env override        | Default                |
| ------------- | ------------------- | ---------------------- |
| `x12.release` | `TEDI_X12_RELEASE`  | `004010`               |
| `api.baseUrl` | `TEDI_API_BASE_URL` | `https://tediware.com` |

The config directory can be relocated with `TEDI_CONFIG_DIR`.

## Updating

```bash
tedi update              # upgrade to the latest published version
tedi update --version X  # install a specific version
```

`tedi update` reinstalls the CLI from npm (`npm install -g @tediware/tedi@latest`)
and then prints the new version's changelog. The CLI also checks for updates in
the background (throttled, cached) and shows a non-interrupting nudge when a newer
version is available; you can always upgrade manually with `npm install -g @tediware/tedi`.

## Development

This is a [oclif](https://oclif.io) (TypeScript, ESM) project.

```bash
npm install
npm run build          # compile to dist/
./bin/run.js --help    # run the built CLI
./bin/dev.js --help    # run straight from TypeScript source
npm run lint           # type-check
npm test               # run tests
npm run check:licensed-data   # licensed-data tripwire (also runs in CI)
```

By default the CLI talks to the real Tediware API — `api.baseUrl` defaults to the
production host (`https://tediware.com`), so you just need a key (the HTTP contract
is documented in [`API.md`](API.md)):

```bash
export TEDI_API_KEY=<api-key>     # or `tedi auth login`
tedi x12 releases
```

For local development without a live server or a real key, opt into a synthetic
mock backend with `TEDI_API_MOCK=1` (any non-empty key works as a token there):

```bash
export TEDI_API_MOCK=1
export TEDI_API_KEY=sk-dev-anything
tedi x12 releases
```

> **Note:** the mock backend's reference content is synthetic placeholder data for
> development only. It is not licensed X12 reference content.

## Releasing

Releases are tag-driven. Bump the version and push the tag:

```bash
npm version <patch|minor|major>
git push --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds, tests,
publishes to npm with provenance via OIDC trusted publishing (no stored token),
and creates the GitHub Release whose notes power `tedi update`'s changelog. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the one-time npm trusted-publisher setup.

## Contributing

Contributions are welcome under the [DCO](https://developercertificate.org/) —
sign commits with `git commit -s`. See [CONTRIBUTING.md](./CONTRIBUTING.md).

**One hard rule: never commit licensed X12 data** (including test fixtures and
recorded responses). A CI tripwire guards against it.

## License

[Apache-2.0](./LICENSE).
