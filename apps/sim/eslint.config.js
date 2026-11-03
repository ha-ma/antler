// React/RN feature-based architecture quality template (ESLint Flat Config).
// npm i -D eslint typescript-eslint eslint-plugin-import \
//   eslint-import-resolver-typescript \
//   eslint-plugin-react-hooks eslint-plugin-eslint-comments \
//   eslint-plugin-react-you-might-not-need-an-effect eslint-plugin-zustand-rules

import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import eslintComments from 'eslint-plugin-eslint-comments'
import youMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'
import zustandRules from 'eslint-plugin-zustand-rules'

const testFileGlobs = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**']

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: testFileGlobs,
    plugins: {
      import: importPlugin,
      'react-hooks': reactHooks,
      'eslint-comments': eslintComments,
      'react-you-might-not-need-an-effect': youMightNotNeedAnEffect,
      'zustand-rules': zustandRules,
    },
    settings: {
      // `@/` エイリアス import を no-restricted-paths zones で解決するために必須
      'import/resolver': {
        typescript: {},
      },
    },
    rules: {
      // ============================================
      // ERROR: 物理的に書けなくする（CI で落ちる）
      // ============================================

      // Zustand create() は features/{name}/store.ts 以外で禁止
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'zustand',
            message: 'zustand は src/features/{name}/store.ts でのみ import してください。他では store の export した hook を使う。',
          },
        ],
      }],

      // 依存方向: app -> features -> shared（逆流禁止）+ feature 内部への直接 import 禁止
      'import/no-restricted-paths': ['error', {
        zones: [
          {
            target: './src/shared/**',
            from: './src/features/**',
            message: 'shared から features への import は禁止（依存方向は app -> features -> shared）。',
          },
          {
            target: './src/shared/**',
            from: './src/app/**',
            message: 'shared から app への import は禁止。',
          },
          {
            target: './src/features/**',
            from: './src/app/**',
            message: 'features から app への import は禁止。',
          },
        ],
      }],

      // ESLint disable コメントには理由を必須化
      'eslint-comments/require-description': ['error', { ignore: [] }],

      // react-hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Zustand store 品質
      'zustand-rules/no-multiple-stores': 'error',
      'zustand-rules/enforce-slices-when-large-state': ['warn', { maxProperties: 5 }],
      'zustand-rules/use-store-selectors': 'warn',
      'zustand-rules/no-state-mutation': 'error',

      // ============================================
      // WARN: 気づかせる
      // ============================================

      'react-you-might-not-need-an-effect/no-derived-state': 'warn',
      'no-restricted-syntax': ['warn', {
        selector: 'CallExpression[callee.name="useEffect"]',
        message: 'useEffect は原則禁止。代替: TanStack Query(データ取得), useMemo(派生値), event handler(操作反応), key prop(リセット)。',
      }],
    },
  },
  // feature 間の直接 import 禁止（barrel 経由のみ）。
  // no-restricted-paths では「同 feature は許可、他 feature は index のみ」を
  // 表現できないため、パターンで内部パスを禁止する。
  {
    files: ['**/src/**'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'zustand',
            message: 'zustand は src/features/{name}/store.ts でのみ import してください。',
          },
        ],
        patterns: [
          {
            group: [
              '@/features/*/components/*',
              '@/features/*/hooks/*',
              '@/features/*/store',
              '@/features/*/store.*',
              '@/features/*/types',
              '**/features/*/components/*',
              '**/features/*/hooks/*',
            ],
            message: 'feature の内部ファイルへの直接 import は禁止。barrel（@/features/{name}）経由にしてください。同 feature 内は相対 import を使う。',
          },
        ],
      }],
    },
  },
  // store.ts では zustand の import を許可
  {
    files: ['**/src/features/*/store.ts', '**/src/features/*/store.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@/features/*/components/*', '@/features/*/hooks/*'],
            message: 'store から他 feature の内部への import は禁止。',
          },
        ],
      }],
    },
  },
  // テストファイルは緩和
  {
    files: testFileGlobs,
    rules: {
      'no-restricted-syntax': 'off',
      'react-you-might-not-need-an-effect/no-derived-state': 'off',
    },
  },
)
