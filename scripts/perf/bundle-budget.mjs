#!/usr/bin/env node
// A（apps/sim）のバンドルの上限（docs/specs/performance/functional.md R6、ch6「初回読込は 3D アセットを除いて 3 秒以内」）。
//
// apps/sim を一時フォルダへ本番ビルドし（manifest つき）、画面ごとの「最初に読む JS」（入口 ＋ その画面のチャンク ＋
// それらが静的に読むチャンク）と、3D のチャンクの gzip の大きさを上限と比べる。超えたら exit 1。
// 上限は計測した値（2026-11-06）の約 1 割増し。上げるときは理由を functional.md R6 に書く。
//
// 使い方: node scripts/perf/bundle-budget.mjs [--json]

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SIM = join(ROOT, 'apps/sim')

/** 上限（gzip の KB）。画面は「最初に読む JS」の合計、3d は 3D のチャンク 1 つ */
export const BUDGET_KB = {
  '/plan': 200,
  '/trip/:id/brief': 215,
  '/loss/:id': 200,
  '/t/:id': 200,
  '/drive': 260,
  '/trip/:id/day/:n/stops': 200,
  '3d': 275,
  all: 1000,
}

/** 画面のルートと、その遅延読込の元のファイル（manifest のキー） */
const ROUTES = {
  '/plan': 'src/features/plan-trip/index.ts',
  '/trip/:id/brief': 'src/features/brief-map/index.ts',
  '/loss/:id': 'src/features/loss/index.ts',
  '/t/:id': 'src/features/record/index.ts',
  // 運転は DriveRoute の後に drive の barrel を読むまでが 3D の前（出発の案内・HUD）
  '/drive': ['src/app/DriveRoute.tsx', 'src/features/drive/index.ts'],
  '/trip/:id/day/:n/stops': 'src/features/stop-events/index.ts',
}
const SCENE = 'src/features/drive/scene/DriveCanvas.tsx'

function build(outDir) {
  execFileSync(
    'npx',
    [
      '--no-install',
      'vite',
      'build',
      '--manifest',
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    { cwd: SIM, stdio: 'inherit' },
  )
  return JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'))
}

/** 遅延読込の口のうち、画面ではないもの（3D・地図のライブラリ）。ここにも ROUTES にも無い口があれば失敗にする */
const OTHER_DYNAMIC = [SCENE, /^node_modules\/maplibre-gl\//, 'src/app/DriveRoute.tsx']

/** key と、それが静的に読むチャンクの全部（JS と CSS のファイル名の集合） */
function closure(manifest, keys, into = new Set()) {
  for (const key of keys) {
    const chunk = manifest[key]
    if (!chunk) throw new Error(`manifest に ${key} がない（ルートの元のファイルを確かめる）`)
    if (into.has(chunk.file)) continue
    into.add(chunk.file)
    for (const css of chunk.css ?? []) into.add(css)
    closure(manifest, chunk.imports ?? [], into)
  }
  return into
}

/** ROUTES にも OTHER_DYNAMIC にも無い遅延読込の口（新しい画面を足したら ROUTES と上限に足す） */
function unknownDynamicEntries(manifest) {
  const known = new Set(Object.values(ROUTES).flat())
  return Object.keys(manifest).filter(
    (k) =>
      manifest[k].isDynamicEntry &&
      !known.has(k) &&
      !OTHER_DYNAMIC.some((o) => (typeof o === 'string' ? o === k : o.test(k))),
  )
}

function gzipKb(outDir, files) {
  let bytes = 0
  for (const f of files) bytes += gzipSync(readFileSync(join(outDir, f)), { level: 9 }).length
  return Math.round((bytes / 1024) * 10) / 10
}

export function measure(manifest, outDir) {
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry)
  if (!entry) throw new Error('manifest に入口が無い')
  const rows = []
  for (const [route, src] of Object.entries(ROUTES)) {
    const keys = [entry, ...(Array.isArray(src) ? src : [src])]
    rows.push({ name: route, kb: gzipKb(outDir, closure(manifest, keys)) })
  }
  // 3D は 3D のチャンクと、それが静的に読むチャンクのうち入口に無いもの（three・R3F を共有のチャンクに分けられても抜けない）
  const initial = closure(manifest, [entry])
  const scene = [...closure(manifest, [SCENE])].filter((f) => !initial.has(f))
  rows.push({ name: '3d', kb: gzipKb(outDir, scene) })
  // 全部の JS と CSS（地図のワーカーを含む。どこにも数えられないチャンクが増えても抜けない）
  const all = Object.values(manifest).flatMap((c) => [c.file, ...(c.css ?? [])])
  rows.push({
    name: 'all',
    kb: gzipKb(
      outDir,
      [...new Set(all)].filter((f) => /\.(m?js|css)$/.test(f)),
    ),
  })
  return rows.map((r) => ({ ...r, budget: BUDGET_KB[r.name], ok: r.kb <= BUDGET_KB[r.name] }))
}

const outDir = mkdtempSync(join(tmpdir(), 'antler-bundle-'))
try {
  const manifest = build(outDir)
  const unknown = unknownDynamicEntries(manifest)
  if (unknown.length > 0) {
    console.error(`上限の無い遅延読込の口: ${unknown.join(', ')}（ROUTES と BUDGET_KB に足す）`)
    process.exitCode = 1
  }
  const rows = measure(manifest, outDir)
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2))
  else {
    for (const r of rows) {
      const mark = r.ok ? 'ok  ' : 'OVER'
      console.log(
        `${mark} ${r.name.padEnd(24)} ${String(r.kb).padStart(7)} KB gz / 上限 ${r.budget} KB`,
      )
    }
  }
  if (rows.some((r) => !r.ok)) {
    console.error(
      'バンドルが上限を超えた（docs/specs/performance/functional.md R6）。遅延読込にするか、理由を書いて上限を上げる',
    )
    process.exitCode = 1
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
