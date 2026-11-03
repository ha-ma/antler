import { useEffect, useState } from 'react'
import { watchLocationState, type LocationDeps, type LocationState } from '../lib/location'

/** 位置の許可の状態。変化（設定で変えた）も追う。座標は読まない。 */
export function useLocationState(deps: LocationDeps): LocationState | null {
  const [state, setState] = useState<LocationState | null>(null)
  // eslint-disable-next-line no-restricted-syntax -- 許可の変化の購読
  useEffect(() => watchLocationState(deps, setState), [deps])
  return state
}
