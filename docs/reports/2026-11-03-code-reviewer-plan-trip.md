# code-reviewer: plan-trip（feat/plan-trip、5aa3820..HEAD）

レビュー日: 2026-11-03
範囲: packages/trip（itinerary / risk / input / plan）、apps/api の POST /api/trips（usecase / policy / repository / gateway / route）、apps/sim の features/plan-trip
方法: コードと仕様（functional.md / resilience.md）を読んだ。**テストは実行していない**（このエージェントに実行手段が無い）。「実行で確かめた」ではなく「読んで分かる」ものだけを書いた。確認が要るものは「要確認」と書く。

結論: Critical 1 件、Warning 8 件、Info 11 件。全体の設計は良い（下の「良い点」）。
**ユーザー判断が要る 1 件**: Warning 1（移動だけで入りきらない旅を黙って返す）。影響は Critical の月の文より大きいが、直し方に仕様の判断（入力エラーか `feasible` を返すか）が要るので Warning に置いた。

## 良い点

- 依存方向が仕様どおり（`apps/api/src/domain/trips` に `@antler/*`・zod・hono・drizzle の import が無いことを grep で確認。`@antler/trip` を使うのは application の usecase だけ）。しおり・リスクは `@antler/trip` の純粋関数で、端末と api が同じものを呼ぶ。usecase は Claude・DB・乱数・時計・ハッシュをすべて port 経由で受けていて、テストが決定的に書けている（`FixedClock` / `ScriptedWriter` / `ScriptedRandom`）。
- 冪等の状態遷移が小さな純粋関数 `decideOnExistingRequest` に分かれ、`reclaimRequest` は `status` と `updatedAt` を条件にした CAS で、同時の再取得を 1 つに絞れている。再取得で `createdAt` も更新するので 24 時間の TTL が再取得のたびに延びる（drizzle-trip.repository.ts:65-72）。
- ownerToken を `HMAC(secret, 冪等キー)` にして、再送でも同じトークンを返しつつ、保存はハッシュだけ（usecase.test の UC-7c が「保存物にトークンもキーも含まれない」まで見ている）。
- Claude の時間切れは `AbortSignal.timeout` で全体を 30 秒に区切り、SDK の再試行は同じ signal の内側。最悪でも 2 回 × 30 秒 < `PENDING_STALE_MS`（2 分）なので、生きている要求を古い pending と誤認して再取得しない。
- 入力検証が `TripInputSchema` 1 つで、フォーム（resolver）・プレビュー・api が共有している。strictObject で mass assignment を塞いでいる。
- `PlanPage.test.tsx` は DOM と fetch の呼び出し（冪等キー・本文・sessionStorage の後片付け）を見ていて、振る舞いのテストになっている。
- store.ts の「State設計」コメントと、描画中の setState（useTripPreview）で useEffect を使わない判断は、apps/sim/CLAUDE.md に沿っている。

## Critical（修正必須）

- [packages/trip/src/risk.ts:163-172] **11 月の旅で month が根拠文の上位 3 つに入ると、最多でない月に「1 年でいちばん多い時期」と 4 言語で出る（事実と違う）。** `monthText` は係数 `>= 0.75` で最多の文を出すが、`risk-factors.json` の月別係数は 10 月 = 1、11 月 = 0.788。表示は `reasons` の上位 3 つに入ったときだけ（risk.ts:98-102）。11 月の month の寄与は 0.1 × 0.788 ≈ 0.08 で、area / sunset / experience（各 最大 0.2）に負けて 4 位以下になることも多いので、出る頻度は限られる。それでも出たときの文が誤り。0.75 もマジックナンバー。→ 「最多」は係数の閾値で決めず、`MONTH_FACTORS` の最大の月かどうかで決める。
  ```ts
  const PEAK_FACTOR = Math.max(...MONTH_FACTORS)
  // monthText(month, factor)
  if (factor === PEAK_FACTOR) {
    /* いちばん多い */
  } else if (factor >= HIGH_SEASON_FACTOR /* 名前をつけた定数 */) {
    /* 多い時期 */
  }
  ```
  テスト: 11 月の旅（10 月を含まない）で、month が上位に入る入力（area を道央・経験を慣れている・夜の楽しみなし、など他の寄与を下げたもの）を作り、「いちばん多い」が出ないこと。10 月で出ること。いまの `risk.test.ts` は根拠文の月の文を見ていない。

## Warning（推奨）

- [packages/trip/src/itinerary.ts:51-58, 141-151] **（要ユーザー判断）物理的に無理な旅を黙って返す。** `simulate` の `feasible` が false のまま `chosen` が空になると、ループが終わって `schedule`（`feasible: false`）をそのまま使う。読んで分かる例: 新千歳で 10:00 出発・同じ場所に 11:30 返却（`t = 11:00` > `deadline = 10:30`、距離計算は要らない）。出発地と返却地が離れていて移動時間が日程より長い旅（例: 函館空港発・釧路空港着の同日）も同じ経路になる。影響は、返却時刻を過ぎる leg を含む days が TripPlan として保存され、その leg で暗い時間を数えたスコアが付くこと。leg の `day` が `dayCount` を超えても `toDays` は黙って切り捨てる。楽しみがあれば全部 `skipped` に入る。R3 の「黙って落とさない」の精神に反する。→ どちらかに決める: (a) `TripInputSchema` で「移動だけで入りきらない旅」を入力エラーにする（端末と api で同じ検証）、(b) `Itinerary` に `feasible: boolean` を返して画面と api が扱う。仕様に書かれていないので、Example Mapping の Questions に 1 行足してから決めるのが安全。推奨は (a)。テスト: 上の例。
- [packages/trip/src/risk.ts:119-137] **暗い時間の割合が「時間」でなく「サンプル数」の割合。** R4 は「15 分ごとに見て、+6° 未満の時間 ÷ 全移動時間」。実装は leg ごとに `steps = max(1, round(hours*60/15))` 個のサンプルを `total += 1` と数えるので、短い leg（10 分 → 1 サンプル = 15 分ぶんの重み）と長い leg で 1 サンプルの重みが違う。→ 重みを `leg.hours / steps` にして時間で割る。
  ```ts
  const w = leg.hours / steps
  total += w
  if (sunAltitude(at, { lat, lon }) < DARK_ALTITUDE_DEG) dark += w
  ```
  端末と api は同じ関数なので不一致にはならないが、スコアが仕様の式からずれる。
- [packages/trip/src/itinerary.ts:154-176] **`toDays` の末尾 `void firstDay` は return の後ろで実行されない。** 引数 `firstDay` は使われていない（コメントも「sim が求める」と言うだけ）。到達不能コードで、lint を通っているのが不思議（要確認: `no-unreachable` の設定）。→ 引数とその呼び出し側の受け渡しを消す。
- [packages/trip/src/input.ts:50-58] **不正な日時で `toJst` が例外を投げうる（要確認）。** `superRefine` の中で `tripDayCount` → `jstDayIndex` → `toJst` を呼ぶが、`toJst` は `IsoDateTime` に合わないと `RangeError` を投げる（schema/common.ts:28-31）。zod が子の形式エラーのあとに親の superRefine を走らせるかは版による。sim には `user.clear()` で `''` を通すテスト（PlanPage.test.tsx:238）があり、実行していないので結果は分からない。通るなら superRefine は子の失敗後に走っていない（ほぼ問題なし）、落ちる・render で例外なら 500 の経路がある。どちらでも、api 側で「`at` にオフセットが無い・日付だけ」が 400 になる保証のテストが無い（packages/trip・apps/api のどちらにも malformed `at` のテストが無いことを grep で確認した）。500 になれば resilience.md の「入力の形・範囲が違う → 400」に反する。→ superRefine の先頭で `IsoDateTime.safeParse` が両方通ったときだけ日数を数える。テスト: `at: '2027-02-14T10:00'` と `at: '2027-02-14'` を route に送って 400。
- [apps/sim/src/features/plan-trip/hooks/useSubmitTrip.ts:39-48] **「もう一度」が、フォームが不正なあいだ古い入力を送る。** 最初の分岐 `attempt && 同じ入力` は `preview.valid` を見ない。失敗のあと運転できる人を 5 に直す（不正）と `preview.input` は最後に通った値に戻る（useTripPreview の仕様）ので、attempt.input と一致して、画面にエラーが出たまま古い入力が同じキーで送られる。→ 先頭に `if (!preview.valid) return` を足す（`submit` と同じ）。`PlanPage.test.tsx` の R8 のテストは「直して有効にした」場合だけ。「直して不正にした」場合のテストを足す。
- [apps/sim/src/features/plan-trip/hooks/useCreateTrip.ts:72-76] `startAttempt` の `sessionStorage.setItem` が try の外。容量超過・Safari のプライベートモードで投げると、ボタンを押しても何も起きずに例外になる（`storage()` は取得だけを守っている）。→ `setItem` も try/catch で包み、残せなくても送信は続ける（同じタブの mutation 変数で再送できる、とコメントにある方針どおり）。
- [packages/trip/src/*.ts と apps/api/…/trip-rules.ts] **時間定数の重複。** `HOUR_MS` / `DAY_MS` / `JST_MS` が itinerary.ts・risk.ts・input.ts（`DAY_MS`）・trip-rules.ts（`DAY_MS`、`JST_OFFSET_MS`）・daily-limit-policy・schema の `toJst` にある。日付境目の JST の計算が 3 か所（`jstDayIndex` / `dayOf` / risk の `days`）に分かれていて、直すときに片方だけ直しやすい。→ `packages/trip/src/time.ts` に `jstDayIndex` / `atJstHour` / 定数をまとめる。domain は外部に依存しないので api 側の定数は api に残してよい。
- [テスト全般] **重点に挙げられた論点のテストが薄い。**
  - itinerary: 返却が JST の 0 時台（暦日の境目）、物理的に無理な旅（上の Warning）、同じ重さの tie-break（周回順で後ろ）、`day n の to == day n+1 の from` と `stay` の連続性、楽しみの順を入れ替えても同じ結果（UC-3f は同じ順の入力を `structuredClone` で比べているだけ）、1 日の旅で `stops` に楽しみが入ること（UC-3e は `stops` を見ていない）。
  - risk: `sunsetMs`（既知の日没時刻との比較。二分探索の区間 12:00〜22:00 JST の端）、日没の係数の 16:30 / 19:00 の端、`riskLevel` の 0.4 / 0.6 の境目、`darkShare`。いまは「ペルソナが high」「夏の道央が low」と大まかな向きだけで、式の部品を見ていない。
  - resilience.md の観測要件「10 件・10 日の計算時間を確かめるテスト」が見当たらない（`performance.now` を packages/trip で grep して 0 件）。

## Info（参考）

- [create-trip.usecase.ts:97-103] 1 日の上限は「完了した旅の数」だけを数える（`countTripsCreatedSince`）。resilience.md の「数件の超過は許す」どおり。呼んでいる最中の pending は数えないので、異なる IP から同時に来ると上限を超えた回数だけ Claude を呼びうる。費用の上限として厳密にしたいなら、当日の `trip_requests`（pending + done）を数える。
- [itinerary.ts:42-65] `buildItinerary` は検証済みの入力を前提にしていて、`dayCount <= 0` や未知の slug（`pleasureById` が undefined → `flatMap` で黙って落とす。orderByCircuit:70-73）を自分では守らない。api と sim の入口で `TripInputSchema` を通しているので現状は安全。
- [itinerary.ts:68-97] `circuit.indexOf(base)` が -1（拠点が周回順に無い）でも黙って先頭扱いになる。`masters.test.ts` で「全楽しみの `base` が `AREA_CIRCUIT` にある」を見ていれば足りる（読んだ範囲では未確認）。
- [itinerary.ts:141-145] 返却地へは「できるだけ遅く出る」ので、返却が夕方だと移動が日没にかかり、暗い時間の割合が上がりやすい。保守的な見積りとして理にかなうが、R3 に書かれていない設計判断。functional.md に 1 行足すとよい。
- [risk.ts:98-102] 根拠文の順と 0 の除外は、丸めた `contributions`（2 桁）で決めている。丸めで同点になった項目は `ORDER` の順になる。生の値で並べて、表示だけ丸めるほうが「寄与の大きい順」に忠実。
- [risk.ts:181-194] `sunsetText` は「日没が早い時期です」と固定で言うが、18:30 でも寄与は 0 より大きく（0.04）なり文が出る。「早い」と言い切れない日がある。時刻だけを事実として書く文にするか、`sunset` の値が一定以上のときだけ出す。
- [risk.ts 全体 242 行] 計算（上 105 行）と 4 言語の文面（下 130 行）が 1 ファイル。`sunsetText` / `nightText` は 4 段の三項演算子。`risk-text.ts` に分けると、計算のテストと文面のテストが独立する。
- [useCreateTrip.ts:23-34] ownerToken を `localStorage` に平文で置く（旅の id ごと、消す処理が無い）。仕様（R7）どおりだが、XSS で奪われると他人の旅を消せる（削除は record の feature）。record で削除を作るときに、トークンの寿命と削除後の後始末を決める。`crypto.randomUUID()` は HTTPS か localhost でしか使えないので、LAN の http でスマホ実機を試すときは落ちる（useCreateTrip.ts:73）。
- [useSubmitTrip.ts:43] 入力の同一判定が `JSON.stringify` の比較で、キーの順に依存する。いまは同じ関数（zod）が作るので順は同じだが、壊れやすい。api 側の `canonicalJson` と同じ正規化にそろえられる。
- [claude-trip-writer.gateway.ts:130] コメントは「拡張の思考はしない」だが、`thinking: { type: 'between_tools' }` を渡している。SDK の型には `ThinkingConfigDisabled` もある（messages.d.ts:4071）。`between_tools` が「思考しない」を意味するのかは、この読みでは判断できない。意図が「しない」なら `disabled` のほうが読み手に正直。要確認。
- [apps/api … markRequestDone] `status` / `updatedAt` の条件が無い。2 分を過ぎて再取得された古い要求が、遅れて完了すると、新しい要求の行を上書きして旅が 2 つできる。生成は最悪 60 秒で 2 分の閾値と余裕があるため現実には起きにくい。
- [PlanPage.test.tsx 全体] `vi.spyOn(console, 'error').mockImplementation(...)` を複数のテストで無条件に入れている。logger が `console.error` を使うための抑制だと思うが、React の本物の警告（key、act）も隠す。logger を spy して「呼ばれた」ことを見るほうが、意図が残る。
- [create-trip.usecase.ts:98-103] `try { ensureWithinDailyLimit } catch { log; throw }` は、ログのために例外を捕まえて投げ直している。policy の戻り値で分けるほうが、ネストが 1 段減る。好みの範囲。

## 仕様とのずれ（まとめ）

| 仕様                                                | 状態                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| R3 入りきらないとき黙って落とさない                 | 通常は `skipped` に出る。ただし物理的に無理な旅は黙って返す（Warning 1） |
| R4 暗い時間の割合 = 時間 ÷ 全移動時間               | サンプル数の割合（Warning 2）                                            |
| R4 根拠文は事実に基づく                             | 11 月の文が事実と違うことがある（Critical）                              |
| 入力の形が違えば 400                                | `toJst` の例外が 500 になるか要確認（Warning 4）                         |
| resilience 観測要件: 10 件・10 日の計算時間のテスト | 見当たらない（Warning 8）                                                |
| R5 の再試行 / R7 のトークン / R8 の冪等 / R9 の上限 | 仕様どおり。usecase.test が振る舞いを見ている                            |

## 次の一手（提案）

1. Critical の月の文を直し、テストを足す。
2. Warning 1（無理な旅）は仕様の判断が要る。Questions に足して、推奨を仮採用するなら (a) 入力エラー。
3. Warning 2・3・5・6 は小さな修正。まとめて 1 コミットでよい。
4. Warning 4 は route のテスト 2 本で白黒がつく。先に書いて、赤なら修正。
