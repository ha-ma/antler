import { toJst, type Lang } from '@antler/schema'
import { placeById, pleasureById } from '@antler/trip'
import type { LightPeriod } from '@antler/zones'
import { fillText, LOSS_TEXT } from '../text'

// A-6 の表示の整形（時刻は JST の分まで、切り捨て）。

/** HH:MM（JST） */
export function clockOf(iso: string): string {
  return toJst(iso).slice(11, 16)
}

export function placeName(id: string, lang: Lang): string {
  return placeById(id)?.name[lang] ?? id
}

export function pleasureName(id: string, lang: Lang): string {
  return pleasureById(id)?.name[lang] ?? id
}

/** 件数などの 3 桁区切り */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** 「2024-10」→ 言語ごとの年月 */
export function monthLabel(ym: string, lang: Lang): string {
  const [y = '', m = ''] = ym.split('-')
  return fillText(LOSS_TEXT.month[lang], { y, m: String(Number(m)) })
}

const LIGHT_KEY = {
  day: 'lightDay',
  dawn: 'lightDawn',
  dusk: 'lightDusk',
  night: 'lightNight',
} as const

/** 衝突の事実の 1 文（R5 の最後。Claude に書かせない端末の定型文） */
export function factSentence(
  c: {
    light: LightPeriod | null
    side: 'L' | 'R' | null
    speedKmh: number | null
    alertEnabled: boolean
  },
  lang: Lang,
): string {
  const t = LOSS_TEXT
  // 光・側・速さがそろっていれば詳しい文、どれかが分からなければ（DriveResult から来たとき）短い文
  const detailed =
    c.light !== null && c.side !== null && c.speedKmh !== null
      ? fillText(t.fact[lang], {
          light: t[LIGHT_KEY[c.light]][lang],
          side: t[c.side === 'L' ? 'sideL' : 'sideR'][lang],
          speed: c.speedKmh,
        })
      : t.factPlain[lang]
  const parts = [detailed, c.alertEnabled ? null : t.alertOff[lang], t.carDone[lang]]
  // 英語と韓国語は文の間に空白を置く（日本語・中国語は詰める）
  return parts.filter(Boolean).join(lang === 'en' || lang === 'ko' ? ' ' : '')
}
