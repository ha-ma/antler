import { createRng, deriveSeed } from '../domain/rng'

// 車内の BGM の曲（docs/specs/drive-sound-tourism/functional.md S1・S2・S4）。
// OpenGameArt の CC0 の 3 曲。ファイルは apps/sim/public/audio/music/（−18 LUFS・モノラル 64 kbps の mp3）。
// 出所は CREDITS.md、ライセンス本文は apps/sim/public/audio/CC0-1.0.txt。

export type MusicTrack = {
  id: string
  title: string
  author: string
  /** 出典（配布のページ） */
  source: string
  license: 'CC0-1.0'
  /** public/ からのパス */
  file: string
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    id: 'calm-track',
    title: 'Calm Track',
    author: 'pmiller',
    source: 'https://opengameart.org/content/calm-track',
    license: 'CC0-1.0',
    file: 'audio/music/calm-track.mp3',
  },
  {
    id: 'slow-stride',
    title: 'Slow Stride',
    author: 'isaiah658',
    source: 'https://opengameart.org/content/slow-stride',
    license: 'CC0-1.0',
    file: 'audio/music/slow-stride.mp3',
  },
  {
    id: 'morning-sky',
    title: 'Morning Sky',
    author: 'Centurion_of_war',
    source: 'https://opengameart.org/content/morning-sky',
    license: 'CC0-1.0',
    file: 'audio/music/morning-sky.mp3',
  },
]

/** 短い音（ブレーキの鳴き・衝突。S9・S12）。public/ からのパス */
export const SAMPLE_FILES = {
  squeal: 'audio/sfx/tire-squeal.mp3',
  crash: 'audio/sfx/crash.mp3',
} as const

export type SampleName = keyof typeof SAMPLE_FILES

/** 最初の曲（S4）。同じシード → 同じ曲 */
export function firstTrackIndex(seed: number): number {
  const rng = createRng(deriveSeed(seed, 'music'))
  return Math.min(MUSIC_TRACKS.length - 1, Math.floor(rng() * MUSIC_TRACKS.length))
}

/** 次の曲（最後の次は最初） */
export function nextTrackIndex(index: number): number {
  return (index + 1) % MUSIC_TRACKS.length
}

/** 配信の URL（Vite の BASE_URL を前に付ける） */
export function assetUrl(file: string, base: string): string {
  return `${base}${file}`
}
