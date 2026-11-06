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

/** 楽しみの話の時（drive-tourism T2）。これから行く・さっき行った */
export type PleasureTiming = 'ahead' | 'done'

/** 楽しみの話の切り口（drive-tourism T3）。同じ楽しみの話が続いても同じ文にならないように */
export type PleasureAngle = 'anticipation' | 'highlight' | 'tip' | 'memory'

/** その日の楽しみか、後の日の楽しみか（drive-tourism T4・M5。Claude が「今日」と「旅の後半」を書き分ける） */
export type PleasureWhen = 'today' | 'later'

/**
 * 束の 1 行の計画。pleasure は応答・保存にも出す（drive-tourism T6。写真を出すため）。
 * timing・angle・light は Claude の材料だけに使い、応答・保存には出さない
 */
export type ChatPlanLine = {
  id: string
  cue: RoadCue
  topic: ChatTopic
  speaker: ChatSpeaker
  /** pleasure の話題のときの楽しみの id（drive-tourism T2 の候補）。ほかは null */
  pleasure: string | null
  /** pleasure の話題のときの時。ほかは null */
  timing: PleasureTiming | null
  /** pleasure の話題のときの切り口。ほかは null */
  angle: PleasureAngle | null
  /** pleasure の話題のとき、その日の楽しみか後の日の楽しみか（drive-tourism M5）。ほかは null */
  when: PleasureWhen | null
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

/** 応答・保存する行（sim が zod で確かめる形。drive-tourism で pleasure を足した。ほかの欄は増やさない） */
export type ChatLine = {
  id: string
  cue: RoadCue
  topic: ChatTopic
  speaker: ChatSpeaker
  /** 楽しみの話の行の楽しみの id（sim が写真を出す）。ほかは null */
  pleasure: string | null
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
    /** 楽しみの話の材料（drive-tourism T4）。note・所要の時間の数は渡さない */
    pleasure: PleasureBrief | null
    light: Light | null
  }[]
}

/** 楽しみの話の材料（drive-tourism T4）。マスターの名前と地名、区分だけ（数字を含まない） */
export type PleasureBrief = {
  name: LocalizedText
  /** 拠点の地名（マスター） */
  place: LocalizedText | null
  timeOfDay: 'day' | 'night' | 'dawn'
  /** 所要の区分: short 2 時間以下 / half 4 時間以下 / long それより長い */
  length: 'short' | 'half' | 'long'
  timing: PleasureTiming
  angle: PleasureAngle
  when: PleasureWhen
}
