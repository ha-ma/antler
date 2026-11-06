// 楽しみの写真を Wikimedia Commons から取り、apps/sim/public/photos/ と写真の記録（photos.json）に書く
// （docs/specs/plan-trip-photos/functional.md R5・R6・R8）。画面は実行時に Commons へ通信しない。
//
//   npx tsx apps/sim/scripts/fetch-photos.ts            # photo-picks.json の全件を取り直す（1 件 3 秒ほど）
//
// - 選ぶのは人（photo-picks.json。調べた記録は docs/reports/2026-11-06-photo-research.md）。このスクリプトは選んだ
//   ファイルのライセンスを API で取り直して確かめ、外れたら保存しない（CC0・パブリックドメイン・CC BY だけ）
// - 通信先は commons.wikimedia.org（API）と upload / thumb.wikimedia.org（画像）の https だけ。リダイレクトは失敗に
//   する。API は 1 回の要求でまとめて引き（50 件まで）、429 は Retry-After（無ければ倍々）だけ待って取り直す
// - 画像は Commons のサーバーが幅 500px に縮小したサムネイル（標準の幅。ほかの幅は近い標準の幅に寄せられる）。
//   2 MB を超えたら受信の途中で止める。中身は先頭の
//   バイトで JPEG・PNG かを確かめ、JPEG は EXIF・XMP・IPTC を落としてから保存する。名前は楽しみの id から作る
// - User-Agent はプロジェクト名だけ（個人の連絡先を入れない）。https://meta.wikimedia.org/wiki/User-Agent_policy
// - 終わったら CREDITS.md の写真の表の行を標準出力に出す（手で貼る）
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  MAX_PHOTO_BYTES,
  imageKind,
  imageSize,
  isAllowedLicense,
  isAllowedSource,
  plainText,
  stripJpegMetadata,
} from '../src/shared/utils/photo-rules'

const API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT =
  'antler-ezoroad-photo-fetch/0.1 (Built with Claude Japan 2026 hackathon; one-off fetch of a few thumbnails)'
const THUMB_WIDTH = 500
const MAX_WIDTH = 800
const MAX_HEIGHT = 1600
const INTERVAL_MS = 3000
const TIMEOUT_MS = 30_000
const RETRY_WAIT_MS = [10_000, 20_000, 40_000]
const MODIFICATION = '幅 500px に縮小（Commons のサムネイル）・撮影情報（EXIF 等）を除去'
const REVIEW = 'Claude がサムネイルを目視: 顔の判別できる人物・大きな商標・鹿が写っていない'

const here = path.dirname(fileURLToPath(import.meta.url))
const picksFile = path.resolve(here, 'photo-picks.json')
const outDir = path.resolve(here, '../public/photos')
const manifestFile = path.resolve(here, '../src/features/plan-trip/data/photos.json')

const Picks = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    file: z.string().startsWith('File:').nullable(),
  }),
)

const Meta = z.object({ value: z.string() }).optional()
const ApiResponse = z.object({
  query: z.object({
    normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    pages: z.record(
      z.string(),
      z.object({
        title: z.string(),
        imageinfo: z
          .array(
            z.object({
              thumburl: z.string(),
              descriptionurl: z.string(),
              sha1: z.string().regex(/^[0-9a-f]{40}$/),
              extmetadata: z.object({
                License: Meta,
                LicenseShortName: Meta,
                LicenseUrl: Meta,
                Artist: Meta,
                Attribution: Meta,
              }),
            }),
          )
          // 存在しないファイルには imageinfo が無い（その 1 件だけを失敗にする）
          .optional(),
      }),
    ),
  }),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Markdown の表のセルに入れる文字（| を逃がす） */
const cell = (s: string) => s.replace(/\|/g, '\\|')

async function get(url: string, kind: 'api' | 'image'): Promise<Response> {
  if (!isAllowedSource(url, kind)) throw new Error(`許可していない通信先: ${url}`)
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const wait = RETRY_WAIT_MS[attempt]
    if (res.status === 429 && wait !== undefined) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait
      console.log(`  429。${String(ms / 1000)} 秒待って取り直す`)
      await sleep(ms)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}: ${url}`)
    return res
  }
}

type ImageInfo = z.infer<typeof ApiResponse>['query']['pages'][string]

/** 選んだファイルの情報を 1 回の要求でまとめて引く（50 件まで）。キーは photo-picks.json の file の表記。 */
async function lookup(files: readonly string[]): Promise<Map<string, ImageInfo>> {
  if (files.length > 50) throw new Error('API の 1 回の要求は 50 件まで')
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: files.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|sha1',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|LicenseUrl|Artist|Attribution',
  })
  const info = ApiResponse.parse(await (await get(`${API}?${params.toString()}`, 'api')).json())
  const byTitle = new Map(Object.values(info.query.pages).map((p) => [p.title, p]))
  const normalized = new Map((info.query.normalized ?? []).map((n) => [n.from, n.to]))
  const out = new Map<string, ImageInfo>()
  for (const file of files) {
    const page = byTitle.get(normalized.get(file) ?? file)
    if (page) out.set(file, page)
  }
  return out
}

/** 上限を受信中のバイト数で効かせて読む（Content-Length は信じない）。 */
async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) throw new Error('本文が無い')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_PHOTO_BYTES) {
      await reader.cancel()
      throw new Error(`上限 ${String(MAX_PHOTO_BYTES)} バイトを超えた`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

async function fetchOne(id: string, page: ImageInfo | undefined, today: string) {
  const image = page?.imageinfo?.[0]
  if (!page || !image) throw new Error('ファイルが無い')
  const meta = image.extmetadata
  const license = { code: meta.License?.value ?? '', name: meta.LicenseShortName?.value ?? '' }
  if (!isAllowedLicense(license)) {
    throw new Error(`使えないライセンス: ${license.name}（${license.code}）`)
  }
  // 帰属は Attribution（作者が指定した表示）を優先する
  const author = plainText(meta.Attribution?.value || meta.Artist?.value || '')
  if (!author) throw new Error('撮影者が分からない')

  const raw = await readCapped(await get(image.thumburl, 'image'))
  const kind = imageKind(raw)
  if (!kind) throw new Error('JPEG・PNG ではない')
  const bytes = stripJpegMetadata(raw)
  const size = imageSize(bytes)
  if (!size || size.width > MAX_WIDTH || size.height > MAX_HEIGHT)
    throw new Error(`大きさが読めないか大きすぎる: ${JSON.stringify(size)}`)

  const name = `${id}.${kind}`
  const entry = {
    id,
    file: `photos/${name}`,
    title: page.title.replace(/^File:/, ''),
    author,
    license: license.name,
    licenseCode: license.code.toLowerCase(),
    licenseUrl: meta.LicenseUrl?.value ? meta.LicenseUrl.value.replace(/^http:/, 'https:') : null,
    sourceUrl: image.descriptionurl.replace(/^http:/, 'https:'),
    retrievedAt: today,
    originalSha1: image.sha1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: size.width,
    height: size.height,
    modification: MODIFICATION,
    review: REVIEW,
  }
  return { name, bytes, entry }
}

async function main() {
  const picks = Picks.parse(JSON.parse(readFileSync(picksFile, 'utf8')))
  mkdirSync(outDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const pages = await lookup(picks.flatMap((p) => (p.file ? [p.file] : [])))
  await sleep(INTERVAL_MS)
  const fetched: Awaited<ReturnType<typeof fetchOne>>[] = []
  const failed: string[] = []
  for (const pick of picks) {
    if (!pick.file) {
      console.log(`- ${pick.id}: 写真なし（photo-placeholder のまま）`)
      continue
    }
    try {
      fetched.push(await fetchOne(pick.id, pages.get(pick.file), today))
      console.log(`✓ ${pick.id}`)
    } catch (error) {
      failed.push(pick.id)
      console.error(`✗ ${pick.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await sleep(INTERVAL_MS)
  }
  // 1 件でも失敗したら何も書かない（画像と記録を 1 対 1 に保つ。前回の記録を消さない）
  if (failed.length > 0) {
    console.error(`\n取れなかった: ${failed.join(', ')}。画像と記録は書き換えていない`)
    process.exitCode = 1
    return
  }
  for (const f of fetched) writeFileSync(path.join(outDir, f.name), f.bytes)
  const photos = fetched.map((f) => f.entry)
  writeFileSync(manifestFile, `${JSON.stringify(photos, null, 2)}\n`)
  console.log('\nCREDITS.md の行:')
  for (const p of photos) {
    const license = p.licenseUrl ? `[${p.license}](${p.licenseUrl})` : p.license
    console.log(
      `| ${p.id} | 「${cell(p.title)}」 ${cell(p.author)} | ${license} | ${p.sourceUrl} | ${p.retrievedAt}・${p.modification} | apps/sim/public/${p.file} |`,
    )
  }
}

await main()
