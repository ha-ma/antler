// モーダルのフォーカスとキー操作（docs/specs/stop-events/functional.md R11、accessibility-checker の Critical 2・3）。
// - 開いたら最初の選択肢にフォーカス。閉じたら開く前の要素に戻す
// - Esc では閉じない（運転側のキーにも渡さない）。Tab・Shift+Tab はモーダルの中で回る（文字をクリックした後も）
// - 背面（body の他の子）を inert にして、支援技術にもタブにも出さない
// React の外の DOM を触るので、dialog 要素の ref コールバックから呼び、返す関数で元に戻す。

export function attachModalBehavior(dialog: HTMLElement): () => void {
  const doc = dialog.ownerDocument
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
  const buttons = () => Array.from(dialog.querySelectorAll('button'))
  buttons()[0]?.focus()

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab') return
    const list = buttons()
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return
    const active = doc.activeElement
    const inside = active instanceof Node && dialog.contains(active) && active !== dialog
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault()
      first.focus()
    }
  }
  dialog.addEventListener('keydown', onKeyDown)

  // 背面を inert に（モーダルは body 直下の portal にある）
  const host = dialog.closest('[data-modal-root]') ?? dialog
  const made: Element[] = []
  for (const child of Array.from(doc.body.children)) {
    if (child === host || child.contains(host) || child.hasAttribute('inert')) continue
    child.setAttribute('inert', '')
    made.push(child)
  }

  return () => {
    dialog.removeEventListener('keydown', onKeyDown)
    for (const el of made) el.removeAttribute('inert')
    if (previous?.isConnected) previous.focus()
  }
}
