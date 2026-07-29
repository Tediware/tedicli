# tedi CLI — API Surface

The HTTP contract the CLI consumes. Two surfaces are documented here:

- **X12 reference** (`/api/x12`), backing `tedi x12 ...` — licensed reference
  lookup, read-only.
- **EDI inspection** (`/api/edi`), backing `tedi edi inspect` — the CLI sends a
  document up and gets a rendered report back.

This is not a public product API. It is reachable and stable enough to build the
CLI against, but it is versioned with the CLI, not published as a third-party
API. Treat the CLI as the supported interface and this document as the
integration contract behind it.

See `BRIEF.md` for product intent, command grammar, and the licensing posture.

## Base

- Endpoints are under `<base>/api/x12` (reference) and `<base>/api/edi`
  (inspection), where `<base>` is the Tediware host. The CLI defaults to
  production, `https://tediware.com`. Maintainers running the (private) Tediware
  server locally point at `http://localhost:5004`; the host is configurable in
  the CLI.
- There is no version prefix in the path.
- Reference requests are all `GET`. Inspection is a `POST` with a JSON body.

## Authentication

- Header: `Authorization: Key <api_key>`.
- The key is obtained out of band; see `BRIEF.md`. This document assumes the CLI
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
  (standard or sandbox — scope is not enforced), provided the organization has
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
licensed dictionary content, so JSON is acceptable here). Ordered newest first.

Response `200`:

```json
{
  "data": {
    "releases": [
      { "id": "<uuid>", "code": "004010", "name": "Release 004010", "hipaa": false, "published_at": "2000-01-01T00:00:00Z" }
    ]
  }
}
```

Backs: `tedi x12 releases`. Not release-scoped.

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
  omitted, the server defaults to `markdown`.
- `color=true` colors the `console` variant only. Send it only when stdout is an
  interactive terminal and `NO_COLOR` is unset and `--no-color` was not passed.
  See "Color" below.

Response `200`: the rendered reference text in the request body.

```
variant=console   -> Content-Type: text/plain; charset=utf-8
variant=markdown  -> Content-Type: text/markdown; charset=utf-8
```

A `Content-Disposition: attachment` header is also set (it serves the web
download menu). The CLI ignores it and reads the response body directly.

The rendered output echoes the release it used (a `Release: <code>` line). Long
element code lists are truncated in the `console` variant with a footer pointing
at the markdown format for the full list; `markdown` returns every code.

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

- `edi_content` — the interchange, as a string. Required. Maximum 256 KB
  (262,144 bytes); the CLI checks the size before uploading so an oversized file
  fails immediately rather than after the transfer.
- `variant` — `console` or `markdown`. The CLI always sends an explicit variant;
  the server defaults to `console` here (note: the opposite of the reference
  endpoints, which default to `markdown`).
- `color` — `true` colors the `console` variant only, under the same rule as the
  reference endpoints. See "Color" below.

Not release-scoped. The release comes from the document's own envelope, so
`-r/--release` does not apply and an unsupported release is a rejection rather
than a lookup miss.

Response `200`: the rendered report in the response body, with the same content
types as the reference endpoints (`text/plain; charset=utf-8` for `console`,
`text/markdown; charset=utf-8` for `markdown`).

The report annotates the document, runs framing and envelope checks, validates
against the X12 standard, and reprints the interchange one segment per line —
findings anchor to those line numbers and close with a `Findings (N errors, M
notices)` block. Rendering is server-side for the same reason reference rendering
is: neither the parser nor the licensed reference data it validates against ships
in the thin CLI.

A document with problems is still a `200`: structural faults are reported as
findings, not as an error status. See "Inspection errors" below for the line
between the two.

Backs: `tedi edi inspect <file>`.

**This is the only endpoint the CLI sends user data to.** `tedi edi inspect`
therefore runs the local, format-preserving PII scrub (the engine behind `tedi
edi obfuscate`) before the upload **by default**, with `--no-obfuscate` to opt
out. The default is the safe one deliberately: forgetting a flag must not be what
puts personal data on the wire, and the scrub costs nothing here because it
preserves delimiters, element lengths, code values, control numbers, and segment
counts — and preserves faults, so the server sees the same violations. What
changes is that findings quoting a personal value quote the replacement.

## Release scoping

The three reference endpoints are release-scoped and require `:release` in the
path. There is no server-side default. The CLI resolves the release in this
order: the `-r/--release` flag, then `TEDI_X12_RELEASE`, then the `x12.release`
config value, then the built-in default `004010`. `tedi x12 releases` is the one
reference command that is not release-scoped.

## Presentation only (no JSON for reference content)

Reference content is served as `console` or `markdown` text only. There is no
JSON representation of segment, element, or transaction-set detail, by design
(licensing posture, see `BRIEF.md`). JSON `index` and `show` actions exist under
this namespace for the web app, but the CLI must not call them and must not offer
`--json` for reference data. The only JSON the CLI consumes is `releases`.

Inspection is presentation-only for the same reason: the report quotes the
standard it validated against, so it is served as `console` or `markdown` text
and `tedi edi inspect` does not offer `--json` either. (JSON is sent *to* that
endpoint; nothing structured comes back.)

## Error contract

Controller errors return `{ "error": "<message>" }` (a string). The `429`
response is the one exception: it uses the platform throttle envelope
`{ "error": { "message": "...", "code": "rate_limited" } }`. Branch on the HTTP
status code, not the body shape.

```
+--------+----------------------------------+---------------------------------------------+
| Status | Condition                        | Body                                        |
+--------+----------------------------------+---------------------------------------------+
| 200    | Success                          | rendered text (or JSON for /releases)       |
| 400    | Unrecognized variant             | { "error": "Unknown variant '...'. ..." }   |
| 401    | Missing or invalid key           | { "error": "Not authenticated" }            |
|        |                                  | or { "error": "Invalid API key" }           |
| 403    | Key's organization is disabled   | { "error": "Account unavailable" }          |
| 403    | Service terms not accepted       | { "error": "Service terms must be ..." }    |
| 404    | Unknown release/segment/element/ | { "error": "Record not found" }             |
|        | transaction code                 |                                             |
| 429    | Rate limit exceeded              | { "error": { "message": "...",              |
|        |                                  |   "code": "rate_limited" } } + Retry-After  |
+--------+----------------------------------+---------------------------------------------+
```

Suggested CLI handling:

```
401  -> prompt to run `tedi auth login` or check the configured key
403 (terms)     -> tell the user to accept the service terms in the browser
403 (disabled)  -> account unavailable; contact support
404  -> "No <segment|element|transaction> '<code>' in release <release>."
        Suggest `tedi x12 releases` or checking the code.
400  -> should not occur (the CLI controls the variant); treat as a bug
429  -> honor the Retry-After header (seconds) and print a friendly wait message
```

### Inspection errors

Inspection adds a class the reference endpoints don't have: the payload is the
user's own file, so a rejection is usually something the user can act on rather
than a CLI bug.

The dividing line is *readability*, not correctness. A document the parser can
read comes back `200` however broken it is — an unclosed interchange or an
`SE`-count mismatch is a **finding in the report**, not an error status. `422` is
reserved for documents that cannot be read as EDI at all.

```
+---------+--------------------------------------+-------------------------------------------+
| Status  | Condition                            | Body                                      |
+---------+--------------------------------------+-------------------------------------------+
| 422     | Missing/empty `edi_content`          | { "error": "EDI content is required." }   |
| 422     | Not readable as EDI (e.g. no ISA)    | { "error": "<envelope diagnosis>" }       |
| 422     | Release in the envelope unsupported  | { "error": "Unsupported X12 release. ..." }|
| 400     | Unrecognized variant                 | { "error": "Unknown variant '...'. ..." } |
| ?       | `edi_content` over 256 KB            | not observed — the CLI refuses first      |
+---------+--------------------------------------+-------------------------------------------+
```

The `422`s above were confirmed against a running server. The oversize status was
not, because the CLI checks the limit client-side and never sends one; it also
maps `400`, `413`, and `422` on this endpoint to the same user-facing error, so
it stays correct if the server picks a different code for that case.

The CLI prints the server's message verbatim for those. That is safe: on a parse
failure the server renders an envelope diagnosis rather than the raw parser
error, which could otherwise quote data from the file being inspected. Credential
(`401`/`403`) and throttle (`429`) responses behave exactly as in the table
above.

## Rate limits

For client-side backoff. The CLI cannot see these counters; it only sees the
`429` and the `Retry-After` header.

Reference (`/api/x12`):

```
+----------------------+----------------+
| Scope                | Limit          |
+----------------------+----------------+
| Per API key          | 60 / minute    |
| Per API key          | 1,000 / day    |
| Per IP               | 90 / minute    |
| Per IP               | 10,000 / day   |
+----------------------+----------------+
```

Inspection (`/api/edi/inspect`) is throttled harder, because each request parses
a whole document:

```
+----------------------+----------------+
| Scope                | Limit          |
+----------------------+----------------+
| Per API key          | 30 / minute    |
| Per API key          | 1,000 / day    |
| Per IP               | 45 / minute    |
| Per IP               | 2,000 / day    |
+----------------------+----------------+
```

The per-IP layers sit deliberately above the per-key ones, so a well-behaved
caller hits its own credential limit first and a shared NAT does not punish it
for someone else's traffic. (There is also a per-session limit; it never applies
to the CLI, which sends no cookies.) The per-key inspection limits are tunable
server-side, so treat the numbers as indicative and branch on the `429`.

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

## Not available yet (do not build against)

- A `whoami` / identity endpoint for an API-key principal. It does not exist yet;
  it is deferred auth work. When built it will live in the platform's `Platform`
  API namespace and return principal metadata only (organization, scope,
  service-terms state, key label). Until then, validate a key by making a real
  request and reading the status code, not by calling `whoami`.
- Any control-plane or data-plane endpoints (connections, partners, mappings,
  flows, transmissions). The command grammar in `BRIEF.md` sketches these, but
  they are not built.
- The JSON `index`/`show`, `search`, and `favourites` actions under this
  namespace are web-app internals; the CLI does not use them.
