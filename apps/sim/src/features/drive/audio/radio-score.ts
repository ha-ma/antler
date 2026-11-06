import { createRng, deriveSeed } from '../domain/rng'

// 車内のラジオの曲（docs/specs/drive-audio-chat/functional.md R5）。自作。シードで決まる 8 小節の和音の進行と分散和音。
// 純粋関数で音の列だけを作り、鳴らすのは audio-graph.ts。同じシード → 同じ曲（乱数はシード付き）。

export const RADIO_BPM = 84
export const BAR_BEATS = 4
const BARS = 8

export type Voice = 'bass' | 'pad' | 'lead'

export type ScoreNote = {
  /** 小節の中の拍（0 から） */
  beat: number
  /** MIDI の音の番号（60 = C4） */
  midi: number
  /** 長さ（拍） */
  beats: number
  voice: Voice
}

export type RadioScore = { bpm: number; bars: ScoreNote[][] }

/** 和音（根音の半音と、長調か短調か） */
type Chord = { root: number; minor: boolean }
const I: Chord = { root: 0, minor: false }
const IV: Chord = { root: 5, minor: false }
const V: Chord = { root: 7, minor: false }
const VI: Chord = { root: 9, minor: true }
const II: Chord = { root: 2, minor: true }

/** 4 小節の進行（2 回くり返して 8 小節） */
const PROGRESSIONS: Chord[][] = [
  [I, V, VI, IV],
  [VI, IV, I, V],
  [I, VI, IV, V],
  [IV, I, V, VI],
  [I, IV, II, V],
]
/** 分散和音の型（和音の音の番号。0 = 根音、1 = 3 度、2 = 5 度、3 = 上の根音） */
const ARPEGGIOS: number[][] = [
  [0, 1, 2, 3, 2, 1, 0, 1],
  [0, 2, 1, 2, 3, 2, 1, 2],
  [0, 1, 2, 1, 3, 1, 2, 1],
  [2, 1, 0, 1, 2, 3, 2, 1],
]
/** 調（C を 0 とした半音）。A〜E の明るい音域 */
const KEYS = [-3, -1, 0, 2, 4]

function chordTones(chord: Chord): number[] {
  return [chord.root, chord.root + (chord.minor ? 3 : 4), chord.root + 7, chord.root + 12]
}

function pick<T>(items: readonly T[], u: number): T {
  return items[Math.min(items.length - 1, Math.floor(u * items.length))] as T
}

export function radioScore(seed: number): RadioScore {
  const rng = createRng(deriveSeed(seed, 'radio'))
  const key = pick(KEYS, rng())
  const progression = pick(PROGRESSIONS, rng())
  const arpeggio = pick(ARPEGGIOS, rng())
  const bars: ScoreNote[][] = []
  for (let bar = 0; bar < BARS; bar++) {
    const chord = progression[bar % progression.length] as Chord
    const tones = chordTones(chord)
    const notes: ScoreNote[] = [
      // ベース: 根音を 2 分音符で 2 回（2 回目は 5 度のこともある）
      { beat: 0, midi: 36 + key + chord.root, beats: 2, voice: 'bass' },
      {
        beat: 2,
        midi: 36 + key + chord.root + (rng() < 0.4 ? 7 : 0),
        beats: 2,
        voice: 'bass',
      },
      // 和音: 3 音を全音符で
      ...tones
        .slice(0, 3)
        .map((t): ScoreNote => ({ beat: 0, midi: 55 + key + t, beats: 4, voice: 'pad' })),
    ]
    // 分散和音: 8 分音符で 8 つ。最後の小節の後半は休む（くり返しのつなぎ目）
    const steps = bar === BARS - 1 ? 4 : 8
    for (let i = 0; i < steps; i++) {
      const tone = tones[arpeggio[i] ?? 0] ?? 0
      notes.push({ beat: i / 2, midi: 67 + key + tone, beats: 0.5, voice: 'lead' })
    }
    bars.push(notes)
  }
  return { bpm: RADIO_BPM, bars }
}

/** MIDI の音の番号 → 周波数（A4 = 440 Hz） */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}
