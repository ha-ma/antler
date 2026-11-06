import { createRng, deriveSeed } from '../domain/rng'
import { REACTION_TEXT } from './chat-text'
import type { ChatDeck, ChatTrack, ReactionKind, ReactionLine, Speaker } from './chat-types'

// 会話の束を運転の道のりに写す（docs/specs/drive-audio-chat/functional.md R10・R12）。純粋関数。
// - 話の行: 移動の始まりの道のり ＋ km。次の移動の始まり − 1 km で抑える（api の km と道の長さのずれで次の移動に食い込まない）
// - 反応の行: 固定の表（chat-text.ts）から、話し手を種で選ぶ

export type TrackContext = {
  /** 各移動の始まりの道のり（m）。[0, ...scenario.legStarts.map(l => l.sM)] */
  legStartsM: readonly number[]
  /** ルート全体の長さ（m） */
  totalM: number
  partySize: number
  /** DriveScenario.seed */
  seed: number
}

/** 同乗者は人数 − 1 人（最大 3）。1 人旅はラジオの DJ（R10） */
export function speakersFor(partySize: number): Speaker[] {
  if (partySize <= 1) return ['radio']
  return (['p1', 'p2', 'p3'] as const).slice(0, Math.min(3, partySize - 1))
}

const MARGIN_M = 1000

export function buildChatTrack(deck: ChatDeck, ctx: TrackContext): ChatTrack {
  const road = deck.lines
    .map((line) => {
      const start = ctx.legStartsM[line.cue.leg] ?? 0
      const next = ctx.legStartsM[line.cue.leg + 1]
      const limit = next === undefined ? ctx.totalM : Math.max(start, next - MARGIN_M)
      const atM = Math.min(limit, start + line.cue.km * 1000)
      return { id: line.id, atM, speaker: line.speaker, pleasure: line.pleasure, text: line.text }
    })
    .sort((a, b) => a.atM - b.atM)

  const speakers = speakersFor(ctx.partySize)
  const rng = createRng(deriveSeed(ctx.seed, 'chat-reactions'))
  const pick = (): Speaker => speakers[Math.floor(rng() * speakers.length)] ?? 'radio'
  const reactionsOf = (kind: ReactionKind): readonly [ReactionLine, ReactionLine] => {
    const [a, b] = REACTION_TEXT[kind]
    return [
      { speaker: pick(), text: a },
      { speaker: pick(), text: b },
    ]
  }
  const dataKey = deck.data ? `${deck.data.routes}|${deck.data.zones}` : 'local'
  return {
    key: `${deck.tripId}|${String(deck.day)}|${dataKey}|${String(deck.lines.length)}`,
    road,
    reactions: {
      'zone-enter': reactionsOf('zone-enter'),
      'zone-exit': reactionsOf('zone-exit'),
      avoided: reactionsOf('avoided'),
    },
  }
}
