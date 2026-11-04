import { createHash } from 'node:crypto'
import type { BytesHasher } from '../../application/ports/security/bytes-hasher.js'

// node:crypto によるバイト列の SHA-256。

export class NodeSha256BytesHasher implements BytesHasher {
  sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
  }
}
