// data/zones.source.json → data/zones.geojson
//   npm run build:zones -w @antler/zones
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildZoneCollection, loadSourceFile, renderZoneCollection } from './zones-builder'

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
const collection = buildZoneCollection(loadSourceFile(path.join(dataDir, 'zones.source.json')))
writeFileSync(path.join(dataDir, 'zones.geojson'), renderZoneCollection(collection))
process.stdout.write(
  `wrote data/zones.geojson（${String(collection.features.length)} ゾーン、hash ${collection.hash.slice(0, 12)}）\n`,
)
