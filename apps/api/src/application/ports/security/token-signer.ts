// 秘密の鍵で署名した値を作る技術ポート（所有者トークン）。鍵は実装が持ち、usecase は知らない。

export interface TokenSigner {
  /** material の HMAC-SHA256 を 16 進 64 文字で */
  sign(material: string): string
}
