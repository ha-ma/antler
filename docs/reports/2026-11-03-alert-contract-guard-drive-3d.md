# alert-contract-guard: drive-3d（2026-11-03）

対象: `apps/sim/src/features/drive/`。結果: **Critical 0 / Warning 4 / Info 6**（静的に読んだ結果。エージェントは Bash なし）。
全文はエージェントの返答をメインセッションが要約して書いた。対応は各項目の「対応」に書く。

## Critical

なし。確かめた観点: 同じ `AlertState` を使っている（複製・上書きなし）、props と単位（safe/zone は km、danger は m）、色は CSS 変数だけで `alert-danger` は検知の文脈だけ・palette に `#D83B1E` / `#E2492C` なし、型は `@antler/schema` から、乱数はシード付き、最初のフレームから inside / outside（roadmap の持ち越し）、1.5 秒の解除と赤の間の出し直し、アラート OFF で AlertState・ビネット・バナー・検知を出さない、点滅は alert-ui の 1 Hz だけ。

## Warning

- **W-1 解除後の古いフラグで、ゾーンを出ても琥珀が最大 5 秒残る。** release の `deer:false` に `zone:'inside'` を入れていたため、`deriveAlertState` が GPS の outside より flag の inside を取った。B の edge は GPS を持たず `zone` を常に `outside` で送る（`edge/detector/src/detector/flag.py`）ので、A と B で同じフラグの意味が違った。
  - 対応（直した）: `domain/sim-flag.ts` の `buildSimFlag` が B と同じく `zone:'outside'` の `AlertFlag` を作る。ゾーンの内外は GPS 側（`zoneStatusAt`）だけが決める。テスト UC-6j。
  - あわせて見つけたこと: `measureAlongRoute` に前回の `positionKm` を手がかりに渡すと、近くの線分の端（最短 + 30 m 以内）から手がかりに近いものを選ぶため、まっすぐな道でも位置が最大 30 m 遅れる（UC-6j が出口で琥珀のまま落ちた原因）。A は車の道のり s を知っているので、手がかりに `s / 1000` を渡すようにした。**zones 側の `projectOnRoute` の手がかりの扱いは、B（pwa-drive）にも効くかもしれないので zones の担当に伝える**（下の「持ち越し」）。
- **W-2 HUD の 3 状態印が輪郭だけで、チェックと鹿ピクトが無い。**
  - 対応（判断）: HUD 左上は二次表示（R11）。正式の 3 状態表示は車内スマホの AlertState が持つ。alert-ui に小さな印を足すのは凍結 API の変更になるので、`StateMark.tsx` にその旨を書いた。
- **W-3 `makeFlag` が `strict: true` を検証なしで付けていた。**
  - 対応（直した）: `{type:'flag', v:1, t_frame, t_sent, ...}` の `AlertFlag` を作り、B と同じ `readAlertFlag` に通して `strict` を決める。テスト UC-6i（`AlertFlagSchema.safeParse` が通る）。
- **W-4 赤のバナーに「ブレーキ」と副文 3 言語が無い。**
  - 対応（推奨で決定）: バナーに `ALERT_TEXT[lang].danger.action`（ブレーキ）を足した。副文 3 言語は、A の compact に文字が無い件（I-1）とあわせて i18n の feature で決める。

## Info

- I-1 `AlertState` の compact は文字を出さない（AlertState.md は「文字は 9px」）。alert-ui（凍結）の話。A と B の合意が要る。
- I-2 チャイムの再武装（`ZONE_REARM_MS`）は壁時計で数える。UC-4f がルートから 30 秒を超えることを確かめている。
- I-3 palette の `arrowRed: '#B8323A'`（矢羽根の実物の色）は alert-danger とは別。夜の道で赤のビネットと紛れないかはブラウザで確かめた（紛れない）。
- I-4 `muted` の導出（音トグル・一時停止・終了）のテストが無かった → 足した（DrivePage.test の UC-7b）。
- I-5 解除の直後に出口を越える場合のテストが無かった → 足した（UC-6j）。
- I-6 `Weather` / `Surface` は drive 内の語彙。capture の feature で `packages/schema` の Capture の語彙に寄せるか確認する。

## 持ち越し

- zones: `measureAlongRoute(plan, position, hintKm)` の手がかりが、往復の取り違えを防ぐ用途を超えて、まっすぐな道で位置を最大 30 m 遅らせる（`packages/zones/src/route.ts` の `HINT_TOLERANCE_M`）。手がかりに近い候補ではなく、最短に近い候補の中で手がかりに近いものを選ぶ（線分の端点を候補から外す）などの直しを zones の担当で検討する。
