import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Deux pages : la landing (index.html) et le bot trading (trading.html)
      input: {
        main: page('./index.html'),
        trading: page('./trading.html'),
      },
    },
  },
  server: {
    proxy: {
      // En dev local, /api/market (fonction Vercel) n'existe pas :
      // on proxifie directement vers Yahoo Finance.
      '/api/market': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => {
          const url = new URL(path, 'http://localhost')
          const symbol = url.searchParams.get('symbol') ?? 'SPY'
          const range = url.searchParams.get('range') ?? '2y'
          return `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
        },
      },
    },
  },
})
