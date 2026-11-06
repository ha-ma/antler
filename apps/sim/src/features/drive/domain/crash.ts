// 衝突の演出（drive-crash-spot R3）。鹿に当たってから A-6 に移るまでの時間と、カメラの揺れ。
// 揺れは乱数を使わず、時刻の正弦の和で決める（同じ時刻なら同じ揺れ）。world.t は衝突で止まるので、実時間で測る。

/** 当たってから onFinish（A-6 へ移る）までの時間（ms） */
export const CRASH_MS = 3500
/** カメラが揺れる時間（s） */
export const CRASH_SHAKE_S = 0.8
/** 揺れの最大（rad） */
const SHAKE_RAD = 0.045

export type CameraShake = { yaw: number; pitch: number; roll: number }

const STILL: CameraShake = { yaw: 0, pitch: 0, roll: 0 }

/**
 * 衝突から elapsedS 秒のカメラの揺れ（UC-3e）。強く始まって (1 − t)² で弱まり、CRASH_SHAKE_S で 0。
 * reduced（prefers-reduced-motion: reduce）では揺らさない
 */
export function crashShake(elapsedS: number, reduced: boolean): CameraShake {
  if (reduced || elapsedS < 0 || elapsedS >= CRASH_SHAKE_S) return STILL
  const k = 1 - elapsedS / CRASH_SHAKE_S
  const a = SHAKE_RAD * k * k
  const t = elapsedS * Math.PI * 2
  return {
    yaw: a * Math.sin(t * 17 + 0.4),
    pitch: a * Math.sin(t * 23 + 1.3) * 0.8,
    roll: a * Math.sin(t * 13 + 2.1) * 0.6,
  }
}
