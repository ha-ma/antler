import { pleasureById, type Pleasure } from '@antler/trip'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DriveEngine, type DriveSnapshot } from '../../domain/engine'
import { demoScenario } from '../../domain/scenario'
import { ZONES } from '../../domain/zones-data'
import {
  advanceRecommend,
  cardNote,
  INITIAL_RECOMMEND,
  pickRecommendation,
  RESUME_AFTER_MS,
  ROTATE_MS,
  rotationSlot,
  stopPositionsM,
  type RecommendFrame,
  type RecommendState,
} from './recommend'
import { RecommendCard } from './RecommendCard'
import { RecommendTracker } from './recommend-tracker'
import { RECOMMEND_TEXT } from './recommend-text'
import { STAGE_BANNER_MS } from './StageBanner'

// 鹿ゾーンの外のおすすめ（docs/specs/drive-tourism/functional.md T11〜T15、UC-4a〜UC-4d、
// docs/specs/drive-sound-tourism/functional.md S16〜S19、TOUR-6a〜TOUR-6d）

const DEMO = demoScenario(ZONES)
const TOTAL_M = new DriveEngine(DEMO, ZONES).world.plan.totalKm * 1000

const f = (over: Partial<RecommendFrame>): RecommendFrame => ({
  t: 1000,
  rate: 1,
  stage: { index: 1, count: 2 },
  stageClearedAt: null,
  inside: false,
  danger: false,
  driving: true,
  ...over,
})

/** フレームの列を流して、各フレームで出すかを返す */
function run(frames: Partial<RecommendFrame>[]) {
  let state: RecommendState = INITIAL_RECOMMEND
  return frames.map((over) => {
    const r = advanceRecommend(state, f(over))
    state = r.state
    return r.visible
  })
}

const must = (id: string): Pleasure => {
  const p = pleasureById(id)
  if (!p) throw new Error(`楽しみが無い: ${id}`)
  return p
}

describe('UC-4a・TOUR-6a・TOUR-6b: 出しどき（T11・S16）', () => {
  it('UC-4a・TOUR-6a: ステージの始まりから出て、ゾーンに入ると消え、出てから実時間 4 秒で出し直す', () => {
    expect(RESUME_AFTER_MS).toBe(4000)
    expect(
      run([
        { t: 1000 },
        { t: 2000 },
        { t: 3000, inside: true },
        { t: 4000 },
        { t: 7900 },
        { t: 8000 },
      ]),
    ).toEqual([true, true, false, false, false, true])
  })

  it('TOUR-6a: 4 秒は実時間（16× なら走行の 64 秒）', () => {
    expect(
      run([
        { t: 1000 },
        { t: 2000, inside: true, rate: 16 },
        { t: 3000, rate: 16 },
        { t: 3000 + 63_000, rate: 16 },
        { t: 3000 + 64_000, rate: 16 },
      ]),
    ).toEqual([true, false, false, false, true])
  })

  it('UC-4a・TOUR-6a: 赤（ゾーンの外の鹿）でも消え、4 秒後に出し直す', () => {
    expect(
      run([{ t: 1000 }, { t: 2000, danger: true }, { t: 3000 }, { t: 6900 }, { t: 7000 }]),
    ).toEqual([true, false, false, false, true])
  })

  it('UC-4a・TOUR-6b: 次のステージでは、クリアの帯が消えてから出る', () => {
    const cleared = 10_000
    const next = { stage: { index: 2, count: 2 }, stageClearedAt: cleared }
    expect(
      run([
        { t: 1000 },
        { t: 9000, inside: true },
        { t: cleared, ...next },
        { t: cleared + STAGE_BANNER_MS, ...next },
        { t: cleared + RESUME_AFTER_MS, ...next },
      ]),
    ).toEqual([true, false, false, false, true])
  })

  it('UC-4a・TOUR-6b: 走行の終わり・ゾーンの無い日は出さない。restart（t が戻る）で最初から', () => {
    expect(run([{ driving: false }])).toEqual([false])
    expect(run([{ stage: { index: 0, count: 0 } }])).toEqual([false])
    expect(run([{ t: 1000 }, { t: 2000, inside: true }, { t: 0 }])).toEqual([true, false, true])
  })
})

describe('UC-4b・TOUR-6c: 楽しみの選び方（T12・S17）', () => {
  const scene = {
    ...DEMO,
    stops: ['kushiro-marsh', 'akan-ainu-kotan', 'obihiro-butadon'],
  }
  const stops = stopPositionsM(scene, TOTAL_M)
  const at = (id: string) => stops.find((s) => s.pleasure.id === id)?.atM

  it('UC-4b: 拠点にいちばん近い区切りの道のり。15 km より遠い拠点は終点', () => {
    // 釧路は始点、阿寒湖は終点。帯広はどの区切りからも遠いので終点（その日の最後まで「先」）
    expect(at('kushiro-marsh')).toBe(0)
    expect(at('akan-ainu-kotan')).toBe(TOTAL_M)
    expect(at('obihiro-butadon')).toBe(TOTAL_M)
  })

  it('UC-4b・TOUR-6c: 最初は今の位置より先のその日の楽しみのうち最も近いもの。過ぎたものは候補にしない', () => {
    const pick = pickRecommendation(scene, stops, 10_000, 0)
    expect(['akan-ainu-kotan', 'obihiro-butadon']).toContain(pick?.pleasure.id)
    const near = [
      { pleasure: must('kushiro-marsh'), atM: 30_000 },
      { pleasure: must('akan-ainu-kotan'), atM: 20_000 },
    ]
    expect(pickRecommendation(scene, near, 10_000, 0)?.pleasure.id).toBe('akan-ainu-kotan')
    expect(pickRecommendation(scene, near, 25_000, 0)?.pleasure.id).toBe('kushiro-marsh')
  })

  it('TOUR-6c: 候補は先の楽しみ（近い順）→ 到着地の楽しみ。入れ替えの番号で順に回り、最後の次は最初', () => {
    const near = [
      { pleasure: must('kushiro-marsh'), atM: 30_000 },
      { pleasure: must('akan-ainu-kotan'), atM: 20_000 },
    ]
    const nearby = [0, 1].map((i) => pickRecommendation(DEMO, [], 0, i)?.pleasure.id)
    const ids = [0, 1, 2, 3, 4].map(
      (slot) => pickRecommendation(DEMO, near, 10_000, slot)?.pleasure.id,
    )
    // 先の 2 つ → 到着地の楽しみ（見本は 2 つ）→ 最初に戻る
    expect(ids).toEqual(['akan-ainu-kotan', 'kushiro-marsh', ...nearby, 'akan-ainu-kotan'])
    // 12 秒ごとに番号が進む
    expect(ROTATE_MS).toBe(12_000)
    expect([0, 11_999, 12_000, 24_000].map(rotationSlot)).toEqual([0, 0, 1, 2])
  })

  it('TOUR-6c: 入れ替えは出していた実時間で数える（ゾーンの中の間は進めない。出し直してすぐ替わらない）', () => {
    let state: RecommendState = INITIAL_RECOMMEND
    const step = (over: Partial<RecommendFrame>) => {
      state = advanceRecommend(state, f(over)).state
    }
    step({ t: 0 })
    step({ t: 10_000 })
    step({ t: 11_000, inside: true })
    step({ t: 60_000, inside: true })
    step({ t: 61_000 })
    step({ t: 65_000 })
    // 数えるのは出していたフレームの差だけ: 0〜10 秒の 10 秒と、出し直した 65 秒のフレームの 4 秒
    expect(state.visibleMs).toBe(14_000)
    expect(rotationSlot(state.visibleMs)).toBe(1)
    expect(state.realMs).toBe(65_000)
  })

  it('UC-4b・TOUR-6c: 先に無ければ旅の月に合う到着地の楽しみを順に回す。候補が 1 つなら替えない。どれも無ければ出さない', () => {
    const ids = [0, 1, 2].map((i) => pickRecommendation(DEMO, [], 0, i)?.pleasure.id)
    expect(ids[0]).toBeDefined()
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[2]).toBe(ids[0])
    for (const id of ids) expect(must(id ?? '').base).toBe('akan')
    // 候補が 1 つ（到着地の楽しみが無く、先に 1 つ）
    const lone = { stops: [], to: 'no-such-place', startAt: DEMO.startAt }
    const one = [{ pleasure: must('kushiro-marsh'), atM: 30_000 }]
    expect([0, 1, 2].map((i) => pickRecommendation(lone, one, 0, i)?.pleasure.id)).toEqual([
      'kushiro-marsh',
      'kushiro-marsh',
      'kushiro-marsh',
    ])
    expect(pickRecommendation(lone, [], 0, 0)).toBeNull()
  })
})

describe('UC-4c: カードの中身の決まり（T13）', () => {
  it('UC-4c: 「到着地」の時刻は拠点が到着地のときだけ', () => {
    const atAkan = pickRecommendation(DEMO, [], 0, 0)
    expect(atAkan?.atDestination).toBe(true)
    const marsh = [{ pleasure: must('kushiro-marsh'), atM: 20_000 }]
    expect(pickRecommendation(DEMO, marsh, 0, 0)?.atDestination).toBe(false)
  })

  it('UC-4c: note に鹿の語があれば一言を出さない', () => {
    expect(cardNote('湖畔の温泉でゆっくり')).toBe('湖畔の温泉でゆっくり')
    expect(cardNote('エゾシカに会えるかも')).toBeNull()
    expect(cardNote('You may see DEER here')).toBeNull()
  })

  it('UC-4c: 所要は 4 言語の書き方、見出し・到着地も 4 言語（絵文字・数字なし）', () => {
    for (const table of [RECOMMEND_TEXT.title, RECOMMEND_TEXT.destination]) {
      expect(Object.keys(table).sort()).toEqual(['en', 'ja', 'ko', 'zh'])
      for (const value of Object.values(table)) {
        expect(value.length).toBeGreaterThan(0)
        expect(value).not.toMatch(/[0-9]|\p{Extended_Pictographic}/u)
      }
    }
    expect(RECOMMEND_TEXT.hours.ja.join('1.5')).toBe('所要 約 1.5 時間')
    expect(RECOMMEND_TEXT.hours.en.join('1.5')).toBe('About 1.5 h')
    expect(RECOMMEND_TEXT.hours.zh.join('1.5')).toBe('約 1.5 小時')
    expect(RECOMMEND_TEXT.hours.ko.join('1.5')).toBe('약 1.5시간')
  })
})

/** 手で進める運転の代わり（購読者の数と、知らせた回数を見る） */
function fakeSource(start: DriveSnapshot) {
  const listeners = new Set<() => void>()
  let snapshot = start
  return {
    listeners,
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getSnapshot: () => snapshot,
    push(next: Partial<DriveSnapshot>) {
      snapshot = { ...snapshot, ...next }
      for (const l of listeners) l()
    },
    get current() {
      return snapshot
    },
  }
}

describe('UC-4d・TOUR-6d: カード（T13・T15・S19）', () => {
  it('UC-4d: 見出し・写真（alt=""）・名前・一言・所要・到着地・出典。操作要素なし', () => {
    const engine = new DriveEngine(DEMO, ZONES)
    const { container } = render(<RecommendCard engine={engine} lang="en" />)
    const card = screen.getByTestId('recommend-card')
    expect(card.tagName).toBe('ASIDE')
    // 名前は見出しを指す（aria-label で同じ文を 2 回読ませない）
    expect(card).toHaveAccessibleName('Coming up')
    expect(card).not.toHaveAttribute('aria-label')
    expect(card).toHaveAttribute('lang', 'en')
    expect(card).not.toHaveAttribute('aria-live')
    const name = screen.getByRole('heading', { level: 2 })
    const pleasure = pickRecommendation(DEMO, [], 0, 0)?.pleasure
    expect(name).toHaveTextContent(pleasure?.name.en ?? '')
    expect(card.querySelector('.drive-recommend__photo')).toHaveAttribute('alt', '')
    expect(card.querySelector('.drive-recommend__photo')).toHaveAttribute('decoding', 'async')
    expect(card.querySelector('.drive-recommend__credit')?.textContent).toMatch(/^Photo: .+ \/ .+$/)
    expect(card).toHaveTextContent(`About ${String(pleasure?.hours)} h`)
    expect(card).toHaveTextContent(/At destination \d{2}:\d{2}/)
    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
  })

  it('UC-4d: カードの名前（aria-labelledby）は旅の言語（4 言語）', () => {
    for (const lang of ['ja', 'en', 'zh', 'ko'] as const) {
      const { unmount } = render(
        <RecommendCard engine={new DriveEngine(DEMO, ZONES)} lang={lang} />,
      )
      expect(screen.getByTestId('recommend-card')).toHaveAccessibleName(RECOMMEND_TEXT.title[lang])
      unmount()
    }
  })

  it('UC-4a・TOUR-6d: 購読者が何人でも運転の購読は 1 つで、出すものが変わったときだけ知らせる。誰もいなくなったら運転の購読もやめる', () => {
    const source = fakeSource(new DriveEngine(DEMO, ZONES).getSnapshot())
    const tracker = new RecommendTracker(source, DEMO, TOTAL_M)
    let a = 0
    let b = 0
    const offA = tracker.subscribe(() => (a += 1))
    const offB = tracker.subscribe(() => (b += 1))
    expect(source.listeners.size).toBe(1)
    const first = tracker.getSnapshot()
    expect(first).not.toBeNull()
    // 同じフレームを流しても、12 秒より前に進めても知らせない
    source.push({})
    source.push({ t: source.current.t + 5000 })
    expect([a, b]).toEqual([0, 0])
    // 12 秒たつと入れ替わる → 2 人とも 1 回
    source.push({ t: source.current.t + ROTATE_MS })
    expect([a, b]).toEqual([1, 1])
    expect(tracker.getSnapshot()?.pleasure.id).not.toBe(first?.pleasure.id)
    // ゾーンに入ると消える → もう 1 回
    source.push({
      t: source.current.t + 1000,
      zone: { ...source.current.zone, gps: { status: 'inside', remainingKm: 1 } },
    })
    expect([a, b]).toEqual([2, 2])
    expect(tracker.getSnapshot()).toBeNull()
    offA()
    offB()
    expect(source.listeners.size).toBe(0)
  })

  it('TOUR-6d: 入れ替わるとカードを作り直す（現れるときのふわっとをもう一度）', () => {
    const engine = new DriveEngine(DEMO, ZONES)
    render(<RecommendCard engine={engine} lang="ja" />)
    const before = screen.getByTestId('recommend-card')
    const firstName = before.querySelector('h2')?.textContent
    // 止まったまま実時間 12 秒（100 ms × 121）進める
    act(() => {
      for (let i = 0; i < 121; i += 1) engine.frame(100)
    })
    const after = screen.getByTestId('recommend-card')
    expect(after.querySelector('h2')?.textContent).not.toBe(firstName)
    expect(after).not.toBe(before)
  })
})
