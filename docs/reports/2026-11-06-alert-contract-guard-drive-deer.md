# alert-contract-guard: drive-deer（2026-11-06）

対象: ブランチ `claude/drive-deer-4dd39d`（main との差）。エージェントは読み取り専用のため、メインセッションが要旨を保存した。

**Critical 0 / Warning 1 / Info 3**

## 確かめたこと（問題なし）

- `packages/schema`・`packages/alert-ui`・`packages/trip`・`apps/api`・`apps/pwa`・`edge` に変更なし
- `Encounter.pattern` は 5 語のまま（`types.ts` の `DeerPattern`）。12 種の動きは `MOTION_PATTERN`（`deer-spawn.ts`）で 5 語に畳む。`Encounter` に `motion` は無く、`record/utils/drive-run.ts` も `motion` を送らない。`apps/api` の `DEER_PATTERNS` も 5 語のまま
- 検知は AlertFlag の形のまま（`sim-flag.ts`）。変わったのは画角（左右 50°）と距離の帯ごとの引き直しだけ。side は `lateral < 0 ? 'L' : 'R'`。フラグは `readAlertFlag` → `deriveAlertState`。車内スマホは `@antler/alert-ui` の `AlertState` をそのまま使う
- 1.5 秒の解除（`RELEASE_MS = 1500`）は不変。解除で `captured`・`bands` は引き継ぐ

## Warning

- **W-1** 画角が A（左右 50°）と B（`edge/detector/src/detector/config.py` の `hfov_deg = 70`、左右 35°、暫定値）でずれる。至近の右の鹿は A では検知、B では外れる。→ 調査走行で `hfov_deg` を実測して A を合わせる。それまで `detection.ts` のコメントに B の暫定値を書く

## Info

- **I-1** 赤の間に検知した鹿の記録（`simulation.ts`）が、目の反射の鹿を除いていない（目の反射の鹿は林の中で遮蔽されるので実際には検知されないが、念のため）
- **I-2** 契約を守るテストの候補: `MOTION_PATTERN` が 12 種すべてを 5 語に写す・`toDriveRun` の出力に `motion` が無い・右の至近（35° 超 50° 以内）で side R
- **I-3** 未確認: `PhoneScreen` の props と `AlertState.md` の 1 行ずつの照合、`DeerModel`・`DangerOverlay` の色（今回の範囲外）

## 取り込み（メインセッション）

| 指摘 | 取り込み                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1  | `detection.ts` のコメントと仕様 R6・変更記録に B の暫定値（70°）と実測後に合わせることを書いた（仕様の Deferred のまま）                                                                             |
| I-1  | 赤の間の記録でも目の反射の鹿を飛ばすようにした                                                                                                                                                       |
| I-2  | 12 種 → 5 語は `deer-spawn.test.ts` の UC-5c、右の至近（d = +9・15 m、35.6°）で side R は `drive-deer.test.ts` の UC-6a が持つ。`toDriveRun` は変えていない（`motion` を読まない）ので今回は足さない |
| I-3  | 範囲外のまま                                                                                                                                                                                         |
