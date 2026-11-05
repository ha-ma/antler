// deploy-a（Vercel）のテストの部品。本番の DI では使わない。
// Vercel の組み立ては env の file: を拒むので、DB と画像の置き場所は di の差し込み口（vercelPlatform の overrides）から渡す。

import { join } from 'node:path'
import { openDatabase, type Connection } from '../../src/infrastructure/db/connection.js'
import { ensureSchema } from '../../src/infrastructure/db/migrate.js'
import type { CaptureImageStore } from '../../src/infrastructure/repositories/vercel-blob-image-store.js'

/** Vercel の関数が受ける env（値はすべてテスト用。本物の秘密ではない） */
export const VERCEL_SOURCE: Record<string, string> = {
  NODE_ENV: 'production',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  OWNER_TOKEN_SECRET: 'test-owner-token-secret-0123456789abcdef',
  TRIPS_DB_URL: 'libsql://antler-preview-test.turso.io',
  TURSO_AUTH_TOKEN: 'test-turso-token',
  BLOB_READ_WRITE_TOKEN: 'test-blob-token',
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'antler-abc123.vercel.app',
  VERCEL_BRANCH_URL: 'antler-git-feat-deploy-a.vercel.app',
}

export class FakeImageGateway implements CaptureImageStore {
  readonly images = new Map<string, { bytes: Uint8Array; contentType: string }>()
  puts = 0
  failPut = false

  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.puts += 1
    if (this.failPut) return Promise.reject(new Error('blob unavailable'))
    this.images.set(pathname, { bytes, contentType })
    return Promise.resolve()
  }
}

/** file の SQLite を開く（migrate = true なら表と版を作る） */
export async function openTestDb(dir: string, name: string, migrate = true): Promise<Connection> {
  const connection = openDatabase(`file:${join(dir, name)}`)
  if (migrate) await ensureSchema(connection.client)
  return connection
}
