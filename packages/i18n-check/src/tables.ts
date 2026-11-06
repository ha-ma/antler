import type { Lang } from '@antler/schema'
import { LANGS, hasCjk, hasEnglishWord, scriptProblems, type ScriptRule } from './script'

// 4 言語の文言の表の共通の検査（docs/specs/i18n/functional.md R2・R3）。
// 表（モジュールの export の値）を辿り、キーに ja / en / zh / ko のうち 2 つ以上を持つオブジェクトを「4 言語の組」として見る。
// 言語が外側の表（Record<Lang, { … }>）は、4 言語の道筋の和集合で組をつくる（無い道筋は missing）。関数の葉は辿らない。

export type TableRule =
  'missing' | 'empty' | 'copy' | 'placeholder' | 'untranslated' | 'unsampled' | ScriptRule

/** 1 つの組の 4 言語の文（無い言語は undefined） */
export type LangEntry = { path: string; texts: Partial<Record<Lang, string>> }

export type TableProblem = { file: string; path: string; rule: TableRule; lang?: Lang }

/** 例外（道筋・規則・理由。理由の無い例外は書けない） */
export type TableAllowance = { path: string; rule: TableRule; reason: string }

const PLACEHOLDER = /\{(\w+)\}/g
const MAX_DEPTH = 12

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** 言語のキーを 2 つ以上持つオブジェクト（足りない言語は missing にする。4 つそろうものだけを見ると、欠けた表がすり抜ける） */
function isLangRecord(value: unknown): value is Partial<Record<Lang, unknown>> {
  return isPlainObject(value) && LANGS.filter((lang) => lang in value).length >= 2
}

/** 見えない文字（ゼロ幅スペース・BOM・単語結合子など）。空の判定の前に除く */
const INVISIBLE = /[​-‍⁠﻿­]/g
function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${String(key)}`
}

/** 言語の中身を道筋 → 文に平らにする（数・真偽は飛ばす。関数は fns に道筋を残す） */
function flatten(
  value: unknown,
  path: string,
  out: Map<string, string>,
  fns: Set<string>,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    out.set(path, value)
    return
  }
  if (typeof value === 'function') {
    fns.add(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, join(path, i), out, fns, depth + 1))
    return
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, join(path, k), out, fns, depth + 1)
  }
}

/** 表を辿って 4 言語の組を全部集める */
export function collectEntries(value: unknown, path = ''): LangEntry[] {
  return collect(value, path).entries
}

/** 4 言語の組の外にある、仮名・漢字・ハングルを含む文（1 言語だけの文言。R3 の untranslated） */
export function collectLoose(value: unknown, path = ''): LooseText[] {
  return collect(value, path).loose
}

export type LooseText = { path: string; text: string }

/**
 * 表の中の関数（文を作る関数。モジュールの一番上の export の関数は道具なので数えない）の道筋。
 * 検査は値しか読めないので、関数の文は呼び出しの見本を表に足して検査する。見本を出したら、その道筋を
 * 理由つきの例外（`unsampled`）にする。黙って飛ばすと、関数の中の文が一度も検査されない
 */
export function collectFunctions(value: unknown, path = ''): string[] {
  return collect(value, path).functions
}

function collect(
  value: unknown,
  path: string,
): { entries: LangEntry[]; loose: LooseText[]; functions: string[] } {
  const entries: LangEntry[] = []
  const loose: LooseText[] = []
  const functions: string[] = []
  const seen = new WeakSet<object>()
  const walk = (v: unknown, p: string, depth: number): void => {
    if (typeof v === 'string') {
      if (hasCjk(v)) loose.push({ path: p, text: v })
      return
    }
    if (typeof v === 'function') {
      if (depth >= 2) functions.push(p)
      return
    }
    if (depth > MAX_DEPTH || typeof v !== 'object' || v === null) return
    if (seen.has(v)) return
    seen.add(v)
    if (isLangRecord(v)) {
      const byLang = new Map<Lang, Map<string, string>>()
      const fns = new Set<string>()
      for (const lang of LANGS) {
        const flat = new Map<string, string>()
        flatten(v[lang], '', flat, fns, depth + 1)
        byLang.set(lang, flat)
      }
      for (const leaf of fns) functions.push(leaf === '' ? p : join(p, leaf))
      const leaves = new Set(LANGS.flatMap((lang) => [...(byLang.get(lang)?.keys() ?? [])]))
      for (const leaf of leaves) {
        const texts: Partial<Record<Lang, string>> = {}
        for (const lang of LANGS) {
          const text = byLang.get(lang)?.get(leaf)
          if (text !== undefined) texts[lang] = text
        }
        entries.push({ path: leaf === '' ? p : join(p, leaf), texts })
      }
      // 4 言語の組の外に並ぶキー（例: { ja, en, zh, ko, id }）も辿る
      for (const [k, child] of Object.entries(v)) {
        if (!(LANGS as readonly string[]).includes(k)) walk(child, join(p, k), depth + 1)
      }
      return
    }
    const children = Array.isArray(v) ? v.entries() : Object.entries(v)
    for (const [k, child] of children) walk(child, join(p, k), depth + 1)
  }
  walk(value, path, 0)
  return { entries, loose, functions }
}

function placeholders(text: string): string {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))].sort().join(',')
}

/** 1 つの組の問題（R3） */
export function checkEntry(entry: LangEntry): { rule: TableRule; lang?: Lang }[] {
  const problems: { rule: TableRule; lang?: Lang }[] = []
  const { texts } = entry
  for (const lang of LANGS) {
    const text = texts[lang]
    if (text === undefined) problems.push({ rule: 'missing', lang })
    else if (text.replace(INVISIBLE, '').trim() === '') problems.push({ rule: 'empty', lang })
  }
  if (problems.length > 0) return problems

  const all = LANGS.map((lang) => texts[lang] ?? '')
  const ja = texts.ja ?? ''
  // 中立の文: 4 言語が同じで、仮名・漢字・ハングルも英語の語も含まない（ブランド名・単位・キーの名前）。
  // 4 言語に同じ英文を写した組（Loading ×4）は中立にしない
  const neutral = all.every((t) => t === ja) && !hasCjk(ja) && !hasEnglishWord(ja)
  if (!neutral) {
    for (const lang of LANGS) {
      for (const rule of scriptProblems(lang, texts[lang] ?? '')) problems.push({ rule, lang })
    }
    for (const lang of ['en', 'ko'] as const) {
      if (texts[lang] === ja && hasCjk(ja)) problems.push({ rule: 'copy', lang })
    }
  }
  const names = placeholders(ja)
  for (const lang of LANGS) {
    if (placeholders(texts[lang] ?? '') !== names) problems.push({ rule: 'placeholder', lang })
  }
  return problems
}

export type CheckOptions = {
  /** 例外。使われなかった例外は `unusedAllowances` に出す（古い例外を残さない） */
  allow?: readonly TableAllowance[]
}

export type CheckResult = {
  /** 見た組の数（0 なら表を読めていない） */
  entries: number
  problems: TableProblem[]
  unusedAllowances: TableAllowance[]
}

/**
 * 表をまとめて検査する。
 * @param tables ファイル名 → モジュール（import.meta.glob の eager の結果、または手で書いた表）
 */
export function checkTables(
  tables: Readonly<Record<string, unknown>>,
  options: CheckOptions = {},
): CheckResult {
  const allow = options.allow ?? []
  const used = new Set<TableAllowance>()
  const problems: TableProblem[] = []
  let count = 0
  const report = (file: string, path: string, p: { rule: TableRule; lang?: Lang }) => {
    const hit = allow.find(
      (a) => a.rule === p.rule && (a.path === `${file}:${path}` || a.path === path),
    )
    if (hit) used.add(hit)
    else problems.push({ file, path, ...p })
  }
  for (const [file, mod] of Object.entries(tables)) {
    const { entries, loose, functions } = collect(mod, '')
    count += entries.length
    for (const entry of entries) {
      for (const p of checkEntry(entry)) report(file, entry.path, p)
    }
    for (const l of loose) report(file, l.path, { rule: 'untranslated' })
    for (const f of functions) report(file, f, { rule: 'unsampled' })
  }
  return { entries: count, problems, unusedAllowances: allow.filter((a) => !used.has(a)) }
}

/** 問題を 1 行ずつの文にする（テストの失敗の表示） */
export function formatProblems(problems: readonly TableProblem[]): string {
  return problems
    .map((p) => `${p.file} ${p.path}${p.lang ? ` [${p.lang}]` : ''}: ${p.rule}`)
    .join('\n')
}
