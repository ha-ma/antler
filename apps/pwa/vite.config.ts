import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { buildCsp } from './csp'

// 本番ビルドだけに CSP を入れる（開発中は React Refresh のインラインスクリプトが要るため）。
// 組み立ては csp.ts（テストできる純粋な関数）。接続先は Mac Mini の WebSocket（ch7「B WebSocket」）に加えて、
// edge-capture の走行後の送信のために edge の 8767 と VITE_API_BASE_URL のオリジン（あるときだけ）。
// edge のホストは VITE_EDGE_HOSTS（既定 ezoroad.local。車の AP の IP を足す。docs/specs/pwa-https R5）。
// フォントはオフライン用に同梱する（ch8 規約 4）。
function contentSecurityPolicy(): Plugin {
  let apiBaseUrl: unknown
  let edgeHosts: unknown
  return {
    name: 'antler-csp',
    apply: 'build',
    configResolved(config) {
      apiBaseUrl = config.env['VITE_API_BASE_URL']
      edgeHosts = config.env['VITE_EDGE_HOSTS']
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: buildCsp(apiBaseUrl, edgeHosts),
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', '**/*.test.{ts,tsx}'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
})
