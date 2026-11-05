# code-reviewer: feat/stop-events（2026-11-04）

範囲: apps/api の stop-events 一式、apps/sim/src/features/stop-events。仕様 R1〜R12 と照合。
読んだ主なファイル: prepare-stop-deck / record-trip-events usecase、stop-deck-policy、trip-event-policy、stop-writing-policy、owner-policy、stop-material、2 つの Drizzle repository、2 つの routes・schemas、claude-scene-writer.gateway、migrate.ts、sim の useStopDeck・useTripEventLog・event-sender・StopScenesPage。
テストの中身と di.ts・app.ts・StopSceneModal 等の画面は読んでいない（下の「未確認」）。

## レビュー結果

### Critical（修正必須）

なし。

確認して問題なかった点:

- 所有者の照合は、旅の有無 → トークンの形 → ハッシュ照合 → 日の範囲の順。束の書き込み・Claude の呼び出しの前にある（R9、AUTH-31〜33）。
- 束の claim は `insertPending`（ON CONFLICT DO NOTHING の件数）と `reclaim`（status と updatedAt の比較更新）で原子的。`markDone` / `markFailed` は自分の pending の行だけを書く（CONC-33）。
- 失敗は `execute` の try/catch で必ず `markFailed` に戻る。`markFailed` の失敗は元の例外を隠さない。
- 同時呼び出しの枠は `finally` で解放される。リトライのぶんも 1 枠で持つ。
- イベントは (trip_id, run_id, seq) が主キー。INSERT は 1 文で、半端に残らない。fingerprint は receivedAt を除き、キー順を正規化している。

### Warning（推奨）

1. [apps/api/src/domain/stop-events/policies/stop-writing-policy.ts:35,47-54] 禁止パターンが実在の自然な語を誤検出し、502 の原因になる。
   - `FORBIDDEN_SYMBOLS` の `件` と `円` は、ja の「条件」「用件」「円滑」、zh の「條件」「一件事」を落とす。天候・渋滞の場面は「路面の条件」と書きやすい。
   - `CLOCK_TIME` の `(?:数字|漢数字){1,3}\s*時(?!間)` は、ja の「一時的に」「一時停止」にあたる。
   - 同じ式の `點` は、zh-TW の「有一點」「一點點」（少し）にあたる。
   - 2 回とも外れると 502 になり、sim はその日の A-4 を出せない。
   - 改善案: 時刻の漢数字は `(?!間|的|停|期)` で除く。`點` は数字の直前が「一」のとき（「一點」）は、前後に「點」の続きや「半」が無ければ許す。`件` と `円` は、数字の直後に限る（`[0-9０-９]\s*[件円]`）。ただし spec は「文字を含まない」と書いている。仕様側（R7）の直しとセットで決めること。
   - この誤検出を固定するテストが無い（stop-writing-policy.test.ts は未読。grep で「一時的」「条件」が無いか確かめること）。
   - プロンプトにも「条件」「一時的」を避ける指示は無い。リトライの `previousProblems` は `forbidden-symbol@path` のコードだけで、どの字かを返さない。そのため 2 回目も同じ語を選びやすい。

2. [apps/sim/src/features/stop-events/hooks/useTripEventLog.ts:21-26] `alertEnabled`（と `runId`・`ownerToken`）が変わると、`useMemo` が新しい `TripEventSender` を作り、`nextSeq` が 0 に戻る。runId が同じままなら、同じ (runId, seq) で中身が違うことになり、api が 409 `EVENT_CONFLICT` を返す。sender は 4xx を捨てて警告を出すだけなので、イベントが黙って失われる。
   - 起きる場面: StopScenesPage は `?alert=off` から `alertEnabled` を毎回読む。R11 のモーダル下の ON/OFF は、drive-link が同じ runId のまま切り替えると、同じ問題を踏む。
   - 仕様は「alertEnabled は run の欄。切り替えは新しい run」（R10）。
   - 改善案: (a) hook 内で `alertEnabled` が変わったら sender を作り直さず、runId も新しくする。(b) `runId` と `alertEnabled` を 1 つの run オブジェクトにして `newRun(alertEnabled)` で作らせる。(c) 最低限、`alertEnabled` を依存に入れず sender の初期値とし、変わったら dev でエラーを出す。
   - hook のテスト（stop-events-hooks.test.tsx）に、この切り替えのケースを足す。

3. [apps/sim/src/features/stop-events/hooks/useStopDeck.ts:11-16] コメントの「生成の時間切れ 45 秒より長く待つ」と数が合わない。
   - 生成は最悪 45 秒 × 2 回の呼び出し（SDK の maxRetries: 1 を含めるとさらに延びる）。pending が古いと見なされるのは 2 分後。
   - 待ち直しは 5 秒 × 12 回 = 60 秒。2 回目の生成が長引くと、別タブの待ちが先に切れて A-4 が出ない。
   - 改善案: 待ちを 120 秒を超える数（5 秒 × 25 回など）にするか、`PENDING_STALE_MS` から導く。コメントも数に合わせる。

4. [apps/api/src/application/usecases/stop-events/record-trip-events.usecase.ts:79-107] 再送の冪等が、束の状態に依存する。
   - choice の解決は「いまの束」から値を写すので、再送の前に束が作り直されると（データの版が変わった、または reclaim で `deck: null` の pending に戻った）、保存済みの行と plannedLight 等が食い違って 409、または束が無くて 400 になる。
   - 送信側は 4xx を捨てるので、結果は黙った欠落になる。
   - 改善案: 解決の前に `findBySeqs` を引き、既存の行がある seq の choice は、保存済みの行と (sceneId, choiceId) が同じなら重複として数える。束の解決はまだ無い seq だけに行う。
   - 頻度は低いが、R10 の「同じ内容は成功」を壊す。

5. [apps/api/src/application/usecases/stop-events/record-trip-events.usecase.ts:88-123] 並行する同一 POST の扱い。
   - 2 つの同時 POST が両方 `findBySeqs` で「未保存」と見て、片方の INSERT は ON CONFLICT DO NOTHING で黙って捨てられる。
   - 結果: (a) 両方が `accepted: n` を返し、重複が数えられない。(b) 同じ seq で中身が違う 2 つの POST は、片方が 409 にならず、黙って捨てられる。
   - データは壊れない（主キーで守られている）。IDEM-32/33 は直列のテストなので気づけない。
   - 同様に、`countByTrip` と `insertMany` の間で 5,000 件を少し超えうる。
   - 改善案: `insertMany` が実際に入った件数（`rowsAffected` / RETURNING）を返し、`accepted` と `duplicates` をそれで決める。上限は「超えてもよい小さな誤差」とコメントに明記するか、INSERT 内の条件で守る。
   - sender は 1 件ずつ POST するので、実害は小さい。

6. [apps/api/src/application/usecases/stop-events/prepare-stop-deck.usecase.ts:84-86] `decks.find` が `null` を返すのは、`insertPending` の失敗と `find` の間に行が消えたとき（実際にはほぼ無い）。`TripInProgressError` を投げて 409 にするのは妥当だが、`existing.status === 'done'` なのに `deck` / `writing` が null の行（壊れた行）は、そのまま `reclaim` に進む。これは正しい処理。ただし、ログが無く原因を追えない。`log.warn('stop_deck.corrupt_done')` を足す。

7. [apps/api/src/domain/stop-events/policies/stop-deck-policy.ts:154-158] `placeOnLegs` が返す `km` は 2 桁に丸められている。一方、`atMs` の計算は丸めた km を使う。`l.distanceKm > 0` の分岐は良いが、ゾーンの手前へ動かした km（`entryKm - 1`）が 0 のとき、`km === inside.entryKm`（ゾーンが 0 km から始まる）なら、場面がゾーンの中に残る。R2 は「0 km で止める」と書いているので仕様どおり。ただし、その場面の `remaining.zones` は `entryKm > km` なので、入口が 0 のゾーンは「通過済み」に数えられる（`z.entryKm > km` が false）。そのゾーンの `passedZone` は `exitKm <= km` で false になり、`zones` からも漏れる。結果として、そのゾーンが R4 の「残るゾーン」からも「通過した」からも消える。入口が 0 km のゾーンを置いたテストを DECK-1d に足す。

8. [apps/api/src/domain/stop-events/policies/stop-deck-policy.ts:57-68] `buildStopDeck` は 1 関数に束の組み立て全体の流れがあり、読みやすさは保たれている。ただし `Draft` から `atMs`・`order`・`remaining` を落とす分割代入の `_atMs`・`_order` は、lint の未使用の例外に頼る。`Draft` を `{ scene, sortKey, remaining }` の形にすると、除く処理が要らなくなる。

### Info（参考）

- 良い点: domain が `@antler/*` を import せず、`LightAt` と `DayMaterial` を渡す形にしてある。決定的で、テストしやすい。`stop-material.ts` が写しを担う分担も明快。
- 良い点: route が薄い。rate limit → bodyLimit → param 検証 → usecase の順が、認可より前に IP の上限を当てる設計と合っている。
- 良い点: sender の再送が、同じ seq・同じ body で、api の冪等と対になっている。
- [owner-policy.ts:15-17] `storedHash.length === presentedHash.length &&` は、`===` だけで足りるので冗長。SHA-256 の 16 進同士の比較の根拠はコメントにある。
- [claude-scene-writer.gateway.ts:161] `thinking: { type: 'between_tools' }` は、コメント（拡張の思考をしない）と型の意味が合っていないように見える。plan-trip の gateway（claude-trip-writer.gateway.ts:130）と同じ値なので、既存の流儀。SDK の型が通っているなら問題ないが、`disabled` との違いを確かめておく。
- [error-mapper.ts] 新しい 4 つの例外の対応は、spec の表どおり。
- [trip-event.schema.ts:18] `at` は `local: false` で、オフセット必須。`day` の上限 31 は旅の日数との照合が usecase にある。二重だが、スキーマは形、usecase は意味で、分担は妥当。
- [record-trip-events.usecase.ts:76] `Date.parse(stored.plan.depart.at)` は、保存済みの旅の値で、不正な日付は入らない前提。
- [prepare-stop-deck.usecase.ts:89] 保存済みを返すとき `data.load()` を毎回呼ぶ。負荷は小さいが、読み込みがキャッシュされているか（`RoadCatalogGateway.load`）を確かめておくとよい。

### 未確認（時間の都合で読んでいない）

- テストファイルの中身（網羅は Test List のチェックだけで判断した）、`di.ts`・`app.ts` の配線、StopSceneModal・ChoiceButton・stop-events.css、`routes.tsx`・`plan-trip/index.ts` の変更、`parse-deck.ts`。
- `rate-limit` の `rateLimitKey` が、プロキシ背後で IP を正しく取るか。
- セキュリティ観点（トークンの扱い、`X-Owner-Token` のログ漏れ）は security-auditor に任せる。
