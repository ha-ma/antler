# alert-contract-guard: drive-link（2026-11-04）

対象: `apps/sim/src/features/drive/`（drive-link の差分）。結果: **Critical 0 / Warning 3 / Info 3**（静的に読んだ結果。エージェントは Bash なし）。
エージェントの返答をメインセッションが要約して書いた。対応は各項目の「対応」に書く。

## Critical

なし。確かめた観点: 3 状態は `@antler/alert-ui` の `AlertState` だけ（props は AlertState.md どおり）、最初のフレームから `zoneStatusFromS` の inside / outside を `deriveAlertState` に渡す、`resolveAlertEnabled` は URL の `alert` だけで決め TripPlan を書き換えない（plan-trip R10）、アラート OFF では検知・フラグ・スマホ・ビネットを出さない（A5-4）、フラグは `buildSimFlag` → `readAlertFlag`（zone は B と同じ outside）、乱数は `deriveSeed(plan.seed, "drive:" + 日)` からで `Math.random` 等なし、`alert-danger` の直書きなし、API の応答は 3 つの schema で確かめてから使う、`windowFog` の語彙と係数は `@antler/trip` と R6 のとおり。

## Warning

- **W-1 直線で埋めたつなぎ目に区間が立ちうる。** 前の移動の終点と次の移動の始点が離れているときの補間は、どの移動の範囲にも入らず `straightRangesM` に載らなかった。A-2 に出ないゾーンが運転にだけ出る。
  - 対応（直した）: 補間の道のりも `straightRangesM` に足す（`trip-scenario.ts`）。テスト UC-4f。
- **W-2 `zoneStatusFromS` は区間が道のり順で重ならない前提。**
  - 対応（判断）: `planRoute` はルートを前から 1 回なめて、続く inside を 1 つの区間にまとめるので、順に並び重ならない。`withoutRanges` で割っても順は保つ。前提を `zone-status.ts` のコメントに書いた。UC-4a が `measureAlongRoute` と同じ答えを確かめている。
- **W-3 `withoutRanges` の境界で長さ 0 の区間ができうる。**
  - 対応（直した）: 範囲の端に接するだけの区間は割らない（`<=` / `>=`）。割った残りは長さが正のものだけ。テスト UC-4f。

## Info

- I-1 `advanceClockAtLegStart` が同じ移動の始まりで 2 回足さないこと、進めた後の `t_frame` の単調増加のテストが無い。始まりの道のりを「前のステップ < s ≤ 今のステップ」で越えたときだけ足すので 2 回は足さない（後退で戻って再び越えた場合は、既に `departAt` を過ぎているので足さない）。
- I-2 `DriveResult.endedAt` は進めた時計（JST の ISO 8601）。loss / record はこれを JST として読んでよい。
- I-3 音（チャイム・ビープ・読み上げ）・副文・点滅・コントラストは差分の外（alert-ui）で未確認。
