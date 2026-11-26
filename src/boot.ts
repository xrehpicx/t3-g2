/** What the page URL may do at startup. A packed build ignores all of it. */
export interface BootActions {
  reset: boolean
  defaults: boolean
  pair: { server: string; token: string } | null
  demo: boolean
  showcase: boolean
  perModelOff: boolean
  startPage: string | null
  openId: string | null
}

const NONE: BootActions = {
  reset: false,
  defaults: false,
  pair: null,
  demo: false,
  showcase: false,
  perModelOff: false,
  startPage: null,
  openId: null,
}

/**
 * `#reset`, `#server`, `#token`, `#demo` and the screenshot flags are dev-server conveniences.
 * `vite build` leaves `dev` false, so a packed app cannot be pointed at another server by its URL.
 */
export function readBootHash(hash: string, dev: boolean): BootActions {
  if (!dev) return NONE
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const server = params.get('server')
  const token = params.get('token')
  return {
    reset: params.has('reset'),
    defaults: params.has('defaults'),
    pair: server && token ? { server, token } : null,
    demo: params.has('demo'),
    showcase: params.has('showcase'),
    perModelOff: params.get('permodel') === 'off',
    startPage: params.get('page'),
    openId: params.get('open'),
  }
}
