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

- **`tedi auth login` uses a browser device flow.** The CLI prints a URL and a short code; the user signs up (if needed), agrees to the EULA, and authorizes in the browser; the CLI polls and stores the resulting token. This handles signup, EULA consent, and key issuance in a single flow. The browser step is deliberate: it gives a real clickwrap EULA with recorded, auditable consent, which a pasted key cannot. Requires device-authorization endpoints server-side.
- **Stopgap if device endpoints are not ready for v0:** accept a pasted key in `tedi auth login`, with signup and EULA handled on the web first. This is an explicit, temporary fallback to be upgraded to the device flow, not the target design.
- Tokens are stored in the OS keychain where available, falling back to a permissioned config file.
- `tedi auth logout` clears stored credentials.

## Quota and metering

- **X12 reference lookups are free and never count against the 800 tx/month developer tier.**
- **They are rate-limited per account** to deter bulk scraping that would let someone reconstruct the licensed reference corpus through the API. The rate limit is set to be invisible to normal interactive use.

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

- Reference (the licensed X12 standard): presentation only, `--format console | markdown` (default `console`), mirroring the existing platform export. No JSON. `--json` returns an educational error rather than a flat failure ("X12 reference is available as `--format console` or `--format markdown`. Structured JSON isn't offered for licensed X12 reference data."). Console and markdown are presentations of the standard, not a re-ingestable data feed, which is the licensing-defensible posture. This is defense-in-depth and intent-signaling, not an airtight barrier; the real protection stays the EULA and the rate limit. Color for the `console` variant is rendered server-side (the renderer holds the structural context) and requested by the CLI only when stdout is an interactive terminal and `NO_COLOR`/`--no-color` are unset, so piped or redirected output stays clean. `markdown` is never colored.
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

All `x12` commands accept `--release / -r <id>` and `--format console | markdown` (see Command design).

- **Element code lists are surfaced inside element output**, not as a separate top-level command in v1. (In X12, code values belong to elements, so `tedi x12 element 235` shows its valid codes.)
- **Large code lists are truncated in console output** (`1,247 codes — showing 20; --format markdown for the full list`). Some elements carry thousands of codes; unbounded dumps hurt readability and are the scraping vector the rate limit defends against.
- **Output:** colored `console` (an ASCII diagram) by default, or `markdown`. No JSON for reference data, per the ownership rule above.
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

Non-binding sketch for the Control and Data plane, shown so the grammar is known to absorb it (nouns reconciled against the platform's domain model when these ship):

```
tedi connection  list | get | create | update | delete | test
tedi partner     list | get | ...
tedi mapping     list | get | ...
tedi flow        list | get | run
tedi exchange    list | get
tedi transaction list | get | logs
```

Every topic must stay thin: logic and licensed data remain server-side behind the API.


# Codex Review (2026-06-25)

1. Summary

The brief is directionally strong on product positioning and grammar, but several core implementation assumptions do not match the current codebase. The biggest mismatches are auth (X12 API is not API-key authenticated today), transaction lookup shape (`856` vs `SH856`), output contract (JSON is currently available for reference endpoints), and scraping controls (no console truncation, no per-account throttle). Confidence: medium-high, based on direct controller/model reads plus targeted spec runs and Rails runner checks.

2. Claim verification

- **Claim:** X12 reference is global licensed standard data, release-scoped.
  - **Verdict:** Confirmed.
  - **Evidence:** X12 models are scoped by `x12_release_id` and not org-bound (`app/models/x12/release.rb:4`, `app/models/x12/segment.rb:4`, `app/models/x12/element.rb:4`, `app/models/x12/transaction_set.rb:4`). API routes are release-scoped under `/api/x12/:release_id/...` (`config/routes.rb:215`).

- **Claim:** `tedi x12 releases` can map to a server endpoint listing supported releases.
  - **Verdict:** Confirmed.
  - **Evidence:** `GET /api/x12/releases` exists (`config/routes.rb:213`, `app/controllers/api/x12/releases_controller.rb:4`). Local DB currently has `004010,004060,005010,006010,007010,008010` (command: `bundle exec rails runner 'puts X12::Release.order(:code).pluck(:code).join(",")'`).

- **Claim:** `tedi x12 transaction 856` is a valid lookup shape.
  - **Verdict:** Refuted (against current API).
  - **Evidence:** transaction lookup currently uses identifier (`func_group + code`), not bare code (`app/controllers/api/x12/transaction_sets_controller.rb:60`, `app/models/x12/transaction_set.rb:23`, `app/models/x12/transaction_set.rb:27`). In current data, 856 resolves as `SH856` (command: `bundle exec rails runner '...find_by(code: "856")...puts "#{ts.func_group}#{ts.code}"'` output `SH856`).

- **Claim:** Element code lists belong in element output, not a separate top-level command.
  - **Verdict:** Confirmed.
  - **Evidence:** element renderers include allowed codes (`app/services/x12_element_console_output_service.rb:37`, `app/services/x12_element_markdown_summary_service.rb:31`). JSON element serializer also includes code values for `ID` elements (`app/serializers/x12/element_serializer.rb:8`, `app/serializers/x12/element_serializer.rb:14`).

- **Claim:** Large code lists are truncated in console output.
  - **Verdict:** Refuted.
  - **Evidence:** console renderer prints all codes with no truncation branch (`app/services/x12_element_console_output_service.rb:41`). In current data, element `008010/128` has `1905` codes and console output has `1918` lines (commands: max-code query and line-count query).

- **Claim:** Reference output is presentation-only (`console|markdown`), no JSON.
  - **Verdict:** Refuted (current server behavior).
  - **Evidence:** `/api/x12/:release_id/{segments,elements,transaction_sets}` `show` endpoints return JSON (`app/controllers/api/x12/segments_controller.rb:28`, `app/controllers/api/x12/elements_controller.rb:30`, `app/controllers/api/x12/transaction_sets_controller.rb:28`). Index/search are also JSON (`app/controllers/api/x12/search_controller.rb:8`).

- **Claim:** Console output includes release context in output.
  - **Verdict:** Refuted.
  - **Evidence:** renderers print code/name headers only, no release field (`app/services/x12_element_console_output_service.rb:11`, `app/services/x12_segment_console_output_service.rb:11`, `app/services/x12_transaction_set_console_output_service.rb:11`). Runner output starts with `98 - Entity Identifier Code` and `# 98 - Entity Identifier Code`.

- **Claim:** All commands require API key auth.
  - **Verdict:** Refuted (today).
  - **Evidence:** `Api::X12::BaseController` skips auth globally (`app/controllers/api/x12/base_controller.rb:5`). X12 download requires signed-in session user (`Current.user`), not API key (`app/controllers/api/x12/base_controller.rb:22`). API-key auth is implemented in `Platform::BaseController` only (`app/controllers/platform/base_controller.rb:20`).

- **Claim:** Browser device flow is the target auth path (requires server endpoints).
  - **Verdict:** Unverifiable as implemented; practically absent in current server.
  - **Evidence:** no device/oauth-style routes in `config/routes.rb` (grep for `device|oauth|authorization` returned no matches). Existing auth is session cookie (`app/controllers/concerns/authentication.rb:24`) plus manual API key management under authenticated web API (`app/controllers/api/api_keys_controller.rb:17`).

- **Claim:** X12 lookups are free and do not count toward the 800 transmission limit.
  - **Verdict:** Confirmed.
  - **Evidence:** usage limit/billing calculations are based on `BillingEvent` type `edi_transmission` (`app/models/organization.rb:281`, `app/services/usage_report_service.rb:23`, `app/models/billing_event.rb:13`). X12 controllers do not create billing events. Transmission billing is created from `EdiTransmission` only (`app/models/edi_transmission.rb:133`).

- **Claim:** X12 lookups are rate-limited per account.
  - **Verdict:** Refuted.
  - **Evidence:** current X12 throttles are per session cookie and per IP (`config/initializers/rack_attack.rb:151`, `config/initializers/rack_attack.rb:155`), not per account/API key id.

- **Claim:** `tedi whoami` fits initial locked command set.
  - **Verdict:** Unverifiable/likely blocked by current backend.
  - **Evidence:** no `whoami` endpoint found in routes/controllers for API-key principal (grep for `whoami` returned none). `api/current_user` exists but is session-auth (`config/routes.rb:62`, `app/controllers/api/base_controller.rb:3`).

- **Claim:** Reference boundary is global standard data, partner implementations are separate control-plane state.
  - **Verdict:** Confirmed.
  - **Evidence:** X12 reference lives in global `X12::*` models; partner/implementation resources are separate APIs (`config/routes.rb:158`, `config/routes.rb:178`, `app/models/x12/transaction_set.rb:4`).

3. Risks and edge cases

- Backend dependency risk: this CLI brief assumes API-key-authenticated reference lookups, but current X12 endpoints are session/anonymous patterns, so CLI implementation will stall unless server changes land first.
- Licensing posture gap: ticket emphasizes account+EULA gating, but current reference endpoints still expose substantial JSON/list data without API key auth (`skip_before_action :require_authentication`), which weakens the stated defense model.
- Scraping surface mismatch: no console truncation exists today, and some elements have very large code lists (1905 values), so a naive CLI can pull large corpus chunks quickly.
- Transaction lookup ambiguity: brief uses bare transaction code (`856`), while existing identifiers are functional-group prefixed (`SH856`), leading to avoidable 404s unless normalized server-side or client-side.
- Output contract mismatch: brief says presentation-only with optional color; current download endpoints are file attachments and render plain text/markdown only, with no color control.
- Future control/data-plane command risk: grammar includes `exchange`, but there is no first-class Exchange model/resource in current API (`edi_transmissions` exists instead), so noun drift is likely.

4. Gaps in the ticket

- Missing explicit backend prerequisites: no linked server ticket/acceptance criteria for API-key X12 auth, text-inline responses, transaction code resolution, and release echo.
- Missing auth contract details: token type (API key vs device token), validation endpoint for `auth status`/`whoami`, and sandbox-key behavior are not defined.
- Missing error contract: CLI-facing behavior for 401/403/404/429 is described informally, but server response formats are currently mixed JSON/text and not standardized for CLI consumption.
- Missing rollout plan for stopgap auth: no trigger/date to retire pasted-key login, no compatibility expectations between stopgap and device flow.
- Missing acceptance criteria for anti-scrape controls: target rate-limit values, truncation thresholds, and whether `markdown` should also be bounded are unspecified.

5. Implementation considerations

- Treat this as a two-repo effort: backend API contract first, then CLI. The existing `ai/tickets/x12-reference-api.md` already captures most required backend deltas and should be reconciled with this brief.
- Prefer explicit endpoint contract tests before CLI work: request specs for auth mode, content type, `variant`, `color`, 404/429 bodies, and bare transaction-code lookup.
- Keep tenancy boundaries strict as CLI expands: reference commands can be global, but control/data plane commands should map to `/platform` API-key endpoints to preserve org scoping.
- Define noun mapping now for planned commands: `transaction` probably maps to `edi_transmissions`; `exchange` currently has no direct resource and needs a product/API decision.
- Add release context in renderer output if required by the brief; this is currently absent in all three reference renderers.

6. Open questions / anything else relevant

- Should reference lookups be API-key required for CLI only, or should web anonymous previews remain as-is? If both stay, clarify exactly what payload tier is public vs gated.
- For `tedi x12 transaction <id>`, should `<id>` be bare code (`856`), identifier (`SH856`), or both accepted?
- What is the source of truth for `whoami` under API-key auth?
- Should per-account rate limiting key on API key id, organization id, or both (plus IP backstop)?
- Do we want to keep JSON reference endpoints for web app internals while refusing CLI `--json`, or remove/restrict JSON server-side for consistency with the licensing stance?
- Validation run completed: `bundle exec rspec spec/controllers/api/x12/elements_controller_spec.rb spec/controllers/api/x12/segments_controller_spec.rb spec/controllers/api/x12/transaction_sets_controller_spec.rb spec/config/rack_attack_spec.rb` passed (`41 examples, 0 failures`).

