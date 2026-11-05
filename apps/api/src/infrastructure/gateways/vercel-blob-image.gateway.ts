import { del, put } from '@vercel/blob'
import type { CaptureImageGateway } from '../../application/ports/gateways/capture-image.gateway.js'

// Capture の画像を Vercel Blob（非公開のストア）に置く（docs/specs/deploy-a/functional.md R9）。
// 資格は SDK が env から読む（Vercel では OIDC: VERCEL_OIDC_TOKEN と BLOB_STORE_ID。手元からは BLOB_READ_WRITE_TOKEN）。
// - access: 'private'（URL を知っていても資格が無ければ読めない）
// - addRandomSuffix: false（名前はサーバーが決めた中身のハッシュ）
// - allowOverwrite: true（同じ名前は同じ中身。引き継いだ再送が同じ画像を置き直せる）

export type BlobClient = {
  put: typeof put
  del: typeof del
}

export class VercelBlobImageGateway implements CaptureImageGateway {
  constructor(private readonly blob: BlobClient = { put, del }) {}

  async put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.blob.put(pathname, Buffer.from(bytes), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    })
  }

  async delete(pathname: string): Promise<void> {
    await this.blob.del(pathname)
  }
}
