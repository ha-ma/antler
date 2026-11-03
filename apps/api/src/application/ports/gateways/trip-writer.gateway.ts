import type { TripWriting, TripWritingBrief } from '../../../domain/trips/models/trip-writing.js'

// Claude にタイトルと各日の 1 行説明（4 言語）を書かせる外部 transport（docs/specs/plan-trip/functional.md R5）。
// 通信の失敗・時間切れ・認証の失敗は TripWriterError を投げる（作り直さない）。
// 応答はあったが使えない（上限で切れた・断られた・JSON の形が違う）は rejected で返す（usecase が 1 回だけ作り直す）。

export type TripWriterOutcome =
  | { kind: 'draft'; writing: TripWriting }
  | { kind: 'rejected'; reason: 'truncated' | 'refused' | 'malformed' }

export type TripWriterRequest = {
  brief: TripWritingBrief
  /** 前の回が検証で外れた理由のコード（作り直しのときだけ）。本文は渡さない */
  previousProblems?: readonly string[]
}

export interface TripWriterGateway {
  write(request: TripWriterRequest): Promise<TripWriterOutcome>
}
