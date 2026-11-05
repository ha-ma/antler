import type { SceneChoice, SceneWriting, StopDeck, StopDeckResponse, StopScene } from '../types'

// 束の POST の応答の形を確かめる（docs/specs/stop-events/functional.md UI-4e）。
// sim は zod を持たない（lock を他のセッションとぶつけない。plan.md）ので、使う欄だけを手で確かめる。形が違えば null。

type Obj = Record<string, unknown>

const LIGHTS = new Set(['dawn', 'day', 'dusk', 'night'])
const SCENE_KINDS = new Set(['pleasure', 'fuel', 'traffic', 'weather', 'request'])
const LANGS = ['ja', 'en', 'zh', 'ko'] as const

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLocalized = (v: unknown) => isObj(v) && LANGS.every((l) => isStr(v[l]))
const isArrival = (v: unknown) => v === null || (isObj(v) && isStr(v['place']) && isStr(v['at']))

function isChoice(v: unknown): v is SceneChoice {
  if (!isObj(v) || !isStr(v['id']) || !isStr(v['kind']) || !isNum(v['delayMin'])) return false
  if (typeof v['endsDay'] !== 'boolean' || !isArrival(v['arrive'])) return false
  const zone = v['zone']
  if (
    zone !== null &&
    !(
      isObj(zone) &&
      isStr(zone['entryAt']) &&
      LIGHTS.has(zone['light'] as string) &&
      isNum(zone['km']) &&
      isLocalized(zone['roadName'])
    )
  ) {
    return false
  }
  const lost = v['lost']
  return (
    isObj(lost) &&
    isNum(lost['jpy']) &&
    isNum(lost['weight']) &&
    Array.isArray(lost['pleasures']) &&
    typeof lost['lateReturn'] === 'boolean'
  )
}

function isScene(v: unknown): v is StopScene {
  if (!isObj(v) || !isStr(v['id']) || !SCENE_KINDS.has(v['kind'] as string) || !isStr(v['at'])) {
    return false
  }
  const trigger = v['trigger']
  const triggerOk =
    isObj(trigger) &&
    ((trigger['kind'] === 'stop' && isNum(trigger['beforeLeg'])) ||
      (trigger['kind'] === 'road' && isNum(trigger['leg']) && isNum(trigger['km'])))
  const choices = v['choices']
  return (
    triggerOk &&
    isArrival(v['arrive']) &&
    Array.isArray(choices) &&
    choices.length >= 2 &&
    choices.length <= 3 &&
    choices.every(isChoice)
  )
}

function isSceneWriting(v: unknown): v is SceneWriting {
  return (
    isObj(v) &&
    isStr(v['id']) &&
    isLocalized(v['headline']) &&
    isLocalized(v['body']) &&
    Array.isArray(v['choices']) &&
    v['choices'].every(
      (c) => isObj(c) && isStr(c['id']) && isLocalized(c['label']) && isLocalized(c['note']),
    )
  )
}

export function parseStopDeckResponse(body: unknown): StopDeckResponse | null {
  if (!isObj(body)) return null
  const deck = body['deck']
  const writing = body['writing']
  if (
    !isObj(deck) ||
    !isStr(deck['tripId']) ||
    !isNum(deck['day']) ||
    !isStr(deck['date']) ||
    !isNum(deck['dayBudgetJPY']) ||
    !Array.isArray(deck['scenes']) ||
    !deck['scenes'].every(isScene)
  ) {
    return null
  }
  if (!isObj(writing) || !Array.isArray(writing['scenes'])) return null
  if (!writing['scenes'].every(isSceneWriting)) return null
  return { deck: deck as StopDeck, writing: { scenes: writing['scenes'] } }
}
