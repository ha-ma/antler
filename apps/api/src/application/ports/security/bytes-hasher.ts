// バイト列のハッシュ（受け取った画像の同一性）。文字列用の Hasher とは別。業務判断は持たない。

export interface BytesHasher {
  /** SHA-256 を 16 進 64 文字で */
  sha256Hex(bytes: Uint8Array): string
}
