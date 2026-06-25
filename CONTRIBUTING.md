# Contributing to tedi

Thanks for your interest in improving the Tediware CLI.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. Every commit must be signed off, certifying that you wrote the
patch or otherwise have the right to submit it under the project's license.

Add a `Signed-off-by` line to each commit:

```
git commit -s -m "your message"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

CI verifies that every commit in a pull request carries this line.

## The one hard rule: no licensed X12 data, ever

**Never commit licensed X12 reference data to this repository.** This includes
test fixtures, recorded API responses, and snapshot output. Tests must use
synthetic or mocked data only.

A CI tripwire (`npm run check:licensed-data`) scans tracked files for content
that looks like real reference data and fails the build if it finds any. If you
are adding a genuinely synthetic data file that trips the heuristic, add the
marker `tedi:synthetic-data-ok` to the file. The marker bypasses the density
heuristic but never the publisher/copyright check.

Committing licensed data to a public repo is the single largest licensing risk
this project carries — larger than any code exposure. When in doubt, leave it out.

## Keeping the client thin

`tedi` is a thin client over the Tediware API. Proprietary logic and licensed
data live server-side, behind the API. Please keep new commands thin: relay to
the API rather than embedding platform logic or reference data in the client.

## Development

```bash
npm install
npm run build          # compile TypeScript to dist/
./bin/run.js --help    # run the built CLI
./bin/dev.js --help    # run straight from TypeScript source (no build step)
npm run lint           # type-check
npm test               # run tests
```

By default the CLI runs against a synthetic mock backend so it works without a
live server. Set `TEDI_API_MOCK=0` to target a real API base URL
(`tedi config set api.baseUrl ...`).
