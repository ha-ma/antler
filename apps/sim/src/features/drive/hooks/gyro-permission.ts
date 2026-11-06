// 端末の向きのセンサーの許可（docs/specs/mobile-landscape/functional.md R4）。
// iOS 13 以降は DeviceOrientationEvent.requestPermission を、ユーザーの操作（「出発」の click）の中で
// 同期的に呼ばないと許可を聞けない。呼び出し側は結果を待たずに走り出す。
// granted か、関数が無い（Android・古い iOS）ときだけ true。denied・例外・reject・センサーが無いときは false。

type PermissionState = 'granted' | 'denied' | 'default'

type OrientationEventStatic = {
  requestPermission?: () => Promise<PermissionState>
}

export function requestGyroPermission(
  target: { DeviceOrientationEvent?: unknown } = window,
): Promise<boolean> {
  const ctor = target.DeviceOrientationEvent as OrientationEventStatic | undefined
  if (!ctor) return Promise.resolve(false)
  if (typeof ctor.requestPermission !== 'function') return Promise.resolve(true)
  try {
    return ctor.requestPermission().then(
      (state) => state === 'granted',
      () => false,
    )
  } catch {
    return Promise.resolve(false)
  }
}
