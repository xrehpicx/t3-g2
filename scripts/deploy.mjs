#!/usr/bin/env node
// Uploads t3-g2.ehpk to Even Hub as a new private build, once per version.
//
// It only uploads. Promoting to beta, submitting for review and publishing stay in the developer
// portal on purpose: a published version is permanent.
//
// Needs Even credentials in $XDG_CONFIG_HOME/evenhub/credentials.yaml (see the README).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('app.json', 'utf8'))
const pkg = manifest.package_id
const version = manifest.version
const changelog = (process.env.CHANGELOG || `Release ${version}`).split('\n')[0].slice(0, 500)

const run = args => {
  const result = spawnSync('npx', ['--no-install', 'evenhub', ...args, '--json'], { encoding: 'utf8' })
  let body = {}
  try { body = JSON.parse(result.stdout || '{}') } catch { /* diagnostics are on stderr */ }
  return { code: result.status ?? 1, body, stderr: result.stderr }
}
const fail = (message, code = 1) => { console.error(`::error::${message}`); process.exit(code) }

const ls = run(['ls', pkg])
if (ls.code === 2) fail('Even Hub credentials expired. Run `evenhub login` locally and replace the EVENHUB_CREDENTIALS secret.')
if (ls.code !== 0) fail(`Could not list builds: ${ls.body.message ?? ls.stderr}`)
if ((ls.body.versions ?? []).some(v => v.version === version)) {
  console.log(`::notice::Version ${version} is already on Even Hub. Bump "version" in app.json and package.json to ship a new build.`)
  process.exit(0)
}

console.log(`Uploading ${pkg} ${version}: ${changelog}`)
const up = run(['upload', 't3-g2.ehpk', '-m', changelog, '--package-id', pkg])
switch (up.code) {
  case 0: console.log(`::notice::Uploaded ${version} as a private build. Install it from the Even app, then submit it for review in the portal when ready.`); break
  case 4: console.log(`::notice::Version ${version} was uploaded by another run.`); break
  case 2: fail('Even Hub credentials expired. Run `evenhub login` locally and replace the EVENHUB_CREDENTIALS secret.')
  default: fail(`Upload failed (exit ${up.code}): ${up.body.message ?? up.stderr} ${up.body.hint ?? ''}`)
}
