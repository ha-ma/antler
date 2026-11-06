# コードレビュー: feat/plan-trip-photos（2026-11-06）

対象: packages/trip（itinerary.ts・plan.ts・input.ts・title.ts・pleasures.ts）、apps/sim plan-trip（PleasureCard・PhotoCredit・AllocationBar・photos.ts・photo-rules.ts・store.ts・trip-input.ts）、apps/sim/scripts/fetch-photos.ts、テストの旅の固定（apps/api/tests/factories/stop-events.ts・losses.ts、apps/sim/src/test/trip-day.ts）。
仕様: docs/specs/plan-trip-photos/functional.md。読んだ範囲はファイルの現状（git diff は実行できないため、対象ファイルを直接読んだ）。

## レビュー結果

### Critical（修正必須）

なし。

決定性は保たれている。`buildItinerary` / `weightForHours` / `activityHours` は純粋関数で、並べ替えの比較はすべて hours → id（または周回順）の全順序まで決まる。時刻・乱数・Map の挿入順への依存はない。`1.6` の枠と `weight × 96 分` は 1 つの整数から出るので、数式の上では厳密に一致する（plan.ts:12-22、stop-rules.ts:5-6）。

### Warning（推奨）

- W1 [packages/trip/src/day/day-plan.ts:55-57、apps/api/src/application/usecases/stop-events/stop-material.ts:15,44] 保存済みの TripPlan との互換が `days` の一致だけで守られている。仕様は「以前の旅は A-2 で作り直せなくなる」と書くが、`buildDayPlan` は `JSON.stringify(itinerary.days) !== JSON.stringify(plan.days)` だけを見る。旧 weight（例: 3 時間で weight 3）の旅は、`days` がたまたま同じなら ItineraryChangedError にならず、stop-events は保存の `plan.pleasures[].weight`（旧値）× 96 分で滞在を作る。しおりの活動時間（新の枠）と食い違う。`weights.get(s.id) ?? 1` も、欠けを黙って 1 にする。マスターの `hours` を直したとき（Deferred）も同じ → `buildDayPlan` で保存の weight が `weightForHours(pleasureById(id).hours)` と一致するかも確かめ、違えば ItineraryChangedError にする。
  ```ts
  const weightsMatch = plan.pleasures.every(
    (p) => p.weight === weightForHours(pleasureById(p.id)?.hours ?? Number.NaN),
  )
  if (!weightsMatch || JSON.stringify(itinerary.days) !== JSON.stringify(plan.days))
    throw new ItineraryChangedError()
  ```
- W2 [apps/api/src/domain/stop-events/rules/stop-rules.ts:6 と packages/trip/src/plan.ts:12] `MINUTES_PER_WEIGHT = 96` と `HOURS_PER_WEIGHT = 1.6` は domain が `@antler/*` を import できないため二重定義で、両者を結ぶテストが無い（`HOURS_PER_WEIGHT` / `MINUTES_PER_WEIGHT` をテストから参照している箇所は 0 件）。片方だけ直すと、仕様が最も大事にしている「滞在が厳密に一致」が静かに崩れる → apps/api に `expect(MINUTES_PER_WEIGHT).toBe(HOURS_PER_WEIGHT * 60)` のテストを 1 つ（application 層か tests/ から両方を import できる）。ついでに、`personaTrip()` の DayPlan で「各 stop の stayMin = activityHours × 60」を見る結合テストがあるとよい。
- W3 [apps/sim/scripts/fetch-photos.ts:218] 1 件でも取得に失敗すると、成功した分だけで photos.json を上書きする。前回成功していた楽しみの記録が消え、画像ファイル（public/photos/）と CREDITS.md だけが残る（記録の無い画像＝出典不明）。画像の書き込み（176 行）も記録の書き込みより先で、途中で落ちると不整合になる → 失敗があるときは manifest を書かない（`failed.length > 0` なら書かずに終了コード 1）、または既存の記録とマージして失敗した id は前回の記録を残す。
- W4 [apps/sim/scripts/fetch-photos.ts:61-76,119] API の応答の zod が `imageinfo` を必須（`.min(1)`）にしている。Commons は存在しないタイトルを `missing` のページで返し、`imageinfo` が無い。1 つのファイル名が間違い（改名・削除）だと `ApiResponse.parse` が全体を落とし、どのファイルが原因か分からない例外になる。`fetchOne` の「ファイルが無い」の分岐が実質届かない → `imageinfo` を optional にして、`pages` の `missing` を拾って id 単位で失敗にする。
- W5 [apps/sim/scripts/fetch-photos.ts:39,192] `REVIEW`（「Claude がサムネイルを目視: 顔・商標・鹿が写っていない」）を、取得したすべての写真に無条件で書く。photo-picks.json のファイルを差し替えて再実行すると、見ていない写真にも「目視した」記録が付く。ライセンスの記録の信頼性（R6 の `review`）を損なう → picks に `reviewedSha1`（目視した原本の SHA-1）を持たせ、一致したときだけ `review` を書く。一致しなければ失敗にして目視を促す。
- W6 [packages/trip/src/itinerary.ts:4,94、title.ts:19、apps/sim/.../AllocationBar.tsx:17] 設計: (a) 「所要の長い順、同じなら id 順」の比較が 3 か所に同じ式で複製されている（さらに itinerary.ts:60 の「外す順」がその逆）。仕様の「長い順」を変えると 1 か所の直し忘れで画面のタイトルと配分バーの順が食い違う。(b) `itinerary.ts` が `plan.ts`（TripPlan の組み立て）から `activityHours` を import している。所要→枠の換算は組み立ての部品なので、依存の向きが逆 → `packages/trip/src/duration.ts` に `HOURS_PER_WEIGHT`・`weightForHours`・`activityHours`・`compareByHoursDesc` を置き、itinerary / plan / title / sim から使う（index.ts の公開はそのまま）。

### Info（参考）

- [packages/trip/src/plan.ts:16] `- 1e-9` は、マスターの hours が 0.5 刻みで 1.6 の倍数は 8 だけ（8 / 1.6 = 5 ちょうど）なので不要。害は無いが、理由のコメントが無いと将来「なぜ」になる。
- [packages/trip/src/itinerary.ts:59-64] 外す順は生の `hours` で決める。3 時間と 2 時間はどちらも枠 2 で占有が同じなので、2 時間を外しても空きは増えない（3 時間を残す意味が無い場面がある）。仕様 R2 は「所要の短い順」なので仕様どおり。気になるなら `weightForHours` の昇順 → hours の昇順にすると、占有の同じものでは余計に外さない。
- [packages/trip/src/itinerary.ts:135-144] 待ちの規則（移動だけなら当日に移動／着けず翌朝からなら 1 日に収まるときだけ翌朝）は読めて、day-plan.test.ts:60 の「17:30 に釧路空港」で反対側の分岐もある。ただし「着けるので当日に移動して泊まり、活動は翌朝」の分岐を直接見るテストは、DUR-2 の `days[0].to !== 'cts'` だけ。stay の値（鶴居など）まで固定すると退行に強い。
- [apps/sim/scripts/fetch-photos.ts:92-99] Retry-After に上限が無い（巨大な値で長時間待つ）。`Math.min(ms, 120_000)` 程度に。HTTP-date 形式は NaN になり既定の待ちに落ちるので安全側。
- [apps/sim/scripts/fetch-photos.ts:168-170] 先頭バイトの判定と SHA-256、幅の上限、2 MB の途中打ち切り、`redirect: 'error'`、ホストの完全一致は、仕様 R8 どおりで良い。PNG はメタデータを落とさない（R8 は JPEG のみ。PNG の tEXt/eXIf を落とすかは未決）。
- [apps/sim/src/features/plan-trip/utils/photos.ts:11-44] 良い点: 記録の zod でライセンス・id とファイル名・重複を例外にしている。`licenseUrl` は https だけでホストは縛っていない（記録は人が確かめた値なので許容）。楽しみの id がマスターに存在するかはここでは見ず、PH-1 のテストに任せている。
- [apps/sim/src/features/plan-trip/components/PleasureCard.tsx / PhotoCredit.tsx] 良い点: 引用をトグルのボタンの外に出し、ボタンの名前を楽しみの名前だけに保っている。リンクの `aria-label` に表示文字（撮影者・ライセンス名）が含まれ、WCAG 2.5.3（ラベルを含む名前）も満たす。
- [apps/sim/src/features/plan-trip/text.ts:162-167] `riskNote`「重みは目安です」は、リスクの重み（RISK_WEIGHTS）のことで楽しみの重さではない。紛らわしいので「リスクの係数は目安です」などにすると、PlanPage.test の `/重さ/` の否定とも混同しない。
- [apps/sim/src/features/plan-trip/components/AllocationBar.tsx:18、PleasureCard.tsx:67] 画面の「約 n 時間」はマスターの hours（目安）で、しおりは 1.6 時間の枠に切り上げる（3 時間 → 3.2 時間）。仕様で決めたことだが、合計が実際の日程より短く見える。
- [テストの旅の固定] apps/api/tests/factories/stop-events.ts:42-45、losses.ts:28、apps/sim/src/test/trip-day.ts:31-35 は、PERSONA_INPUT を共有せずに明示の 2 件に固定していて意図が明確（良い）。ただし同じ `[{drift-ice-walk},{red-crowned-crane}]` が 3 か所に複製されている。tests 用の共有の定数にまとめられる（api と sim は別 workspace なので、packages/trip から `STORY_PLEASURES` のようなテスト専用の公開は避け、各 workspace で 1 つにする程度でよい）。
- [packages/trip/src/input.ts:30-33] `weight` を optional で受けて使わない互換は、冪等キーの body 比較（届いた body のまま）と合わせて筋が通る。`satisfies z.ZodType<TripInput>` で型の整合も取れている。
