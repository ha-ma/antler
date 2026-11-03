// docs/design/tokens.json から tokens.css（CSS 変数）と tokens.ts（TS 定数）を作る（ch8 規約 1、functional.md R9）。
// 書き出しは build-tokens.ts。UC-9a のテストが、書き出し済みのファイルとこの出力の一致を確かめる。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type DesignTokens = {
  name: string
  version: number
  color: {
    themes: { id: string; name: string }[]
    tokens: { name: string; value: Record<string, string>; usage: string }[]
  }
  type: {
    families: Record<string, string>
    groups: {
      name: string
      family: string
      styles: {
        name: string
        fontSize: string
        lineHeight: string
        fontWeight: number
        letterSpacing?: string
      }[]
    }[]
  }
  spacing: { tokens: { name: string; value: string }[] }
  radius: { tokens: { name: string; value: string }[] }
  shadow: { tokens: { name: string; value: string }[] }
}

export const TOKENS_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/design/tokens.json',
)

const HEADER =
  '生成物: docs/design/tokens.json から packages/alert-ui/scripts/build-tokens.ts が作る。手で直さない'

export function loadDesignTokens(file = TOKENS_JSON): DesignTokens {
  return JSON.parse(readFileSync(file, 'utf-8')) as DesignTokens
}

/** テーマで変えない色（alert-* と on-alert-*）。:root に 1 回だけ出す。 */
function isFixed(name: string): boolean {
  return name.startsWith('alert-') || name.startsWith('on-alert-')
}

export function renderTokensCss(t: DesignTokens): string {
  const lines: string[] = [`/* ${HEADER} */`, '']
  const fixed = t.color.tokens.filter((c) => isFixed(c.name))
  const themed = t.color.tokens.filter((c) => !isFixed(c.name))
  const first = t.color.themes[0]?.id ?? 'trip'

  lines.push(':root {')
  for (const c of fixed) lines.push(`  --${c.name}: ${c.value[first] ?? ''};`)
  for (const [k, v] of Object.entries(t.type.families)) lines.push(`  --font-${k}: ${v};`)
  for (const g of t.type.groups) {
    for (const s of g.styles) {
      lines.push(`  --${s.name}-size: ${s.fontSize};`)
      lines.push(`  --${s.name}-line: ${s.lineHeight};`)
      lines.push(`  --${s.name}-weight: ${String(s.fontWeight)};`)
      if (s.letterSpacing) lines.push(`  --${s.name}-tracking: ${s.letterSpacing};`)
    }
  }
  for (const s of t.spacing.tokens) lines.push(`  --${s.name}: ${s.value};`)
  for (const r of t.radius.tokens) lines.push(`  --${r.name}: ${r.value};`)
  for (const s of t.shadow.tokens) lines.push(`  --${s.name}: ${s.value};`)
  lines.push('}', '')

  t.color.themes.forEach((theme, i) => {
    const selector = i === 0 ? `:root,\n[data-theme='${theme.id}']` : `[data-theme='${theme.id}']`
    lines.push(`${selector} {`)
    for (const c of themed) lines.push(`  --${c.name}: ${c.value[theme.id] ?? ''};`)
    lines.push('}', '')
  })
  return `${lines.join('\n').trimEnd()}\n`
}

export function renderTokensTs(t: DesignTokens): string {
  const color: Record<string, Record<string, string>> = {}
  for (const theme of t.color.themes) {
    color[theme.id] = Object.fromEntries(
      t.color.tokens.map((c) => [c.name, c.value[theme.id] ?? '']),
    )
  }
  const out = {
    color,
    font: t.type.families,
    type: Object.fromEntries(
      t.type.groups.flatMap((g) =>
        g.styles.map((s) => [
          s.name,
          {
            family: g.family,
            fontSize: s.fontSize,
            lineHeight: s.lineHeight,
            fontWeight: s.fontWeight,
            ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}),
          },
        ]),
      ),
    ),
    space: Object.fromEntries(t.spacing.tokens.map((s) => [s.name, s.value])),
    radius: Object.fromEntries(t.radius.tokens.map((r) => [r.name, r.value])),
    shadow: Object.fromEntries(t.shadow.tokens.map((s) => [s.name, s.value])),
  }
  return [
    `// ${HEADER}`,
    '',
    `export const tokens = ${JSON.stringify(out, null, 2)} as const`,
    '',
    'export type ThemeId = keyof typeof tokens.color',
    '',
  ].join('\n')
}
