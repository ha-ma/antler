#!/usr/bin/env node
// A（apps/sim）の運転画面の fps を実測する（docs/specs/performance/functional.md R2、ch6「A 性能」）。
//
// 本番ビルドを `vite preview` で出しておき、Playwright の Chromium で /drive の見本の場面を開いて
// 「出発」→ W を押し続けて走る。鹿ゾーンの外は 4× で早送りし（区間の境界をたくさんまたぐ）、ゾーンの中は 1×。
// 赤（前方に鹿）の間はブレーキ（Space）。衝突したら「もう一度」で走り直す。音は --mute-audio で出さない。
// rAF の間隔はページに差し込んだ requestAnimationFrame のループで取る（アプリの計測とは独立）。
//
// 使い方（Playwright はリポジトリの依存に入れていない。手元の npx のキャッシュなどを PLAYWRIGHT_DIR で指す）:
//   npm --prefix apps/sim run build && npx --prefix apps/sim vite preview --port 5224 --strictPort
//   PLAYWRIGHT_DIR=~/.npm/_npx/<hash>/node_modules/playwright \
//     node scripts/perf/measure-drive.mjs --profile pc --vsync on --seconds 90 --out /tmp/pc.json
//
// --profile: pc（1440×900・DPR 2。MacBook の内蔵 GPU）/ pc1（1440×900・DPR 1）/
//            phone（844×390・DPR 3・タッチ・CPU 4× 減速。iPhone 13 / Pixel 6 の横画面の CPU 側の目安）
// --vsync off: --disable-gpu-vsync --disable-frame-rate-limit（vsync に隠れない 1 フレームの仕事を見る）
// --gpu off: SwiftShader（GPU なし。参考値）
// --scenes: カンマ区切りの URL のクエリ（既定は 既定・雪・紅葉の雨・夏の晴れ）
// --query: 各場面のクエリに足す（例 "fps=1"）

import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

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
const SECONDS = Number(args.seconds ?? 90)
const WARMUP_S = 3
const EXTRA = args.query ?? ''
const SCENES = (args.scenes ?? ',month=2&weather=snow,month=10&weather=rain,month=7&weather=clear')
  .split(',')
  .map((s) => s.trim())

const PROFILES = {
  pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, cpu: 1 },
  pc1: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, cpu: 1 },
  phone: {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    cpu: 4,
  },
}

const dir = (args.playwright ?? process.env.PLAYWRIGHT_DIR ?? 'playwright').replace(/^~/, homedir())
const pw = await import(dir.includes('/') ? pathToFileURL(`${dir}/index.mjs`).href : dir)

const flags = ['--mute-audio', '--autoplay-policy=user-gesture-required']
if (!VSYNC) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit')
if (GPU) flags.push('--enable-gpu', '--ignore-gpu-blocklist')
else flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader')

// CHROME_PATH: Playwright の版とブラウザの版が合わないとき、手元の Chromium を直接指す
const executablePath = process.env.CHROME_PATH?.replace(/^~/, homedir())
const browser = await pw.chromium.launch({
  channel: 'chromium',
  headless: true,
  args: flags,
  ...(executablePath ? { executablePath } : {}),
})
const profile = PROFILES[PROFILE]
if (!profile) throw new Error(`unknown profile ${PROFILE}`)
const { cpu, ...contextOptions } = profile

// ページに差し込む計測（rAF の間隔と、そのときの場面のタグ）
const SAMPLER = () => {
  const s = { dts: [], tags: [], tag: 'start', last: 0, on: false }
  globalThis.__perfSampler = s
  const tick = (t) => {
    if (s.on && s.last > 0) {
      s.dts.push(t - s.last)
      s.tags.push(s.tag)
    }
    s.last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setInterval(() => {
    const danger = document.querySelector('[data-testid="danger-banner"]')
    const locked = document.getElementById('drive-playback-locked')
    s.tag = danger ? 'danger' : locked ? 'zone' : 'approach'
  }, 100)
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null
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

const results = []
for (const scene of SCENES) {
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
  await page.waitForSelector('canvas', { timeout: 30_000 })
  await start.click()
  await page.keyboard.down('KeyW')
  let braking = false
  let collisions = 0
  const t0 = Date.now()
  let measuring = false
  while (Date.now() - t0 < (SECONDS + WARMUP_S) * 1000) {
    if (!measuring && Date.now() - t0 > WARMUP_S * 1000) {
      measuring = true
      await page.evaluate(() => {
        globalThis.__perfSampler.on = true
      })
    }
    const state = await page.evaluate(() => ({
      end: Boolean(document.querySelector('.drive-hud__end')),
      danger: Boolean(document.querySelector('[data-testid="danger-banner"]')),
      locked: Boolean(document.getElementById('drive-playback-locked')),
      fast: document
        .querySelectorAll('.drive-hud__playback button')[1]
        ?.getAttribute('aria-pressed'),
    }))
    if (state.end) {
      collisions += 1
      await page.keyboard.up('KeyW')
      await page.keyboard.up('Space')
      await page.locator('.drive-hud__end .drive-hud__primary').click()
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
    await page.waitForTimeout(150)
  }
  const sample = await page.evaluate(() => {
    const s = globalThis.__perfSampler
    s.on = false
    const c = document.querySelector('.drive__scene canvas')
    return { dts: s.dts, tags: s.tags, canvas: c ? [c.width, c.height] : null }
  })
  const byTag = {}
  for (const tag of ['approach', 'zone', 'danger']) {
    byTag[tag] = summarize(sample.dts.filter((_, i) => sample.tags[i] === tag))
  }
  const row = {
    scene: scene || 'default',
    profile: PROFILE,
    vsync: VSYNC,
    gpu: GPU,
    renderer,
    canvas: sample.canvas,
    collisions,
    all: summarize(sample.dts),
    ...byTag,
  }
  results.push(row)
  console.log(JSON.stringify({ ...row }))
  await context.close()
}
await browser.close()
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2))
