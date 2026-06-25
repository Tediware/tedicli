#!/usr/bin/env node
// Development entrypoint: runs commands straight from TypeScript source via tsx,
// so there's no build step in the inner dev loop. `bin/run.js` is the shipped entry.

import {execute} from '@oclif/core'

await execute({development: true, dir: import.meta.url})
