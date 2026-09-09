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

## Exit codes

Every command uses the same three-way split. Branch on it.

```
0   ran to completion, nothing to report
1   a real answer that is a finding: errors in a document, a code that does not exist
2   did not run, or the result cannot be trusted: nothing was learned
```

`2` is never a pass. It covers a mistyped flag, no key, rate limiting, a server
fault, a network failure, a server too old to know an endpoint, and an
inspection the server reports as incomplete. A data-plane `404` is exit `1`
("not found") only when the server says so in the body; a bare routing `404`
exits `2`, so a stale server cannot tell you that an existing record is missing.

`edi inspect` writes a one-line finding count to stderr regardless of where
stdout goes, so a redirected report still explains its exit code.

## Local versus networked

| Command                                     | Where it runs                     |
| ------------------------------------------- | --------------------------------- |
| `edi obfuscate`                             | Local. No key. Nothing sent.      |
| `edi inspect`                               | Uploads the file (scrubbed first by default). |
| `x12 *`                                     | Server lookup.                    |
| `transaction`, `result`, `feed`, `artifact` | Server, your organization's data. |
| `partner send`, `partner receive`           | Server, and the document is delivered or processed. |
| `mcp serve`                                 | Forwards to the server. No tool logic locally. |

Each command's `--help` states this too.

## Scrub before anything leaves the machine

An EDI file usually carries personal data. The default workflow is:

```bash
tedi edi obfuscate claims.edi -o clean.edi
```

then work with `clean.edi` everywhere: pasting into a ticket, sending to a
partner for debugging, or reading it into your own context. The scrub is
format-preserving (delimiters, lengths, control numbers, code values and
business identifiers survive) and it preserves faults, so the scrubbed file
still reproduces the problem. `edi inspect` runs the same scrub by default
before uploading; `--no-obfuscate` sends the file verbatim.

The scrub is best-effort, not a certified de-identification. Free-text
segments deserve a look before sharing.

## Output

- `--json` is offered on every command that returns your own organization's
  data (`transaction`, `result`, `feed`, `artifact get` excepted since its
  payload is raw bytes, `partner`, `whoami`). `feed list --follow --json`
  emits JSONL, one entry per line, since the stream never ends.
- `--json` is not offered on `x12` or `edi inspect`. The X12 standard is
  licensed and served as presentation only: `--format console` (default) or
  `--format markdown`. Passing `--json` there prints an explanation and exits
  `2`. Do not work around it by scraping; the reference tools on the MCP server
  behave the same way and return the same rendered page.
- Color and interactive truncation switch off when stdout is not a terminal, so
  piped output is complete and clean. `NO_COLOR` and `--no-color` also work.
- `-` reads stdin where a file is expected; `-o <path>` writes a file instead
  of stdout.

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

Diagnosing a transaction that went wrong:

```bash
tedi transaction get <id> --json      # envelope, status, artifacts on the trace
tedi transaction logs <id>            # the trace's processing logs, oldest first
tedi artifact get <artifact-id> -o document.edi
```

## MCP

`tedi mcp serve` is a stdio bridge to the platform's Model Context Protocol
server. It holds no tool logic and forwards every request, so the server's own
instructions and tool list are authoritative. Register it with the host once:

```bash
claude mcp add tediware -- tedi mcp serve
```

It uses the stored key or `TEDI_API_KEY`, and it is metered into the same rate
limits as the CLI commands, so calling a tool and running the equivalent
command draw from one allowance.
