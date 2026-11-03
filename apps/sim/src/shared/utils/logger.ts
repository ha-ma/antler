// 構造化ログ（JSON 1 行）。ブラウザでは console.error / console.warn だけに出す（console.log は lint で禁止）。
// 外部の解析サービスには送らない（ch6「計測」）。

type Level = 'error' | 'warn'
type Fields = Record<string, unknown>

function serializeError(error: unknown): Fields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { message: String(error) }
}

function emit(level: Level, event: string, fields: Fields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') {
    console.error(line)
  } else {
    console.warn(line)
  }
}

export const logger = {
  error(event: string, error: unknown, fields: Fields = {}): void {
    emit('error', event, { ...fields, error: serializeError(error) })
  },
  warn(event: string, fields: Fields = {}): void {
    emit('warn', event, fields)
  },
}

/** 未捕捉の例外と Promise の拒否を logger に流す。アプリの起動時に 1 回だけ呼ぶ。 */
export function installGlobalErrorHandlers(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (e: ErrorEvent): void => {
    logger.error('window.error', e.error ?? e.message)
  }
  const onRejection = (e: PromiseRejectionEvent): void => {
    logger.error('window.unhandledrejection', e.reason)
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
