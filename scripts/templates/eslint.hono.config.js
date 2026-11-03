// antler の ESLint 設定（apps/api）。scripts/templates/ が正で、setup-from-amptech.sh が配る。
// Amptech の Hono 設定（eslint.amptech.config.js。直接直さない）に、/sfad init の lint 要件を足す:
// console 出力の禁止（ログは infrastructure/logging の logger だけ）・未使用・空 catch の禁止。
import amptech from './eslint.amptech.config.js'

export default [
  { ignores: ['dist/', 'coverage/', 'eslint.*.js', 'vitest.config.ts'] },
  ...amptech,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
]
