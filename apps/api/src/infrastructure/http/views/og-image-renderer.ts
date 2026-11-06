import { existsSync } from 'node:fs'
import { renderAsync } from '@resvg/resvg-js'
import { bundledOgFontFiles } from './og-fonts.js'

// しおりの SVG → PNG（docs/specs/record/functional.md R6、resilience.md）。
// 描画は libuv のスレッドで行う（renderAsync）。同時に描くのは maxConcurrent 枚まで、超えたら OgImageBusyError（503）。
// 描いた PNG は鍵（旅の id・run の数・最後の seq）でメモリに cacheSize 枚まで持つ。持っている画像は枠を使わずに返す。
// 鍵は DB を読んでから作るので、削除した旅の画像が返ることはない（route は先に記録を読む）。

/** 描画の同時実行の上限に達している */
export class OgImageBusyError extends Error {
  override name = 'OgImageBusyError'
  constructor() {
    super('画像を作れませんでした。しばらくしてもう一度')
  }
}

export type Png = Uint8Array<ArrayBuffer>

export type OgImageRendererOptions = {
  /** フォントのファイル（OG_FONT_FILES）。空なら同梱のフォント */
  fontFiles: readonly string[]
  /** 同梱のフォントの場所の取り方（テストで差し替える） */
  bundledFonts?: () => string[]
  /** 使えるフォントが無く、システムのフォントに戻ったとき（四角になりうる）。起動のときに 1 回 */
  onFontsMissing?: () => void
  maxConcurrent?: number
  cacheSize?: number
  /** 描画（テストで差し替える） */
  render?: (svg: string) => Promise<Png>
}

export interface OgImages {
  /** key は `{旅の id}:…` の形 */
  png(key: string, svg: () => string): Promise<Png>
  /** その旅の画像を捨てる（削除のあと） */
  forget(tripId: string): void
}

export class OgImageRenderer implements OgImages {
  private active = 0
  private readonly cache = new Map<string, Png>()
  private readonly inFlight = new Map<string, Promise<Png>>()
  private readonly maxConcurrent: number
  private readonly cacheSize: number
  private readonly render: (svg: string) => Promise<Png>

  constructor(options: OgImageRendererOptions) {
    this.maxConcurrent = options.maxConcurrent ?? 2
    this.cacheSize = options.cacheSize ?? 100
    // 指定（OG_FONT_FILES）があればそれ、無ければ同梱の Noto Sans JP / TC / KR（og-fonts.ts）。
    // どちらも無い（同梱のファイルが欠けている）ときだけシステムのフォント
    // 指定のファイルが 1 つも無いときも同梱に戻す（文字の無い画像を返さない）
    const given = options.fontFiles.filter((f) => existsSync(f))
    const files = given.length > 0 ? given : (options.bundledFonts ?? bundledOgFontFiles)()
    if (files.length === 0) options.onFontsMissing?.()
    const font =
      files.length > 0 ? { loadSystemFonts: false, fontFiles: files } : { loadSystemFonts: true }
    this.render =
      options.render ??
      (async (svg) => {
        const image = await renderAsync(svg, { font, fitTo: { mode: 'original' } })
        return new Uint8Array(image.asPng())
      })
  }

  async png(key: string, svg: () => string): Promise<Png> {
    const cached = this.cache.get(key)
    if (cached) {
      // 使った順に並べ直す（古いものから捨てる）
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    // 同じ鍵を描いている最中なら、その結果を待つ（枠を使わない）
    const inFlight = this.inFlight.get(key)
    if (inFlight) return inFlight
    if (this.active >= this.maxConcurrent) throw new OgImageBusyError()
    this.active += 1
    const rendering = this.draw(key, svg)
    this.inFlight.set(key, rendering)
    try {
      return await rendering
    } finally {
      this.inFlight.delete(key)
      this.active -= 1
    }
  }

  forget(tripId: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${tripId}:`)) this.cache.delete(key)
    }
  }

  private async draw(key: string, svg: () => string): Promise<Png> {
    const png = await this.render(svg())
    this.cache.set(key, png)
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return png
  }
}
