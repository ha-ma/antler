// Capture の画像の置き場所（外部のストレージ。docs/specs/deploy-a/functional.md R9）。
// 実装は infrastructure/gateways/（Vercel Blob の非公開のストア）。BlobCaptureRepository が使う。
// 読み出しの口は作らない（edge-capture と同じ。IDOR の面を作らない）。

export interface CaptureImageGateway {
  /** 名前（パス）に置く。同じ名前は上書きする（名前は中身のハッシュなので、同じ名前は同じ中身） */
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** 名前で消す。無ければ何もしない */
  delete(pathname: string): Promise<void>
}
