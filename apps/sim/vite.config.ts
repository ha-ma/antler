import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// 本番ビルドだけに CSP を入れる（開発中は React Refresh のインラインスクリプトが要るため）。
// API の接続先は VITE_API_BASE_URL（.env.example）。フォントは Google Fonts（ch8 規約 4）。
// 地図の背景（brief-map）は VITE_MAP_STYLE_URL の origin（既定は OpenFreeMap）からスタイル・タイル・文字を fetch する。
// MapLibre のワーカーはバンドルの同じ origin のファイル（worker-src 'self'）、画像は blob で描く。
function mapOrigin(): string {
  const style =
    process.env['VITE_MAP_STYLE_URL']?.trim() || 'https://tiles.openfreemap.org/styles/positron'
  return style === 'off' ? '' : new URL(style).origin
}

function contentSecurityPolicy(): Plugin {
  const api = process.env['VITE_API_BASE_URL'] ?? ''
  const map = mapOrigin()
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    `img-src 'self' data: blob: ${map}`.trim(),
    `connect-src 'self' ${api} ${map}`.replace(/\s+/g, ' ').trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
  return {
    name: 'antler-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
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
    // 手元の .env.local（VITE_API_BASE_URL=http://localhost:8787 など）にテストを左右させない。
    // 接続先を変えて確かめるテストは vi.stubEnv で上書きする
    env: { VITE_API_BASE_URL: '' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/main.tsx', '**/*.test.{ts,tsx}'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
})
