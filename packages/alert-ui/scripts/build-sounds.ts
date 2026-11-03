// packages/alert-ui/assets/sounds/chime.wav・beep.wav を書き出す
//   npm run build:sounds -w @antler/alert-ui
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderBeepWav, renderChimeWav } from './sounds'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/sounds')
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'chime.wav'), renderChimeWav())
writeFileSync(path.join(outDir, 'beep.wav'), renderBeepWav())
process.stdout.write('wrote assets/sounds/chime.wav, assets/sounds/beep.wav\n')
