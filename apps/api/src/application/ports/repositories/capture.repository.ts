import type { Capture } from '@antler/schema'
import type { CaptureImageFormat } from '../../../domain/captures/models/capture-image.js'

// 受け取った Capture と画像の保存（docs/specs/edge-capture/functional.md A4〜A6、resilience.md）。
// 実装は infrastructure/repositories/（いまはファイル。口は同じなので、あとで DB に替えられる）。
// 読み出し・削除の口は作らない（取り込みは dataset/ が保存先のファイルを直接読む。IDOR の面を作らない）。

export type NewStoredCapture = {
  /** id の小文字（`^cap_[a-z0-9]+$`。ファイル名に使う） */
  key: string
  /** サーバーが決めた形（image は論理のパス、consent は true） */
  capture: Capture
  bodyHash: string
  /** 受け取った時刻（ISO 8601） */
  receivedAt: string
  image: { bytes: Uint8Array; format: CaptureImageFormat; sha256: string }
}

export type CreateCaptureResult =
  | { status: 'created' }
  /** 先に同じ key があった。既存の本文のハッシュ（読めなければ null） */
  | { status: 'exists'; existingBodyHash: string | null }

export type ExistingCapture = {
  /** 本文のハッシュ。既存の記録が読めなければ null */
  bodyHash: string | null
}

export type CaptureStats = {
  /** 保存した Capture の数 */
  count: number
  /** 保存した画像の合計（バイト） */
  bytes: number
}

export interface CaptureRepository {
  /**
   * 保存する。同じ key が既にあれば上書きせず 'exists'（同時の 2 要求は片方だけが 'created'）。
   * 書けなかったときは例外（一時ファイルと不要な画像は消してから）。
   */
  create(capture: NewStoredCapture): Promise<CreateCaptureResult>
  find(key: string): Promise<ExistingCapture | null>
  /** 件数と画像の合計。起動時に 1 回数え、保存のたびに増やした値（数件の超過は許す） */
  stats(): Promise<CaptureStats>
}
