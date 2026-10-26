import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync('app.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const network = manifest.permissions.find((p: { name: string }) => p.name === 'network')

/** The Even Hub store review rules we can check locally, plus guards so personal addresses never ship. */
describe('app.json (store rules)', () => {
  it('has a valid package id: reverse-domain, lowercase, no hyphens, 2+ segments', () => {
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  })
  it('has a name of at most 20 characters that does not contain "Even"', () => {
    expect(manifest.name.length).toBeLessThanOrEqual(20)
    expect(manifest.name.toLowerCase()).not.toContain('even')
  })
  it('uses plain x.y.z versions that match package.json', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.version).toBe(pkg.version)
  })
  it('declares the current edition and an SDK floor that matches the installed SDK', () => {
    expect(manifest.edition).toBe('202601')
    const sdk = JSON.parse(readFileSync('node_modules/@evenrealities/even_hub_sdk/package.json', 'utf8')).version
    expect(manifest.min_sdk_version).toBe(sdk)
  })
  it('describes every permission in 1 to 300 characters', () => {
    for (const p of manifest.permissions) {
      expect(p.desc.length).toBeGreaterThan(0)
      expect(p.desc.length).toBeLessThanOrEqual(300)
    }
  })
  it('only asks for permissions the app uses', () => {
    expect(manifest.permissions.map((p: { name: string }) => p.name).sort()).toEqual(['g2-microphone', 'network'])
    const source = readFileSync('src/glasses/controller.ts', 'utf8')
    expect(source).toContain('AudioInputSource.Glasses')
  })
})

describe('public network whitelist', () => {
  it('is only secure origins', () => {
    for (const origin of network.whitelist) expect(origin).toMatch(/^(https|wss):\/\//)
  })
  it('names no machine, hostname or IP address', () => {
    for (const origin of network.whitelist) {
      expect(origin).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
      expect(new URL(origin.replace(/^wss/, 'https')).hostname).toMatch(/^\*\.[a-z.]+$/)
    }
  })
})
