import { createRng, deriveSeed } from '../domain/rng'
import {
  FALLBACK_PLEASURE_TEXT,
  FILLER_PLEASURE_TEXT,
  RADIO_FILLER_PLEASURE_TEXT,
  RADIO_PLEASURE_TEXT,
  REACTION_TEXT,
} from './chat-text'
import type {
  ChatDeck,
  ChatTrack,
  FillerLine,
  LocalizedLine,
  ReactionKind,
  ReactionLine,
  Speaker,
} from './chat-types'

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
  /** 補いの観光の行の楽しみと位置（drive-sound-tourism S14。tourismStops の順）。無ければ補わない */
  pleasures?: readonly { id: string; name: LocalizedLine; atM: number }[]
}

/**
 * 補いの観光の行（S14）。楽しみ × 言い回しの組を、回ごとに楽しみ順に並べ、楽しみごとに言い回しを 1 つずらす
 * （続けて同じ言い回しにしない）。話し手は人数で決め、シードで選ぶ（2 人以上なら続けて同じ人にしない）
 */
export function buildFiller(
  pleasures: NonNullable<TrackContext['pleasures']>,
  partySize: number,
  seed: number,
): FillerLine[] {
  if (pleasures.length === 0) return []
  const speakers = speakersFor(partySize)
  const solo = speakers.length === 1 && speakers[0] === 'radio'
  const table = solo
    ? [...RADIO_PLEASURE_TEXT, ...RADIO_FILLER_PLEASURE_TEXT]
    : [...FALLBACK_PLEASURE_TEXT, ...FILLER_PLEASURE_TEXT]
  const rng = createRng(deriveSeed(seed, 'chat-filler'))
  let last: Speaker | null = null
  const lines: FillerLine[] = []
  for (let round = 0; round < table.length; round++) {
    pleasures.forEach((p, i) => {
      const make = table[(round + i) % table.length]
      if (!make) return
      const pool = speakers.length > 1 ? speakers.filter((s) => s !== last) : speakers
      const speaker = pool[Math.floor(rng() * pool.length)] ?? 'radio'
      last = speaker
      lines.push({ speaker, pleasure: p.id, text: make(p.name), untilM: p.atM })
    })
  }
  return lines
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
    filler: buildFiller(ctx.pleasures ?? [], ctx.partySize, ctx.seed),
  }
}
