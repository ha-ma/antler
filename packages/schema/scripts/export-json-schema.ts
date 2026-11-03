// Zod の定義から packages/schema/json/*.schema.json を書き出す。
//   npm run build:json -w @antler/schema
// 生成物を手で直さない。UC-1i のテストが、定義と書き出し済みのファイルの一致を確かめる。
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA_SOURCES, renderJsonSchema, type JsonSchemaName } from '../src/json-schema'

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../json')
mkdirSync(outDir, { recursive: true })
for (const name of Object.keys(JSON_SCHEMA_SOURCES) as JsonSchemaName[]) {
  writeFileSync(path.join(outDir, `${name}.schema.json`), renderJsonSchema(name))
  process.stdout.write(`wrote json/${name}.schema.json\n`)
}
