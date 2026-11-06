import { checkTables, formatProblems, type TableAllowance } from '@antler/i18n-check'
import {
  FALLBACK_PLEASURE_TEXT,
  FILLER_PLEASURE_TEXT,
  RADIO_FILLER_PLEASURE_TEXT,
  RADIO_PLEASURE_TEXT,
} from './features/drive/chat/chat-text'

// sim の 4 言語の文言の表を全部集めて検査する（docs/specs/i18n/functional.md R2・R3、INV-1）。
// 名前の規則（text.ts・*-text.ts・i18n.ts）の表は自動で集まる。規則に合わない表はここに足す
// （scripts/ci_arch_check.py が、ハングルを含むのに登録の無いファイルを落とす）。

const BY_NAME = import.meta.glob(['./**/text.ts', './**/*-text.ts', './**/i18n.ts'], {
  eager: true,
})

/** 楽しみの名前の見本（4 言語。漢字・仮名・ハングルの名前を差し込んだ文も規則を通るか） */
const PLEASURE_NAME = { ja: '阿寒湖', en: 'Lake Akan', zh: '阿寒湖', ko: '아칸호' }

/**
 * 名前の規則に合わない表と、関数の文の見本。関数は値を読めないので、呼んだ結果をここで組にする
 * （見本を出した関数は下の ALLOW に `unsampled` で書く）
 */
const EXTRA: Record<string, unknown> = {
  'features/drive/chat/chat-text.ts（関数の見本）': {
    fallbackPleasure: FALLBACK_PLEASURE_TEXT.map((line) => line(PLEASURE_NAME)),
    radioPleasure: RADIO_PLEASURE_TEXT.map((line) => line(PLEASURE_NAME)),
    // 補いの観光の行の言い回し（drive-sound-tourism S14）
    fillerPleasure: FILLER_PLEASURE_TEXT.map((line) => line(PLEASURE_NAME)),
    radioFillerPleasure: RADIO_FILLER_PLEASURE_TEXT.map((line) => line(PLEASURE_NAME)),
  },
}

const sampled = (path: string, reason: string): TableAllowance => ({
  path: `./features/drive/chat/chat-text.ts:${path}`,
  rule: 'unsampled',
  reason,
})

const ALLOW: TableAllowance[] = [
  ...[0, 1, 2].map((i) =>
    sampled(`FALLBACK_PLEASURE_TEXT.${String(i)}`, 'EXTRA の fallbackPleasure で見本を検査する'),
  ),
  ...[0, 1].map((i) =>
    sampled(`RADIO_PLEASURE_TEXT.${String(i)}`, 'EXTRA の radioPleasure で見本を検査する'),
  ),
  ...[0, 1, 2].map((i) =>
    sampled(`FILLER_PLEASURE_TEXT.${String(i)}`, 'EXTRA の fillerPleasure で見本を検査する'),
  ),
  ...[0, 1].map((i) =>
    sampled(
      `RADIO_FILLER_PLEASURE_TEXT.${String(i)}`,
      'EXTRA の radioFillerPleasure で見本を検査する',
    ),
  ),
  {
    path: './features/drive/components/hud/hud-text.ts:HUD_TEXT.controls.3.0',
    rule: 'script',
    reason: 'キーボードのキーの名前（Space）。キーの刻印と同じで言語に依存しない',
  },
]

describe('INV-1 sim の文言の表（4 言語）', () => {
  const result = checkTables({ ...BY_NAME, ...EXTRA }, { allow: ALLOW })

  it('表を読めている', () => {
    expect(Object.keys(BY_NAME).length).toBeGreaterThanOrEqual(10)
    expect(result.entries).toBeGreaterThan(300)
  })

  it('全部の組が 4 言語の規則を通る', () => {
    expect(result.problems, `\n${formatProblems(result.problems)}\n`).toEqual([])
  })

  it('使われない例外が無い', () => {
    expect(result.unusedAllowances).toEqual([])
  })
})
