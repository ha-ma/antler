// Hono Clean Architecture quality template.
// npm i -D eslint typescript-eslint eslint-plugin-import eslint-import-resolver-typescript

import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

const testFileGlobs = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**']

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: testFileGlobs,
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {},
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Layer direction: inner layers must not import outer layers.
      'import/no-restricted-paths': ['error', {
        zones: [
          {
            target: './src/domain/**',
            from: './src/application/**',
            message: 'domain must not import application (dependency points inward).',
          },
          {
            target: './src/domain/**',
            from: './src/infrastructure/**',
            message: 'domain must not import infrastructure.',
          },
          {
            target: './src/domain/**',
            from: './src/di/**',
            message: 'domain must not import di.',
          },
          {
            target: './src/application/**',
            from: './src/infrastructure/**',
            message: 'application must not import infrastructure. Depend on application/ports interfaces.',
          },
          {
            target: './src/application/**',
            from: './src/di/**',
            message: 'application must not import di.',
          },
          {
            target: './src/infrastructure/repositories/**',
            from: './src/infrastructure/gateways/**',
            message: 'repositories must not call gateways. UseCase orchestrates both.',
          },
          {
            target: './src/infrastructure/gateways/**',
            from: './src/infrastructure/repositories/**',
            message: 'gateways must not access repositories. UseCase orchestrates both.',
          },
        ],
      }],
    },
  },
  // domain is pure TypeScript: no framework/ORM/validation/crypto/SDK packages.
  {
    files: ['**/src/domain/**'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['hono', 'hono/*', '@hono/*', 'drizzle-orm', 'drizzle-orm/*', 'drizzle-zod', 'zod', 'bcryptjs', 'jsonwebtoken', 'jose', 'stripe', 'openai', '@aws-sdk/*', 'resend'],
            message: 'domain must be pure TypeScript with zero external dependencies.',
          },
        ],
      }],
    },
  },
  // application depends on domain + its own ports only.
  {
    files: ['**/src/application/**'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['hono', 'hono/*', '@hono/*', 'drizzle-orm', 'drizzle-orm/*', 'drizzle-zod', 'bcryptjs', 'jsonwebtoken', 'jose', 'stripe', 'openai', '@aws-sdk/*', 'resend'],
            message: 'application must not import framework/ORM/SDK packages. Define a port and implement it in infrastructure.',
          },
        ],
      }],
    },
  },
  // usecases additionally must not own HTTP contracts (zod) or call fetch.
  {
    files: ['**/src/application/usecases/**'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['hono', 'hono/*', '@hono/*', 'drizzle-orm', 'drizzle-orm/*', 'drizzle-zod', 'zod', 'bcryptjs', 'jsonwebtoken', 'jose', 'stripe', 'openai', '@aws-sdk/*', 'resend'],
            message: 'usecases must not import framework/ORM/zod/SDK packages. HTTP contracts live in infrastructure/http/schemas.',
          },
        ],
      }],
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.name="fetch"]',
        message: 'usecases must not call fetch directly. Depend on a Gateway port.',
      }],
    },
  },
  // HTTP layer must not touch the ORM directly.
  {
    files: ['**/src/infrastructure/http/**'],
    ignores: testFileGlobs,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['drizzle-orm', 'drizzle-orm/*', 'drizzle-zod'],
            message: 'HTTP layer must not import drizzle-orm. Data access goes through Repository via UseCase.',
          },
        ],
      }],
    },
  },
  // test files: relax strictness.
  {
    files: testFileGlobs,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
)
