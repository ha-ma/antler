import { checkTables, formatProblems, type TableAllowance } from '@antler/i18n-check'

// sim の 4 言語の文言の表を全部集めて検査する（docs/specs/i18n/functional.md R2・R3、INV-1）。
// 名前の規則（text.ts・*-text.ts・i18n.ts）の表は自動で集まる。規則に合わない表はここに足す
// （scripts/ci_arch_check.py が、ハングルを含むのに登録の無いファイルを落とす）。

const BY_NAME = import.meta.glob(['./**/text.ts', './**/*-text.ts', './**/i18n.ts'], {
  eager: true,
})

/** 名前の規則に合わない表（ファイル名をここに書く。ci_arch_check.py が見る） */
const EXTRA: Record<string, unknown> = {}

const ALLOW: TableAllowance[] = [
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
