import type { Lang } from '@antler/schema'
import type { Dashboard, NavHint } from '../domain/dashboard'

// ダッシュボード（drive-tune R5）の表示の文字。dashboardOf の値から純粋に決める（描画と分けてテストする）。
// 回転数は針で、ブレーキは描かない。どちらも文字に入れない（描き直しの鍵を変えない）。

export type DashboardText = {
  /** 速さ（km/h、整数） */
  speed: string
  /** D と段（D1〜D6）、後退は R */
  gear: string
  /** JST の hh:mm */
  clock: string
  /** 外気温（負はマイナス記号 U+2212） */
  temp: string
  abs: boolean
  /** ナビの次の案内（UC-4d） */
  nav: string
}

const JST_MS = 9 * 60 * 60 * 1000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 時計（JST）。端末のタイムゾーンに左右されないよう UTC に 9 時間足して読む（jstMonth と同じ） */
export function jstClock(atMs: number): string {
  const d = new Date(atMs + JST_MS)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** 距離（km）。10 km 未満は小数 1 桁、以上は整数。負は 0 */
export function formatKm(km: number): string {
  const v = Math.max(0, km)
  return v < 10 ? v.toFixed(1) : String(Math.round(v))
}

/**
 * ナビの次の案内の文（4 言語。`{km}` を差し込む。docs/specs/i18n/functional.md R5）。
 * canvas（Dashboard.tsx）への言語の配線は performance のセッションの範囲（i18n の Deferred）。それまで既定の ja で描く
 */
export const NAV_TEXT: Record<Lang, Record<NavHint['kind'], string>> = {
  ja: {
    'zone-ahead': '{km} km 先 鹿ゾーン',
    'in-zone': '鹿ゾーン 残り {km} km',
    destination: '目的地まで {km} km',
  },
  en: {
    'zone-ahead': 'Deer zone in {km} km',
    'in-zone': 'Deer zone, {km} km left',
    destination: '{km} km to destination',
  },
  zh: {
    'zone-ahead': '{km} km 後 鹿出沒區',
    'in-zone': '鹿出沒區 剩餘 {km} km',
    destination: '距目的地 {km} km',
  },
  ko: {
    'zone-ahead': '{km} km 앞 사슴 구역',
    'in-zone': '사슴 구역 남은 거리 {km} km',
    destination: '목적지까지 {km} km',
  },
}

export function navText(nav: NavHint, lang: Lang = 'ja'): string {
  return NAV_TEXT[lang][nav.kind].replace('{km}', formatKm(nav.km))
}

export function formatDashboard(d: Dashboard): DashboardText {
  const t = Math.round(d.outsideTempC)
  return {
    speed: String(Math.round(Math.abs(d.speedKmh))),
    gear: d.gear === 'R' ? 'R' : `D${d.gear}`,
    clock: jstClock(d.clockMs),
    temp: `${t < 0 ? '−' : ''}${Math.abs(t)}°C`,
    abs: d.abs,
    nav: navText(d.nav),
  }
}

/** 表示が変わったかを見る鍵（変わったときだけ canvas を描き直す） */
export function dashboardKey(t: DashboardText): string {
  return `${t.speed}|${t.gear}|${t.clock}|${t.temp}|${t.abs ? 1 : 0}|${t.nav}`
}
