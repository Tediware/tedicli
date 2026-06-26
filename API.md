# tedi CLI — API Surface

The HTTP contract the CLI consumes for the X12 reference feature. This is the
backing surface for `tedi x12 ...`; it is not a public product API. It is
reachable and stable enough to build the CLI against, but it is versioned with
the CLI, not published as a third-party API. Treat the CLI as the supported
interface and this document as the integration contract behind it.

See `BRIEF.md` for product intent, command grammar, and the licensing posture.

## Base

- All endpoints are under `<base>/api/x12`, where `<base>` is the Tediware host.
  Production is `https://tediware.com`. Local development runs on
  `http://localhost:5004`. The host is configurable in the CLI, defaulting to
  production.
- There is no version prefix in the path.
- All requests are `GET`.

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

## Rate limits

For client-side backoff. The CLI cannot see these counters; it only sees the
`429` and the `Retry-After` header.

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
