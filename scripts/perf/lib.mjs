// scripts/perf の計測スクリプトが共有する部分（Playwright とブラウザの場所）。
// Playwright はリポジトリの依存に入れていない（計測は手元で回す。CI はバンドル上限だけ）。
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

/** Playwright を読み込む（--playwright か PLAYWRIGHT_DIR。無ければ分かる言葉で止める） */
export async function loadPlaywright(arg) {
  const dir = (arg ?? process.env.PLAYWRIGHT_DIR ?? 'playwright').replace(/^~/, homedir())
  try {
    return await import(dir.includes('/') ? pathToFileURL(`${dir}/index.mjs`).href : dir)
  } catch (error) {
    console.error(
      `Playwright を読み込めない（${dir}）。リポジトリの依存には無いので、` +
        'PLAYWRIGHT_DIR=~/.npm/_npx/<hash>/node_modules/playwright のように入っている場所を指す。' +
        `\n${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(2)
  }
}

/** CHROME_PATH: Playwright の版とブラウザの版が合わないとき、手元の Chromium を直接指す */
export function launchOptions(args) {
  const executablePath = process.env.CHROME_PATH?.replace(/^~/, homedir())
  return {
    channel: 'chromium',
    headless: true,
    args,
    ...(executablePath ? { executablePath } : {}),
  }
}
