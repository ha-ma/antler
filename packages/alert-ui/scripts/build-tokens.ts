// docs/design/tokens.json → packages/alert-ui/src/tokens/tokens.css・tokens.ts
//   npm run build:tokens -w @antler/alert-ui
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDesignTokens, renderTokensCss, renderTokensTs } from './tokens'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/tokens')
const tokens = loadDesignTokens()
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'tokens.css'), renderTokensCss(tokens))
writeFileSync(path.join(outDir, 'tokens.ts'), renderTokensTs(tokens))
process.stdout.write('wrote src/tokens/tokens.css, src/tokens/tokens.ts\n')
