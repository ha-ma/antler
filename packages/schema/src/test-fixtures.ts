import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// packages/schema/fixtures/ の見本を読む（テスト専用。TS と edge の Python が同じ見本を使う）。
// index.ts からは export しない。

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures',
)

export type Fixture = { name: string; value: unknown }

export function loadFixtures(kind: string, validity: 'valid' | 'invalid'): Fixture[] {
  const dir = path.join(FIXTURES_DIR, kind, validity)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.json$/, ''),
      value: JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as unknown,
    }))
}

export function loadFixture(kind: string, validity: 'valid' | 'invalid', name: string): unknown {
  const found = loadFixtures(kind, validity).find((f) => f.name === name)
  if (!found) throw new Error(`見本がありません: ${kind}/${validity}/${name}`)
  return structuredClone(found.value)
}
