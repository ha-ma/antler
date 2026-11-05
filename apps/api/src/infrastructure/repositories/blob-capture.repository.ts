import { and, count, eq, sql, sum } from 'drizzle-orm'
import type {
  CaptureRepository,
  CaptureStats,
  CreateCaptureResult,
  ExistingCapture,
  NewStoredCapture,
} from '../../application/ports/repositories/capture.repository.js'
import {
  isStalePending,
  stalePendingBefore,
} from '../../domain/captures/policies/capture-claim-policy.js'
import { imageExtension } from '../../domain/captures/policies/capture-identity-policy.js'
import { CAPTURE_KEY_PATTERN } from '../../domain/captures/rules/capture-rules.js'
import type { Database } from '../db/connection.js'
import { storedCaptures } from '../db/schema.js'
import type { CaptureImageStore } from './vercel-blob-image-store.js'

// CaptureRepository の Vercel の実装（docs/specs/deploy-a/functional.md R9、resilience.md）。
// 画像は Vercel Blob（非公開。CaptureImageStore）、本文・本文のハッシュ・数えは Turso の captures。
// 画像の置き場所は Capture の永続化の一部（FileCaptureRepository が画像を fs に書くのと同じ）で、Repository の中に閉じる。
// 順番（行を先に取る。plan-trip の trip_requests と同じ形。spec-adversary W1）:
//   1. 行を pending で取る（新しく入れる、または古い pending を引き継ぐ。古さは domain の isStalePending）。取れなければ exists
//   2. 画像を置く。失敗したら自分の pending の行を消して例外
//   3. 行を done にする（自分が取った updated_at のときだけ。引き継がれていたら例外）
// 行を取れない間は画像を置かない（INSERT が失敗し続けても Blob が増えない）。stats は pending も数える。
// ファイルの実装と違い、画像の名前は sha256 の全桁（中身が違う画像が同じ名前にならない。上書きしても同じ中身）。

export const CAPTURE_IMAGE_PREFIX = 'captures/images/'

function assertKey(key: string): void {
  // 置き場所の名前に使う前に必ず通す（.. や / を通さない）
  if (!CAPTURE_KEY_PATTERN.test(key)) throw new Error('invalid capture key')
}

export function blobImagePath(item: Pick<NewStoredCapture, 'key' | 'image'>): string {
  return `${CAPTURE_IMAGE_PREFIX}${item.key}-${item.image.sha256}.${imageExtension(item.image.format)}`
}

const contentType = (format: NewStoredCapture['image']['format']): string =>
  format === 'jpeg' ? 'image/jpeg' : 'image/png'

export type BlobCaptureRepositoryDeps = {
  db: Database
  images: CaptureImageStore
  /** 時計（ミリ秒）。古い pending の判断に使う */
  nowMs: () => number
}

export class BlobCaptureRepository implements CaptureRepository {
  constructor(private readonly deps: BlobCaptureRepositoryDeps) {}

  async create(item: NewStoredCapture): Promise<CreateCaptureResult> {
    assertKey(item.key)
    const { db, images, nowMs } = this.deps
    const file = blobImagePath(item)
    const claimedAt = nowMs()
    const row = {
      key: item.key,
      status: 'pending' as const,
      capture: item.capture,
      file,
      bodyHash: item.bodyHash,
      imageBytes: item.image.bytes.byteLength,
      receivedAt: item.receivedAt,
      updatedAt: claimedAt,
    }

    // 1. 行を取る。既にある行は、古い pending のときだけ引き継ぐ
    const claimed = await db
      .insert(storedCaptures)
      .values(row)
      .onConflictDoUpdate({
        target: storedCaptures.key,
        set: {
          capture: item.capture,
          file,
          bodyHash: item.bodyHash,
          imageBytes: row.imageBytes,
          receivedAt: item.receivedAt,
          updatedAt: claimedAt,
        },
        setWhere: sql`${storedCaptures.status} = 'pending' AND ${storedCaptures.updatedAt} <= ${stalePendingBefore(claimedAt)}`,
      })
      .returning({ key: storedCaptures.key })
    if (claimed.length === 0) {
      const existing = await this.read(item.key)
      // 取れなかったのに行が無い = 相手が画像の失敗で消した直後。409（別の本文）にせず、再送で直る失敗にする
      if (!existing) throw new Error('capture row vanished during claim')
      return { status: 'exists', existingBodyHash: existing.bodyHash }
    }

    const mine = and(
      eq(storedCaptures.key, item.key),
      eq(storedCaptures.status, 'pending'),
      eq(storedCaptures.updatedAt, claimedAt),
    )

    // 2. 画像を置く。失敗したら自分の pending を消す（消せなくても、古くなれば引き継げる）
    try {
      await images.put(file, item.image.bytes, contentType(item.image.format))
    } catch (error) {
      await db
        .delete(storedCaptures)
        .where(mine)
        .catch(() => undefined)
      throw error
    }

    // 3. 完成のしるし。0 行 = 古い扱いで別の要求に引き継がれた（その要求が done にする）
    const done = await db
      .update(storedCaptures)
      .set({ status: 'done', updatedAt: nowMs() })
      .where(mine)
    if (done.rowsAffected === 0) throw new Error('capture claim lost')
    return { status: 'created' }
  }

  async find(key: string): Promise<ExistingCapture | null> {
    assertKey(key)
    const row = await this.read(key)
    if (!row) return null
    // 古い pending は無い扱い（create が引き継ぐ）
    if (row.status === 'pending' && isStalePending(row.updatedAt, this.deps.nowMs())) return null
    return { bodyHash: row.bodyHash }
  }

  async stats(): Promise<CaptureStats> {
    const rows = await this.deps.db
      .select({ count: count(), bytes: sum(storedCaptures.imageBytes) })
      .from(storedCaptures)
    const first = rows[0]
    return { count: first?.count ?? 0, bytes: Number(first?.bytes ?? 0) }
  }

  private async read(
    key: string,
  ): Promise<{ status: 'pending' | 'done'; bodyHash: string; updatedAt: number } | null> {
    const rows = await this.deps.db
      .select({
        status: storedCaptures.status,
        bodyHash: storedCaptures.bodyHash,
        updatedAt: storedCaptures.updatedAt,
      })
      .from(storedCaptures)
      .where(eq(storedCaptures.key, key))
      .limit(1)
    return rows[0] ?? null
  }
}
