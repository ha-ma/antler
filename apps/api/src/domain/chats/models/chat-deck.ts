import type { Light } from '../../stop-events/models/stop-deck.js'
import type { LocalizedText, TripLang } from '../../trips/models/trip-writing.js'

// 車内の会話の束（docs/specs/drive-audio-chat/functional.md R10・R11・R16）。純粋な型だけ。
// いつ・誰が・何の話題では api が旅程から決定的に決め（ChatPlan）、Claude は一言（text）だけを書く（ChatWriting）。

export const CHAT_TOPICS = [
  'depart',
  'pleasure',
  'weather',
  'light',
  'scenery',
  'snack',
  'music',
] as const
export type ChatTopic = (typeof CHAT_TOPICS)[number]
/** depart 以外の話題（シード付き乱数で選ぶ） */
export type TalkTopic = Exclude<ChatTopic, 'depart'>

/** 同乗者の席（p1 助手席・p2 後部座席左・p3 後部座席右）と、1 人旅のラジオの DJ */
export type ChatSpeaker = 'p1' | 'p2' | 'p3' | 'radio'

/** その日の leg 番目の移動の km 地点を過ぎたら出す（反応の行は端末の表なので api は作らない） */
export type RoadCue = { kind: 'road'; leg: number; km: number }

/** 束の 1 行の計画。pleasure・light は Claude の材料だけに使い、応答・保存には出さない */
export type ChatPlanLine = {
  id: string
  cue: RoadCue
  topic: ChatTopic
  speaker: ChatSpeaker
  /** pleasure の話題のときの楽しみの id（その日のこれからの楽しみ）。ほかは null */
  pleasure: string | null
  /** light の話題のときの、しおりどおりの通過時刻の光。ほかは null */
  light: Light | null
}

export type ChatDataVersion = { routes: string; zones: string }

export type ChatPlan = {
  tripId: string
  day: number
  lines: ChatPlanLine[]
  data: ChatDataVersion
}

/** 応答・保存する行（sim が zod で確かめる形。欄を増やさない） */
export type ChatLine = {
  id: string
  cue: RoadCue
  topic: ChatTopic
  speaker: ChatSpeaker
  text: LocalizedText
}

export type ChatDeck = {
  tripId: string
  day: number
  lines: ChatLine[]
  /** 束を作ったデータの版（DayPlan の data の routes・zones） */
  data: ChatDataVersion
}

export type StoredChat = {
  keyHash: string
  tripId: string
  day: number
  deck: ChatDeck
  createdAtMs: number
}

/** Claude の出力（検証前） */
export type ChatWriting = { lines: { id: string; text: LocalizedText }[] }

/**
 * Claude に渡す材料（R16）。マスターの地名・楽しみの名前（4 言語）、話題、席、人数、経験、月、天気・路面、光だけ。
 * 自由入力・統計の数字・金額・時刻を含まない（WRITE-2d）
 */
export type ChatWritingBrief = {
  lang: TripLang
  partySize: number
  experience: 'first' | 'few' | 'experienced'
  month: number
  conditions: {
    weather: 'clear' | 'cloudy' | 'snow' | 'fog'
    surface: 'dry' | 'wet' | 'packed-snow' | 'ice'
  }
  lines: {
    id: string
    topic: ChatTopic
    speaker: ChatSpeaker
    /** その行の移動の出発地と行き先 */
    from: LocalizedText | null
    to: LocalizedText | null
    pleasure: LocalizedText | null
    light: Light | null
  }[]
}
