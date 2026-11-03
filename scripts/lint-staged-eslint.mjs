// lint-staged から呼ぶ ESLint。ESLint の設定は workspace ごと（apps/sim・apps/pwa・apps/api・packages）に
// あるので、ステージされたファイルを workspace に振り分けて、それぞれのフォルダで eslint を回す。
// どの workspace にも入らない .ts/.tsx（設定ファイルなど）は対象外。
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const WORKSPACES = ['apps/sim', 'apps/pwa', 'apps/api', 'packages']
const root = process.cwd()
const groups = new Map()

for (const file of process.argv.slice(2)) {
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join('/')
  const ws = WORKSPACES.find((w) => rel.startsWith(`${w}/`))
  if (!ws) continue
  const inWs = rel.slice(ws.length + 1)
  // apps の lint 対象は src/ だけ（package.json の lint と同じ）
  if (ws.startsWith('apps/') && !inWs.startsWith('src/')) continue
  if (!groups.has(ws)) groups.set(ws, [])
  groups.get(ws).push(inWs)
}

let failed = false
for (const [ws, files] of groups) {
  // --no-warn-ignored: 設定で除外したファイル（設定ファイルなど）を渡しても警告にしない
  const args = ['--no-install', 'eslint', '--max-warnings=0', '--no-warn-ignored', ...files]
  const result = spawnSync('npx', args, {
    cwd: path.join(root, ws),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
