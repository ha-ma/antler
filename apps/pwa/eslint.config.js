// antler の ESLint 設定（apps/sim・apps/pwa）。scripts/templates/ が正で、setup-from-amptech.sh が配る。
// Amptech の React 設定（eslint.amptech.config.js。直接直さない）に、/sfad init の lint 要件を足す:
// console 出力・any・未使用・空 catch の禁止、jsx-a11y。
import jsxA11y from 'eslint-plugin-jsx-a11y'
import amptech from './eslint.amptech.config.js'

export default [
  { ignores: ['dist/', 'coverage/'] },
  ...amptech,
  { files: ['src/**/*.{ts,tsx}'], ...jsxA11y.flatConfigs.recommended },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
]
