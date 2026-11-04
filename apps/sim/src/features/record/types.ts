import type { RecordTrip, TripRecord } from '@antler/trip'

// record（A-7 旅の記録）の型。仕様: docs/specs/record/functional.md
//
// State 設計:
// - サーバーの状態（TanStack Query）: 記録の読み出し（useTripRecord）、走行の保存・削除・画像の保存（mutation）
// - 画面だけの状態（useState）: コピーの結果（RecordHeader）、削除の確認の開閉（DeleteSection）
// - Zustand は使わない（ページをまたいで持つ状態が無い）
// - 所有者トークンは plan-trip が localStorage に持つ（barrel の ownerTokenOf / forgetOwnerToken）

/** `GET /api/trips/:id/record` の応答 */
export type RecordData = { trip: RecordTrip; record: TripRecord }

/** api の失敗。status は HTTP のステータス（通信の失敗・形の違いは null）、code は api のエラーコード */
export class RecordApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(`record api failed: ${String(status)} ${String(code)}`)
    this.name = 'RecordApiError'
  }
}

/** useSaveRun の結果（R11）。not-owner は送っていない（呼び出し側は /t/:id へ移らない） */
export type SaveRunOutcome =
  { status: 'saved' | 'replayed'; tripId: string } | { status: 'not-owner'; tripId: string }
