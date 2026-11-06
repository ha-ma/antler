import { pleasureById, type Pleasure } from '@antler/trip'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DriveEngine } from '../../domain/engine'
import { demoScenario } from '../../domain/scenario'
import { ZONES } from '../../domain/zones-data'
import {
  advanceRecommend,
  cardNote,
  INITIAL_RECOMMEND,
  pickRecommendation,
  stopPositionsM,
  type RecommendFrame,
  type RecommendState,
} from './recommend'
import { RecommendCard } from './RecommendCard'
import { RecommendTracker } from './recommend-tracker'
import { RECOMMEND_TEXT } from './recommend-text'
import { STAGE_BANNER_MS } from './StageBanner'

// 鹿ゾーンの前のおすすめ（docs/specs/drive-tourism/functional.md T11〜T15、UC-4a〜UC-4d）

const DEMO = demoScenario(ZONES)
const TOTAL_M = new DriveEngine(DEMO, ZONES).world.plan.totalKm * 1000

const f = (over: Partial<RecommendFrame>): RecommendFrame => ({
  t: 1000,
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

describe('UC-4a: 出しどき（T11）', () => {
  it('UC-4a: ステージの始まりから出て、ゾーンに入ると消え、同じステージでは出し直さない', () => {
    expect(
      run([{ t: 1000 }, { t: 2000 }, { t: 3000, inside: true }, { t: 4000 }, { t: 5000 }]),
    ).toEqual([true, true, false, false, false])
  })

  it('UC-4a: 赤になっても終わり（ゾーンの外の鹿）', () => {
    expect(run([{ t: 1000 }, { t: 2000, danger: true }, { t: 3000 }])).toEqual([true, false, false])
  })

  it('UC-4a: 次のステージでは、クリアの帯が消えてから出る', () => {
    const cleared = 10_000
    expect(
      run([
        { t: 1000 },
        { t: 9000, inside: true },
        { t: cleared, stage: { index: 2, count: 2 }, stageClearedAt: cleared },
        { t: cleared + STAGE_BANNER_MS, stage: { index: 2, count: 2 }, stageClearedAt: cleared },
        {
          t: cleared + STAGE_BANNER_MS + 100,
          stage: { index: 2, count: 2 },
          stageClearedAt: cleared,
        },
      ]),
    ).toEqual([true, false, false, false, true])
  })

  it('UC-4a: 走行の終わり・ゾーンの無い日は出さない。restart（t が戻る）で最初から', () => {
    expect(run([{ driving: false }])).toEqual([false])
    expect(run([{ stage: { index: 0, count: 0 } }])).toEqual([false])
    expect(run([{ t: 1000 }, { t: 2000, inside: true }, { t: 0 }])).toEqual([true, false, true])
  })
})

describe('UC-4b: 楽しみの選び方（T12）', () => {
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

  it('UC-4b: 今の位置より先のその日の楽しみのうち最も近いもの', () => {
    const pick = pickRecommendation(scene, stops, 10_000, 1)
    expect(['akan-ainu-kotan', 'obihiro-butadon']).toContain(pick?.pleasure.id)
    expect(pick?.pleasure.id).not.toBe('kushiro-marsh')
    const near = [
      { pleasure: must('kushiro-marsh'), atM: 30_000 },
      { pleasure: must('akan-ainu-kotan'), atM: 20_000 },
    ]
    expect(pickRecommendation(scene, near, 10_000, 1)?.pleasure.id).toBe('akan-ainu-kotan')
    expect(pickRecommendation(scene, near, 25_000, 1)?.pleasure.id).toBe('kushiro-marsh')
  })

  it('UC-4b: 先に無ければ旅の月に合う到着地の楽しみをステージの番号で回す。どれも無ければ出さない', () => {
    const ids = [1, 2, 3].map((i) => pickRecommendation(DEMO, [], 0, i)?.pleasure.id)
    expect(ids[0]).toBeDefined()
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[2]).toBe(ids[0])
    for (const id of ids) expect(must(id ?? '').base).toBe('akan')
    const nowhere = { stops: [], to: 'no-such-place', startAt: DEMO.startAt }
    expect(pickRecommendation(nowhere, [], 0, 1)).toBeNull()
  })
})

describe('UC-4c: カードの中身の決まり（T13）', () => {
  it('UC-4c: 「到着地」の時刻は拠点が到着地のときだけ', () => {
    const atAkan = pickRecommendation(DEMO, [], 0, 1)
    expect(atAkan?.atDestination).toBe(true)
    const marsh = [{ pleasure: must('kushiro-marsh'), atM: 20_000 }]
    expect(pickRecommendation(DEMO, marsh, 0, 1)?.atDestination).toBe(false)
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

describe('UC-4d: カード（T13・T15）', () => {
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
    const pleasure = pickRecommendation(DEMO, [], 0, engine.getSnapshot().stage.index)?.pleasure
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

  it('UC-4a: 購読者が何人でも運転の購読は 1 つで、出すものが変わったときだけ知らせる。誰もいなくなったら運転の購読もやめる', () => {
    const listeners = new Set<() => void>()
    const engine = new DriveEngine(DEMO, ZONES)
    let snapshot = engine.getSnapshot()
    const source = {
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      getSnapshot: () => snapshot,
    }
    const tracker = new RecommendTracker(source, DEMO, TOTAL_M)
    let a = 0
    let b = 0
    const offA = tracker.subscribe(() => (a += 1))
    const offB = tracker.subscribe(() => (b += 1))
    expect(listeners.size).toBe(1)
    const first = tracker.getSnapshot()
    expect(first).not.toBeNull()
    // 同じフレームを流しても知らせない
    for (const l of listeners) l()
    expect([a, b]).toEqual([0, 0])
    // ゾーンに入ると消える → 2 人とも 1 回
    snapshot = {
      ...snapshot,
      t: snapshot.t + 1000,
      zone: { ...snapshot.zone, gps: { status: 'inside', remainingKm: 1 } },
    }
    for (const l of listeners) l()
    expect([a, b]).toEqual([1, 1])
    expect(tracker.getSnapshot()).toBeNull()
    offA()
    offB()
    expect(listeners.size).toBe(0)
  })
})
