import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    // DayPlan（同梱のルートと鹿ゾーンの計算）を何度も作るテストがある（brief-map・stop-events）。
    // 並列で走らせると既定の 5 秒を越えることがあるので広げる（2026-11-04、stop-events）
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', '**/*.test.ts'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
})
