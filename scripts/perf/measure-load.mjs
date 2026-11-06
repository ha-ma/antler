#!/usr/bin/env node
// A（apps/sim）の初回読込を測る（docs/specs/performance/functional.md R5、ch6「初回読込は 3D アセットを除いて 3 秒以内」）。
//
// 本番ビルドを `vite preview` で出しておき、キャッシュの無い Chromium でページを開いて
// FCP・LCP・load と、読み込んだ JS / CSS の量（転送量）を取る。回線は CDP の Network.emulateNetworkConditions。
//   slow4g: Lighthouse のモバイルの Slow 4G を DevTools で当てた値（RTT 562.5 ms・下り 1,474.6 kbps・上り 675 kbps）＋ CPU 4× 減速
//   fast4g: RTT 150 ms・下り 9 Mbps・上り 1.5 Mbps ＋ CPU 4× 減速
//   none:   制限なし
// 使い方: PLAYWRIGHT_DIR=... [CHROME_PATH=...] node scripts/perf/measure-load.mjs --paths /plan,/drive --runs 3

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
const PATHS = (args.paths ?? '/plan').split(',')
const RUNS = Number(args.runs ?? 3)
const NETS = (args.nets ?? 'slow4g,fast4g,none').split(',')

const NETWORK = {
  slow4g: {
    latency: 562.5,
    downloadThroughput: (1474.56 * 1024) / 8,
    uploadThroughput: (675 * 1024) / 8,
    cpu: 4,
  },
  fast4g: {
    latency: 150,
    downloadThroughput: (9000 * 1024) / 8,
    uploadThroughput: (1500 * 1024) / 8,
    cpu: 4,
  },
  none: null,
}

const dir = (args.playwright ?? process.env.PLAYWRIGHT_DIR ?? 'playwright').replace(/^~/, homedir())
const pw = await import(dir.includes('/') ? pathToFileURL(`${dir}/index.mjs`).href : dir)
const executablePath = process.env.CHROME_PATH?.replace(/^~/, homedir())
const browser = await pw.chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio'],
  ...(executablePath ? { executablePath } : {}),
})

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const rows = []
for (const path of PATHS) {
  for (const net of NETS) {
    const runs = []
    for (let i = 0; i < RUNS; i += 1) {
      const context = await browser.newContext({
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
      })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      const n = NETWORK[net]
      if (n) {
        await cdp.send('Network.emulateNetworkConditions', { offline: false, ...n, cpu: undefined })
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: n.cpu })
      }
      await page.addInitScript(() => {
        globalThis.__lcp = 0
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) globalThis.__lcp = e.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
      })
      // 写真など後から来る LCP の候補も入るよう、通信が止んでから 1 秒待つ
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90_000 })
      await page.waitForTimeout(1000)
      const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]
        const res = performance.getEntriesByType('resource')
        const own = res.filter((r) => r.name.startsWith(location.origin))
        const kb = (xs) =>
          Math.round(
            xs.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 102.4,
          ) / 10
        return {
          fcp: Math.round(fcp?.startTime ?? 0),
          lcp: Math.round(globalThis.__lcp),
          load: Math.round(nav?.loadEventEnd ?? 0),
          jsKb: kb(own.filter((r) => r.name.endsWith('.js'))),
          cssKb: kb(own.filter((r) => r.name.endsWith('.css'))),
          jsFiles: own.filter((r) => r.name.endsWith('.js')).map((r) => r.name.split('/').pop()),
        }
      })
      runs.push(m)
      await context.close()
    }
    const row = {
      path,
      net,
      fcp: median(runs.map((r) => r.fcp)),
      lcp: median(runs.map((r) => r.lcp)),
      load: median(runs.map((r) => r.load)),
      jsKb: runs[0].jsKb,
      cssKb: runs[0].cssKb,
      jsFiles: runs[0].jsFiles,
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
}
await browser.close()
