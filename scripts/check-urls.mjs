#!/usr/bin/env node
// The Even Hub review rejects a build whose bundle mentions a URL that is not in app.json's network
// whitelist ("your bundle references some URLs that aren't in your network.whitelist"). Run this on
// dist/ before packing so that never reaches a reviewer.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync(process.argv[2] ?? 'build/app.json', 'utf8'))
const whitelist = manifest.permissions.find(p => p.name === 'network')?.whitelist ?? []
const dir = process.argv[3] ?? 'dist'

// "https://*.ts.net" allows any subdomain of ts.net; other entries match their host exactly.
const hosts = whitelist.map(entry => {
  const [, scheme, host] = /^(\w+):\/\/(.+)$/.exec(entry) ?? []
  return { scheme, wild: host?.startsWith('*.'), host: host?.replace(/^\*\./, '') }
})
const allowed = url => {
  const [, scheme, host] = /^(\w+):\/\/([^/:?#]+)/.exec(url) ?? []
  return hosts.some(h => h.scheme === scheme && (h.wild ? host.endsWith(`.${h.host}`) : host === h.host))
}
// XML namespaces are identifiers, not requests.
const NAMESPACE = /^https?:\/\/www\.w3\.org\//

const files = (d) => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]))
const found = new Map()
for (const file of files(dir).filter(f => /\.(js|css|html|json|map)$/.test(f) && !f.endsWith('.map'))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:https?|wss?):\/\/[^\s"'`)<>\\]*/g)) {
    const url = m[0]
    if (!NAMESPACE.test(url) && !allowed(url)) found.set(url, file)
  }
}
if (found.size) {
  console.error('The bundle references URLs outside the network whitelist (the store review rejects this):')
  for (const [url, file] of found) console.error(`  ${url}   (${file})`)
  process.exit(1)
}
console.log(`no URLs outside the whitelist (${whitelist.join(' ')})`)
