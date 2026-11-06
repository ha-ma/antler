import type { Lang } from '@antler/schema'

// 車内の会話の型（docs/specs/drive-audio-chat/functional.md R10〜R13・R18・R19、drive-tourism T8〜T10）。

/** 話し手。p1 助手席・p2 後部座席左・p3 後部座席右・radio は 1 人旅のラジオの DJ（氏名は作らない） */
export type Speaker = 'p1' | 'p2' | 'p3' | 'radio'

export type RoadTopic = 'depart' | 'pleasure' | 'weather' | 'light' | 'scenery' | 'snack' | 'music'

export type ReactionKind = 'zone-enter' | 'zone-exit' | 'avoided'

export type LocalizedLine = Record<Lang, string>

/** 話の行（その日の leg 番目の移動の km 地点を過ぎたら出す） */
export type ChatLine = {
  id: string
  cue: { kind: 'road'; leg: number; km: number }
  topic: RoadTopic
  speaker: Speaker
  /** 楽しみの話の行の楽しみの id（写真を出す。drive-tourism T8・T10）。ほかは null */
  pleasure: string | null
  text: LocalizedLine
}

/** その日の会話の束（api の応答の chat、または端末の見本の会話） */
export type ChatDeck = {
  tripId: string
  day: number
  lines: ChatLine[]
  /** 束を作ったデータの版（見本の会話は null） */
  data: { routes: string; zones: string } | null
}

/** 反応の 1 行（固定の表から。R10） */
export type ReactionLine = { speaker: Speaker; text: LocalizedLine }

/** 運転の道のりに写した会話（buildChatTrack が作る） */
export type ChatTrack = {
  /** 束が替わったかを見分ける鍵 */
  key: string
  /** 道のり（m）の順 */
  road: {
    id: string
    atM: number
    speaker: Speaker
    pleasure: string | null
    text: LocalizedLine
  }[]
  /** 種類ごとに 2 行（アラート OFF の走行でも avoided は使う） */
  reactions: Record<ReactionKind, readonly [ReactionLine, ReactionLine]>
}

/** 画面に出す 1 行。pleasure があれば楽しみの写真と出典を添える（drive-tourism T8） */
export type FeedLine = {
  key: string
  speaker: Speaker
  pleasure: string | null
  text: LocalizedLine
}
