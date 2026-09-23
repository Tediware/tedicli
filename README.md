# tedi

The official command-line client for the [Tediware](https://tediware.com) platform.

`tedi` is a thin client over the Tediware API: platform logic and licensed
data stay on the server, not in the CLI. It includes:

**X12 reference lookup**: access transactions, segments and elements from multiple X12
releases.
**Tools for your own EDI files**: scrubbing personal data out of an interchange on your
machine and inspecting one against the standard.
**Tediware data plane access**: read your partners, EDI transactions, results,
traces, logs and artifacts. Send JSON for delivery as EDI, receive EDI as JSON, and more.
**An MCP bridge**: `tedi mcp serve` connects a stdio MCP client to the platform's
MCP server.

It is built to grow into a control-plane companion for the platform. The
interface is the same whether a person or a CI job is driving it:
non-interactive auth, a three-way exit-code contract, `--json` on your own data,
and clean output when nothing is watching. [AGENTS.md](./AGENTS.md) collects
those properties in one place.

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

All commands that talk to the Tediware platform require an API key, with two
exceptions: local `edi` file operations need no server at all, and
`tedi x12 releases` is served anonymously (the CLI still sends a key when it
has one, so the call counts against your own allowance rather than a shared
per-IP one). Create a key in the Tediware dashboard
(sign up and accept the service terms there first, then head to https://tediware.com/app/api-keys), then provide it to the CLI.
The key is never passed as a command-line flag, so it can't leak into shell
history or process listings.

```bash
tedi auth login            # prompts for the key with no echo, stores it, confirms it with the server
tedi auth login < key.txt  # or pipe it in (CI, agents, anything non-interactive)
export TEDI_API_KEY=...    # or set it in the environment (one-off, CI, an agent's env; no login needed)

tedi auth status           # the credential in use: signed in or not, stored or from the environment, label
tedi whoami                # the identity behind it: organization, key scope, terms state
tedi auth logout           # clear stored credentials
```

`auth status` exits 2 when you are not signed in, so a script can gate on it.

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
tedi x12 releases        # list the releases this server carries (no key needed)
```

`tedi x12 releases` marks the release your lookups default to and warns when
that release is not one the server carries. It is the only `x12` command that
also takes `--json`: a list of release codes is version metadata, not
dictionary content.

Every `x12` command accepts:

- `--release / -r <id>`: the X12 release to look up (e.g. `004010`, `005010`).
  Defaults to the `x12.release` config value, or `004010` if unset.
- `--format console | markdown`: output format (default `console`). The licensed
  X12 standard is presentation-only: `--json` is intentionally **not** offered for
  reference data and returns an explanatory message. Structured `--json` is for
  your own org data in future control- and data-plane commands.

Colored `console` output is requested only when stdout is an interactive terminal
and color hasn't been disabled (`--no-color` / `NO_COLOR`). `markdown` is never
colored, so piped and redirected output stays clean.

`tedi x12 ele` additionally accepts:

- `--all`: show every code, instead of the truncated console preview.
- `--limit <n>`: show at most `n` codes. Console format only; `markdown` always
  shows every code.

```bash
tedi x12 ele 673 --all        # the whole code list, not the first 20
tedi x12 ele 673 --limit 50   # a longer preview
tedi x12 ele 673 | grep -i rejected   # piped output is complete, so this searches the whole code list
```

Truncation is an interactive affordance (the footer asks you to run a second
lookup), so it applies only when stdout is a terminal. Piped or redirected output
gets the complete list by default, for the same reason it gets no color. Pass
`--limit` if you want the short list on the other end of a pipe anyway.

## EDI files

Commands for your own EDI files. Locality is a per-command property, stated in
each command's help: `edi obfuscate` runs entirely on your machine and needs no
API key, while `edi inspect` sends the document to the platform.

A real EDI file is a personal-data problem the moment it leaves the machine,
whether that is to a colleague, a support ticket, a partner, or a coding agent's
context. `edi obfuscate` is the step before any of those: local, no key, and
format-preserving, so the scrubbed file still parses and still reproduces the
problem you are chasing.

```bash
tedi edi obfuscate <file>              # obfuscated EDI to stdout
tedi edi obfuscate claims.edi -o clean.edi   # write to a file instead
tedi edi obfuscate claims.edi --seed s       # reproducible replacements
tedi edi obfuscate order.edi --scrub-parties # drop-ship order: the ship-to is a consumer
cat claims.edi | tedi edi obfuscate          # stdin, with or without a '-'
```

`edi obfuscate` replaces personal data in an X12 interchange with
format-preserving fakes: person names and the addresses under them (first three
ZIP digits kept), dates of birth (year kept), phone/fax/email, SSNs, member and
medical-record identifiers, patient account numbers, and bank routing/account
numbers. The same value always maps to the same replacement within a run, so
cross-segment references stay intact.

The defaults follow the document family. Healthcare claims and enrollment (837,
834, 835, 270/271) scrub fully, free text included, because every party is a
person. Supply-chain purchase orders, shipments and invoices (850, 856, 810)
keep business parties, their addresses and their free text, because that is what
a supplier debugging a ship-to needs. `--scrub-parties` treats every N1 ship-to
and bill-to as a person (drop-ship orders), and `--scrub-text` scrubs MSG, MTX,
NTE and K3 on any document.

Everything structural survives byte-for-byte: delimiters, qualifiers, code
values, dates of service, monetary amounts, control numbers, segment counts, and
element lengths (including the fixed-width ISA header), so an obfuscated file
parses exactly like the original. Files are read as UTF-8 when they are valid UTF-8
and as Latin-1 otherwise, and written back the same way, so either kind comes
back byte-identical where nothing was scrubbed.
Business identifiers (sender/receiver routing IDs, organization names, NPIs, tax
IDs) are kept so the file stays debuggable.

Faults in a value survive too: each replacement is invalid in the same way the
value it replaces was. A date of birth that isn't a real date stays impossible
rather than being quietly replaced with a valid one, and a date range that ran
backwards still does, so a file you scrub before sending to a partner still
reproduces the problem you're chasing. Relationships _between_ values are not
preserved, since the values are scrubbed independently: a date of birth that
fell after the date of service may no longer.

Replacements are randomized per run and not reversible; `--seed` derives them
from the given seed instead, for reproducible output. This is a best-effort
scrub for sharing files in debugging contexts, not a certified HIPAA
de-identification: review the output before sharing, especially free-text-heavy
files.

### Inspecting an interchange

```bash
tedi edi inspect claims.edi                 # report to stdout
tedi edi inspect claims.edi --no-obfuscate  # upload the file verbatim instead
tedi edi inspect claims.edi --format markdown -o report.md
tedi edi inspect claims.edi --fail-on notice  # count notices toward exit 1 too
cat claims.edi | tedi edi inspect           # stdin, with or without a '-'
```

`edi inspect` annotates the interchange, runs framing and envelope checks, and
validates it against the X12 standard; findings cite the segment's position in
the report, which shows the interchange as an annotated tree.

**This command uploads your file**, and requires an API key, because neither the
parser nor the licensed reference data it validates against ships in the CLI. It
therefore runs the local scrub described above **by default**, with the same
family defaults and the same `--scrub-parties` and `--scrub-text` flags:
forgetting a flag should never be what puts personal data on the wire. The scrub
is format-preserving, so the report still describes your original file's
structure exactly; `--seed` applies to it.

What that costs you: findings that quote a personal value quote the replacement
rather than what's in your file. Business identifiers, code values, amounts, and
control numbers are kept as-is, so most quoted values still match.

`--no-obfuscate` uploads the file verbatim. Reach for it when a finding you
expect is missing, or when the scrub can't read the envelope well enough to run
at all: a mangled ISA fails locally with exit 1, and the server may still be able
to diagnose it.

Reports are `--format console` (default) or `--format markdown`; as with X12
reference, `--json` is not offered.

Exit codes follow the CLI-wide contract in [Exit codes](#exit-codes): `1` is a
finding (including "this is not an X12 interchange"), `2` is a run that cannot
be trusted. A one-line count with the exit reason goes to stderr on every run.

## Exit codes

Every command uses the same three-way split, so a CI gate or an agent can tell
"the document is bad" from "the run never happened". Only `1` is a verdict about
your input. `2` means nothing was learned, and must never be treated as a pass.

| Exit | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | The command ran to completion and found nothing to report.               |
| `1`  | A real answer that is a finding: errors in a document, a code that does not exist. |
| `2`  | The command did not run, or its result cannot be trusted. Nothing was learned. |

Exit `2` covers the ordinary tool failures: a mistyped flag, no key, rate
limited, network gone, a server fault, a server too old to know an endpoint, and
anything the CLI did not anticipate (printed as one line, no stack trace). A
data-plane `404` counts as "not found" (exit `1`) only when the server says so
in the body; a `404` without the platform's JSON shape is "no such endpoint,
check `api.baseUrl`" and exits `2`, so a wrong base URL can never tell a job
that an existing record is missing.

Under `--json`, an error is JSON too, on stdout, in one shape whatever the
cause, so a script parses one thing for both outcomes:

```json
{"error": {"message": "No transaction 'nope' in your organization.", "code": "not_found", "suggestions": ["..."], "exitCode": 1}}
```

`edi inspect` adds two cases where a clean-looking report is not evidence of
anything: when the server says a check did not run (the inspection is
fail-soft, so a crashed check takes its findings with it), and when it reports
no finding counts at all. Both exit `2` and warn on stderr rather than passing
quietly. Findings still outrank an incomplete run: a crashed check loses
findings, it never invents them, so anything that did surface exits `1` with
the incompleteness noted as a caveat. `--fail-on notice` counts notices toward
`1` as well; the default, `--fail-on error`, exits `1` only for errors. Either
way the report prints, and a one-line count goes to stderr so a redirected
report still says why the build failed.

```bash
tedi edi inspect claims.edi > report.txt
case $? in
  0) echo "clean" ;;
  1) echo "the interchange has problems"; cat report.txt ;;
  *) echo "inspection did not run: do not treat this as a pass" ;;
esac
```

## Your data

The data-plane commands read and drive your own organization's traffic. They
need a standard API key and they all support `--json` for scripting.

```bash
tedi partner list                    # your partners: keys, connections, the sets each takes
tedi partner get ACME                # one partner: connection, envelopes, webhooks, sets with readiness, flows

tedi partner send ACME 850 order.json       # your JSON in, EDI out to the partner
tedi partner send ACME 856 ship.json --wait # ...and wait for the trace to finish (exit 1 on error)
cat order.json | tedi partner send ACME 850 # the file argument reads stdin when omitted
tedi partner receive ACME 850.edi           # raw partner EDI into the inbound flow

tedi trace <guid>                    # everything on a trace: transactions, results, feed, artifacts, logs

tedi transaction list --direction outbound --ack unacknowledged
tedi transaction list --warnings     # only documents whose run raised a warning
tedi transaction get <id>            # envelope, outcome, acknowledgment, warnings, its own artifacts
tedi transaction get --trace <guid>  # the same, found by the trace a receipt handed back
tedi transaction logs <id>           # the trace's processing logs
tedi transaction resend <id>         # re-deliver an outbound document

tedi result list --status error
tedi result get <id>

tedi feed list                       # delivered documents and errors, last 24 hours
tedi feed list --since 3d --status error --partner ACME
tedi feed list --follow              # tail it live (JSONL with --json)

tedi artifact get <id> -o file.edi   # download stored document bytes
```

The rest of your configuration reads the same way, by id. Every `list` has
`--json`, and every `{id, name}` reference in one command's output is an id the
next command takes:

```bash
tedi connection list                 # SFTP, AS2 and sandbox connections; get <id> adds the partners on it
tedi envelope list                   # ISA and GS identifiers; get <id> adds who uses it, as internal or external
tedi webhook list                    # URLs and kinds; get <id> adds who delivers to it, in which role
tedi flow list --partner ACME --status active
tedi flow get <id>                   # nodes and edges, no node configuration

tedi mapping list --direction outbound
tedi mapping get <id>                # what it targets and reads from, and the transformation
tedi mapping get <id> -o map.jsonata # the transformation alone, to edit and diff
tedi mapping versions <id>           # every version; mapping get --version <n> reads one

tedi implementation list --set 850   # your own implementations (public ones are imported in the app)
tedi implementation schema <id>      # the JSON shape a mapping targets
tedi implementation guide <id> --format markdown -o acme-850.md
tedi implementation export <id> -o acme-850.json   # one portable JSON document, for version control or a diff

tedi source list              # the shapes you send, and the mappings reading each
```

Every receipt (`partner send`, `partner receive`, `transaction resend`) ends
with the `tedi trace <guid>` line to follow it with. Direction is always
`inbound` (received from a partner) or `outbound` (sent to one); `--set` names a
transaction set; `--since` takes an ISO 8601 timestamp with a zone, a bare date,
or a relative form such as `2h`. Timestamps print as `YYYY-MM-DD HH:MM:SSZ`.
`--json` prints the server's response unchanged.

Warnings are non-fatal notes a run raised, and they are their own axis: they
never change a document's status, so one that was delivered still reads
`delivered`. `transaction list` and `result list` show the count beside STATUS
when there is one; `transaction get` and `result get` print each as its stable
code and the prose behind it, and on a transaction each names the result that
raised it. `--warnings` and `--no-warnings` on `transaction list` filter on
having any. `--json` carries `warningCount` and the `warnings` array
(`detail.warnings` on a result), so a script can branch on the code rather than
on the prose.

The feed is a forward-only stream, so it reads oldest first and a bare
`feed list` shows the last 24 hours with a footer saying so. `--since` or
`--cursor` chooses a different window; `--follow` picks up where the page ended
and polls every 5 seconds. Logs read oldest first for the same reason.
Transaction and result lists read newest first.

## Connect your agent

Tediware hosts a [Model Context Protocol](https://modelcontextprotocol.io) server
at `https://tediware.com/mcp`. Its tools cover the same ground as this CLI, under
the same key, rate limits and service terms: interchange inspection, and
reading and driving your own EDI traffic.

`tedi mcp serve` bridges that server to stdio for agents that launch MCP servers
as subprocesses, using the key from `tedi auth login` so it never has to be
pasted into the agent's configuration:

```bash
claude mcp add tediware -- tedi mcp serve     # Claude Code
codex mcp add tediware -- tedi mcp serve      # Codex
```

For clients configured by file (Cursor, Windsurf, Claude Desktop and most
others), the entry is the same command:

```json
{
  "mcpServers": {
    "tediware": { "command": "tedi", "args": ["mcp", "serve"] }
  }
}
```

The bridge forwards every request to the platform and holds no tool logic of its
own. It answers the `initialize` handshake current hosts still open with, so they
connect to the platform's newer protocol without knowing it. It needs a standard API key; run `tedi auth login` first, or set
`TEDI_API_KEY` in the agent's environment. A client that speaks Streamable HTTP
directly can skip the CLI and connect to `https://tediware.com/mcp` with an
`Authorization: Key <api_key>` header.

The data tools return structured content, as `--json` does here. Two of the
tools (`edi_inspect`,
`partner_receive`) send a document to the server; run `tedi edi obfuscate` on it
first if it carries anything that should stay on your machine.

## Configuration

```bash
tedi config list                       # the config directory, every value, and where each comes from
tedi config get x12.release
tedi config set x12.release 005010
tedi config set api.baseUrl http://localhost:5004   # scheme and host only; no path
tedi config unset api.baseUrl
```

| Key           | Env override        | Default                |
| ------------- | ------------------- | ---------------------- |
| `x12.release` | `TEDI_X12_RELEASE`  | `004010`               |
| `api.baseUrl` | `TEDI_API_BASE_URL` | `https://tediware.com` |

Profiles keep several servers' config and credentials apart:
`--profile <name>` on any command reads and writes `~/.tedi-profiles/<name>`
(under `$XDG_CONFIG_HOME` when that is set). `TEDI_CONFIG_DIR` relocates the
default directory outright.

Environment variables, in one place:

| Variable                       | Effect                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `TEDI_API_KEY`                 | The API key; overrides a stored one at request time.       |
| `TEDI_API_BASE_URL`            | Overrides `api.baseUrl`.                                   |
| `TEDI_X12_RELEASE`             | Overrides `x12.release`.                                   |
| `TEDI_CONFIG_DIR`              | Where config and credentials live.                         |
| `TEDI_SKIP_NEW_VERSION_CHECK`  | `1` turns off the daily new-version notice.                |
| `TEDI_API_MOCK`                | `1` uses the synthetic development backend (see below).    |
| `NO_COLOR`                     | Disables color, like `--no-color`; `--color` forces it on. |

## Updating

```bash
tedi update              # upgrade to the latest published version
tedi update 0.4.1        # install a specific version
```

`tedi update` reinstalls the CLI from npm (`npm install -g @tediware/tedi@latest`)
and then prints the new version's changelog. It refuses when the copy running is
not the one npm would replace (a checkout on PATH, a wrapper, a different Node's
global prefix), and says what it found. The CLI also checks npm once a day and
prints a one-line notice on a terminal when a newer version is available
(never under `--json`, never inside `mcp serve`); `TEDI_SKIP_NEW_VERSION_CHECK=1`
turns that off.

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

By default the CLI talks to the real Tediware API: `api.baseUrl` defaults to the
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

`tedi` is proprietary software and does not accept outside contributions. Bug
reports and feature requests are welcome as issues. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

**One hard rule: never commit licensed X12 data** (including test fixtures and
recorded responses). A CI tripwire guards against it.

## License

Proprietary; see [LICENSE](./LICENSE). The packages published to npm before
September 23, 2026 (0.4.0 and earlier) were released under Apache-2.0, and those
packages remain under that license.
