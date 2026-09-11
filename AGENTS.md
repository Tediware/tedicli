# tedi for agents

`tedi` is a thin command-line client over the Tediware API. This file is the
interface contract an automated caller, whether a CI job or a coding agent,
needs in order to drive it without guessing. Nothing here is about the content
the commands return; `tedi <command> --help` describes each command.

## Authentication

- `TEDI_API_KEY` in the environment is enough. No login step, no config file.
- The key is never passed as a flag, so it cannot leak into shell history or a
  process listing. Do not try `--api-key`; it does not exist.
- `tedi whoami` validates a key and reports its organization, scope, and
  service-terms state without spending reference quota. Run it first when a key
  is of unknown provenance.
- A sandbox key answers `whoami` but is refused by the org-wide data commands
  and by `tedi mcp serve`. The refusal names the reason.
- `tedi auth status` says whether a key is present and where it came from
  (stored or `TEDI_API_KEY`); it exits 2 when none is.
- `--profile <name>` selects a config and credential set under
  `~/.tedi-profiles/<name>`, for switching servers.

## Exit codes

Every command uses the same three-way split. Branch on it.

```
0   ran to completion, nothing to report
1   a real answer that is a finding: errors in a document, a code that does not exist
2   did not run, or the result cannot be trusted: nothing was learned
```

`2` is never a pass. It covers a mistyped flag, no key, rate limiting, a server
fault, a network failure, a server too old to know an endpoint, an inspection
the server reports as incomplete, and anything unanticipated (one line, no
stack). A data-plane `404` is exit `1` ("not found") only when the server says
so in the body; a `404` without the platform's JSON shape is "no such endpoint"
and exits `2`, so a wrong `api.baseUrl` cannot tell you that an existing record
is missing. "Not an X12 interchange" is exit `1` on every path.

Under `--json`, an error is JSON on stdout in one shape:
`{"error": {"message", "code", "suggestions", "exitCode"}}`, with the server's
`code` carried through when the failure was its refusal. Parse one thing.

`edi inspect` writes a one-line finding count with the exit reason to stderr on
every run, regardless of where stdout goes, so a redirected report still
explains its exit code.

## Local versus networked

| Command                                     | Where it runs                     |
| ------------------------------------------- | --------------------------------- |
| `edi obfuscate`                             | Local. No key. Nothing sent.      |
| `edi inspect`                               | Uploads the file (scrubbed first by default). |
| `x12 *`                                     | Server lookup.                    |
| `transaction`, `result`, `feed`, `artifact`, `trace`, `partner list`, `partner get` | Server, your organization's data. |
| `partner send`, `partner receive`, `transaction resend` | Server, and the document is delivered or processed. |
| `mcp serve`                                 | Forwards to the server. No tool logic locally. |
| `whoami`, `auth login`, `auth status`       | Server. `auth status` reads only the key's label and degrades without it. |
| `config`, `auth logout`                     | Local. Nothing is sent.           |

The first line of each command's `--help` states this too.

## Scrub before anything leaves the machine

An EDI file usually carries personal data. The default workflow is:

```bash
tedi edi obfuscate claims.edi -o clean.edi
```

then work with `clean.edi` everywhere: pasting into a ticket, sending to a
partner for debugging, or reading it into your own context. The scrub is
format-preserving (delimiters, lengths, control numbers, code values and
business identifiers survive) and it preserves faults, so the scrubbed file
still reproduces the problem. Its defaults follow the document family:
healthcare documents scrub fully; supply-chain ones keep business parties,
their addresses and free text. `--scrub-parties` (drop-ship consumers in N1
ST/BT) and `--scrub-text` move the line. `edi inspect` runs the same scrub by
default before uploading; `--no-obfuscate` sends the file verbatim.

The scrub is best-effort, not a certified de-identification. Free-text
segments deserve a look before sharing.

## Output

- `--json` is offered on every command that returns your own organization's
  data (`transaction`, `result`, `feed`, `trace`, `partner`, `whoami`, and
  `artifact get` excepted since its payload is raw bytes) and on the local
  state commands (`config`, `auth status`) and `x12 releases`. It prints the
  server's response unchanged: lists are `{<collection>: [...], pagination:
  {hasMore, nextCursor}}`. `feed list --follow --json` emits JSONL, one entry
  per line, since the stream never ends.
- `--json` is not offered on `x12` or `edi inspect`. The X12 standard is
  licensed and served as presentation only: `--format console` (default) or
  `--format markdown`. Passing `--json` there prints an explanation and exits
  `2`. Do not work around it by scraping; the reference tools on the MCP server
  behave the same way and return the same rendered page.
- Color and interactive truncation switch off when stdout is not a terminal, so
  piped output is complete and clean. `NO_COLOR` and `--no-color` also work.
- `-` reads stdin where a file is expected, and so does omitting the file on a
  pipe; `-o <path>` writes a file instead of stdout, and `-o -` is stdout.
- Direction is `inbound|outbound` everywhere; `--set` is a transaction set;
  `--since` takes an ISO 8601 timestamp with a zone, a bare date, or `30m`,
  `2h`, `3d`. Timestamps print as `YYYY-MM-DD HH:MM:SSZ`.

## Pipeline

Inspect a file, branch on the exit code, act on the findings:

```bash
tedi edi obfuscate claims.edi -o clean.edi || exit 2
tedi edi inspect clean.edi --format markdown > report.md
case $? in
  0) echo "clean" ;;
  1) echo "findings:"; cat report.md ;;
  *) echo "inspection did not run; do not treat as a pass" >&2; exit 2 ;;
esac
```

Submitting a document and following it. Every receipt ends with the one
command to run next:

```bash
tedi partner get ACME                          # which sets it takes, and whether each is ready
tedi partner send ACME 856 shipment.json --wait   # exit 0 delivered, 1 on an error (printed), 2 on timeout
tedi trace <guid>                              # everything on the trace; poll until Processing is no
```

Diagnosing a transaction that went wrong:

```bash
tedi transaction get <id> --json      # envelope, status, acknowledgment, its own artifacts
tedi transaction logs --trace <guid>  # the trace's processing logs, oldest first
tedi artifact get <artifact-id> -o document.edi
```

## MCP

`tedi mcp serve` is a stdio bridge to the platform's Model Context Protocol
server. It holds no tool logic and forwards every request, so the server's own
instructions and tool list are authoritative. Register it with the host once:

```bash
claude mcp add tediware -- tedi mcp serve
```

The platform speaks MCP revision `2026-07-28`, which has no handshake, so the
bridge answers the `initialize`, `notifications/initialized` and `ping` calls
that current hosts still open with, and stamps the revision onto everything it
forwards; a host connects without knowing the server is newer than it is.

It uses the stored key or `TEDI_API_KEY`, and it is metered into the same rate
limits as the CLI commands, so calling a tool and running the equivalent
command draw from one allowance.
