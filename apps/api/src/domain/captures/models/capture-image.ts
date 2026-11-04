// 受け取った画像の判定結果（docs/specs/edge-capture/functional.md A3）。

export type CaptureImageFormat = 'jpeg' | 'png'

/** 画像を受けない理由。応答には出さず（code は INVALID_IMAGE 1 つ）、ログと検査で見分けるために持つ */
export type CaptureImageRejection =
  | 'not_image'
  | 'too_large'
  | 'malformed'
  | 'metadata'
  | 'trailing_data'
  | 'dimension_range'
  | 'size_mismatch'

export type CaptureImageInspection =
  | { ok: true; format: CaptureImageFormat; width: number; height: number }
  | { ok: false; reason: CaptureImageRejection }
