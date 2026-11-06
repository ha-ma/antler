// OG 画像のフォント（Noto Sans JP / TC / KR の Bold。SIL OFL 1.1）を取り、assets/fonts/ に置く（docs/specs/og-font/functional.md R1）。
//   node apps/api/scripts/fetch-og-fonts.mjs          # 取って、sha256 が合うことを確かめて置く
//   node apps/api/scripts/fetch-og-fonts.mjs --check  # 置いてあるファイルの sha256 だけを確かめる（通信しない）
// 配布元は notofonts/noto-cjk の公式のタグ。タグと sha256 はここに固定する（変わったら止まる。黙って別のものを入れない）。
// ファイルは取ってきて検証してから置く（検証に失敗したら、置いてあるファイルに触らない）。

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TAG = 'Sans2.004'
const BASE = `https://raw.githubusercontent.com/notofonts/noto-cjk/${TAG}`
const OUT_DIR = join(import.meta.dirname, '..', 'assets', 'fonts')
// 1 ファイルの上限（想定の 2 倍。想定外に大きいものを黙って受けない）
const MAX_BYTES = 12 * 1024 * 1024

export const FILES = [
  {
    name: 'NotoSansJP-Bold.otf',
    url: `${BASE}/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf`,
    sha256: '1b0edfb500b73a4fa8a4fcaae1bbbd403994e08e73e3e0da37e70d3853f42c5f',
  },
  {
    name: 'NotoSansTC-Bold.otf',
    url: `${BASE}/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf`,
    sha256: '55420b259eb119bf5f2a0aadba10cf9d736c12d64ab93e78546d69ef5f43558b',
  },
  {
    name: 'NotoSansKR-Bold.otf',
    url: `${BASE}/Sans/SubsetOTF/KR/NotoSansKR-Bold.otf`,
    sha256: '5a6ceb287ed2fc6cfc6213144ebea68cbd94b20fc9eb873d8486493bf02d9bda',
  },
  {
    name: 'OFL.txt',
    url: `${BASE}/LICENSE`,
    sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2',
  },
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function download(file) {
  const res = await fetch(file.url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${file.name}: ${String(res.status)} ${file.url}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES)
    throw new Error(`${file.name}: 大きすぎる（${String(bytes.length)} バイト）`)
  const actual = sha256(bytes)
  if (actual !== file.sha256) {
    throw new Error(`${file.name}: sha256 が違う（期待 ${file.sha256}、実際 ${actual}）。置かない`)
  }
  return bytes
}

async function main() {
  if (process.argv.includes('--check')) {
    for (const file of FILES) {
      const actual = sha256(readFileSync(join(OUT_DIR, file.name)))
      if (actual !== file.sha256) throw new Error(`${file.name}: sha256 が違う（${actual}）`)
      console.log(`ok ${file.name}`)
    }
    // 余計なファイル（書きかけの .tmp など）は bundle にも写るので許さない
    const known = new Set(FILES.map((f) => f.name))
    const extra = readdirSync(OUT_DIR).filter((n) => !known.has(n))
    if (extra.length > 0) throw new Error(`余計なファイルがある: ${extra.join(', ')}`)
    return
  }
  // 全部取って検証してから、一時ファイルに書き、最後にまとめて名前を替える（途中で止まっても古いものと混ざらない）
  const fetched = []
  for (const file of FILES) fetched.push([file, await download(file)])
  mkdirSync(OUT_DIR, { recursive: true })
  const tmps = []
  try {
    for (const [file, bytes] of fetched) {
      const tmp = join(OUT_DIR, `${file.name}.tmp`)
      tmps.push(tmp)
      writeFileSync(tmp, bytes)
    }
  } catch (error) {
    for (const tmp of tmps) rmSync(tmp, { force: true })
    throw error
  }
  for (const [i, [file, bytes]] of fetched.entries()) {
    renameSync(tmps[i], join(OUT_DIR, file.name))
    console.log(`置いた ${file.name}（${String(bytes.length)} バイト）`)
  }
}

// import（テスト）されたときは走らせない
if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
