import { renderAsync } from '@resvg/resvg-js'

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
  /** フォントのファイル。空ならシステムのフォント */
  fontFiles: readonly string[]
  maxConcurrent?: number
  cacheSize?: number
  /** 描画（テストで差し替える） */
  render?: (svg: string) => Promise<Png>
}

export interface OgImages {
  png(key: string, svg: () => string): Promise<Png>
}

export class OgImageRenderer implements OgImages {
  private active = 0
  private readonly cache = new Map<string, Png>()
  private readonly maxConcurrent: number
  private readonly cacheSize: number
  private readonly render: (svg: string) => Promise<Png>

  constructor(options: OgImageRendererOptions) {
    this.maxConcurrent = options.maxConcurrent ?? 2
    this.cacheSize = options.cacheSize ?? 100
    const font =
      options.fontFiles.length > 0
        ? { loadSystemFonts: false, fontFiles: [...options.fontFiles] }
        : { loadSystemFonts: true }
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
    if (this.active >= this.maxConcurrent) throw new OgImageBusyError()
    this.active += 1
    try {
      const png = await this.render(svg())
      this.cache.set(key, png)
      while (this.cache.size > this.cacheSize) {
        const oldest = this.cache.keys().next().value
        if (oldest === undefined) break
        this.cache.delete(oldest)
      }
      return png
    } finally {
      this.active -= 1
    }
  }
}
