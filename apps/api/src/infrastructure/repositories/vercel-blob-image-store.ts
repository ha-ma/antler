import { del, put } from '@vercel/blob'

// BlobCaptureRepository の画像の置き場所（docs/specs/deploy-a/functional.md R9）。
// Capture の永続化の一部（FileCaptureRepository が画像を fs に書くのと同じ役目）で、外部の通知・送信ではないので
// Gateway にせず、Repository の実装の中に閉じる（layer-guard: Repository から Gateway を呼ばない）。
// Vercel Blob（非公開のストア）。資格は SDK が env から読む（Vercel では OIDC: VERCEL_OIDC_TOKEN と BLOB_STORE_ID。
// 手元からは BLOB_READ_WRITE_TOKEN）。
// - access: 'private'（URL を知っていても資格が無ければ読めない）
// - addRandomSuffix: false（名前はサーバーが決めた中身のハッシュ）
// - allowOverwrite: true（同じ名前は同じ中身。引き継いだ再送が同じ画像を置き直せる）
// 読み出しの口は作らない（edge-capture と同じ。IDOR の面を作らない）。

export interface CaptureImageStore {
  /** 名前（パス）に置く。同じ名前は上書きする（名前は中身のハッシュなので、同じ名前は同じ中身） */
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>
}

export type BlobClient = {
  put: typeof put
  del: typeof del
}

export class VercelBlobImageStore implements CaptureImageStore {
  constructor(private readonly blob: Pick<BlobClient, 'put'> = { put }) {}

  async put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.blob.put(pathname, Buffer.from(bytes), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    })
  }
}
