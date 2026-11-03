import { createLogger, serializeError } from './logger.js'

function capture() {
  const lines: Record<string, unknown>[] = []
  return { lines, sink: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) }
}

describe('createLogger', () => {
  it('1 行の JSON に ts・level・event・項目を入れる', () => {
    const { lines, sink } = capture()
    createLogger('info', { sink }).info('server.listening', { port: 8787 })
    expect(lines[0]).toMatchObject({ level: 'info', event: 'server.listening', port: 8787 })
    expect(typeof lines[0]?.['ts']).toBe('string')
  })

  it('しきい値より低いレベルは出さない', () => {
    const { lines, sink } = capture()
    const log = createLogger('warn', { sink })
    log.debug('a')
    log.info('b')
    log.warn('c')
    log.error('d')
    expect(lines.map((l) => l['event'])).toEqual(['c', 'd'])
  })

  it('child は共通の項目を引き継ぐ', () => {
    const { lines, sink } = capture()
    createLogger('debug', { sink, base: { service: 'api' } })
      .child({ requestId: 'r1' })
      .debug('x')
    expect(lines[0]).toMatchObject({ service: 'api', requestId: 'r1', level: 'debug' })
  })

  it('既定では標準出力に書く', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    createLogger('info').info('stdout')
    expect(String(write.mock.calls[0]?.[0])).toMatch(/"event":"stdout"/)
    write.mockRestore()
  })
})

describe('serializeError', () => {
  it('Error は name・message・stack、それ以外は message', () => {
    expect(serializeError(new TypeError('t'))).toMatchObject({ name: 'TypeError', message: 't' })
    expect(serializeError(42)).toEqual({ message: '42' })
  })
})
