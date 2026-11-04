import type {
  StopWriting,
  StopWritingBrief,
} from '../../../domain/stop-events/models/stop-writing.js'

// Claude に出来事の文（4 言語）を書かせる外部 transport（docs/specs/stop-events/functional.md R7）。
// 通信の失敗・時間切れ・認証の失敗は SceneWriterError を投げる（作り直さない）。
// 応答はあったが使えない（上限で切れた・断られた・JSON の形が違う）は rejected で返す（usecase が 1 回だけ作り直す）。

export type SceneWriterOutcome =
  | { kind: 'draft'; writing: StopWriting }
  | { kind: 'rejected'; reason: 'truncated' | 'refused' | 'malformed' }

export type SceneWriterRequest = {
  brief: StopWritingBrief
  /** 前の回が検証で外れた理由のコード（作り直しのときだけ）。本文は渡さない */
  previousProblems?: readonly string[]
}

export interface SceneWriterGateway {
  write(request: SceneWriterRequest): Promise<SceneWriterOutcome>
}
