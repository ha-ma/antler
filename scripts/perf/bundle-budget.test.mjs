// bundle-budget.mjs の純粋な部分の自己テスト（performance R6、UC-6b）。ビルドはしない。
// 実行: node --test scripts/perf/bundle-budget.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closure, resolveKey, unknownDynamicEntries } from './bundle-budget.mjs'

/** 小さな manifest（入口・画面・共有のチャンク・3D・地図） */
const MANIFEST = {
  'index.html': {
    file: 'assets/index.js',
    isEntry: true,
    imports: ['_vendor.js'],
    css: ['assets/index.css'],
  },
  '_vendor.js': { file: 'assets/vendor.js' },
  // record の barrel はほかからも読まれて共有のチャンクに移った
  '_record-abc.js': { file: 'assets/record.js', isDynamicEntry: true, imports: ['_vendor.js'] },
  'src/features/brief-map/index.ts': { file: 'assets/brief.js', isDynamicEntry: true },
  'src/features/loss/index.ts': { file: 'assets/loss.js', isDynamicEntry: true },
  'src/features/stop-events/index.ts': { file: 'assets/stops.js', isDynamicEntry: true },
  'src/app/DriveRoute.tsx': {
    file: 'assets/route.js',
    isDynamicEntry: true,
    imports: ['src/features/drive/index.ts'],
  },
  'src/features/drive/index.ts': { file: 'assets/drive.js' },
  'src/features/drive/scene/DriveCanvas.tsx': {
    file: 'assets/scene.js',
    isDynamicEntry: true,
    imports: ['_three.js', '_vendor.js'],
  },
  '_three.js': { file: 'assets/three.js' },
  '../../node_modules/maplibre-gl/dist/maplibre-gl.js': {
    file: 'assets/maplibre.js',
    isDynamicEntry: true,
  },
}

test('UC-6b: 共有のチャンクに移った barrel は _<feature>- の名前で解く。2 つあれば止める', () => {
  assert.equal(resolveKey(MANIFEST, 'src/features/record/index.ts'), '_record-abc.js')
  assert.equal(resolveKey(MANIFEST, 'src/features/loss/index.ts'), 'src/features/loss/index.ts')
  const two = { ...MANIFEST, '_record-def.js': { file: 'assets/record2.js' } }
  assert.throws(() => resolveKey(two, 'src/features/record/index.ts'), /複数/)
  assert.throws(() => resolveKey(MANIFEST, 'src/features/nope/index.ts'), /manifest に/)
})

test('UC-6b: closure は静的に読むチャンクと CSS をたどる', () => {
  const files = closure(MANIFEST, ['index.html', 'src/app/DriveRoute.tsx'])
  assert.deepEqual([...files].sort(), [
    'assets/drive.js',
    'assets/index.css',
    'assets/index.js',
    'assets/route.js',
    'assets/vendor.js',
  ])
})

test('UC-6b: 共有のチャンクに移った画面は「上限の無い口」にしない。知らない口は返す', () => {
  assert.deepEqual(unknownDynamicEntries(MANIFEST), [])
  const extra = {
    ...MANIFEST,
    'src/features/new-page/index.ts': { file: 'assets/new.js', isDynamicEntry: true },
  }
  assert.deepEqual(unknownDynamicEntries(extra), ['src/features/new-page/index.ts'])
})
