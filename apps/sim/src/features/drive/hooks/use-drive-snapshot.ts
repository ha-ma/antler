import { useSyncExternalStore } from 'react'
import type { DriveEngine, DriveSnapshot } from '../domain/engine'

/** HUD が読む値（エンジンが 0.1 秒ごとと状態の変化のときに配る） */
export function useDriveSnapshot(engine: DriveEngine): DriveSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}
