// 視線（R10、A3-2）。カーソルの位置（正規化 -1〜1）→ 目標のヨー・ピッチ（制限つき）と、イージング。
// 符号: ヨーは右を見るのが正、ピッチは上を見るのが正（rad）。three.js への変換（rotation.y = -yaw）は scene/ でする。
// スマホのジャイロ（mobile-landscape）も同じ lookTarget / easeLook に渡せばよい。

export const LOOK_YAW_MAX_DEG = 12
export const LOOK_PITCH_MAX_DEG = 6
/** 目標へ近づく時定数（s）。0.25 秒で 63% */
export const LOOK_TIME_CONSTANT_S = 0.25
/** 1 回に進める時間の上限（s）。タブを戻したときに視線が飛ばない */
const MAX_DT_S = 0.1

const RAD = Math.PI / 180

export type Look = { yaw: number; pitch: number }

/** x: 左 -1 〜 右 1、y: 下 -1 〜 上 1（R3F の pointer と同じ） */
export function lookTarget(x: number, y: number): Look {
  return {
    yaw: clampUnit(x) * LOOK_YAW_MAX_DEG * RAD,
    pitch: clampUnit(y) * LOOK_PITCH_MAX_DEG * RAD,
  }
}

/** 目標へ指数関数的に寄せる（行き過ぎない。dt が長くても 0.1 秒ぶんだけ） */
export function easeLook(current: Look, target: Look, dtS: number): Look {
  const dt = Math.min(MAX_DT_S, Math.max(0, dtS))
  const k = 1 - Math.exp(-dt / LOOK_TIME_CONSTANT_S)
  return {
    yaw: current.yaw + (target.yaw - current.yaw) * k,
    pitch: current.pitch + (target.pitch - current.pitch) * k,
  }
}

function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(-1, v))
}
