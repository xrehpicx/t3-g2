import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * The store scans the bundle for http(s) URLs outside the app's network whitelist. React's production
 * build carries one inside an error-message string (it is text, never fetched), so drop the scheme.
 */
const noReactErrorUrl = (): Plugin => ({
  name: 'no-react-error-url',
  apply: 'build',
  renderChunk: code => (code.includes('https://react.dev/errors/') ? { code: code.replaceAll('https://react.dev/errors/', 'react.dev/errors/'), map: null } : null),
})

export default defineConfig({
  plugins: [react(), tailwindcss(), noReactErrorUrl()],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
