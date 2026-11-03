import { defineConfig } from 'vitest/config'

// packages/* をまとめて検査する。DOM が要るテスト（alert-ui）はファイル先頭で
// `// @vitest-environment jsdom` を指定する。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['*/src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '*/src/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
})
