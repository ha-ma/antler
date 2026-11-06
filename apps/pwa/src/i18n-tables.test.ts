import { checkTables, formatProblems, type TableAllowance } from '@antler/i18n-check'

// pwa の 4 言語の文言の表を全部集めて検査する（docs/specs/i18n/functional.md R2・R3、INV-1）。
// 名前の規則（text.ts・*-text.ts・i18n.ts）の表は自動で集まる。規則に合わない表は import して EXTRA に足す
// （scripts/ci_arch_check.py が、仮名・漢字・ハングルを含むのに登録の無いファイルを落とす）。

const BY_NAME = import.meta.glob(['./**/text.ts', './**/*-text.ts', './**/i18n.ts'], {
  eager: true,
})

const EXTRA: Record<string, unknown> = {}

const ALLOW: TableAllowance[] = []

describe('INV-1 pwa の文言の表（4 言語）', () => {
  const result = checkTables({ ...BY_NAME, ...EXTRA }, { allow: ALLOW })

  it('表を読めている', () => {
    expect(Object.keys(BY_NAME).length).toBeGreaterThanOrEqual(3)
    expect(result.entries).toBeGreaterThan(50)
  })

  it('全部の組が 4 言語の規則を通る', () => {
    expect(result.problems, `\n${formatProblems(result.problems)}\n`).toEqual([])
  })

  it('使われない例外が無い', () => {
    expect(result.unusedAllowances).toEqual([])
  })
})
