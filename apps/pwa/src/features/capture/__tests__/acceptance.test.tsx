import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders as render } from '@/test/render'
import { CaptureGate } from '..'
import { API_BASE, captureId, jsonResponse, makeCapture } from './fake-edge'
import { rig } from './rig'

describe('AC-3 走行後の同意と送信（外側の受け入れ）', () => {
  it('AC-3: 画面に件数・チェック（ON）・サムネイルが出て、送るで同意した分だけ api に multipart で届き、送信済みが edge に付く', async () => {
    const user = userEvent.setup()
    const { backend, services } = rig({
      items: [makeCapture(1), makeCapture(2)],
      stuckConsent: [captureId(2)],
    })
    render(<CaptureGate services={services} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('2')
    expect(within(dialog).getByRole('checkbox')).toBeChecked()
    expect(within(dialog).getAllByRole('img')).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: /送る/ }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 件を提供しました（失敗 1 件）')
    })
    expect(backend.apiCalls).toHaveLength(1)
    const call = backend.apiCalls[0]
    expect(call?.url).toBe(`${API_BASE}/api/captures`)
    expect(call?.keys).toEqual(['capture', 'image'])
    expect(call?.capture.id).toBe(captureId(1))
    expect(call?.capture.consent).toBe(true)
    expect(backend.state.items.find((i) => i.capture.id === captureId(1))?.uploaded).toBe(true)
    expect(backend.state.items.find((i) => i.capture.id === captureId(2))?.uploaded).toBe(false)
  })

  it('AC-3: 回線が切れたら未送信のまま「もう一度」が出て、続きから送れる', async () => {
    const user = userEvent.setup()
    let offline = true
    const { backend, services } = rig({
      items: [makeCapture(1), makeCapture(2)],
      api: (call, n) => {
        if (n === 2 && offline) return 'network'
        return jsonResponse(201, { id: call.capture.id, image: call.capture.image })
      },
    })
    render(<CaptureGate services={services} />)
    await user.click(await screen.findByRole('button', { name: /送る/ }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        '回線がつながったら、もう一度送ってください',
      )
    })
    expect(backend.state.items.map((i) => i.uploaded)).toEqual([true, false])

    offline = false
    await user.click(screen.getByRole('button', { name: /もう一度/ }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('2 件を提供しました（失敗 0 件）')
    })
    expect(backend.state.items.map((i) => i.uploaded)).toEqual([true, true])
    // 送信済みの 1 件目は送り直さない
    expect(backend.apiCalls.map((c) => c.capture.id)).toEqual([
      captureId(1),
      captureId(2),
      captureId(2),
    ])
  })
})
