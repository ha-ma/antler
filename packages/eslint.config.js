// antler の ESLint 設定（packages/*）。Amptech に該当する stack が無いので antler が持つ。
// /sfad init の lint 要件: console 出力・any・未使用・空 catch の禁止、jsx-a11y（alert-ui）。
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/', '**/coverage/', 'eslint.config.js', 'vitest.config.ts'] },
  ...tseslint.configs.recommended,
  { files: ['*/src/**/*.tsx'], ...jsxA11y.flatConfigs.recommended },
  {
    files: ['*/src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
)
