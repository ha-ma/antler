## セキュリティ監査結果: POST /api/trips/:id/losses（d3576c6）

対象: apps/api の loss 差分。plan-trip の rate-limit・client-ip・env は前提。行番号は作業ツリー（write-loss.usecase.ts は未コミットの変更あり）のもの。

### Critical（即時対応）

- なし

### High（早期対応）

- なし

### Medium（計画的対応）

- [apps/api/src/application/usecases/losses/write-loss.usecase.ts:148, di/container.ts:66-76] 1 日の上限（既定 400）を plan-trip と丸ごと共有しており、loss 専用の下位枠が無い | 影響: 1 つの IP が 1 分 10 件で旅を作り（各旅 20 件まで loss）、約 40 分で当日の枠を使い切れる。以降は plan-trip（新規の旅の作成）が 429 DAILY_LIMIT になる。費用は 400 回で頭打ちなので金銭の濫用は抑えられているが、可用性は落とせる（CWE-770 / CWE-400） | 修正: loss には全体の一部（例: 上限の 25%）までの別カウンタを置く、または countWriterCall に用途別の上限を渡して loss が使い切れないようにする。アラート（残り 20% で warn）も足す
- [write-loss.usecase.ts:95, domain/losses/rules/loss-rules.ts MAX_LOSSES_PER_TRIP] 旅の ID を知る人（共有リンクの受け取り手を含む）が、日 × 移動 × ON/OFF × 済ませた楽しみの組み合わせを変えて 20 件を埋められる。埋まると本人の A-6 は LOSS_LIMIT（429）で喪失文が出ない | 影響: 旅の持ち主の A-6 が壊れる（嫌がらせ）。threat.md の「残るリスク」は偽の文の保存だけで、枠の枯渇は書かれていない（CWE-770） | 修正: (a) 上限に達しても、この旅で一番新しい文や記述子に合う文があれば返す、または上限到達時は Claude を呼ばず最も近い保存済みの文を返して 429 にしない、(b) threat.md の残るリスクに枠の枯渇を書き、上限を実際に使われる組み合わせ数（衝突は 1 旅に 1 回が普通）に合わせて小さくする、(c) 所有者トークンがあれば上限を別枠にする。UC は推奨で進めてよい（受け入れるなら threat.md に明記）

### Low / Info（確信はあるが緊急ではない）

- [write-loss.usecase.ts:95-103] 旅ごとの上限は「数える → Claude → INSERT」で原子的でない。別の鍵を同時に送ると 20 を数件超えうる（同時の枠 4 が上限）。1 日の上限が最終の歯止めなので実害は小さい。INSERT を `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < 20` にすれば閉じる（CWE-362）
- [write-loss.usecase.ts:148-153] Claude の出力が外れた失敗は保存しない（negative cache なし）。同じ記述子を繰り返すと毎回最大 2 回呼ぶ。IP の 10/分と 1 日の上限で抑えられる。攻撃者が失敗を起こすのは難しいが、モデルが特定の材料で外れ続けると自分の費用で増幅する。同じ鍵の失敗を数十秒だけ覚える方法がある
- [write-loss.usecase.ts:66-68, loss-context.ts:35] replay（保存済みを返す経路）でも `findTrip` と `buildItinerary` ＋ JSON 比較を毎回走らせる。鍵を先に引ければ省ける。IP あたり 10/分なので DoS にはならない（CWE-400）
- [write-loss.usecase.ts:65-67, 69-70] 存在する旅の ID は 400 / 409 / 201、存在しない ID は 404 になるので、body の形が正しければ ID の存在を見分けられる（threat.md の AUTH-2 は「無い id と形の違う id」しか同じにしていない）。8 文字の英数と 10/分/IP で総当たりは現実的でない。エラーの文言から旅の日数の範囲も分かるが、ID を知る人には既知。許容でよい（CWE-204）
- [infrastructure/http/validation.ts, http/app.ts:67-76] zod の `unrecognized_keys` は利用者が送ったキー名を 400 の message とログに入れる。上限 4 KB・JSON 文字列なので注入にはならない。ログの値の長さに上限があると安心

### 指示された観点の結果（問題なしの確認）

- Claude の費用: 鍵は文の材料だけ（tripId・day・leg・alertEnabled・並べ替えた achievedStops）。`at` を入れていないので秒を変えても別の鍵にならない。replay は Claude も 1 日の数も使わない。呼び出しごとに countWriterCall（UPSERT RETURNING の 1 文で原子的）を数え、作り直しの 2 回目も数える。同時の枠は plan-trip と同じ limiter のインスタンスで、`finally` で必ず解放。時間切れは AbortSignal で 30 秒に区切られる
- single-flight: inFlight の鍵は keyHash（tripId 入り）で他の旅へ結果が漏れない。`finally` で成功・失敗とも削除。待っている側は同じ失敗を受け取るだけ
- 入力検証・Mass Assignment: strictObject（body・param）、`day` 1-999・`leg` 0-99・`achievedStops` は slug の正規表現で最大 10 件、`at` は ISO 8601 ＋ offset。保存したしおりと突き合わせ（日・移動・暦日・済ませた楽しみ）てから使う。応答は `{ loss: { tripId, story, createdAt } }` を明示して組み立て、ownerTokenHash を含まない。DB は drizzle のパラメータ化で SQL インジェクションなし
- プロンプトへの自由入力: 材料は保存したしおり（`buildItinerary` で作り直して保存の `days` と一致を確かめる）とマスターの名前・数値・真偽値だけ。`previousProblems` は `code@path` の固定の文字列。body の文字列がそのままプロンプトに入る経路は無い。JSON.stringify で `<loss>` の中に入れる
- ログ: gateway は理由のコード・トークン数・ms だけ。Anthropic の例外は LossWriterError に包み、元の message をログにも応答にも出さない。API キーは env から Anthropic クライアントに渡るだけ。`http.error` の `serializeError` は LossWriterError（固定文言）や TripInputError しか持たない
- エラー応答: error-mapper で code と固定文だけ。`detail` は NODE_ENV=development のときだけ（既存の仕組み）
- DoS: rateLimit → bodyLimit（4 KB、超えたら 413）→ 検証の順で、巨大な body は読まれる前に止まる。実体の読み込みは bodyLimit が上限を強制する

### 総合評価

- リスクレベル: Medium（Critical 0 / High 0 / Medium 2）
- 推奨アクション: 費用の濫用は 1 日の上限・IP・旅ごと・同時枠・single-flight で有効に抑えられていて、プロンプト・ログ・応答の漏れも見つからなかった。マージを止める指摘は無い。Medium の 2 件（loss 専用の下位枠、旅ごとの枠の枯渇）は推奨案で決めて threat.md に残し、次の feature か同じ PR の追補で入れる
