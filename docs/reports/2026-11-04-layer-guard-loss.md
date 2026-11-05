# layer-guard: loss（api、d3576c6）2026-11-04

結果: Critical 0 / Warning 3 / Info 3（エージェントは読み取り専用のため、メインセッションが要約を保存）。

## Critical

なし（domain/losses は相対 import だけ、UseCase に HTTP の知識なし、Route は検証と呼び出しと 201/200 の切り替えだけ、例外 → HTTP は error-mapper に集約、Service レイヤなし）。

## Warning（次に回す）

- W-1 `application/usecases/losses/loss-context.ts`: JST の暦日の判定・`addDays`・しおりの作り直しの比較が usecase 側にある。純粋な部分（`jstDateOf`・`addDays`）は `domain/losses/policies/` へ移せる。plan-trip の `usecases/trips/writing-brief.ts` と同じ置き方なので、今回は揃えたままにした
- W-2 `write-loss.usecase.ts` の `execute` が検証まで持っている。`assessCollision(plan, collision)` のような policy にまとめられる
- W-3 `WriteLossUseCase` が `TripRepository.countWriterCall` に依存している（1 日の上限を plan-trip と共有するため）。`WriterCallCounter` の専用ポートに分けると結合が減る。分けるときは plan-trip の usecase も一緒に変える

## Info

- I-1 ダミーの story と createdAtMs: 0 を持つ draft → `LossKey` 型に分けた（直した）
- I-2 `loss.routes.ts` の 413 の JSON を route で組み立てている（plan-trip の route と同じ形。二重管理）
- I-3 `thinking: { type: 'between_tools' }` の意味は plan-trip の gateway と同じ設定（SDK の型は通る）
