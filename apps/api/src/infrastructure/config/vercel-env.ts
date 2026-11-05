import { EnvError, isRemoteDbUrl, loadEnv, type Env } from './env.js'

// Vercel の上だけの env の既定と検査（docs/specs/deploy-a/functional.md R4）。
// - 公開の URL（PUBLIC_API_URL・SIM_PUBLIC_URL）と CORS_ORIGINS が無ければ、Vercel が付ける値から作る。
//   Production は VERCEL_PROJECT_PRODUCTION_URL、それ以外は VERCEL_BRANCH_URL（無ければ VERCEL_URL）。明示した値が常に勝つ
// - TRIPS_DB_URL は Turso（libsql:// / https://）だけ。TURSO_AUTH_TOKEN は必須
// - Blob の資格（BLOB_STORE_ID か BLOB_READ_WRITE_TOKEN）が要る。SDK が env から読む
// エラーのメッセージには変数の名前だけを書き、値を書かない。

type Source = Record<string, string | undefined>

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== ''

/** Vercel が付ける値から、この関数の公開のオリジン（https://…）を決める。分からなければ undefined */
export function vercelOrigin(source: Source): string | undefined {
  const host =
    source['VERCEL_ENV'] === 'production'
      ? source['VERCEL_PROJECT_PRODUCTION_URL']
      : present(source['VERCEL_BRANCH_URL'])
        ? source['VERCEL_BRANCH_URL']
        : source['VERCEL_URL']
  return present(host) ? `https://${host.trim()}` : undefined
}

/** 公開の URL と CORS_ORIGINS の既定を足した env を返す（元の source は変えない） */
export function withVercelDefaults(source: Source): Source {
  const origin = vercelOrigin(source)
  if (!origin) return { ...source }
  const fill = (name: string): Record<string, string> =>
    present(source[name]) ? {} : { [name]: origin }
  return {
    ...source,
    ...fill('PUBLIC_API_URL'),
    ...fill('SIM_PUBLIC_URL'),
    ...fill('CORS_ORIGINS'),
  }
}

/** Vercel の関数の env を読む。足りない・形が違う → EnvError（名前だけ。値は書かない） */
export function loadVercelEnv(source: Source): Env {
  const problems: string[] = []
  const url = source['TRIPS_DB_URL']
  if (!present(url) || !isRemoteDbUrl(url) || /^wss?:/i.test(url)) {
    problems.push(
      'TRIPS_DB_URL: Vercel では Turso の URL（libsql:// か https://）を書く（file: は使えない）',
    )
  }
  if (!present(source['TURSO_AUTH_TOKEN'])) {
    problems.push('TURSO_AUTH_TOKEN: Turso の DB のトークンが要る')
  }
  if (!present(source['BLOB_STORE_ID']) && !present(source['BLOB_READ_WRITE_TOKEN'])) {
    problems.push(
      'BLOB_STORE_ID: Blob のストアをプロジェクトにつなぐ（または BLOB_READ_WRITE_TOKEN を入れる）',
    )
  }
  if (problems.length > 0) throw new EnvError(`環境変数が不正です: ${problems.join('; ')}`)
  return loadEnv(source)
}
