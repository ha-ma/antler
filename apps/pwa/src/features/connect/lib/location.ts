// 位置の許可の状態と、出発のときの許可の要求（R9）。座標は読まない・保存しない・ログに出さない。
// 座標を使うのは pwa-drive の watchPosition。ここでは許可のダイアログを出すためだけに 1 回呼ぶ。

export type LocationState = 'granted' | 'prompt' | 'denied' | 'unknown' | 'insecure'

export type PermissionStatusLike = {
  state: string
  onchange: (() => void) | null
}

export type LocationDeps = {
  isSecureContext: boolean
  geolocation: { getCurrentPosition(ok: () => void, fail: () => void): void } | undefined
  permissions:
    { query(descriptor: { name: 'geolocation' }): Promise<PermissionStatusLike> } | undefined
}

export function browserLocationDeps(): LocationDeps {
  return {
    isSecureContext: globalThis.isSecureContext,
    geolocation: globalThis.navigator?.geolocation,
    permissions: globalThis.navigator?.permissions as LocationDeps['permissions'],
  }
}

function fromPermissionState(state: string): LocationState {
  if (state === 'granted' || state === 'prompt' || state === 'denied') return state
  return 'unknown'
}

/** 取れる最も正確な状態。変化があれば onChange を呼ぶ。戻り値は購読の解除。 */
export function watchLocationState(
  deps: LocationDeps,
  onChange: (state: LocationState) => void,
): () => void {
  if (!deps.isSecureContext || !deps.geolocation) {
    onChange('insecure')
    return () => undefined
  }
  const permissions = deps.permissions
  if (!permissions) {
    onChange('unknown')
    return () => undefined
  }
  let cancelled = false
  let status: PermissionStatusLike | null = null
  permissions.query({ name: 'geolocation' }).then(
    (result) => {
      if (cancelled) return
      status = result
      onChange(fromPermissionState(result.state))
      result.onchange = () => {
        if (!cancelled) onChange(fromPermissionState(result.state))
      }
    },
    () => {
      if (!cancelled) onChange('unknown')
    },
  )
  return () => {
    cancelled = true
    if (status) status.onchange = null
  }
}

/** 出発のとき。許可がまだ（prompt か判定できない）ときだけ、許可のダイアログを出す。 */
export function requestLocationOnce(deps: LocationDeps, state: LocationState): boolean {
  if ((state !== 'prompt' && state !== 'unknown') || !deps.geolocation) return false
  try {
    deps.geolocation.getCurrentPosition(
      () => undefined,
      () => undefined,
    )
    return true
  } catch {
    return false
  }
}
