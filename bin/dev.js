#!/usr/bin/env node
// Development entrypoint: runs commands straight from TypeScript source via tsx,
// so there's no build step in the inner dev loop. `bin/run.js` is the shipped entry.

import {execute} from '@oclif/core'

// The daily new-version notice is a line for a person at a terminal. Under
// --json it would sit beside the output a script parses, inside `mcp serve`
// stdout is MCP messages only, and on a stderr that is not a terminal it is
// noise in a log. The check plugin honors this variable, and setting it here,
// before oclif loads any plugin, is the one place that cannot race its hook.
const argv = process.argv.slice(2)
if (argv.indexOf('--json') !== -1 || (argv[0] === 'mcp' && argv[1] === 'serve') || !process.stderr.isTTY) {
  process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
}

await execute({development: true, dir: import.meta.url})
