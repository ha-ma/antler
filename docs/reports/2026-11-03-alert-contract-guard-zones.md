# レビュー結果: alert-contract-guard × packages/zones（feat/zones）

alert-contract-guard（読み取り専用）の結果を、メインセッションが書き写したもの。Critical 1 / Warning 3 / Info 2。テストは実行していない（エージェント側）。

## Critical

### C-1. 最初の測位が unknown だと緑が出る — `judge.ts` の `toGpsZone`、`alert-ui/src/state/derive-alert-state.ts:78`

- ゾーンの中で起動し、最初の測位が古い・無い・北海道の外、または誤差 100 m 超で円がゾーンに重ならないとき。`toGpsZone` は `unknown` を返し、`previous` が null なので `deriveAlertState` は `safe`（距離「--」）を出す。
- ch5 と R9「緑はゾーン外であって安全ではない」に反する。
- 直し方の候補: (a) 測位が一度も取れていない間は safe を出さず zone 側（琥珀）に倒す、(b) 「測位中」のような中立表示を足す。
- **alert-ui（PR #7）の振る舞いの変更なので、ユーザー判断待ち。** 推奨は (a)。凍結 API の型を変えずに済み、安全側に倒れる。

## Warning

- **W-1（対応済み）** `hash` が形式しか検証していない → `verifyZoneHash`（WebCrypto で features から sha256 を計算し直して照合）を `data.ts` に足して公開。UC-1e。
- **W-2（対応済み）** unknown を挟むと出口側の猶予が 150 m に戻る → `lastInsideZoneId` で判定。UC-2i（code-reviewer C1 と同じ根）。
- **W-3（次に回す）** 誤差 100 m 超で円が重なって inside のとき、`remainingKm` は誤差を含む位置から出すので距離表示がずれる。安全側の意図どおり。表示の扱いは pwa の feature で決める。

## Info（確認できた点）

- `toGpsZone` の出力は alert-ui の `GpsZone` と一致。`exactOptionalPropertyTypes` を意識した分岐も正しい。
- `LightPeriod` は `Capture.conditions.light` と同じ 4 語。
- ETA は `toJst` を通る。タイムゾーンの無い文字列は `toInstant` が拒否する。
- `toRoadSegment` は zone id か `unknown` だけを返し、座標を含まない。zone id は `roadSegment` の正規表現を通る（UC-7b で確認済み）。
- 生成物の大きさは 500 KB 未満（UC-1d / AC-2 で確認）。
