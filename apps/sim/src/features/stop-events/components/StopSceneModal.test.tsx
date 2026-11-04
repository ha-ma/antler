import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stopDeckBody } from '@/test/stop-deck'
import type { SceneWriting, StopScene } from '../types'
import { StopSceneModal } from './StopSceneModal'

// A-4 のモーダル（docs/specs/stop-events/functional.md R11、UI-4a〜UI-4d）。

const body = stopDeckBody()
const crane = body.deck.scenes[0] as unknown as StopScene
const fuel = body.deck.scenes[1] as unknown as StopScene
const craneWriting = body.writing.scenes[0] as SceneWriting

function open(
  scene: StopScene,
  writing: SceneWriting | null,
  lang: 'ja' | 'en' | 'zh' | 'ko' = 'ja',
) {
  const onChoose = vi.fn()
  render(
    <StopSceneModal
      scene={scene}
      writing={writing}
      lang={lang}
      alertEnabled
      date="2027-02-15"
      onChoose={onChoose}
    />,
  )
  return onChoose
}

describe('StopSceneModal', () => {
  it('UI-4a: 見出し・短文・滞在・使った（目安）・到着予定、選択肢ごとに到着・鹿ゾーンの帯・失うもの', () => {
    open(crane, craneWriting)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('群れがまだ残っていた。')
    expect(screen.getByText(/四十羽ほど/)).toBeInTheDocument()
    expect(screen.getByText('滞在').nextSibling).toHaveTextContent('42 分')
    expect(screen.getByText('使った（予算からの目安）').nextSibling).toHaveTextContent('¥0')
    expect(screen.getByText('阿寒湖 到着予定').nextSibling).toHaveTextContent('16:50')

    const buttons = within(screen.getByRole('group', { name: 'どうする？' })).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent('いま出発する')
    expect(buttons[0]).toHaveTextContent('→ 阿寒湖 16:50 着')
    expect(buttons[0]).toHaveTextContent('鹿ゾーン（38 km）を 16:20〜 薄暮に通過')
    expect(buttons[1]).toHaveTextContent('17:20〜 日没後に通過（ほか 1 区間）')
    expect(buttons[2]).toHaveTextContent('鹿ゾーンを通らない')
    expect(buttons[2]).toHaveTextContent('予算からの目安 −¥96,000')
    expect(buttons[2]).toHaveTextContent('楽しみ −重さ 1')
    expect(buttons[2]).toHaveTextContent('温泉はなくなる')
    expect(screen.getByText(/鹿アラート ON/)).toBeInTheDocument()
  })

  it('UI-4b: 4 言語で出し、翌日の時刻に「翌」、返却に遅れる、夜明け前・昼の言い方', () => {
    open(fuel, null)
    const [refuel, skip] = screen.getAllByRole('button')
    expect(refuel).toHaveTextContent('→ 阿寒湖 翌 00:05 着')
    expect(skip).toHaveTextContent('返却に遅れる')
  })

  it('UI-4b: en・zh・ko の文言', () => {
    for (const [lang, text] of [
      ['en', 'Deer zone (38 km) from 16:20, at dusk'],
      ['zh', '16:20起於黃昏通過鹿區（38 公里）'],
      ['ko', '사슴 구간(38km)을 16:20부터 해 질 녘에 통과'],
    ] as const) {
      const { unmount } = render(
        <StopSceneModal
          scene={crane}
          writing={craneWriting}
          lang={lang}
          alertEnabled={false}
          date="2027-02-15"
          onChoose={vi.fn()}
        />,
      )
      expect(screen.getAllByRole('button')[0]).toHaveTextContent(text)
      unmount()
    }
  })

  it('UI-4c: dialog の役割と見出しの名前、開いたら最初の選択肢にフォーカス、Esc で閉じない、Tab は中で回る', async () => {
    const user = userEvent.setup()
    const onChoose = open(crane, craneWriting)
    const dialog = screen.getByRole('dialog', { name: '群れがまだ残っていた。' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onChoose).not.toHaveBeenCalled()
    await user.tab({ shift: true })
    expect(buttons[2]).toHaveFocus()
    await user.tab()
    expect(buttons[0]).toHaveFocus()
    // 44px 以上（CSS の min-height。jsdom は計算しないので class を確かめる）
    expect(buttons[0]).toHaveClass('stop-choice')
  })

  it('UI-4d: 文が無い場面は楽しみの名前と決まった言い回し（Claude の代わりの物語は出さない）', () => {
    open(crane, null)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('タンチョウ')
    expect(screen.getAllByRole('button')[1]).toHaveTextContent('もう少しいる')
    expect(screen.queryByText(/四十羽/)).not.toBeInTheDocument()
  })

  it('AC-32（画面）: 選択肢を押すと onChoose がその選択肢で呼ばれる', async () => {
    const user = userEvent.setup()
    const onChoose = open(crane, craneWriting)
    await user.click(screen.getByRole('button', { name: /もう少し、鶴の飛び立ちを見る/ }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'linger', delayMin: 60 }))
  })
})
