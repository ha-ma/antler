// Capture の受け口の定数（docs/specs/edge-capture/functional.md A1・A3・A4・A6）。

/** capture 欄（JSON 文字列）の上限（バイト） */
export const CAPTURE_JSON_MAX_BYTES = 8 * 1024
/** 画像 1 枚の上限（バイト）。320 px の JPEG は数十 KB、sim の 1280×720 の JPEG は 100〜300 KB */
export const CAPTURE_IMAGE_MAX_BYTES = 512 * 1024
/** リクエスト本文の上限（バイト）。画像 512 KiB ＋ multipart の枠と Capture */
export const CAPTURE_BODY_MAX_BYTES = 640 * 1024
/** 画像の一辺の下限・上限（px） */
export const CAPTURE_IMAGE_MIN_PX = 16
export const CAPTURE_IMAGE_MAX_PX = 2048
/** id の長さの上限（ファイル名の上限を超えない。凍結の CaptureSchema は変えず HTTP の層で止める） */
export const CAPTURE_ID_MAX_LENGTH = 40
/** ファイル名に使う key（id の小文字）の形 */
export const CAPTURE_KEY_PATTERN = /^cap_[a-z0-9]+$/
/** 画像の実ファイル名に使う sha256 の桁数 */
export const CAPTURE_IMAGE_HASH_PREFIX = 12
/**
 * 書きかけ（pending）の保存を、書いた要求が止まったとみなして引き継ぐまでの時間（ミリ秒。deploy-a R9）。
 * Vercel の関数は 60 秒（maxDuration）で止まるので、それに余裕を足した 90 秒
 */
export const CAPTURE_STALE_PENDING_MS = 90_000
