export interface PairingTarget {
  origin: string
  credential: string
}

/** Accepts a full `https://host/pair#token=…` link, or a host plus a bare pairing code. */
export function parsePairing(host: string, code = ''): PairingTarget {
  const raw = host.trim()
  if (!raw) throw new Error('Enter your T3 server address.')
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('That server address is not a valid URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http(s) address.')

  const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get('token')
  const credential = (fromHash ?? url.searchParams.get('token') ?? code).trim()
  if (!credential) throw new Error('Enter the pairing code, or paste the full pairing link.')
  return { origin: url.origin, credential }
}
