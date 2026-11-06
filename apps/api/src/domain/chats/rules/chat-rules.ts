// 車内の会話の束の定数（docs/specs/drive-audio-chat/functional.md R10・R11・R15・R17）。

/** 出発の行を置く道のり（各移動の始まりから） */
export const DEPART_KM = 0.2
/** 出発の行がゾーンの中なら、出口の何 km 先に動かすか */
export const DEPART_AFTER_EXIT_KM = 0.2
/** 話の行の候補 1 つあたりの移動の距離（k = min(3, floor(距離 ÷ 15))） */
export const TALK_INTERVAL_KM = 15
export const MAX_TALKS_PER_LEG = 3
/** 話の行の合計（1 日。depart は数えない） */
export const MAX_TALKS_PER_DAY = 10
/** 候補の位置の揺らぎ（移動の距離に対する割合。±10%） */
export const TALK_JITTER_RATIO = 0.1
/** 移動の始まり・終わりから空ける道のり（話の行は [1 km, 距離 − 1 km]。出発の行も終わりの 1 km 手前まで） */
export const EDGE_MARGIN_KM = 1
/** ゾーンの中に落ちた話の行を、入口の何 km 手前に動かすか */
export const ZONE_MARGIN_KM = 1
/** 同じ移動の他の行とこれ以内なら、その候補は作らない */
export const MIN_GAP_KM = 1
/** km を丸める桁（0.1 km。配置の時点で丸め、間隔・ゾーンの判定は丸めた値でする） */
export const KM_DIGITS = 1

/** 一言の長さ（各言語。コードポイントで数える） */
export const CHAT_TEXT_MAX_LENGTH = 60
/** 1 つの旅に保存できる会話の束（旅程を作り直して鍵を変え続けられないように） */
export const MAX_CHATS_PER_TRIP = 30
/** Claude の出力が外れたときの作り直し（最初の 1 回 + 1 回） */
export const MAX_CHAT_WRITER_ATTEMPTS = 2
/** 外れが続いた鍵を覚える時間（その間は Claude を呼ばずに失敗を返す） */
export const CHAT_FAILURE_MEMORY_MS = 10 * 60_000
/** 保存の鍵の版（束の組み立てを変えたら上げる） */
export const CHAT_KEY_VERSION = 'chat:v1'
