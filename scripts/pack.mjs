#!/usr/bin/env node
// Packs dist/ into an .ehpk. The committed app.json only whitelists generic origins (any Tailscale
// HTTPS host). With --personal, the origins in .env.personal.local's VITE_T3_CANDIDATES are added too, so your
// own machines' addresses never need to be committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const personal = process.argv.includes('--personal')
const manifest = JSON.parse(readFileSync('app.json', 'utf8'))
const network = manifest.permissions.find(p => p.name === 'network')

if (personal && existsSync('.env.personal.local')) {
  const line = readFileSync('.env.personal.local', 'utf8').split('\n').find(l => l.startsWith('VITE_T3_CANDIDATES='))
  const origins = (line?.split('=')[1] ?? '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean)
  // Requests use http(s); live updates use the matching ws(s) origin.
  const all = origins.flatMap(o => [o, o.replace(/^http/, 'ws')])
  network.whitelist = [...new Set([...network.whitelist, ...all])]
}

mkdirSync('build', { recursive: true })
writeFileSync('build/app.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(`whitelist (${personal ? 'personal' : 'public'}):`, network.whitelist.join(' '))
// What the store review checks: nothing in the bundle may name a URL outside the whitelist.
execFileSync('node', ['scripts/check-urls.mjs', 'build/app.json', 'dist'], { stdio: 'inherit' })
execFileSync('npx', ['evenhub', 'pack', 'build/app.json', 'dist', '-o', 't3-g2.ehpk'], { stdio: 'inherit' })
