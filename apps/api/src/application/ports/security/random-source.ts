// 暗号論的乱数（旅の id・seed）。テストでは決まった値を返すものに差し替える。

export interface RandomSource {
  bytes(n: number): Uint8Array
}
