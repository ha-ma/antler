// 構造化ログ（JSON 1 行を標準出力へ）。console は lint で禁止しているので、ログはこの logger だけが出す。
// 外部の解析サービスには送らない（ch6「計測」）。

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export type LogFields = Record<string, unknown>

export type Logger = {
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

type Sink = (line: string) => void

const stdoutSink: Sink = (line) => {
  process.stdout.write(`${line}\n`)
}

export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

export function createLogger(
  level: LogLevel,
  { sink = stdoutSink, base = {} }: { sink?: Sink; base?: LogFields } = {},
): Logger {
  const threshold = LOG_LEVELS.indexOf(level)
  const write = (lv: LogLevel, event: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(lv) < threshold) return
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lv, event, ...base, ...fields }))
  }
  return {
    debug: (event, fields) => {
      write('debug', event, fields)
    },
    info: (event, fields) => {
      write('info', event, fields)
    },
    warn: (event, fields) => {
      write('warn', event, fields)
    },
    error: (event, fields) => {
      write('error', event, fields)
    },
    child: (fields) => createLogger(level, { sink, base: { ...base, ...fields } }),
  }
}
