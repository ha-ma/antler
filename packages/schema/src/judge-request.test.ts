import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlertFlagSchema, readAlertFlag } from './alert-flag'
import { CaptureSchema, isUploadable } from './capture'
import * as api from './index'
import { JUDGE_QUESTIONS, JudgeRequestSchema } from './judge-request'
import { JSON_SCHEMA_SOURCES, renderJsonSchema, type JsonSchemaName } from './json-schema'
import { FIXTURES_DIR, loadFixture, loadFixtures } from './test-fixtures'

// docs/specs/schema-judge/functional.md の Test List（TS 側）。
// 同じ見本を edge の Python（jsonschema と pydantic）も使う: edge/detector/tests/test_judge_request_model.py。

type Json = Record<string, unknown>
const ch7 = () =>
  loadFixture('judge-request', 'valid', 'ch7-example') as Json & {
    state: Json & { track: Json[] }
    questions: Json[]
  }
const parses = (value: unknown) => JudgeRequestSchema.safeParse(value).success
const withState = (patch: Json) => ({ ...ch7(), state: { ...ch7().state, ...patch } })
const jsonSchemaDir = path.resolve(FIXTURES_DIR, '../json')

describe('AC 受け入れ', () => {
  it('AC-1: 原本 ch7 の JudgeRequest の例が通り、質問文を 1 語変えると落ちる（Python 側は test_judge_request_model.py）', () => {
    expect(parses(ch7())).toBe(true)
    const reworded = ch7()
    reworded.questions[0] = { ...reworded.questions[0], text: 'Which alert should the driver get?' }
    expect(parses(reworded)).toBe(false)
  })

  // 「既存の全見本の結果が変わらない」は schema.test.ts（全見本）と edge の契約テストが担保する。ここでは l1 の有無だけを比べる
  it('AC-2: l1 つきの AlertFlag と l1Probs つきの Capture が通り、readAlertFlag の結果は l1 の有無で変わらない', () => {
    expect(AlertFlagSchema.safeParse(loadFixture('alert-flag', 'valid', 'with-l1')).success).toBe(
      true,
    )
    expect(CaptureSchema.safeParse(loadFixture('capture', 'valid', 'with-l1probs')).success).toBe(
      true,
    )
    const plain = readAlertFlag(loadFixture('alert-flag', 'valid', 'ch7-example'))
    const withL1 = readAlertFlag(loadFixture('alert-flag', 'valid', 'with-l1'))
    expect(withL1).toEqual(plain)
    for (const kind of ['alert-flag', 'capture', 'client-message', 'trip-plan'] as const) {
      expect(loadFixtures(kind, 'valid').length, kind).toBeGreaterThan(0)
    }
  })
})

describe('UC-1 JudgeRequest の形', () => {
  it('UC-1a: ch7 原本の例（と valid の見本すべて）が通る', () => {
    const failing = loadFixtures('judge-request', 'valid')
      .filter((f) => !parses(f.value))
      .map((f) => f.name)
    expect(failing).toEqual([])
    expect(loadFixtures('judge-request', 'valid').map((f) => f.name)).toContain('ch7-example')
  })

  it('UC-1b: model の欠落・空文字・65 字・空白や改行を含む → 拒否。jev-latest 以外の文字列 → 通る', () => {
    for (const n of [
      'model-missing',
      'model-empty',
      'model-too-long',
      'model-space',
      'model-newline',
      'model-leading-hyphen',
      'model-non-ascii',
    ]) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
    for (const n of ['model-other', 'model-dotted']) {
      expect(parses(loadFixture('judge-request', 'valid', n)), n).toBe(true)
    }
  })

  it('UC-1c: state に frameJpegB64・lat・lng・deviceId を足す → 拒否。トップレベルの余分なキー → 拒否', () => {
    for (const n of [
      'state-frame-jpeg',
      'state-lat',
      'state-lng',
      'state-device-id',
      'top-level-extra',
    ]) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
  })

  it('UC-1d: zone・light・headlight が語彙の外 → 拒否', () => {
    for (const n of ['zone-bad', 'light-bad', 'headlight-bad']) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
  })

  it('UC-1e: track の 0 件・65 件・t が正・conf が範囲外・distanceM が負・side が F・pos が語彙の外・キーの欠落や余分 → 拒否。64 件 → 通る', () => {
    const invalid = loadFixtures('judge-request', 'invalid').filter((x) =>
      x.name.startsWith('track-'),
    )
    expect(invalid.map((f) => f.name)).toEqual(expect.arrayContaining(['track-65', 'track-empty']))
    for (const f of invalid) expect(parses(f.value), f.name).toBe(false)
    expect(parses(loadFixture('judge-request', 'valid', 'track-64'))).toBe(true)
  })

  it('UC-1f: lateralMps が負 → 通る。speedKmh が負・文字列 → 拒否', () => {
    expect(parses(loadFixture('judge-request', 'valid', 'lateral-negative'))).toBe(true)
    expect(parses(loadFixture('judge-request', 'invalid', 'speed-negative'))).toBe(false)
    expect(parses(loadFixture('judge-request', 'invalid', 'speed-string'))).toBe(false)
  })

  it('UC-1g: ttcSec が null → 通る。負・欠落 → 拒否', () => {
    expect(parses(loadFixture('judge-request', 'valid', 'ttc-null'))).toBe(true)
    expect(parses(loadFixture('judge-request', 'invalid', 'ttc-negative'))).toBe(false)
    expect(parses(loadFixture('judge-request', 'invalid', 'ttc-missing'))).toBe(false)
  })

  it('UC-1h: recentAlerts30s が負・小数・欠落 → 拒否。0 → 通る', () => {
    for (const n of ['recent-negative', 'recent-fractional', 'recent-missing']) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
    expect(parses(loadFixture('judge-request', 'valid', 'single-track-outside-night'))).toBe(true)
  })

  it('UC-1i: 1e400（JSON として正しく Infinity に読まれる値）は拒否される', () => {
    const text = JSON.stringify(ch7()).replace('"speedKmh":54', '"speedKmh":1e400')
    expect(text).toContain('1e400')
    expect(parses(JSON.parse(text))).toBe(false)
  })

  it('UC-1i: NaN・Infinity は speedKmh・lateralMps・ttcSec のどれでも拒否される', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(parses(withState({ speedKmh: bad })), `speedKmh ${bad}`).toBe(false)
      expect(parses(withState({ ttcSec: bad })), `ttcSec ${bad}`).toBe(false)
      const request = ch7()
      request.state.track[1] = { ...request.state.track[1], lateralMps: bad }
      expect(parses(request), `lateralMps ${bad}`).toBe(false)
    }
  })

  it('invalid の見本はすべて拒否される（edge の契約テストと同じ見本）', () => {
    const passing = loadFixtures('judge-request', 'invalid')
      .filter((f) => parses(f.value))
      .map((f) => f.name)
    expect(passing).toEqual([])
  })
})

describe('UC-2 質問の固定', () => {
  const texts = [
    'Which alert should the driver get now?',
    'The animal is moving into the driving lane.',
    'The animal is standing still on the road shoulder.',
    'The detection is not a real deer (sign, snow, post).',
  ]

  it('UC-2a: 文言を変える（4 問それぞれ）→ 拒否', () => {
    for (const n of [
      'question-reworded-alert-level',
      'question-reworded-on-roadway',
      'question-reworded-static-shoulder',
      'question-reworded-false-positive',
      'question-text-trailing-space',
    ]) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
    texts.forEach((text, i) => {
      const request = ch7()
      request.questions[i] = { ...request.questions[i], text: `${text} ` }
      expect(parses(request), `question ${i}`).toBe(false)
    })
  })

  it('UC-2b: 3 問・5 問・0 問・順序の入れ替え・同じ質問の重複 → 拒否', () => {
    for (const n of [
      'questions-three',
      'questions-five',
      'questions-empty',
      'questions-swapped',
      'questions-duplicate',
    ]) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
  })

  it('UC-2c: options の順の入れ替え・欠落・余分、type の取り違え、余分なキー → 拒否', () => {
    for (const n of [
      'options-reordered',
      'options-missing',
      'options-extra',
      'type-swapped',
      'noul-with-options',
      'question-extra-key',
    ]) {
      expect(parses(loadFixture('judge-request', 'invalid', n)), n).toBe(false)
    }
  })

  it('UC-2d: JUDGE_QUESTIONS は ch7 の例の questions と一致し、そのまま JudgeRequestSchema に通る', () => {
    expect(JSON.parse(JSON.stringify(JUDGE_QUESTIONS))).toEqual(ch7().questions)
    expect(JUDGE_QUESTIONS.map((q) => q.text)).toEqual(texts)
    expect(parses({ ...ch7(), questions: JUDGE_QUESTIONS })).toBe(true)
  })
})

describe('UC-3 AlertFlag.l1', () => {
  it('UC-3a: l1 つきの 4 通りの AlertFlag（deer true/false × inside/outside）が通る', () => {
    const names = [
      'with-l1',
      'with-l1-deer-true-outside',
      'with-l1-deer-false-inside',
      'with-l1-deer-false-outside',
    ]
    for (const n of names) {
      expect(AlertFlagSchema.safeParse(loadFixture('alert-flag', 'valid', n)).success, n).toBe(true)
    }
  })

  it('UC-3b: conf が範囲外・alert_level が red・overrode が真偽値でない・latencyMs が負・キーの欠落・余分なキー・null → 拒否', () => {
    const names = loadFixtures('alert-flag', 'invalid')
      .map((f) => f.name)
      .filter((n) => n.startsWith('l1-'))
    expect(names.length).toBe(7)
    for (const n of names) {
      expect(AlertFlagSchema.safeParse(loadFixture('alert-flag', 'invalid', n)).success, n).toBe(
        false,
      )
    }
  })

  it('UC-3c: l1 の無い既存の見本は結果が変わらない', () => {
    const plain = loadFixtures('alert-flag', 'valid').filter((f) => !f.name.includes('l1'))
    expect(plain.length).toBeGreaterThanOrEqual(5)
    for (const f of plain) {
      expect(AlertFlagSchema.safeParse(f.value).success, f.name).toBe(true)
    }
  })

  it('UC-3d: readAlertFlag は l1 つきのフラグを厳しい検証にも通し（strict:true・problem なし）、結果に l1 を含めない', () => {
    const result = readAlertFlag(loadFixture('alert-flag', 'valid', 'with-l1'))
    expect(result.problem).toBeUndefined()
    expect(result.flag?.strict).toBe(true)
    expect(result.flag).not.toHaveProperty('l1')
  })

  it('UC-3e: [ADDED spec-adversary C1] l1 だけが壊れた deer:false は strict:true。deer:true は壊れた l1 でも deer・距離・方向を読む。deer の欄が壊れていれば strict:false', () => {
    const off = loadFixture('alert-flag', 'valid', 'with-l1-deer-false-inside') as Json
    const brokenOff = readAlertFlag({ ...off, l1: { alert_level: 'red', conf: 7 } })
    expect(brokenOff.flag).toMatchObject({ deer: false, strict: true })
    expect(brokenOff.problem).toBeUndefined()
    expect(AlertFlagSchema.safeParse({ ...off, l1: { alert_level: 'red', conf: 7 } }).success).toBe(
      false,
    )
    const on = readAlertFlag(loadFixture('alert-flag', 'invalid', 'l1-conf-over-1'))
    expect(on.flag).toMatchObject({ deer: true, distanceM: 58, side: 'L', strict: true })
    const brokenFlag = readAlertFlag({ ...off, zone: 'sideways', l1: { conf: 7 } })
    expect(brokenFlag.flag).toMatchObject({ deer: false, strict: false })
    expect(brokenFlag.problem).toBe('partial')
  })
})

describe('UC-4 Capture.l1Probs', () => {
  it('UC-4a: ch7 の Capture の例に l1Probs を足したものが通る', () => {
    expect(CaptureSchema.safeParse(loadFixture('capture', 'valid', 'with-l1probs')).success).toBe(
      true,
    )
  })

  it('UC-4b: 確率が 0〜1 の外・alert_level の値の欠落・質問の欠落・余分なキー・null → 拒否', () => {
    const names = loadFixtures('capture', 'invalid')
      .map((f) => f.name)
      .filter((n) => n.startsWith('l1probs-'))
    expect(names.length).toBe(7)
    for (const n of names) {
      expect(CaptureSchema.safeParse(loadFixture('capture', 'invalid', n)).success, n).toBe(false)
    }
  })

  it('UC-4c: l1Probs の無い既存の見本は結果が変わらない', () => {
    const plain = loadFixtures('capture', 'valid').filter((f) => !f.name.includes('l1probs'))
    expect(plain.length).toBeGreaterThanOrEqual(3)
    for (const f of plain) {
      expect(CaptureSchema.safeParse(f.value).success, f.name).toBe(true)
    }
  })

  it('UC-4d: l1Probs があっても consent:false は isUploadable が false', () => {
    expect(isUploadable(loadFixture('capture', 'valid', 'with-l1probs-consent-false'))).toBe(false)
    expect(isUploadable(loadFixture('capture', 'valid', 'with-l1probs'))).toBe(true)
  })
})

describe('UC-5 JSON Schema', () => {
  it('UC-5a: 書き出し済みの json/*.schema.json（judge-request を含む 5 つ）が定義から作り直したものと一致する', () => {
    const names = Object.keys(JSON_SCHEMA_SOURCES) as JsonSchemaName[]
    expect(names).toContain('judge-request')
    // 件数は固定しない（ほかの feature が JSON Schema の対象を足しても壊れないように）
    expect(names).toEqual(
      expect.arrayContaining(['alert-flag', 'capture', 'client-message', 'judge-request']),
    )
    for (const name of names) {
      const file = path.join(jsonSchemaDir, `${name}.schema.json`)
      expect(readFileSync(file, 'utf-8'), `${name}: npm run build:json -w @antler/schema`).toBe(
        renderJsonSchema(name),
      )
    }
  })

  it('UC-5c: 既存のプロパティ（AlertFlag・Capture の全キー）が JSON Schema に残り、増えたのは l1・l1Probs だけ', () => {
    const flag = JSON.parse(renderJsonSchema('alert-flag')) as { anyOf: { properties: Json }[] }
    const existingFlagKeys = [
      'type',
      'v',
      't_frame',
      't_sent',
      'frameJpegB64',
      'deer',
      'conf',
      'zone',
    ]
    expect(flag.anyOf).toHaveLength(4)
    for (const arm of flag.anyOf) {
      for (const key of existingFlagKeys) expect(arm.properties, key).toHaveProperty(key)
      expect(arm.properties).toHaveProperty('l1')
    }
    const capture = JSON.parse(renderJsonSchema('capture')) as {
      properties: Json
      required: string[]
    }
    const existingCaptureKeys = [
      'id',
      'source',
      'image',
      'imageSize',
      'boxes',
      'conditions',
      'distanceM',
      'side',
      'pose',
      'reactionMs',
      'outcome',
      'roadSegment',
      'consent',
      'createdAt',
    ]
    expect(Object.keys(capture.properties).sort()).toEqual(
      [...existingCaptureKeys, 'l1Probs'].sort(),
    )
    expect(capture.required).not.toContain('l1Probs')
    expect(capture.required.sort()).toEqual([...existingCaptureKeys].sort())
  })

  it('UC-5d: index.ts の既存の export がすべて残り、JudgeRequest 関連が増えている', () => {
    const existing = [
      'IsoDateTime',
      'Lang',
      'Side',
      'Slug',
      'toJst',
      'AlertFlagSchema',
      'readAlertFlag',
      'AckMessageSchema',
      'ClientMessageSchema',
      'LabelMessageSchema',
      'CaptureSchema',
      'isUploadable',
      'DeparturePlace',
      'TripPlanSchema',
      'buildJsonSchema',
      'JSON_SCHEMA_SOURCES',
      'renderJsonSchema',
    ]
    const added = [
      'JudgeRequestSchema',
      'JUDGE_QUESTIONS',
      'AlertLevel',
      'L1ResultSchema',
      'L1ProbsSchema',
    ]
    for (const name of [...existing, ...added]) expect(api, name).toHaveProperty(name)
  })
})

describe('FAIL / IDEM', () => {
  it('FAIL-1: 壊れた l1 つきの deer:false は strict:true（PWA が捨てず赤を解ける）。壊れた l1 つきの deer:true は deer・距離・方向を読める', () => {
    const off = loadFixture('alert-flag', 'valid', 'with-l1-deer-false-outside') as Json
    expect(readAlertFlag({ ...off, l1: { ...(off['l1'] as Json), conf: 1.1 } }).flag?.strict).toBe(
      true,
    )
    const on = readAlertFlag(loadFixture('alert-flag', 'invalid', 'l1-conf-over-1'))
    expect(on.flag).toMatchObject({ deer: true, distanceM: 58, side: 'L' })
  })

  it('FAIL-2: pos に末尾の改行がある JudgeRequest は拒否される（JSON Schema の式は (?!\\n)$ に直してある）', () => {
    expect(parses(loadFixture('judge-request', 'invalid', 'track-pos-trailing-newline'))).toBe(
      false,
    )
    expect(renderJsonSchema('judge-request')).toContain('(?!\\\\n)$')
  })

  it('FAIL-4: 壊れた l1Probs を持つ Capture は isUploadable が false', () => {
    expect(isUploadable(loadFixture('capture', 'invalid', 'l1probs-over-1'))).toBe(false)
    expect(isUploadable(loadFixture('capture', 'invalid', 'l1probs-extra-key'))).toBe(false)
  })

  it('IDEM-1: JSON Schema の書き出しを 2 回繰り返しても同じバイト列', () => {
    for (const name of Object.keys(JSON_SCHEMA_SOURCES) as JsonSchemaName[]) {
      expect(renderJsonSchema(name)).toBe(renderJsonSchema(name))
    }
  })
})
