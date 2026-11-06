#!/usr/bin/env node
// A（apps/sim）の運転画面の fps を実測する（docs/specs/performance/functional.md R3、ch6「A 性能」）。
//
// 本番ビルドを `vite preview` で出しておき、Playwright の Chromium（新しいヘッドレス）で /drive の見本の場面を開いて
// 「出発」→ W を押し続けて走る。鹿ゾーンの外は 4× で早送りし（区間の境界をたくさんまたぐ。要件より重い）、ゾーンの中は 1×。
// 赤（前方に鹿）の間はブレーキ（Space）。衝突したら「もう一度」で走り直す。音は --mute-audio で出さない。
// 場面ごとにブラウザを起動し直す（GPU のプログラムのキャッシュを場面の間で持ち越さない）。
// rAF の間隔はページに差し込んだ requestAnimationFrame のループで取る（アプリの計測とは独立）。
// フレームのタグ: ended（衝突・完走のバナーの間。判定から除く）/ settle（出発・やり直しから 2 秒。判定から除く）/
// onset（赤が出てから 1 秒）/ danger / zone / approach。50 ms を超えたフレームは long に間隔とタグを残す。
//
// 使い方（Playwright はリポジトリの依存に入れていない。手元の npx のキャッシュなどを PLAYWRIGHT_DIR で指す）:
//   npm --prefix apps/sim run build && npx --prefix apps/sim vite preview --port 5224 --strictPort
//   PLAYWRIGHT_DIR=~/.npm/_npx/<hash>/node_modules/playwright [CHROME_PATH=<Chromium の実行ファイル>] \
//     node scripts/perf/measure-drive.mjs --profile pc --vsync on --seconds 75 --out /tmp/pc.json
//
// --profile: pc（1440×900・DPR 2。MacBook の内蔵 GPU。Canvas は DPR の上限 1.5 で 2160×1350）/ pc1（DPR 1）/
//            phone（844×390・DPR 3・タッチ・CPU 4× 減速。iPhone 13 / Pixel 6 の横画面の CPU 側の目安）
// --vsync off: --disable-gpu-vsync --disable-frame-rate-limit（vsync に隠れない 1 フレームの仕事を見る。判定はしない）
// --gpu off: SwiftShader（GPU なし。参考値。判定はしない）
// --scenes: カンマ区切りの URL のクエリ（既定は 既定・雪・紅葉の雨・夏の晴れ）。--query: 各場面に足すクエリ

import { writeFileSync } from 'node:fs'
import { launchOptions, loadPlaywright } from './lib.mjs'

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc),
      [],
    ),
)
const BASE = args.base ?? 'http://localhost:5224'
const PROFILE = args.profile ?? 'pc'
const VSYNC = (args.vsync ?? 'on') === 'on'
const GPU = (args.gpu ?? 'on') === 'on'
const SECONDS = Number(args.seconds ?? 75)
const EXTRA = args.query ?? ''
const POLL_MS = 300
const SCENES = (args.scenes ?? ',month=2&weather=snow,month=10&weather=rain,month=7&weather=clear')
  .split(',')
  .map((s) => s.trim())

const PROFILES = {
  pc: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    cpu: 1,
    canvas: [2160, 1350],
  },
  pc1: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    cpu: 1,
    canvas: [1440, 900],
  },
  phone: {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    cpu: 4,
    canvas: [1266, 585],
  },
}

/**
 * 合格の基準（functional.md R3）。vsync ありで GPU があるときだけ判定する。
 * steady: approach・zone（判定に足るフレーム数がある場面のタグ）、onset: 赤が出てから 1 秒
 */
const PASS = {
  pc: { fpsP50: 59, msP95: 18.2, over33PerK: 1, msMax: 50, onsetOver: ['over33', 0] },
  pc1: { fpsP50: 59, msP95: 18.2, over33PerK: 1, msMax: 50, onsetOver: ['over33', 0] },
  phone: { fpsP50: 30, msP95: 34, over50PerK: 1, msMax: 100, onsetOver: ['over50', 0] },
}
const MIN_FRAMES = { approach: 600, zone: 300, onset: 30 }

const pw = await loadPlaywright(args.playwright)

const flags = ['--mute-audio', '--autoplay-policy=user-gesture-required']
if (!VSYNC) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit')
if (GPU) flags.push('--enable-gpu', '--ignore-gpu-blocklist')
else flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader')

const profile = PROFILES[PROFILE]
if (!profile) throw new Error(`unknown profile ${PROFILE}`)
const { cpu, canvas: expectedCanvas, ...contextOptions } = profile

// ページに差し込む計測（rAF の間隔と、そのときの場面のタグ）
const SAMPLER = () => {
  const s = {
    dts: [],
    tags: [],
    last: 0,
    on: false,
    settleUntil: 0,
    onsetUntil: 0,
    danger: false,
    locked: false,
    ended: false,
    /** 50 ms を超えたフレーム（間隔とタグ。どこで落ちたかを報告に書く） */
    long: [],
  }
  globalThis.__perfSampler = s
  s.settle = () => {
    s.settleUntil = performance.now() + 2000
  }
  const read = () => {
    const danger = Boolean(document.querySelector('[data-testid="danger-banner"]'))
    if (danger && !s.danger) s.onsetUntil = performance.now() + 1000
    s.danger = danger
    s.locked = Boolean(document.getElementById('drive-playback-locked'))
    s.ended = Boolean(document.querySelector('.drive-hud__end'))
  }
  new MutationObserver(read).observe(document.body, { childList: true, subtree: true })
  const tick = (t) => {
    if (s.on && s.last > 0) {
      const tag = s.ended
        ? 'ended'
        : t < s.settleUntil
          ? 'settle'
          : t < s.onsetUntil
            ? 'onset'
            : s.danger
              ? 'danger'
              : s.locked
                ? 'zone'
                : 'approach'
      s.dts.push(t - s.last)
      s.tags.push(tag)
      if (t - s.last > 50) s.long.push({ ms: Math.round(t - s.last), tag })
    }
    s.last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function summarize(dts) {
  if (dts.length === 0) return null
  const ms = [...dts].sort((a, b) => a - b)
  const round = (v) => Math.round(v * 100) / 100
  const p50 = quantile(ms, 0.5)
  return {
    frames: ms.length,
    msP50: round(p50),
    msP95: round(quantile(ms, 0.95)),
    msP99: round(quantile(ms, 0.99)),
    msMax: round(ms[ms.length - 1]),
    fpsP50: round(1000 / p50),
    fpsP5: round(1000 / quantile(ms, 0.95)),
    over33: ms.filter((v) => v > 33.4).length,
    over50: ms.filter((v) => v > 50).length,
  }
}

/** 行の判定（理由の列。空なら合格）。判定しない構成は null */
function judge(row) {
  if (!VSYNC || !GPU) return null
  const pass = PASS[PROFILE]
  const reasons = []
  if (/swiftshader|llvmpipe/i.test(row.renderer)) reasons.push(`GPU が無い（${row.renderer}）`)
  if (String(row.canvas) !== String(expectedCanvas))
    reasons.push(`Canvas が ${row.canvas}（${expectedCanvas} のはず）`)
  for (const tag of ['approach', 'zone']) {
    const s = row[tag]
    if (!s || s.frames < MIN_FRAMES[tag]) {
      reasons.push(`${tag} のフレームが足りない（${s?.frames ?? 0} < ${MIN_FRAMES[tag]}）`)
      continue
    }
    if (s.fpsP50 < pass.fpsP50) reasons.push(`${tag} fps p50 ${s.fpsP50} < ${pass.fpsP50}`)
    if (s.msP95 > pass.msP95) reasons.push(`${tag} p95 ${s.msP95} ms > ${pass.msP95}`)
    if (pass.over33PerK !== undefined && s.over33 > (s.frames / 1000) * pass.over33PerK)
      reasons.push(`${tag} 33.4 ms 超 ${s.over33}`)
    if (pass.over50PerK !== undefined && s.over50 > (s.frames / 1000) * pass.over50PerK)
      reasons.push(`${tag} 50 ms 超 ${s.over50}`)
    if (s.msMax > pass.msMax) reasons.push(`${tag} 最大 ${s.msMax} ms > ${pass.msMax}`)
  }
  const [key, limit] = pass.onsetOver
  // 赤の出始めを測れていない場面は合格にしない（鹿が出なかった・早送りで飛ばした）
  if (!row.onset || row.onset.frames < MIN_FRAMES.onset)
    reasons.push(`赤の出始めを測れていない（${row.onset?.frames ?? 0} < ${MIN_FRAMES.onset}）`)
  else if (row.onset[key] > limit) reasons.push(`赤の出始め ${key} ${row.onset[key]}`)
  return reasons
}

/** 1 場面を測る（ブラウザは場面ごとに起動し、途中で落ちても必ず閉じる） */
async function measureScene(scene) {
  const browser = await pw.chromium.launch(launchOptions(flags))
  try {
    return await driveScene(browser, scene)
  } finally {
    await browser.close()
  }
}

async function driveScene(browser, scene) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  if (cpu > 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  }
  const query = [scene, EXTRA].filter(Boolean).join('&')
  const url = `${BASE}/drive${query ? `?${query}` : ''}`
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(SAMPLER)
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : String(gl ? 'webgl2' : 'none')
  })
  const start = page.locator('.drive-start .drive-hud__primary')
  await start.waitFor({ timeout: 30_000 })
  await page.waitForSelector('.drive__scene canvas', { timeout: 30_000 })
  // 3D が 1 秒描いてから出発する（チャンクの到着とシェーダの最初のコンパイルを出発の前に済ませる）
  await page.waitForTimeout(1000)
  await start.click()
  await page.evaluate(() => {
    const s = globalThis.__perfSampler
    s.settle()
    s.on = true
  })
  await page.keyboard.down('KeyW')
  let braking = false
  let collisions = 0
  const t0 = Date.now()
  while (Date.now() - t0 < SECONDS * 1000) {
    const state = await page.evaluate(() => ({
      end: Boolean(document.querySelector('.drive-hud__end')),
      danger: globalThis.__perfSampler.danger,
      locked: globalThis.__perfSampler.locked,
      fast: document
        .querySelectorAll('.drive-hud__playback button')[1]
        ?.getAttribute('aria-pressed'),
    }))
    if (state.end) {
      collisions += 1
      await page.keyboard.up('KeyW')
      await page.keyboard.up('Space')
      // やり直しの作り直しのフレームも settle に入るよう、押す前に印を付ける
      await page.evaluate(() => globalThis.__perfSampler.settle())
      await page.locator('.drive-hud__end .drive-hud__primary').click()
      await page.evaluate(() => globalThis.__perfSampler.settle())
      await page.keyboard.down('KeyW')
      braking = false
    } else if (state.danger && !braking) {
      await page.keyboard.up('KeyW')
      await page.keyboard.down('Space')
      braking = true
    } else if (!state.danger && braking) {
      await page.keyboard.up('Space')
      await page.keyboard.down('KeyW')
      braking = false
    } else if (!state.locked && state.fast === 'false') {
      await page.locator('.drive-hud__playback button').nth(1).click()
    }
    await page.waitForTimeout(POLL_MS)
  }
  const sample = await page.evaluate(() => {
    const s = globalThis.__perfSampler
    s.on = false
    const c = document.querySelector('.drive__scene canvas')
    return { dts: s.dts, tags: s.tags, long: s.long, canvas: c ? [c.width, c.height] : null }
  })
  const byTag = {}
  for (const tag of ['settle', 'approach', 'zone', 'onset', 'danger', 'ended']) {
    byTag[tag] = summarize(sample.dts.filter((_, i) => sample.tags[i] === tag))
  }
  const row = {
    scene: scene || 'default',
    profile: PROFILE,
    vsync: VSYNC,
    gpu: GPU,
    renderer,
    canvas: sample.canvas,
    long: sample.long,
    collisions,
    ...byTag,
  }
  row.fail = judge(row)
  return row
}

const results = []
for (const scene of SCENES) {
  let row
  try {
    row = await measureScene(scene)
  } catch (error) {
    // 1 場面が落ちても、ほかの場面は測る（落ちた場面は NG として残す）
    row = { scene: scene || 'default', profile: PROFILE, fail: [`計測が落ちた: ${String(error)}`] }
  }
  results.push(row)
  console.log(JSON.stringify(row))
  // 場面ごとに書き直す（途中で止めても測れた分は残る）
  if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2))
}
const failed = results.filter((r) => r.fail && r.fail.length > 0)
for (const r of failed) console.error(`NG ${r.profile} ${r.scene}: ${r.fail.join(' / ')}`)
if (failed.length > 0) process.exitCode = 1
