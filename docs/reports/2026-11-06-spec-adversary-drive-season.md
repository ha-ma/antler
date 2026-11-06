# spec-adversary: drive-season（2026-11-06）

対象: `docs/specs/drive-season/functional.md`（ドラフト）。エージェントは書き込みできないので、メインセッションが要約して残す。取り込み先は各行の「→」。

## Critical

- C1 季節の切り替えのリンクを押しても場面が変わらない恐れ: `DrivePage.tsx` はエンジンを `useState` で 1 回だけ作り、見本の `DrivePage` に key が無い。React Router の `Link` だと作り直されない
  → 切り替えはページを読み直すふつうの `<a href>` にした（`StartOverlay.tsx` の `SeasonSwitch`）。仕様 R2 に明記し、UC-2c に「SPA のリンクではない」を足す。ブラウザでも押して確かめる

## Major

- M1 `rain` が `packages/trip/src/day/schema.ts` の zod の enum と `apps/api/src/domain/chats/models/chat-deck.ts` に要る（足さないと雨の DayPlan が検証で落ちる）
  → 両方足した。`target_paths` に入れる。UC-1f「雨の日の DayPlan が DayPlanSchema を通る」を足す
- M2 版を上げたときの波及: 会話・立ち寄りの保存済みの束のキーは routes・zones だけで条件の版を見ない（v1 で書いた文が雨の場面で流れうる）。4〜11 月の保存済みの旅は A-2 の条件が変わり、v1 は再現できない。`z.literal(CONDITIONS_VERSION)` なので api と sim の版がずれると応答が検証で落ちる
  → 推奨で決定: v1 は再現しない（受け入れる）。束のキーは変えない（会話の api は別のセッションの領域で、永続化の形に触れる。冬の旅は天候・路面が v1 と同じなので影響は 4〜11 月の旅だけ）。api と sim は同じ PR で入れる。仕様の「版の波及」に書く
- M3 `/drive` と `?month=2` が違う（圧雪・曇り と 晴れ・凍結）。`weather=hail`（既定）と `weather=rain`（2 月の表で雨は無いので無視）でも違う。5 つの切り替えの路面が決まっていない
  → 5 つの切り替えの URL・文言・天候・路面を Test List に 1 行ずつ固定（UC-2d）。`?month=2` が晴れ・凍結になることも書く。「その月に無い天候」は指定なしと同じ（月の抽選）に揃えるのは R1 のまま
- M4 「2 月は v1 と同じ」を 1 シードでしか見ていない
  → v1 の実装で 200 シード × 12・1・2・3 月 × 1〜5 日の条件の要約を作り、v2 と照らすテストを足す（UC-1a）。「表に重み 0 の項目を置かない」を R1 に書く

## minor

- m1 旅の URL に `month` / `weather` を付けても無視する → UC-2c に足す
- m2 4・11 月の凍結の μ はスタッドレス前提か → R4 に「μ はスタッドレス前提（4・11 月も同じ）」
- m3 平年値で割合を直したときの版 → Deferred の暫定挙動に「直したら版 3、冬は変えない」
- m4 性能: スマホ 30 fps、粒の数の上限、ミラーに粒を描かない、葉の三角形数 → R6 に書き、3D の担当に伝える
- m5 景色の月（startAt）と条件の月（DayPlan.date）が同じという仮定、見本の departMonth → R3 に「旅の場面では最初の移動の出発の日 ＝ その日の date（drive-link）」、見本は departMonth = N を書く
- m6 文言と見た目をテストで固定できるか → 切り替えの文言を全文で Test List に（UC-2d）。光沢は材質のパラメータ（shininess）のしきい値で（UC-3c）

## 問題なしとされたもの

JST の月の境界、天候を指定したときの乱数の進み方（運転者が変わらない）、§3.2 の各セルと景色の季節の組み合わせ。
