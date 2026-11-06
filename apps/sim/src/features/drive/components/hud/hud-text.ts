import type { Lang } from '@antler/schema'
import type { Surface, Weather } from '../../types'

// HUD の文言。地の文は ja（4 言語化は i18n の feature、functional.md の Deferred）。
// 赤のバナーの左右だけは AlertState と同じく 4 言語（R7）。

export const HUD_TEXT = {
  start: {
    title: '国道 240 号 釧路 → 阿寒',
    lead: '実在の鹿ゾーン（北海道開発局の資料から作成）を、2 月の夕方に走ります。',
    alertOn: '鹿アラート ON: 鹿ゾーンで琥珀とチャイム、カメラが鹿を見つけたら赤とビープ',
    alertOff: '鹿アラート OFF: スマホのアラートと音は出ません。鹿ゾーンの表示だけ残ります',
    go: '出発（音を出します）',
  },
  controls: [
    ['W', '加速'],
    ['S', '減速・後退'],
    ['A / D', 'ハンドル'],
    ['Space', 'ブレーキ'],
    ['マウス', '視線'],
  ] as const,
  zone: {
    nextZone: '次の鹿ゾーンまで',
    arrival: '到達',
    noNextZone: 'この先に鹿ゾーンはありません',
    inZone: '鹿ゾーン走行中 残り',
    danger: '前方に鹿',
  },
  time: { sunset: '日没', driving: '運転' },
  playback: {
    label: '再生速度',
    pause: '一時停止',
    resume: '再開',
    locked: '鹿ゾーンの中は 1× だけ',
  },
  sound: { on: '音 ON', off: '音 OFF', label: '音' },
  end: {
    collided: '鹿と衝突しました',
    collidedNote: '喪失の画面（A-6）はこの後の作業で入ります。',
    completed: '完走しました',
    completedNote: '旅の記録（A-7）はこの後の作業で入ります。',
    retry: '同じシードでもう一度',
  },
  route: {
    label: 'いまの区間',
    destination: '目的地まで',
    arrival: '到着予定',
    stage: 'ステージ',
    today: '今日の楽しみ',
  },
  stage: {
    cleared: (n: number, of: number) => `ステージ ${String(n)} / ${String(of)} クリア`,
    noZone: 'この日は鹿ゾーンを通りません。「出発」でこの日の運転を終えます。',
  },
  trip: {
    loading: '旅を読み込んでいます',
    notFound: '旅が見つかりません',
    dayNotFound: 'その日はありません',
    changed: 'この旅は古い形式です。旅をつくり直してください',
    rateLimited: '少し待ってからもう一度',
    failed: '読み込めませんでした',
    noMove: 'この日は移動がありません',
    retry: 'もう一度',
    toPlan: '旅をつくる（A-1）へ',
    toBrief: 'ブリーフィングに戻る',
    toFirstDay: '1 日目のブリーフィングへ',
    distance: '距離',
  },
  speedUnit: 'km/h',
  noWebgl:
    'このブラウザでは 3D を表示できません（WebGL2 が必要です）。最新の Chrome・Safari・Edge・Firefox で開いてください。',
} as const

export const WEATHER_TEXT: Record<Weather, string> = {
  clear: '晴れ',
  cloudy: '曇り',
  snow: '雪',
  fog: '霧',
}

export const SURFACE_TEXT: Record<Surface, string> = {
  dry: '乾燥',
  wet: '湿潤',
  'packed-snow': '圧雪',
  ice: '凍結',
}

/** 赤のバナーの左右（4 言語） */
export const SIDE_TEXT: Record<Lang, { L: string; R: string }> = {
  ja: { L: '左', R: '右' },
  en: { L: 'LEFT', R: 'RIGHT' },
  zh: { L: '左側', R: '右側' },
  ko: { L: '왼쪽', R: '오른쪽' },
}
