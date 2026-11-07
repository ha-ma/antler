import { Fragment, type ReactNode } from 'react'

// 文の型（`{key}`）に React の要素を差し込む（docs/specs/result-countup/functional.md R2）。
// 言語ごとに置き場所の順番が違うので、名前で差し込む。文字だけを渡せば fillText と同じ文字列になる。
// 知らない key は fillText と同じく `{key}` のまま残す。

const PLACEHOLDER_RE = /\{(\w+)\}/g

export function fillNodes(template: string, values: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const [all, key = ''] = m
    if (m.index > last) out.push(template.slice(last, m.index))
    out.push(
      key in values ? <Fragment key={`${key}-${String(m.index)}`}>{values[key]}</Fragment> : all,
    )
    last = m.index + all.length
  }
  if (last < template.length) out.push(template.slice(last))
  return out
}
