// ハッシュ（所有者トークン・冪等キー・body の同一性）。業務判断は持たない。

export interface Hasher {
  /** UTF-8 の SHA-256 を 16 進 64 文字で */
  sha256Hex(text: string): string
}
