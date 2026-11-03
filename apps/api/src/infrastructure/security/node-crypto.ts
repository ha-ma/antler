import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { Hasher } from '../../application/ports/security/hasher.js'
import type { RandomSource } from '../../application/ports/security/random-source.js'
import type { TokenSigner } from '../../application/ports/security/token-signer.js'

// node:crypto による乱数・ハッシュ・HMAC の実装。

export class NodeRandomSource implements RandomSource {
  bytes(n: number): Uint8Array {
    return new Uint8Array(randomBytes(n))
  }
}

export class NodeSha256Hasher implements Hasher {
  sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex')
  }
}

/** HMAC-SHA256。鍵は env の OWNER_TOKEN_SECRET（32 文字以上）を di が渡す */
export class HmacSha256TokenSigner implements TokenSigner {
  constructor(private readonly secret: string) {}

  sign(material: string): string {
    return createHmac('sha256', this.secret).update(material, 'utf8').digest('hex')
  }
}
