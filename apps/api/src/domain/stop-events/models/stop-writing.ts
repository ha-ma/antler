import type { LocalizedText } from '../../trips/models/trip-writing.js'
import type { ChoiceKind, Light, SceneKind } from './stop-deck.js'

// Claude に書かせる出来事の文と、Claude に渡す材料（docs/specs/stop-events/functional.md R7）。純粋な型だけ。

/** Claude の出力（検証前）。場面と選択肢の id・数・順は束と同じ */
export type StopWriting = {
  scenes: {
    id: string
    headline: LocalizedText
    body: LocalizedText
    choices: { id: string; label: LocalizedText; note: LocalizedText }[]
  }[]
}

/**
 * Claude に渡す材料。すべて選択肢由来の値（マスターの名前・種類・遅れ・光・失う重さ）で、自由入力の文字列を含まない。
 * 時刻・金額・統計は渡さない（画面が計算値を出す。R1・R7）。
 */
export type StopWritingBrief = {
  lang: 'ja' | 'en' | 'zh' | 'ko'
  area: 'doto' | 'doo'
  month: number
  party: { size: number; experience: 'first' | 'few' | 'experienced' }
  conditions: { weather: string; surface: string }
  from: LocalizedText | null
  to: LocalizedText | null
  scenes: {
    id: string
    kind: SceneKind
    pleasure: { name: LocalizedText; weight: number; timeOfDay: 'day' | 'night' | 'dawn' } | null
    /** その場面のいる場所の名前（楽しみの拠点・今の移動の出発地） */
    place: LocalizedText | null
    choices: {
      id: string
      kind: ChoiceKind
      delayMin: number
      endsDay: boolean
      /** その後で通る鹿ゾーンの光（通らないなら null） */
      zoneLight: Light | null
      lostWeight: number
      lostPleasures: LocalizedText[]
    }[]
  }[]
}
