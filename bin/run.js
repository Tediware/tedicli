#!/usr/bin/env node

// Fail fast with a readable message on unsupported Node versions. This check must
// run BEFORE @oclif/core is imported: its dependency tree uses syntax newer than
// our floor (e.g. `??=`, Node 15+) that throws a cryptic SyntaxError at parse time
// on old runtimes. A static `import` would load that tree before any code here runs,
// so oclif is loaded via the dynamic import below, only after the check passes.
// Keep this file parseable on very old Node: no top-level await, no `??`/`??=`.
const [major, minor] = process.versions.node.split('.', 2).map(Number)
if (major < 18 || (major === 18 && minor < 19)) {
  process.stderr.write(
    'tedi requires Node.js 18.19 or newer, but found ' + process.version + '.\n' +
      'Upgrade Node (with nvm: `nvm install 20 && nvm use 20`), then reinstall:\n' +
      '  npm install -g @tediware/tedi\n',
  )
  process.exit(1)
}

// The shipped CLI is always compiled JS, so it must never try to auto-transpile
// from TypeScript source. Without this, a user's `NODE_ENV=development` (or `test`)
// makes oclif hunt for `typescript` and print a "Could not find typescript" warning
// before falling back to dist/. Disabling it here (oclif reads `globalThis.oclif`)
// keeps the production entry quiet. `bin/dev.js` intentionally leaves it on.
globalThis.oclif = globalThis.oclif || {}
globalThis.oclif.enableAutoTranspile = false

// The daily new-version notice is a line for a person at a terminal. Under
// --json it would sit beside the output a script parses, inside `mcp serve`
// stdout is MCP messages only, and on a stderr that is not a terminal it is
// noise in a log. The check plugin honors this variable, and setting it here,
// before oclif loads any plugin, is the one place that cannot race its hook.
var argv = process.argv.slice(2)
if (argv.indexOf('--json') !== -1 || (argv[0] === 'mcp' && argv[1] === 'serve') || !process.stderr.isTTY) {
  process.env.TEDI_SKIP_NEW_VERSION_CHECK = '1'
}

import('@oclif/core').then((oclif) => oclif.execute({dir: import.meta.url}))
