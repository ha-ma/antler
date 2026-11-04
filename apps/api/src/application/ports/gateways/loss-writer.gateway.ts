import type { LossBrief, LossStory } from '../../../domain/losses/models/loss.js'

// Claude に「失ったもの」の文（4 言語）を書かせる外部 transport（docs/specs/loss/functional.md R5）。
// 通信の失敗・時間切れ・認証の失敗は LossWriterError を投げる（作り直さない）。
// 応答はあったが使えない（上限で切れた・断られた・JSON の形が違う）は rejected で返す（usecase が 1 回だけ作り直す）。

export type LossWriterOutcome =
  | { kind: 'draft'; output: LossStory }
  | { kind: 'rejected'; reason: 'truncated' | 'refused' | 'malformed' }

export type LossWriterRequest = {
  brief: LossBrief
  /** 前の回が検証で外れた理由のコード（作り直しのときだけ）。本文は渡さない */
  previousProblems?: readonly string[]
}

export interface LossWriterGateway {
  write(request: LossWriterRequest): Promise<LossWriterOutcome>
}
