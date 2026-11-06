// @vitest-environment node
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUSIC_TRACKS, SAMPLE_FILES } from './music-tracks'

// 音源のファイル・大きさ・出所（docs/specs/drive-sound-tourism/functional.md S1・S2・S10）

const PUBLIC = fileURLToPath(new URL('../../../../public/', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url))
const MB = 1024 * 1024

describe('音源（S1・S2・S10）', () => {
  it('SND-1a: 曲は 3 曲（CC0・作者・出典 URL つき）。1 曲 2.5 MB 以下・合計 5 MB 以下。CC0 の本文と CREDITS に 3 曲', () => {
    expect(MUSIC_TRACKS).toHaveLength(3)
    let total = 0
    const credits = readFileSync(`${ROOT}CREDITS.md`, 'utf8')
    for (const track of MUSIC_TRACKS) {
      expect(track.license).toBe('CC0-1.0')
      expect(track.author).not.toBe('')
      expect(track.source).toMatch(/^https:\/\//)
      expect(track.file).toMatch(/^audio\/music\/[a-z-]+\.mp3$/)
      const size = statSync(`${PUBLIC}${track.file}`).size
      expect(size).toBeLessThanOrEqual(2.5 * MB)
      total += size
      expect(credits).toContain(track.source)
      expect(credits).toContain(track.file)
    }
    expect(total).toBeLessThanOrEqual(5 * MB)
    expect(readFileSync(`${PUBLIC}audio/CC0-1.0.txt`, 'utf8')).toContain('CC0 1.0 Universal')
  })

  it('SND-1a: 短い音（鳴き・衝突）は合わせて 100 KB 以下で、CREDITS に出所がある', () => {
    const credits = readFileSync(`${ROOT}CREDITS.md`, 'utf8')
    let total = 0
    for (const file of Object.values(SAMPLE_FILES)) {
      total += statSync(`${PUBLIC}${file}`).size
      expect(credits).toContain(file)
    }
    expect(total).toBeLessThanOrEqual(100 * 1024)
  })
})
