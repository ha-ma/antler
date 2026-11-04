import type { Capture } from '@antler/schema'

// POST /api/captures の UseCase の入出力。

export type SubmitCaptureInput = {
  /** CaptureSchema（strict）と id の長さを通ったもの */
  capture: Capture
  /** image 欄のファイルのバイト列 */
  image: Uint8Array
}

export type SubmitCaptureOutput = {
  id: string
  /** サーバーが決めた論理の画像パス（captures/{id}.{jpg|png}） */
  image: string
  /** 同じ id・同じ中身の再送（保存し直していない） */
  replayed: boolean
  /** 画像の大きさ（バイト）。ログ用 */
  imageBytes: number
}
