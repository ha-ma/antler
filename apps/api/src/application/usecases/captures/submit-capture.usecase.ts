import { isUploadable } from '@antler/schema'
import {
  ConsentRequiredError,
  InvalidImageError,
  StoreFullError,
} from '../../../domain/captures/errors/capture-errors.js'
import {
  captureBodyMaterial,
  captureKey,
  decideOnExistingCapture,
  logicalImagePath,
} from '../../../domain/captures/policies/capture-identity-policy.js'
import { inspectCaptureImage } from '../../../domain/captures/rules/capture-image.js'
import type { CaptureRepository } from '../../ports/repositories/capture.repository.js'
import type { BytesHasher } from '../../ports/security/bytes-hasher.js'
import type { Hasher } from '../../ports/security/hasher.js'
import type { Clock } from '../../ports/system/clock.js'
import type { SubmitCaptureInput, SubmitCaptureOutput } from './dto.js'

// POST /api/captures（docs/specs/edge-capture/functional.md A2・A4・A5、resilience.md「トランザクション境界」）。
// 検証の順（最初に外れたもので止める。保存は最後）:
//   5. consent が true（isUploadable。false は保存しない）→ 6. 画像 → 7. 同じ id の扱い（200 か 409）→ 8. 空き → 9. 保存
//   （1〜4 の本文の大きさ・欄の有無・JSON・スキーマは HTTP の層が先に止める）
// 同じ id は「サーバーが決めた形」（論理の image パス・consent: true）と画像の sha256 の本文ハッシュで比べる。

export type SubmitCaptureDeps = {
  captures: CaptureRepository
  hasher: Hasher
  bytesHasher: BytesHasher
  clock: Clock
  /** 保存件数の上限（以上で STORE_FULL） */
  maxItems: number
  /** 保存した画像の合計の上限（バイト。以上で STORE_FULL） */
  maxBytes: number
}

export class SubmitCaptureUseCase {
  constructor(private readonly deps: SubmitCaptureDeps) {}

  async execute({ capture, image }: SubmitCaptureInput): Promise<SubmitCaptureOutput> {
    const { captures, hasher, bytesHasher, clock, maxItems, maxBytes } = this.deps

    if (!isUploadable(capture)) throw new ConsentRequiredError()

    const inspected = inspectCaptureImage(image, capture.imageSize)
    if (!inspected.ok) throw new InvalidImageError(inspected.reason)

    const key = captureKey(capture.id)
    const imagePath = logicalImagePath(capture.id, inspected.format)
    const stored = { ...capture, image: imagePath, consent: true }
    const imageSha256 = bytesHasher.sha256Hex(image)
    const bodyHash = hasher.sha256Hex(captureBodyMaterial(stored, imageSha256))
    const output = { id: capture.id, image: imagePath, imageBytes: image.byteLength }

    const existing = await captures.find(key)
    if (existing) {
      decideOnExistingCapture(existing.bodyHash, bodyHash)
      return { ...output, replayed: true }
    }

    const stats = await captures.stats()
    if (stats.count >= maxItems || stats.bytes >= maxBytes) throw new StoreFullError()

    const result = await captures.create({
      key,
      capture: stored,
      bodyHash,
      receivedAt: new Date(clock.nowMs()).toISOString(),
      image: { bytes: image, format: inspected.format, sha256: imageSha256 },
    })
    if (result.status === 'exists') {
      // 同時に同じ id が来て、先に取られた。既存と比べて 200 か 409
      decideOnExistingCapture(result.existingBodyHash, bodyHash)
      return { ...output, replayed: true }
    }
    return { ...output, replayed: false }
  }
}
