import type { LightPeriod } from '@antler/zones'
import { Color } from 'three'
import type { Weather } from '../types'
import { OVERCAST, SKY, WEATHER_FOG, WEATHER_SKY, type SkyLook } from './palette'

// 光の区分と天候から、空・フォグ・光の目標の値を決める（drive-season UC-3f）。描画と分けてテストする。
// Atmosphere はこの目標へ 3 秒ほどかけて寄せる（光の区分の変化と同じなじませ）。

function toward(a: string, b: string, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`
}

/** 光の区分 period・天候 weather の空とフォグ（晴れは SKY のまま。曇り・雨・雪・霧は雲の灰色へ寄せ、霧を詰める） */
export function skyTargetOf(period: LightPeriod, weather: Weather): SkyLook {
  const base = SKY[period]
  const { gray, sun } = WEATHER_SKY[weather]
  const cloud = OVERCAST[period]
  const fog = WEATHER_FOG[weather]
  return {
    ...base,
    zenith: toward(base.zenith, cloud.zenith, gray),
    horizon: toward(base.horizon, cloud.horizon, gray),
    fog: toward(base.fog, cloud.horizon, gray),
    fogNear: base.fogNear * fog,
    fogFar: base.fogFar * fog,
    sunIntensity: base.sunIntensity * sun,
  }
}

const PERIODS: LightPeriod[] = ['day', 'dawn', 'dusk', 'night']

/** 天候ごとに 4 つの光の区分の目標をまとめて作る（毎フレーム色の文字列を作らない） */
export function skyTableOf(weather: Weather): Record<LightPeriod, SkyLook> {
  const out = {} as Record<LightPeriod, SkyLook>
  for (const p of PERIODS) out[p] = skyTargetOf(p, weather)
  return out
}
