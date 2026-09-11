<!--
  tedi:synthetic-data-ok

  This file is hand-written prose about the HTTP contract and carries no
  reference content. The licensed-data tripwire's density check reads a line
  beginning with a short uppercase token as a code-list row, which matches
  every `GET /platform/...` and `404 (not_found) -> ...` line here. The marker
  turns off that check only; the publisher and copyright markers and the
  positioning check still apply to this file.
-->

# tedi CLI: the API surface

The HTTP contract the CLI consumes. Two surfaces are documented here:

- **X12 reference** (`/api/x12`), backing `tedi x12 ...`: licensed reference
  lookup, read-only.
- **EDI inspection** (`/api/edi`), backing `tedi edi inspect`. The CLI sends a
  document up and gets a rendered report back.
- **The data plane** (`/platform`), backing `tedi transaction`, `result`,
  `feed`, `trace`, `artifact`, `partner` and `whoami`: the caller's own traffic
  and, since partner reads landed, the first read-only slice of its
  configuration.
- **MCP** (`/mcp`), backing `tedi mcp serve`: the platform's Model Context
  Protocol server, which the CLI bridges to stdio without adding anything.

This is not a public product API. It is reachable and stable enough to build the
CLI against, but it is versioned with the CLI, not published as a third-party
API. Treat the CLI as the supported interface and this document as the
integration contract behind it.

## Base

- Endpoints are under `<base>/api/x12` (reference), `<base>/api/edi`
  (inspection), `<base>/platform` (the data plane), and `<base>/mcp` (the MCP
  server), where `<base>` is the Tediware host. The CLI defaults to production, `https://tediware.com`, and
  the host is configurable (`api.baseUrl` / `TEDI_API_BASE_URL`).
- There is no version prefix in the path.
- Reference requests are all `GET`. Inspection is a `POST` with a JSON body.
  Data-plane reads are `GET`; submissions and resend are `POST` with JSON
  bodies.

## Authentication

- Header: `Authorization: Key <api_key>`.
- The key is obtained out of band. This document assumes the CLI
  already holds a key. The shipping mechanism for v0 is the pasted-key stopgap:
  the user creates a key in the dashboard, and `tedi auth login` prompts for it
  with no echo (never via a flag or argv). The browser device flow is the
  deferred destination; it swaps in later under the same `Authorization: Key`
  credential model, so nothing about how the CLI stores or sends the key changes.
- Reference reads require no scope: any valid key reads reference, which is the
  floor beneath the platform's data and control planes. The CLI does nothing
  scope-related today. The scope model is server-authoritative and documented in
  the tediware repo at `doc/architecture/api_authentication.md`; treat that as
  canonical rather than re-deriving it here.
- Inspection sits on that same reference floor: any valid key authenticates it
  (standard or sandbox, since scope is not enforced), provided the organization has
  accepted the service terms and is not disabled. Unlike the reference
  endpoints, inspection always requires a key; there is no anonymous path.
- The three `download` endpoints require the header. `releases` is reachable
  without it, but the CLI should send the header on every request anyway, so
  usage counts against the per-key rate limit rather than only the per-IP one.
- A parseable `Key` header takes precedence over any session and must
  authenticate on its own. The CLI never sends cookies, so this is moot for it.

## Endpoints

### List releases

```
GET /api/x12/releases
```

Returns the supported X12 releases as JSON (this is version-index metadata, not
licensed dictionary content, so JSON is acceptable here). Ordered by
publication date, oldest first, then by code.

Response `200`:

```json
{
  "data": {
    "releases": [
      { "id": 9, "code": "004010", "name": "Release 004010", "hipaa": false, "published_at": "2000-01-01T00:00:00Z" }
    ]
  }
}
```

Backs: `tedi x12 releases`. Not release-scoped, and the one reference endpoint
reachable without a key (see "Authentication"). The CLI marks the release its
lookups default to and warns when that release is absent from this list.

### Segment, element, and transaction-set reference

```
GET /api/x12/:release/segments/:code/download?variant=<console|markdown>[&color=true]
GET /api/x12/:release/elements/:code/download?variant=<console|markdown>[&color=true]
GET /api/x12/:release/transaction_sets/:id/download?variant=<console|markdown>[&color=true]
```

Path parameters:

- `:release` is the release code, e.g. `004010`. Required. The server has no
  default release; the CLI owns the default (`004010`) and the `-r/--release`
  flag. See "Release scoping" below.
- `:code` for segments is the segment code (`N1`, `ISA`). For elements it is the
  element code (`235`). Both resolve case-sensitively within the release.
- `:id` for transaction sets resolves by either the functional-group identifier
  (`SH856`) or the bare transaction-set code (`856`). The CLI passes whatever the
  user typed; both work.

Query parameters:

- `variant=console|markdown`. The CLI should always send an explicit variant. If
  omitted, the server defaults to `console` (it defaulted to `markdown` until
  both endpoints were moved onto one shared vocabulary and default). Omitting it
  therefore yields `text/plain` and a `.txt` filename, not markdown, which is
  exactly why the CLI never omits it.
- `color=true` colors the `console` variant only. Send it only when stdout is an
  interactive terminal and `NO_COLOR` is unset and `--no-color` was not passed.
  See "Color" below.
- `limit=<n>|all` caps the rendered element code list. Omit it and the server
  keeps its own default (20 today); the CLI omits it rather than pinning a
  number the renderer is free to change. `limit=all` renders every code and drops
  the truncation footer, as does any `n` at or above the code count. Only
  `elements` acts on it; `segments` and `transaction_sets` accept and ignore it,
  so a client may send it uniformly. `markdown` ignores it too, being complete
  already. Anything else (`0`, `-1`, `twenty`) is a `400` with code
  `invalid_limit`; auth runs first, so a bad limit without a key is still `401`.

Response `200`: the rendered reference text in the request body.

```
variant=console   -> Content-Type: text/plain; charset=utf-8
variant=markdown  -> Content-Type: text/markdown; charset=utf-8
```

A `Content-Disposition: attachment` header is also set (it serves the web
download menu). The CLI ignores it and reads the response body directly.

The rendered output echoes the release it used (a `Release: <code>` line). Long
element code lists are truncated in the `console` variant with a footer pointing
at the markdown format for the full list; `markdown` returns every code. `limit`
(above) overrides the truncation. See "Element code lists" below for how the CLI
decides what to send.

Backs:

```
tedi x12 segment <code>       -> /segments/:code/download
tedi x12 element <code>       -> /elements/:code/download
tedi x12 transaction <code>   -> /transaction_sets/:id/download
```

### Inspect an EDI document

```
POST /api/edi/inspect
```

JSON body:

- `edi_content`: the interchange, as a string. Required. Maximum 256 KB
  (262,144 bytes); the CLI checks the size before uploading so an oversized file
  fails immediately rather than after the transfer.
- `variant`: `console` or `markdown`. The CLI always sends an explicit variant;
  the server defaults to `console`, as the reference endpoints now do too.
- `color`: `true` colors the `console` variant only, under the same rule as the
  reference endpoints. See "Color" below.

Not release-scoped. The release comes from the document's own envelope, so
`-r/--release` does not apply and an unsupported release is a rejection rather
than a lookup miss.

Response `200`: the rendered report in the response body, with the same content
types as the reference endpoints (`text/plain; charset=utf-8` for `console`,
`text/markdown; charset=utf-8` for `markdown`).

The report annotates the document, runs framing and envelope checks, validates
against the X12 standard, and renders the interchange as a tree of segments
under their loops. Findings cite a segment's position in that tree, not a line
number in the caller's file, and the report closes with a
`Findings (N errors, M notices)` block. Rendering is server-side for the same
reason reference rendering is: neither the parser nor the licensed reference
data it validates against ships in the thin CLI.

A document with problems is still a `200`: structural faults are reported as
findings, not as an error status. See "Inspection errors" below for the line
between the two.

#### Findings headers

Every `200`, in both variants, also summarizes itself in response headers, so a
caller can act on the outcome without parsing the rendered report:

```
X-Edi-Findings-Errors: 3
X-Edi-Findings-Notices: 0
X-Edi-Inspection-Complete: true
```

They are **absent on every non-`200`**, and absence must never be read as zero.

`X-Edi-Inspection-Complete` is `true` or `false`, and it is not redundant with
the counts: a gate built on the counts alone is wrong. The inspection is
deliberately fail-soft. If the framing check crashes its findings vanish with no
trace in the report, and if standard validation crashes it degrades to a single
notice. Either way a document nobody examined comes back with zero errors.
`false` means at least one check did not run, so the report is not evidence of
anything. A check skipped *on purpose* (the envelope check, when the parse
stopped early) leaves it `true`, because the finding that justified the skip is
in the report.

The CLI treats a missing, partial, or malformed set of headers as "unknown", not
as "clean", and exits `2` for it (see "Exit codes" below).

Backs: `tedi edi inspect <file>`.

**This is the only endpoint the CLI sends user data to.** `tedi edi inspect`
therefore runs the local, format-preserving PII scrub (the engine behind `tedi
edi obfuscate`) before the upload **by default**, with `--no-obfuscate` to opt
out. The default is the safe one deliberately: forgetting a flag must not be what
puts personal data on the wire, and the scrub costs nothing here because it
preserves delimiters, element lengths, code values, control numbers, and segment
counts, and preserves each value's faults, so the server sees the same
violations. What changes is that findings quoting a personal value quote the
replacement, and that a finding about the relationship between two scrubbed
values (a birth date falling after a service date, say) may not survive.

## Release scoping

The three reference endpoints are release-scoped and require `:release` in the
path. There is no server-side default. The CLI resolves the release in this
order: the `-r/--release` flag, then `TEDI_X12_RELEASE`, then the `x12.release`
config value, then the built-in default `004010`. `tedi x12 releases` is the one
reference command that is not release-scoped.

## Presentation only (no JSON for reference content)

Reference content is served as `console` or `markdown` text only. There is no
JSON representation of segment, element, or transaction-set detail, by design
(licensing posture). JSON `index` and `show` actions exist under
this namespace for the web app, but the CLI must not call them and must not offer
`--json` for reference data. The only JSON the CLI consumes is `releases`.

Inspection is presentation-only for the same reason: the report quotes the
standard it validated against, so it is served as `console` or `markdown` text
and `tedi edi inspect` does not offer `--json` either. (JSON is sent *to* that
endpoint; nothing structured comes back.)

## Error contract

Controller errors return a flat `{ "error": "<message>", "code": "<code>" }`:
a human message plus a stable machine code. This is not the platform's nested
envelope. The `429` response is the exception: it uses the throttle envelope
`{ "error": { "message": "...", "code": "rate_limited" } }`. Auth (`401`/`403`)
and throttle (`429`) responses carry no `code` of the flat kind at all, so they
are told apart by status.

Where a `code` is present it is the thing to branch on: the statuses have moved
once already (see "Inspection errors"), while the codes are the stable half of
the contract. Never branch on the body *shape*.

```
+--------+----------------------------------+---------------------------------------------+
| Status | Condition                        | Body                                        |
+--------+----------------------------------+---------------------------------------------+
| 200    | Success                          | rendered text (or JSON for /releases)       |
| 400    | Unrecognized variant             | { "error": "Unknown variant '...'. ...",    |
|        |                                  |   "code": "invalid_variant" }               |
| 400    | Code limit not a positive        | { "error": "...", "code":                   |
|        | integer or "all"                 |   "invalid_limit" } + Cache-Control:        |
|        |                                  |   no-store                                  |
| 401    | Missing or invalid key           | { "error": "Not authenticated" }            |
|        |                                  | or { "error": "Invalid API key" }           |
| 403    | Key's organization is disabled   | { "error": "Account unavailable" }          |
| 403    | Service terms not accepted       | { "error": "Service terms must be ..." }    |
| 404    | Unknown release in the path      | { "error": "Unknown X12 release '...'. ...",|
|        |                                  |   "code": "unknown_release" }               |
| 404    | Unknown segment/element/         | { "error": "Record not found",              |
|        | transaction code                 |   "code": "not_found" }                     |
| 404    | No route at that path            | { "error": "No such endpoint",              |
|        |                                  |   "code": "no_route" }                      |
| 429    | Rate limit exceeded              | { "error": { "message": "...",              |
|        |                                  |   "code": "rate_limited" } } + Retry-After  |
+--------+----------------------------------+---------------------------------------------+
```

The two `404` codes exist because `N1` is in every release: without them, a
mistyped `-r 4010` is reported as "no segment N1", which is never true. The
`unknown_release` message names the release it did not recognize and points at
`GET /api/x12/releases`. `no_route` comes from a catch-all at the end of the
`/api` namespace, so a wrong `api.baseUrl` answers in JSON rather than with the
HTML 404 page; the CLI reads it as "no such endpoint, check `api.baseUrl`" and
exits 2.

Suggested CLI handling:

```
401  -> prompt to run `tedi auth login` or check the configured key
403 (terms)     -> tell the user to accept the service terms in the browser
403 (disabled)  -> account unavailable; contact support
404 (not_found)      -> "No <segment|element|transaction set> '<code>' in
        release <release>." Suggest checking the code.
404 (unknown_release) -> print the server's message and suggest
        `tedi x12 releases`; do not blame the code that was looked up
404 (no_route)       -> "No such endpoint at <base>. Check api.baseUrl", exit 2
400 (invalid_variant) -> should not occur (the CLI controls the variant); a bug
400 (invalid_limit)   -> the CLI validates --limit before sending, so this means
        this build and the server disagree about what is allowed; say so and
        suggest `tedi update` rather than printing a bare status
429  -> honor the Retry-After header (seconds) and print a friendly wait message
```

### Inspection errors

Inspection adds a class the reference endpoints don't have: the payload is the
user's own file, so a rejection may be something the user can act on rather than
a CLI bug. Most of them aren't, and the `code` is what says which.

**The rule that matters: a document that could be read answers `200` no matter
how broken it is.** Everything wrong with it arrives as findings: an unclosed
interchange or an `SE`-count mismatch is a **finding in the report**, not an
error status. A non-`2xx` means the inspection did not happen.

```
+---------+-----------------------+---------------------------------------------------+
| Status  | Code                  | Meaning                                           |
+---------+-----------------------+---------------------------------------------------+
| 400     | missing_parameter     | No edi_content sent.                              |
| 400     | invalid_parameter     | edi_content was not a string.                     |
| 400     | invalid_variant       | variant not console|markdown.                     |
| 413     | content_too_large     | Body over 256 KB.                                 |
| 422     | unparseable_document  | Could not be read as EDI.                         |
| 422     | unsupported_release   | Read fine, no reference data for that release.    |
| 422     | inspection_failed     | A bug on the server side.                         |
+---------+-----------------------+---------------------------------------------------+
```

Three of these statuses moved: missing and non-string `edi_content` answered
`422` before they answered `400`, and an oversize body answered `422` before it
answered `413`. Key on `code`, not status. The CLI does, and falls back to the
status only for a response carrying no code (where a `422` keeps its historic
meaning of "could not be read as EDI").

So `422` means the document, *except* for the two codes that don't: an
`unsupported_release` is a gap in Tediware's reference data and an
`inspection_failed` is a bug on the server. Neither is a defect in the user's
document and neither may fail their build.

#### Where the 200/422 line actually falls

The split is invisible from the outside (both exit `1`), so here is each side
with the document that produces it.

A `422 unsupported_release` is the envelope parsing fine and the release having
no inspection tables. The message names what it read and what it carries, so a
caller can act on it:

```
Unsupported X12 release (ISA12 00602, GS08 006020). Inspection supports
releases 003060, 004010, 004060, 005010, 006010, 007010, 008010. Contact
support to have this release added.
```

The two release sets are maintained separately: reference needs a dictionary
import, inspection needs a registered parser. They agree today, and nothing
keeps them in step, so `tedi x12 releases` can list a release inspection
refuses. This message is what says so, and it reads the supported list from the
server at the moment of refusal, so it stays current even when this document
does not.

A `422 unparseable_document` is a document the parser could not read at all: a
truncated or mangled `ISA`, no segment terminator, bytes that are not X12. The
body carries an envelope diagnosis built from counts and offsets rather than the
parser's own message, which could quote the file's contents.

Everything else is a `200` with findings, including the cases that look fatal:

- `ST*252` (a transaction set no table in this release describes) inside a
  supported release. The `ST..SE` block stays in the tree unvalidated, still
  counts toward `GE-01`, and raises one `unknown_transaction_set` finding.
  Before this, the block vanished and the report blamed the envelope for a
  count the document had right.
- An `SE` segment count that disagrees with the segments it closes, an unclosed
  `GS`, a missing `IEA`. Framing faults are findings.

A caller that wants "did this document validate" reads
`X-Edi-Findings-Errors`; a caller that wants "did the inspection run" reads
`X-Edi-Inspection-Complete`. The status answers neither.

The CLI prints the server's message verbatim for these. That is safe: on a parse
failure the server renders an envelope diagnosis rather than the raw parser
error, which could otherwise quote data from the file being inspected.

Credential (`401`/`403`) and throttle (`429`) responses are unchanged, carry no
`code`, and are distinguished by status: `401` missing or invalid key, `403`
disabled organization or unaccepted service terms, `429` rate limited (honor
`Retry-After`).

The CLI never sends `missing_parameter` or `content_too_large` in normal use: it
refuses an empty document and one over the cap locally, before uploading. Getting
either back therefore means the CLI is at fault or its cap is stale, and it says
so rather than blaming the file.

### Exit codes

Server-side policy stops at reporting facts; how they map to an exit code is the
CLI's decision, and this is it. The split that matters to a CI job is between a
bad document and a tool that could not run. Collapsing them means an expired API
key gets reported as a broken file.

```
+------+---------------------------------------------------------------------+
| Exit | Condition                                                           |
+------+---------------------------------------------------------------------+
| 0    | 200, errors == 0, complete == true                                  |
| 1    | 200 and errors > 0  (plus notices, with --fail-on notice)           |
| 1    | 422 unparseable_document                                            |
| 2    | complete == false and nothing counted as a failure                  |
| 2    | 200 with no findings headers; unknown is not zero                   |
| 2    | 422 unsupported_release, 422 inspection_failed                      |
| 2    | 400, 401, 403, 413, 429, 5xx, transport failure, local usage errors |
+------+---------------------------------------------------------------------+
```

`1` is reserved for a verdict on the input: the document has findings, the server
could not read it, or (for reference lookups) the code does not exist. Everything
else is `2`, which is also oclif's default, so a mistyped flag already lands
there. `--fail-on=error|notice` chooses whether notices count toward `1`; it
defaults to `error`.

Note the first `2`: findings outrank an incomplete run. A crashed check loses
findings, it never invents them, so `errors > 0` with `complete == false` exits
`1`: a real verdict, with the incompleteness noted on stderr as a caveat. Only
a *silent* incomplete run (nothing found, so nothing to stand on) exits `2`.

On every `200` the report prints in full before the exit code is decided, whatever
that code turns out to be. On a non-`2xx` there is no report to print: the
server's diagnosis goes to stderr as an error instead.

## Rate limits

For client-side backoff. The CLI cannot see these counters; it only sees the
`429` and the `Retry-After` header.

Every surface is throttled in layers: per API key per minute and per day, with
per-IP layers deliberately above the per-key ones so a well-behaved caller hits
its own credential limit first and a shared NAT does not punish it for someone
else's traffic. Inspection is throttled harder than reference (each request
parses a whole document); the data plane has its own read, submit, and resend
ceilings, with resend the tightest because each accepted call puts a document
on a trading partner's wire.

The numbers are server-side and tunable, and this document does not quote them:
they have drifted from reality here once already. The canonical values and
their reasoning live in the tediware repo (`doc/architecture/api_authentication.md`
and `config/initializers/rack_attack.rb`). The CLI never needs them; it
branches on the `429`.

On `429`, respect `Retry-After` (whole seconds). Because there is a daily
ceiling, a `Retry-After` can occasionally be large; surface the wait rather than
silently hanging or hammering.

## Color

Color is decided and applied server-side; the renderer holds the structural
context, so the CLI does not add ANSI of its own.

- The server colors the `console` variant only when `color=true` is sent.
- `markdown` is never colored, regardless of the parameter.
- The CLI sends `color=true` only when all of: variant is `console`, stdout is a
  TTY, `NO_COLOR` is unset, and `--no-color` was not passed. Otherwise it omits
  the parameter and gets plain text, which is safe to pipe or redirect.
- Inspection follows the identical rule; `color` is a JSON boolean there rather
  than a query parameter, and is likewise omitted when not wanted.

## Request examples

```
# Releases
curl -H "Authorization: Key $TEDI_API_KEY" \
  "$BASE/api/x12/releases"

# Segment N1 in 004010, colored console
curl -H "Authorization: Key $TEDI_API_KEY" \
  "$BASE/api/x12/004010/segments/N1/download?variant=console&color=true"

# Element 673 in 004010, console, every code
curl -H "Authorization: Key $TEDI_API_KEY" \
  "$BASE/api/x12/004010/elements/673/download?variant=console&limit=all"

# Element 235 in 004010, markdown
curl -H "Authorization: Key $TEDI_API_KEY" \
  "$BASE/api/x12/004010/elements/235/download?variant=markdown"

# Transaction set by bare code in 004010, console
curl -H "Authorization: Key $TEDI_API_KEY" \
  "$BASE/api/x12/004010/transaction_sets/856/download?variant=console"

# Inspect a document, colored console
jq -Rs '{edi_content: ., variant: "console", color: true}' claims.edi | \
  curl -H "Authorization: Key $TEDI_API_KEY" -H "Content-Type: application/json" \
    --data-binary @- "$BASE/api/edi/inspect"
```

## Element code lists

The `console` variant truncates long element code lists; `limit` (see the
reference endpoint's query parameters) controls that. What the CLI sends:

| Invocation                       | `limit` sent |
| -------------------------------- | ------------ |
| `tedi x12 ele 673` at a terminal  | *(omitted)*, the server's default  |
| `tedi x12 ele 673` piped or redirected | `all` |
| `tedi x12 ele 673 --all`          | `all` |
| `tedi x12 ele 673 --limit 50`     | `50` |
| `--format markdown`, any of the above | as given; the server ignores it |

The piped default is the part worth explaining. A truncated list ends in a footer
inviting a second lookup, an affordance aimed at a person at a prompt. A pipe, a
file, or a script cannot act on it, so truncation there spends a round trip the
caller can never make. Piped output gets the whole list for the same reason it
gets no color. `--limit` still wins if a caller genuinely wants the short list on
the other end of a pipe.

The CLI validates the limit itself (a whole number ≥ 1, or `--all`), so an
`invalid_limit` response means this build and the server disagree about what is
allowed; it is worded as such rather than as a bare status.

### Why there is no relevance ordering

The companion idea, putting the useful codes first so a truncated window is
worth reading, was **dropped: no relevance signal exists.** Recorded so it isn't
re-proposed:

- **The existing order is stable, which is worth something.** Codes come back in
  dictionary import order (`order(:id)`), deliberately, so the console slice is
  always a prefix of the markdown list. For 673 that is `00, 01, 02, 03…`. It is
  arbitrary with respect to relevance, but it is the dictionary's own opening and
  it does not shift underfoot. (An earlier version of this note called the order
  alphanumeric. It isn't.)
- **Per-transaction-set code subsets do not exist in the reference data.** Asked
  and answered: code lists hang off the element and are release-scoped only. A
  transaction set reaches an element through `segment_uses → element_uses`, which
  carries requirement and position, never a code subset. So `tedi x12 ele 673 --in
  837` is not answerable from licensed reference data, and should not be faked.
  The subsets do exist one layer up, as `implementation_element_uses.allowed_codes`
  on partner implementations, but that is org-private customer data on a
  different auth plane, so it could only ever back a command scoped to the
  caller's own implementation, never a public `tedi x12` lookup.
- **There is no deprecation or status flag per code** to order on either; the
  dictionary import has nothing to populate one from.
- **Usage frequency from `POST /api/edi/inspect` traffic** is the only empirical
  signal in the system, and the scrub preserves code values, so it survives
  obfuscation. Mining customer interchanges for aggregate statistics is a data-use
  and consent decision, not a ranking feature. Do not build it as a side effect of
  a formatting fix.

## Data plane (`/platform`)

The caller's own operational data, on the same `Authorization: Key` credential.
Unlike reference, structured JSON is the point here, so every response is JSON
and every CLI data-plane command offers `--json`.

Three contract differences from the reference plane:

- **Errors are nested**: `{ "error": { "message", "code", "reason"? } }`, not
  the flat `{error, code}` body. `code` names the class of failure (a small
  closed set); `reason`, when present, names the condition within it. An
  unknown path under `/platform` answers this shape with `code: "no_route"`,
  from a catch-all at the end of the namespace.
- **No terms gate**: service terms are enforced at use on reference and
  inspection only.
- **This is the shape `--json` prints.** The CLI reshapes nothing here. A list
  is `{<collection>: [...], pagination: {hasMore, nextCursor}}`, a show is the
  object, `whoami` is the identity object, and a receipt is the receipt. The
  human renderings are derived from these; the JSON is not derived from the
  renderings. Anything a table shows that the body does not carry (a derived
  `READY` column, a footer) is the CLI's own presentation and never reaches
  `--json`.

Endpoints:

```
GET  /platform/whoami                        identity
GET  /platform/partners                      partner list
GET  /platform/partners/:key                 one partner, embedded
GET  /platform/traces/:guid                  one trace, assembled
GET  /platform/edi_transactions              transaction list
GET  /platform/edi_transactions/:id          one transaction
POST /platform/edi_transactions/:id/resend   re-deliver, 202
GET  /platform/results                       result list
GET  /platform/results/:id                   one result
GET  /platform/logs?trace=...                trace logs, oldest first
GET  /platform/feed_entries                  the feed, oldest first
GET  /platform/artifacts/:id                 raw document bytes
POST /platform/partners/:key/ts/:code        outbound submission
POST /platform/partners/:key/edi             inbound raw-EDI submission
GET  /platform/connections [/:id]            connections
GET  /platform/envelopes [/:id]              envelopes
GET  /platform/webhooks [/:id]               webhooks
GET  /platform/flows [/:id]                  flows; filters partner, direction, status
GET  /platform/mappings [/:id]               mappings; filters direction, partner
GET  /platform/mappings/:id/versions [/:n]   a mapping's versions
GET  /platform/implementations [/:id]        your own implementations; filter transactionSetIdentifier
GET  /platform/implementations/:id/schema    the JSON schema a mapping targets
GET  /platform/implementations/:id/guide     the rendered guide, ?variant=console|markdown
GET  /platform/implementations/:id/export    the portable export
GET  /platform/sources [/:id]         sources
```

Every list answers `{<collection>, pagination: {hasMore, nextCursor}}`, takes
`limit` (default 50, capped at 100) and an opaque `cursor`, and pages on a
`(created_at, id)` keyset. The same cursor codec backs the MCP tools, so a
cursor one surface hands out works on the other. Sandbox-scoped keys are
refused (`forbidden`) everywhere except `whoami`, `results/:id`, and
`artifacts/:id`; partners and traces are org-wide and are not opted in.

`since` on the logs and feed endpoints is an ISO 8601 timestamp. A value with
no zone is read in the server's zone, which is not the zone the API prints in,
so the CLI never sends one: `--since` accepts a full ISO 8601 value with a
zone, a bare date (read as UTC midnight), or a relative form (`30m`, `2h`,
`3d`, also `s` and `w`), refuses a zone-less datetime with a hint, and sends
the resolved UTC instant.

### Identity

`GET /platform/whoami` returns `{organization: {id, name}, keyScope, keyLabel,
serviceTermsAccepted}`, for any valid key including a sandbox one. `keyScope`
and `organization` are contract: the CLI exits 2 rather than defaulting when
either is missing, because a server that drops `keyScope` would otherwise make
every key look standard.

### Partners

```
GET /platform/partners
GET /platform/partners/:key
```

The first resource of the read-only control plane, and the pattern every later
one follows. Three rules hold it together:

- **One `Platform<Model>Serializer` per resource, secrets absent rather than
  masked.** No password, passphrase, private key, webhook secret, sink token,
  or API key appears at any depth. A spec renders every platform serializer
  through a populated fixture and fails on a key matching any of those words.
  The internal serializers are deliberately not reused: `ConnectionSerializer`
  returns credentials for a non-provisioned connection and `WebhookSerializer`
  returns a masked secret.
- **Show embeds, list summarizes.** The show carries `connection`,
  `internalEnvelope`, `externalEnvelope`, `inboundWebhook`, `outboundWebhook`
  and `errorWebhook` as full objects, each with its `id` and each rendered by
  the serializer its own endpoint will use when that endpoint exists. No second
  GET, and no shape change when it does.
- **Raw facts, not computed verdicts.** Flow status, whether a mapping or
  implementation is attached, whether the connection is provisioned. There is
  no server-side `ready` boolean; the CLI derives its `READY` column from
  these, and a different client is free to derive something else.

A list row carries `id`, `key`, `name`, `connection: {id, name, kind} | null`,
`inboundSets: [codes]`, `outboundSets: [codes]`, and
`flows: [{direction, status}]`. The list is oldest first, so partners read in
the order they were set up.

The show adds the control-number starting points, the acknowledgment settings,
the delivery method, and:

```json
{
  "transactionSets": [
    {
      "transactionSetIdentifier": "850",
      "direction": "inbound",
      "mapping": { "id": "...", "name": "ACME 850 inbound" },
      "implementation": null,
      "directory": "/in"
    }
  ],
  "flows": [
    { "id": "...", "name": "ACME Inbound", "direction": "inbound", "status": "active" }
  ]
}
```

Keys resolve in any case and are returned uppercase. A miss is
`404 not_found` with `reason: "partner"`.

Backs `tedi partner list` and `tedi partner get <key>`.

### Configuration

```
GET /platform/connections [/:id]
GET /platform/envelopes [/:id]
GET /platform/webhooks [/:id]
GET /platform/flows [/:id]
GET /platform/mappings [/:id]
GET /platform/mappings/:id/versions [/:number]
GET /platform/implementations [/:id]
GET /platform/implementations/:id/{schema|guide|export}
GET /platform/sources [/:id]
```

The rest of the read-only control plane, on the partner pattern: compact list
rows, a show that embeds related objects with their ids, raw facts, the shared
cursor, secrets absent, standard key only. Ids are the identifiers everywhere;
a partner key is a list filter (`partner=`) and never a path segment. Every
resource that points at another returns `{id, name}` (`{id, key, name}` for a
partner), and every resource lists what points at it: a connection its
`partners`, an envelope and a webhook their `partners` each with a `role`, a
mapping the keys of the `partners` using it, an implementation its `mappings` and
`partners`, a source its `mappings`.

A miss on any show is `404 not_found` with `reason` naming the resource
(`connection`, `envelope`, `webhook`, `flow`, `mapping`, `mapping_version`,
`implementation`, `source`), and the CLI prints "No <resource> '<id>'
in your organization." A malformed id is a miss, not a 400.

Flows list only the current version of each; superseded versions drop out.
`status` is `pending|active`, `frequency` is minutes with `0` paused, and the
show adds `nodes: [{id, name, kind, service}]` and `connections: [{from, to}]`
with no node configuration. `direction` and `status` outside their vocabulary
are refused with `invalid_parameter`; an unknown partner key is an empty page.

A mapping's show carries `current` (the latest version: `versionNumber`,
`transformation`, `placeholders`, `note`, `createdAt`, `createdBy: {name}`)
and the source embedded in full (`sample`, `semantics`); the
implementation stays a reference. `versions/:number` returns one version in
the `current` shape, which is what `--version` on `mapping get` prints and
what `--json` emits there. `current.versionNumber` is `null` on a mapping
saved before versions existed.

Implementations cover the organization's own only. A public implementation
(the shared catalogue) is a 404 on every representation here; importing one is
done in the app, after which it is the organization's copy with
`sourceImplementation` recording the origin. `schema` is the JSON schema
(draft 2020-12) a mapping targets, returned as JSON. `guide` is presentation
only, like the reference: `?variant=console` (default, `text/plain`) or
`markdown` (`text/markdown`), no JSON variant, and `tedi implementation guide`
refuses `--json` the way `x12` does. `export` is the whole implementation as one
portable JSON document keyed by segment codes, positions and loop identifiers
rather than database ids, for version control, diffs and support
conversations. There is no import on this plane.

Backs `tedi connection|envelope|webhook|flow|mapping|source list|get`,
`tedi mapping versions`, and `tedi implementation list|get|schema|guide|export`.

### Traces

```
GET /platform/traces/:guid
```

Everything the platform knows about one processing run, which is the one thing
a caller polls after a submission:

```json
{
  "traceGuid": "...",
  "processing": false,
  "ediTransactions": [ /* list rows */ ],
  "results": [ /* oldest first */ ],
  "feedEntries": [ /* oldest first */ ],
  "logs": [ /* oldest first */ ],
  "artifacts": [
    { "id": "...", "usage": "output", "contentType": "application/edi-x12",
      "filename": "856_1042.edi", "resultId": "...", "nodeName": "Implementation" }
  ]
}
```

`artifacts` is every pointer on the trace exactly once, each labelled with the
result and node that produced it. Pointers are cumulative down a pipeline, so
the first carrier in creation order is the producer; this is what replaces the
flattened per-result listing that showed one artifact fourteen times.

`processing` is `true` while the pipeline is still running. Nothing stores a
running state, so it is derived from the flow graph: a node's job writes its
result and enqueues its children, so work remains exactly while some node has
written more results than its children have taken. It is counted per result
rather than per node, because a splitter writes one result per transaction set
and the sets flow on one at a time. An errored result is terminal. The
poll-only terminal writes no result at all, so its work is read from the
success feed entry it publishes.

That gives `partner send --wait` and any agent one boolean with a defined end
state, instead of guessing from a log that has not stopped growing.

`logs` here carry the same visibility lag as `GET /platform/logs`: a line is
committed after its timestamp, so lines younger than about five seconds are
withheld rather than risk a reader seeing "no more logs" and then an older
line appearing. A trace that has just finished takes a moment to show its tail.

A guid nothing in the organization carries is `404 not_found`, which
distinguishes a trace that does not exist from one with nothing to show yet.

Backs `tedi trace <guid>`, and `--trace` on `transaction get` and
`transaction logs`.

### Transactions

`GET /platform/edi_transactions` filters on `incoming`, `direction`,
`transaction_set_identifier`, `trace`, `ack_status`, `status` and `partner`,
newest first.

`status=delivered|error` is the processing status the show already carried,
now stored on the row so the list can filter on it in SQL, and emitted on every
list row. It is `error` when a result on the document's run recorded a
failure and does not change back: a resend that succeeds leaves the original
failure on the trace. Backs `--status` on `transaction list`.

`direction=inbound|outbound` is the vocabulary every other record already used.
`incoming=true|false` stays, shipped and consumed; both are accepted and the
serializer emits both. Sending both with values that disagree is
`400 invalid_parameter` rather than a silent winner. `incoming` and the
`incoming=` parameter carry `TODO(deprecate)` at their sites and will not be
removed while a consumer still reads them.

`partnerKey` is the partner recorded when the document was processed (the
partner whose flow received it, or the partner it was submitted to), and
`partner=<key>` filters on it, so two partners sharing an external envelope
still get their own rows. Rows that predate the recording resolve the partner
from the counterparty ISA id (the sender inbound, the receiver outbound)
against each partner's external envelope; on those, `partnerKey` is absent
when nothing matches or when two partners share the identifier, rather than
guessed at.

`duplicateOf` names an earlier inbound transmission from the same sender with
the same interchange control number, when there was one. It is a note, not a
refusal: `partner receive` exists to replay documents.

The show narrows `results` to the transmission's own attributed results, oldest
first, falling back to the whole trace only when nothing is attributed. Two
documents sharing a trace (an inbound 850 and the 997 sent back for it) no
longer show each other's results. It also carries:

- `status`, `"delivered"` or `"error"`. `error`, not `errored`: the failure
  word is now the same on every record the platform returns. This serializer
  had not shipped when it changed.
- `acknowledges` and `acknowledgedBy`, the transaction ids on the other end of
  the acknowledgment, from the Expectation model. A 997 can finally say what it
  answered.
- `traceErroredElsewhere` and `traceErroredElsewhereNodeName`, for the case
  where this document is fine and a sibling on its trace is not.
- `artifacts`, the four roles the in-app transaction page derives:

```json
{
  "artifacts": {
    "input":  { "id": "...", "usage": "input",  "contentType": "application/edi-x12",
                "filename": "850_4471.edi",  "resultId": "...", "nodeName": "SFTP Fetch" },
    "output": { "id": "...", "usage": "output", "contentType": "application/json",
                "filename": "850_4471.json", "resultId": "...", "nodeName": "EDI to JSON" },
    "errored": null,
    "acknowledged": null
  }
}
```

Each role is the artifact that plays the part, flattened together with the
`resultId` and `nodeName` that produced it, or `null` when the transaction has
nothing in that role. A role can arrive carrying `resultId` and `nodeName` and
no artifact fields: an error result writes no file, since the failure is its
`errorMessage`, and an outbound document's entry result holds the submitted
JSON in its data rather than as an artifact. Naming the result is still worth
more than omitting the role.

`POST /platform/edi_transactions/:id/resend` answers `202` with
`{message, ediTransactionId, traceGuid}`. `traceGuid` is the addition: the
resend lands on the original trace, and without it the receipt named nothing
the caller could follow. The replay's results carry `detail.resend: true`, so a
trace or an error feed entry can tell a replay from the original.

### Results

`GET /platform/results` filters on `trace`, `node` and `status`, newest first.

`node` accepts a node id or a node name, case-insensitively and org-scoped.
Only the name is displayed anywhere, so an id-only filter was unreachable
without copying one out of a dashboard URL; the serializer now emits `nodeId`
as well, which makes the id form discoverable from the rows it returns.

`status=success|error` is sifted in Ruby, not SQL: result metadata is
encrypted, so the error flag cannot be a column predicate. Rows are read in
keyset order and sifted until the page fills, with a bounded scan behind it, so
a filter matching nothing for a long stretch stays a bounded request and hands
back a cursor at the last row scanned rather than walking the table.

On a row, `status` is `"error"` when the node recorded a failure and
`"success"` otherwise. A mapping that was delivered flagged is a `success` with
`detail.mappingFailed: true` beside it: the document went out, and the flag is
its own axis.

`detail.direction` on a result is **the node's transfer direction, not the
document's**. A webhook delivering an inbound 850 to your endpoint writes
`outbound`, because the HTTP call leaves the platform; so does one of the two
results behind an automatic 997. The feed's `direction` is the document's. They
disagree by design, which is why `tedi result list` has no `DIR` column: read
the transaction or the feed entry for the document's direction.

`detail.errors` is an array of strings beside the one-sentence
`detail.errorMessage`, on the steps that record their findings individually
(implementation validation does). It exists because the validation message used
to be one 1,100-character string with serialized JSON embedded in the prose,
which a caller had to find and parse out of a sentence. `detail.mappingError`
was already structured this way and is the model it follows.

### Submissions

`POST /platform/partners/:key/ts/:code` takes
`{contents, filename?, overrides?}` and answers:

```json
{
  "message": "Processing queued",
  "interchangeControlNumber": "1042",
  "groupControlNumber": "1043",
  "traceGuid": "...",
  "ediTransactionId": "..."
}
```

`ediTransactionId` is there because the service creates the transmission before
it answers. Queued means queued: validation, translation and delivery run
afterwards, so a submission that will fail still answers `200` here and fails
on the trace seconds later. `tedi partner send --wait` polls
`GET /platform/traces/:guid` for that verdict.

`contents` that is not a JSON object (a string, an array, `null`) is
`400 invalid_parameter` with "contents must be a JSON object". It used to reach
`merge` and produce a Rails 500, which the CLI reported as a server fault and
the MCP bridge as "server down".

`POST /platform/partners/:key/edi` takes `{contents, filename?}`, where
`contents` is the raw interchange, and answers `{message, traceGuid}` plus
`duplicateOf` when the interchange control number and sender ISA id match an
earlier inbound transmission in this organization.

Two checks run before the document is queued, both `422 invalid_edi`: the ISA
header has to be readable, and the trailers have to be present and their counts
plausible (`SE`, `GE`, `IEA`). The trailer check is structural and uses no
reference data; a document that passes it can still fail the full parse
downstream. It exists because `head -c 300` on a real 850 passed the header
check, passed every node, and failed quietly in a mapping.

The submitted bytes are stored as an `input` artifact on the entry node's
result, as an SFTP fetch already did, so a document pushed in over HTTP can be
re-inspected or replayed.

## MCP (`/mcp`)

The platform hosts a Model Context Protocol server at `POST <base>/mcp`,
revision `2026-07-28` only. That revision is stateless (no `initialize`
handshake, no session id, no server-initiated stream), so every call is one
self-describing HTTP POST on the same `Authorization: Key` credential as
everything else.

`tedi mcp serve` is a transport adapter for clients that launch MCP servers as
stdio subprocesses. It reads newline-delimited JSON-RPC on stdin, sends each
request as one POST whose body is the message unchanged, and writes the reply
back as one line. It holds no tool logic and no tool list; `server/discover` and
`tools/list` are forwarded like everything else so the server's `instructions`
and definitions reach the agent unaltered. Because the credential comes from
`tedi auth login` (or `TEDI_API_KEY`), a key never has to be written into an
agent's configuration file.

What the bridge adds to each POST, per the Streamable HTTP binding:

- `MCP-Protocol-Version`, copied from `params._meta["io.modelcontextprotocol/protocolVersion"]`.
- `Mcp-Method`, copied from `method`.
- `Mcp-Name`, copied from `params.name` (`tools/call`, `prompts/get`) or
  `params.uri` (`resources/read`); Base64-wrapped as `=?base64?...?=` when the
  value is not plain visible ASCII.
- `Accept: application/json, text/event-stream`. The server answers with plain
  JSON today; an SSE reply is read and each event written as its own line, and a
  stream that closes without answering the request is reported as `-32002`.
- No `Mcp-Param-*` headers. The binding requires clients to mirror tool
  parameters a server annotates with `x-mcp-header`; no Tediware tool does, and
  the server does not validate them. Annotating one server-side means teaching
  the bridge to mirror it first.

The server rejects a header that disagrees with the body (`-32020`), which is
what lets it meter `Mcp-Name` into the same reference, inspection and platform
ceilings the REST endpoints use. The bridge only ever copies headers from the
body, so this refusal is not reachable through it.

### The legacy-era handshake

The server is modern-only, and every shipping MCP host is a legacy client: it
opens with `initialize` carrying `protocolVersion: "2025-11-25"`, which the
server has no method for. The spec's own compatibility matrix says legacy
client plus modern server fails, and names a dual-era server as the remedy.
That era lives in the bridge, not in the server.

The bridge answers locally:

- `initialize`: echoes the requested `protocolVersion`, with
  `capabilities: {tools: {}, resources: {}, prompts: {}}` and
  `serverInfo: {name: "tediware", version: <cli version>}`. The requested
  version is logged to stderr once at startup.
- `notifications/initialized`: swallowed, no reply.
- `ping`: an empty result.

On every request it does forward, it injects
`params._meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"` when
absent, and the mirrored `MCP-Protocol-Version` header follows. A request that
carries a different version explicitly is still refused, naming the supported
one. So a host that knows nothing about 2026-07-28 connects, lists tools, and
calls them, and the server never sees a version it does not speak.

This is a compatibility shim with an expiry: `TEDI-540`, due 2027-09-01,
revisits whether the legacy era still needs answering. Direct HTTP from a
legacy host is not supported and is not planned; the bridge is the path.

What else the bridge answers itself, and only these:

- A line that is not JSON: `-32700`. A JSON value that is not a JSON-RPC 2.0
  request: `-32600`. Both on `id: null`.
- A forwarded request naming a protocol version other than `2026-07-28` in
  `_meta`: `-32022` with `data.supported: ["2026-07-28"]`, without forwarding.
  The server would call this a header mismatch, which is the wrong words on a
  transport with no headers.
- A `tools/call`, `resources/read` or `prompts/get` with no string `name` (or
  `uri`): `-32602`, without forwarding, for the same reason.
- A `429` from the rate limiter, which carries the REST `{error: {code:
  "rate_limited"}}` body rather than a JSON-RPC one: `-32001` with
  `data.reason: "rate_limited"` and `data.retryAfterSeconds` from `Retry-After`.
- A reply with no JSON-RPC body (a gateway 502, an unreachable host, the 60
  second deadline): `-32002` with `data.reason` of `upstream_error`,
  `unreachable` or `timeout`.

Every JSON-RPC body the server returns passes through whatever its HTTP status
(an error the server wrote on `id: null`, such as the oversized-body refusal,
is re-keyed to the request's id, since on stdio nothing else correlates it), so `401`/`403` refusals (`-32000` with `data.reason` of `unauthorized`,
`organization_disabled`, `sandbox_key_not_supported` or
`service_terms_required`), unknown tools (`-32602`) and unknown methods
(`-32601`) reach the client exactly as the server wrote them. Tool-level
failures (an unknown segment code, an unparseable document) are ordinary
results with `isError: true`, also untouched.

Notifications are not forwarded. The core protocol defines one client-to-server
notification, `notifications/cancelled`, and it acts on the bridge: the matching
in-flight POST is aborted and nothing further is written for that id. Any other
notification is dropped with a note on stderr, since a notification must not be
answered and the server refuses them. Stdout carries MCP messages only.

**The reference-tools-return-text rule.** `x12_segment`, `x12_element` and
`x12_transaction_set` answer with one Markdown text block, declare no
`outputSchema`, and return no `structuredContent`; the server strips the field
rather than trusting the tools. This is the presentation-only rule above,
mapped onto MCP, and the bridge must never add a structured rendering of that
text. `x12_releases` is structured (a version index, not dictionary content),
`edi_inspect` carries its findings counters beside the rendered report, and the
data-plane tools return `structuredContent` freely, as `--json` does.

Sandbox keys are refused on `/mcp` outright (`403`, `sandbox_key_not_supported`).

### Tool arguments

Argument names are camelCase, matching the REST query parameters and the keys
the tools return: `transactionSetIdentifier`, `ackStatus`, `transactionId`,
`partnerKey`. `x12_releases` returns `publishedAt`. Nothing MCP had shipped
when this changed, so there is no compatibility window to respect.

Arguments are validated against each tool's declared schema before the tool
runs. Every schema already said `additionalProperties: false`; now the server
enforces it, so a misspelled argument is a refusal rather than a filter that
was silently dropped. `{"transactionSetIdentifier": "850"}` on a tool that
expected the snake_case name used to return the whole organization with
`isError: false`.

Three further rules the validator applies:

- An empty string for an identifying argument (`trace`, `partner`,
  `transactionId`, `node`) is `isError: true`, not "no filter". A blank shell
  variable used to return everything.
- `direction` and `status` carry enums and refuse a bad value with the allowed
  list, as `ackStatus` and `level` already did.
- A `limit` outside 1 to 100 is an error rather than a silent clamp, since the
  description already promised that range.

The tool list adds `partner_list`, `partner_get` and `trace_get`, mirroring the
endpoints above.

Two response details worth knowing. The `content[0].text` block beside
`structuredContent` is now a one-line summary (record kind, id, status) rather
than the same JSON again; `transaction_get` was returning about 20 KB twice.
And an unhandled exception, once the request id is known, renders JSON-RPC
`-32603 Internal error` with that id, so the bridge can say "the server
faulted" rather than `-32002 upstream_error`, which reads as "server down".

## Not available yet (do not build against)

- Control-plane writes. Every configuration resource is readable (see
  Configuration); creating or changing any of it stays in the application.
  Node configuration bodies are not readable either: a flow's show carries
  node identities and edges only. There is no `control` scope yet; the reads
  sit under `standard`, and nothing here forecloses adding one.
- Public (catalogue) implementations, and importing one through the API.
- The JSON `index`/`show`, `search`, and `favourites` actions under the
  reference namespace are web-app internals; the CLI does not use them.
