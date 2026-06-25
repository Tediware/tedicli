# tedi

The official command-line client for the [Tediware](https://tediware.com) platform.

`tedi` is a thin client over the Tediware API — no proprietary logic and no
licensed data live in the CLI. Its first capability is **X12 reference lookup**,
and it is built to grow into a control-plane companion for the platform.

## Install

```bash
npm install -g @tediware/tedi
```

## Quick start

```bash
tedi auth login            # authenticate in the browser (device flow)
tedi x12 segment N1        # look up an X12 segment
tedi x12 transaction 856   # look up a transaction set
tedi x12 element 235       # look up an element and its code list
```

## Authentication

All commands require a Tediware API key.

```bash
tedi auth login            # browser device flow: signup, EULA consent, key issuance
tedi auth login --key ...  # stopgap: store a pre-issued key (signup + EULA on the web first)
tedi auth status           # show whether you're signed in
tedi whoami                # show the authenticated identity
tedi auth logout           # clear stored credentials
```

Credentials are stored in a permissioned file in the CLI config directory today;
OS-keychain storage is a planned drop-in. X12 reference access additionally
requires that your account has accepted the current Tediware service terms; the
server enforces this on every request.

## X12 reference

```bash
tedi x12 segment <id>        # e.g. tedi x12 segment N1
tedi x12 transaction <id>    # e.g. tedi x12 transaction 856  (SH856 also accepted)
tedi x12 element <id>        # e.g. tedi x12 element 66
tedi x12 releases            # list supported X12 releases
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

## Configuration

```bash
tedi config list                       # show all config values and their sources
tedi config get x12.release
tedi config set x12.release 005010
```

| Key           | Env override          | Default                     |
| ------------- | --------------------- | --------------------------- |
| `x12.release` | `TEDI_X12_RELEASE`    | `004010`                    |
| `api.baseUrl` | `TEDI_API_BASE_URL`   | `https://api.tediware.com`  |

The config directory can be relocated with `TEDI_CONFIG_DIR`.

## Updating

```bash
tedi update
```

The CLI checks for updates in the background (throttled, cached) and shows a
non-interrupting nudge when a newer version is available.

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

By default the CLI runs against a synthetic mock backend, so a fresh checkout is
fully runnable without a live server. Set `TEDI_API_MOCK=0` to target a real API.

> **Note:** the mock backend's reference content is synthetic placeholder data for
> development only. It is not licensed X12 reference content.

## Contributing

Contributions are welcome under the [DCO](https://developercertificate.org/) —
sign commits with `git commit -s`. See [CONTRIBUTING.md](./CONTRIBUTING.md).

**One hard rule: never commit licensed X12 data** (including test fixtures and
recorded responses). A CI tripwire guards against it.

## License

[Apache-2.0](./LICENSE).
