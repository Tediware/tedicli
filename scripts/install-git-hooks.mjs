#!/usr/bin/env node
/**
 * Point this clone's core.hooksPath at the tracked .githooks/ directory, so the
 * pre-push `npm audit` gate is active after a plain `npm install`. Runs from the
 * `prepare` script.
 *
 * Deliberately quiet and non-fatal outside a maintainer clone: `prepare` also
 * runs in CI and before `npm pack`, and this package directory may not be a git
 * checkout at all (or may sit inside some other repository, whose config must
 * not be touched). An existing, different core.hooksPath is left alone with a
 * warning rather than overwritten.
 */
import {execFileSync} from 'node:child_process'
import {realpathSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const HOOKS_PATH = '.githooks'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
}

let top
try {
  top = git(['rev-parse', '--show-toplevel'])
} catch {
  process.exit(0) // not a git checkout (or no git): nothing to install
}
if (realpathSync(top) !== realpathSync(root)) process.exit(0)

let current = ''
try {
  current = git(['config', '--local', '--get', 'core.hooksPath'])
} catch {
  // unset
}

if (current === HOOKS_PATH) process.exit(0)
if (current !== '') {
  console.warn(
    `install-git-hooks: core.hooksPath is already "${current}"; leaving it. ` +
      `The pre-push npm audit gate lives in ${HOOKS_PATH}/pre-push.`,
  )
  process.exit(0)
}

git(['config', '--local', 'core.hooksPath', HOOKS_PATH])
console.log(`install-git-hooks: core.hooksPath set to ${HOOKS_PATH} (pre-push runs npm audit).`)
