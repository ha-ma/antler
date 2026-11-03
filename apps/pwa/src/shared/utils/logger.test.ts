import { installGlobalErrorHandlers, logger } from './logger'

function lastJson(spy: { mock: { calls: unknown[][] } }) {
  const line = spy.mock.calls.at(-1)?.[0]
  return JSON.parse(String(line)) as Record<string, unknown>
}

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('error は 1 行の JSON に event・level・error を入れる', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logger.error('ws.message', new Error('bad json'), { attempt: 1 })
    const entry = lastJson(spy)
    expect(entry).toMatchObject({ level: 'error', event: 'ws.message', attempt: 1 })
    expect(entry['error']).toMatchObject({ name: 'Error', message: 'bad json' })
    expect(typeof entry['ts']).toBe('string')
  })

  it('Error でない値も message にする', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logger.error('x', 'plain')
    expect(lastJson(spy)['error']).toEqual({ message: 'plain' })
  })

  it('warn は console.warn に出す', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    logger.warn('ws.reconnect', { attempt: 2 })
    expect(lastJson(spy)).toMatchObject({ level: 'warn', event: 'ws.reconnect', attempt: 2 })
  })

  it('未捕捉の例外と Promise の拒否を記録し、解除できる', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // 本物の window に error を投げると、テストランナー自身が未捕捉の例外として拾うので、別の EventTarget で試す
    const target = new EventTarget() as unknown as Window
    const uninstall = installGlobalErrorHandlers(target)
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught') }))
    expect(lastJson(spy)).toMatchObject({ event: 'window.error' })
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('rejected') })
    target.dispatchEvent(rejection)
    expect(lastJson(spy)).toMatchObject({ event: 'window.unhandledrejection' })
    uninstall()
    const calls = spy.mock.calls.length
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('after') }))
    expect(spy.mock.calls.length).toBe(calls)
  })
})
