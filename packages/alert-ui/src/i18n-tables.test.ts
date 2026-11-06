import { checkTables, formatProblems, type TableAllowance } from '@antler/i18n-check'
import { describe, expect, it } from 'vitest'
import { ALERT_TEXT, LANGS, type Lang } from './i18n/i18n'

// alert-ui の 4 言語の文言を全部集めて検査する（docs/specs/i18n/functional.md R2・R3、INV-1）。
// 名前の規則（text.ts・*-text.ts・i18n.ts）の表は自動で集まる。読み上げ（関数）は見本を出して組にする。

const BY_NAME = import.meta.glob(['./**/text.ts', './**/*-text.ts', './**/i18n.ts'], {
  eager: true,
})

function each<T>(make: (lang: Lang) => T): Record<Lang, T> {
  return Object.fromEntries(LANGS.map((lang) => [lang, make(lang)])) as Record<Lang, T>
}

/** 読み上げの文の見本（左右・距離の有無の全部の分岐） */
const ANNOUNCE = {
  dangerLeft: each((l) => ALERT_TEXT[l].announceDanger('L', '80')),
  dangerRight: each((l) => ALERT_TEXT[l].announceDanger('R', undefined)),
  dangerAhead: each((l) => ALERT_TEXT[l].announceDanger(undefined, '45')),
  zone: each((l) => ALERT_TEXT[l].announceZone('zone', '2.4')),
  zoneNoDistance: each((l) => ALERT_TEXT[l].announceZone('zone', undefined)),
  safe: each((l) => ALERT_TEXT[l].announceZone('safe', '12')),
  safeNoDistance: each((l) => ALERT_TEXT[l].announceZone('safe', undefined)),
}

const ALLOW: TableAllowance[] = ['announceDanger', 'announceZone'].map((fn) => ({
  path: `./i18n/i18n.ts:ALERT_TEXT.${fn}`,
  rule: 'unsampled' as const,
  reason: '読み上げの関数。ANNOUNCE で左右・距離の有無の全部の分岐の見本を出して検査する',
}))

describe('INV-1 alert-ui の文言の表（4 言語）', () => {
  const result = checkTables(
    { ...BY_NAME, 'i18n/i18n.ts（読み上げの見本）': ANNOUNCE },
    { allow: ALLOW },
  )

  it('表を読めている', () => {
    expect(Object.keys(BY_NAME).length).toBeGreaterThanOrEqual(1)
    expect(result.entries).toBeGreaterThanOrEqual(15)
  })

  it('全部の組が 4 言語の規則を通る', () => {
    expect(result.problems, `\n${formatProblems(result.problems)}\n`).toEqual([])
  })

  it('使われない例外が無い', () => {
    expect(result.unusedAllowances).toEqual([])
  })
})
