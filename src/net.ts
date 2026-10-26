/**
 * The Even SDK swaps window.fetch for a native bridge inside the Even app. Outside it (simulator,
 * desktop browser) the original browser transport is what works, so capture it before the SDK loads.
 */
export interface Net {
  fetch: typeof fetch
  WebSocket: typeof WebSocket
  inEven: boolean
}

const original = {
  fetch: window.fetch.bind(window),
  WebSocket: window.WebSocket,
}

export function resolveNet(): Net {
  const inEven = Boolean((window as unknown as { flutter_inappwebview?: { callHandler?: unknown } }).flutter_inappwebview?.callHandler)
  if (inEven) return { fetch: window.fetch.bind(window), WebSocket: window.WebSocket, inEven }
  window.fetch = original.fetch
  return { ...original, inEven }
}
