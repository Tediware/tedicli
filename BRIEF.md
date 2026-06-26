# tedi CLI — Brief

## Overview

`tedi` is the official command-line client for the Tediware platform. It is a thin client over the Tediware API: no proprietary logic and no licensed data live in the CLI. Its first shipped capability is X12 reference lookup, and it is intended to grow into a control-plane companion for the platform over time.

Positioning is human-developer-first. Agent use is not part of the documented surface, but no decision should be made that actively harms agentic use. Protection of the licensed X12 corpus is contractual and server-side (account + EULA + the data staying behind the API), not a function of keeping the client closed or undocumented. That distinction drives several decisions below.

## Naming and distribution

- CLI invocation: `tedi`
- GitHub repository: `github.com/tediware/tedicli` (public)
- npm package: `@tediware/tedi` (scoped)
- Install: `npm install -g @tediware/tedi`

## License and contributions

- **License: Apache-2.0.** Chosen over MIT for its explicit patent grant and defensive-termination clause, which is the safer default for an OSS tool shipped alongside a commercial product.
- **Contributions: DCO** (a `Signed-off-by` line), not a CLA. Keeps the contribution barrier low without a separate agreement process.
- **Hard rule: no licensed X12 data in the repository, ever.** This includes test fixtures, recorded API responses, and snapshot output. Tests use synthetic or mocked data. A CI check guards against committing anything that looks like real reference data. Committing licensed data to a public repo is the single largest licensing risk this project carries, larger than any code exposure.

## Why open source

1. **Trust and auditability.** This tool handles the user's API key and pipes their data. Source you can read before `npm install -g` lowers the adoption barrier for exactly the developer audience we want. This is the primary reason.
2. **Closed-source would protect no licensed asset.** The X12 corpus is protected server-side and by EULA, so there is no moat to defend by hiding the client. With no security downside, the trust upside wins outright.
3. **Thin-client discipline, with a tripwire.** OSS is correct only while the client stays thin. If licensed data or proprietary algorithms ever need to live client-side (local schema validation, cached reference data, offline lookups), revisit this decision before shipping that capability.
4. **Secondary benefits:** npm provenance from a public build, public issue tracking, and the repo and README as a modest marketing surface. These are nice-to-haves, not the rationale.

## Language and framework

- Runtime: Node.js
- CLI framework: oclif, for its topic-based command hierarchy, built-in update plugin, and room to grow as commands are added
- Colored output: chalk
- Updates: `@oclif/plugin-update`, providing a built-in `tedi update`

## Authentication

All commands require a Tediware API key.

- **Destination (deferred): `tedi auth login` via a browser device flow.** The CLI prints a URL and a short code; the user signs up (if needed), agrees to the EULA, and authorizes in the browser; the CLI polls and stores the resulting key. This handles signup, EULA consent, and key issuance in a single flow, with a real clickwrap EULA and recorded, auditable consent that a pasted key cannot give. It requires device-authorization endpoints server-side, and those are deliberately deferred: the server is not building them for v0 (too heavy a surface to ship and maintain right now). Device flow swaps in later under the same stored-credential model, so the CLI does not change when it lands.
- **v0 mechanism (build this now): a pasted key in `tedi auth login`.** The user creates a key in the dashboard (signup and EULA handled on the web first); the CLI prompts for it with no echo and never accepts it via a flag or argv. This is the explicit, temporary path until the device-authorization endpoints ship, not the long-term design, but it is what v0 ships.
- **Reference access additionally requires accepted service terms.** Independent of how the key was obtained, the server checks on every reference request that the principal's account has accepted the current service terms, returning 403 otherwise. This keeps the EULA gate airtight even for the paste-key stopgap and when terms are updated.
- `tedi whoami` and `tedi auth status` report the authenticated identity (organization, key scope, service-terms state, key label) via an API-key-aware identity endpoint in the platform's `Platform` API. That endpoint does not exist yet and is deferred auth work, so v0 validates the key by making a real call and reading the status code rather than calling whoami. The platform scope model these report against (reference floor, sandbox, data plane, control plane, with control nested over data) is server-authoritative; see `doc/architecture/api_authentication.md` in the tediware repo.
- Tokens are stored in the OS keychain where available, falling back to a permissioned config file.
- `tedi auth logout` clears stored credentials.

## Quota and metering

- **X12 reference lookups are free and never count against the 800 tx/month developer tier.**
- **They are rate-limited per account** to deter bulk scraping that would let someone reconstruct the licensed reference corpus through the API. The limit is set to be invisible to normal interactive use (starting at roughly 60/min and 1,000/day per key, tunable via config), with the existing IP and session throttles kept as a backstop.

## Command design

The CLI surface spans four layers, and the grammar has to hold all of them as the platform CLI grows:

```
Layer            What it is                              Mutability   Scope
---------------  --------------------------------------  -----------  -------------
Meta / account   auth, config, update, whoami            n/a          local + account
Reference        the X12 standard itself (licensed)      read-only    global, versioned
Control plane     your org's config: connections,         CRUD         org-scoped
                 partners, mappings, flows
Data plane        operational data: exchanges,            read-mostly  org-scoped
                 transactions, traces, logs
```

The most important property the grammar reflects: reference is global licensed knowledge, while control and data plane are your org's mutable state.

**Grammar:** `tedi <noun> <verb> [args] [--flags]`, singular nouns. A fixed verb vocabulary is set now so later commands do not drift: `list`, `get`, `create`, `update`, `delete`, plus resource-specific actions where a CRUD verb does not fit (`flow run`, `connection test`, `transaction logs`).

**Reference is the one deliberate exception:** it is read-only, so the verb is implicit. `tedi x12 segment N1` means get; enumeration is explicit via `tedi x12 segment list`. This is a conscious specialization of the read-only layer, not an inconsistency.

**Output, and the JSON ownership rule:** structured JSON availability tracks who owns the data.

- Reference (the licensed X12 standard): presentation only, `--format console | markdown` (default `console`), mirroring the existing platform export. No JSON. `--json` returns an educational error rather than a flat failure ("X12 reference is available as `--format console` or `--format markdown`. Structured JSON isn't offered for licensed X12 reference data."). Console and markdown are presentations of the standard, not a re-ingestable data feed, which is the licensing-defensible posture. This is defense-in-depth and intent-signaling, not an airtight barrier; the real protection stays the EULA and the rate limit. The platform keeps JSON reference endpoints for its own web app; the CLI simply does not expose them and does not offer `--json`. Color for the `console` variant is rendered server-side (the renderer holds the structural context) and requested by the CLI only when stdout is an interactive terminal and `NO_COLOR`/`--no-color` are unset, so piped or redirected output stays clean. `markdown` is never colored.
- Control and data plane (your own org data): `--json` everywhere, since it is your data and piping is the right developer affordance.

**Release scoping (reference only):** every X12 lookup is implicitly scoped to a release (e.g. 004010, 005010), because the same id can differ across releases.

- `--release / -r` flag on every `x12` command.
- A configurable default: `tedi config set x12.release <id>` or `TEDI_X12_RELEASE`. With nothing set, the CLI defaults to `004010` (the most widely used release) rather than erroring on first use.
- Output always echoes the release used, in both console and markdown.
- `tedi x12 releases` lists supported releases.

**Boundary:** `tedi x12 ...` is always the generic licensed X12 standard, never an org's partner-specific implementation. Partner implementations are control-plane state and live under their own nouns (`partner`, `mapping`) when those ship. This prevents a future collision where `tedi x12 transaction 856` is ambiguous about whose 856 is meant.

For this first release we lock the Meta and Reference syntax and the grammar. The Control and Data plane rows are a non-binding sketch that the grammar must be able to absorb; their nouns are reconciled against the platform's actual domain model when those features are real, not invented now.

## First feature: X12 reference

Commands:

```
tedi x12 segment <id>        # e.g. tedi x12 segment N1
tedi x12 transaction <id>    # e.g. tedi x12 transaction 856
tedi x12 element <id>        # e.g. tedi x12 element 66
tedi x12 releases            # list supported X12 releases
```

All `x12` commands accept `--release / -r <id>` and `--format console | markdown` (see Command design). The user types a bare transaction code (`856`); the server resolves it, and also still accepts the functional-group identifier (`SH856`).

- **Element code lists are surfaced inside element output**, not as a separate top-level command in v1. (In X12, code values belong to elements, so `tedi x12 element 235` shows its valid codes.)
- **Large code lists are truncated in console output**, rendered server-side (for example `1,247 codes; showing 20. Use --format markdown for the full list.`). Some elements carry thousands of codes and unbounded dumps hurt readability. Truncation is a readability measure, not the scraping defense; that is the rate limit. `markdown` returns the full list.
- **Output:** colored `console` (a box-drawing diagram) by default, or `markdown`. No JSON for reference data, per the ownership rule above.
- **Reference scope (minimum):** segment definitions and element breakdowns, valid element values and code lists, and transaction-set loop structure.

## Update experience and changelog

- The update check runs asynchronously, throttled to at most once per 24 hours and cached, so it does not add latency or network calls to every invocation.
- When a newer version exists, a non-interrupting nudge is shown at the bottom of output.
- `tedi update` performs the update via `@oclif/plugin-update`.
- After updating, the changelog for the new version is fetched from GitHub Releases and shown in the terminal.
- Changelog copy is written as a marketing surface: new platform capabilities can be highlighted alongside CLI changes.

## Command structure (initial and planned)

Locked for this release (Meta + Reference):

```
tedi auth login | logout | status
tedi config get | set | list
tedi x12 segment <id>          [-r release] [--format console|markdown]
tedi x12 element <id>          [-r release] [--format console|markdown]
tedi x12 transaction <id>      [-r release] [--format console|markdown]
tedi x12 releases
tedi update
tedi whoami
```

Non-binding sketch for the Control and Data plane, shown so the grammar is known to absorb it (nouns reconciled against the platform's domain model when these ship; in practice `transaction` likely maps to the platform's `edi_transmissions`, and `exchange` has no current resource):

```
tedi connection  list | get | create | update | delete | test
tedi partner     list | get | ...
tedi mapping     list | get | ...
tedi flow        list | get | run
tedi exchange    list | get
tedi transaction list | get | logs
```

Every topic must stay thin: logic and licensed data remain server-side behind the API.
