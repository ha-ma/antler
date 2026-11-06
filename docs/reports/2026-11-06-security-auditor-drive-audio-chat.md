# セキュリティ監査: POST /api/trips/:id/day/:n/chat（drive-audio-chat）

対象: コミット 7589dd0（apps/api の chat 一式）と apps/sim/src/features/drive/chat/chat-api.ts。
仕様: docs/specs/drive-audio-chat/threat.md・resilience.md・functional.md R15〜R17。
実行: chats 関連の vitest 6 ファイル 56 件が通ることを確認（`--maxWorkers=2`）。コードは変更していない。

## 総合

- リスクレベル: Medium（Critical なし）
- 認可・IDOR・応答の絞り込み・ログ・削除は仕様どおりで、確信のある欠陥は無い。
- 残る論点は、サーバーレス実行（Vercel）で費用の抑えが 1 日の上限と IP 制限だけに頼ること、出力検証の抜け、削除と生成の競合による孤児行。

## Critical（即時対応）

なし。

## Warning（計画的に直す）

### W1. 失敗の記憶・single-flight・同時の枠がプロセス内だけで、Vercel では効かない（CWE-770）

- 場所: `prepare-chat.usecase.ts` の `failures`（96 行）・`inFlight`（94 行）、`container.ts` の `InProcessConcurrencyLimiter`。
- 内容: `failures`・`inFlight`・`writerSlots` はインスタンスごとのメモリ。コールドスタートや別インスタンスでは「10 分の失敗の記憶」が空になり、外れ続ける鍵（例: 検証に毎回外れる日）でも 1 要求あたり最大 2 回（`MAX_CHAT_WRITER_ATTEMPTS`）Claude を呼ぶ。
- 上限: 所有者の IP あたり 10 件/分（20 呼び出し/分）、全体は `CLAUDE_DAILY_CALL_LIMIT`（DB の `trip_writer_calls`）で頭打ち。無制限ではない。
- 影響: 所有者 1 人が 1 日の枠を短時間で使い切り、plan-trip・stop-deck・loss も 429 になる（共有の枠）。threat.md の「残るリスク」と同じ方向で、記憶が効かないぶん増幅が大きい。
- 修正案: (a) 失敗の記憶を DB に置く（`trip_chats` と別の小さな表、または rate-limit カウンタの scope `chat-fail:{keyHash}` を 10 分窓で使う）。(b) 会話に全体の一部までの別枠を置く（threat.md が予告済み）。
- 補足: `PrepareChatUseCase` の鍵（`chatKeyMaterial`）は tripId・day・データの版だけで決まる。所有者が鍵を増やすことはできず、成功は 1 日 1 束まで。したがって増幅は「外れ続ける鍵の再試行」に限られる。

### W2. 生成中に旅が削除されると trip_chats の孤児行が残る（CWE-459 / 削除方針）

- 場所: `prepare-chat.usecase.ts` 184 行 `insertChat`、`drizzle-record.repository.ts` `deleteTrip`。
- 内容: 旅の存在確認は処理の先頭だけで、Claude の呼び出し（最長 60 秒）のあとに旅の行を確かめずに INSERT する。その間に DELETE /api/trips/:id が通ると、旅が無いのに `trip_chats` の行が残る。FK も無く、旅が 404 になるので以後だれにも消せない。`deleteTrip` 自体も複数の DELETE を並べただけでトランザクションではない（旅の行を最後に消す順なので、途中で失敗しても旅は残る）。
- 影響: 内容は個人を特定しない（Data Classification どおり）ため機密性の問題は小さい。削除の約束（「旅の削除と同時に消える」）が競合時に破れる。
- 修正案: INSERT を `INSERT ... SELECT ... WHERE EXISTS (SELECT 1 FROM trips WHERE id = ?)` にする。または保持期間の掃除ジョブ（Deferred）で `trip_id` が trips に無い行を消す。

### W3. 出力の検証の抜け（CWE-20 / CWE-116）

Claude の出力が材料以外の影響を受ける経路は無い（下の I1）ので、悪用ではなく品質・偽警報の防御として見る。`chat-writing-policy.ts`:

- 正規化していない。全角の `ｄｅｅｒ`、半角カナの `ｼｶ` は `DEER_WORD`（`/鹿|シカ|deer|사슴/iu`）をすり抜ける。NFKC 正規化してから判定する。
- `DIGIT` は `[0-9０-９]` だけ。`①` `²` `Ⅲ` `٣` などは通る。`\p{N}` にする。
- 鹿以外の動物・危険の語（elk・moose・fawn・stag・wildlife・animal・動物・野生・獣・熊・엘크・고라니 など）は、プロンプトで禁じているだけで検証が無い。「前方に鹿」の赤の警告と紛れる文を弾く目的なら、広げるか、意図的に許すと functional.md に書く。
- 言語の取り違えを検出できない。`zh` は「かな・ハングルが無い」だけで通るので、英語の文でも通る。`en` は ASCII 英字が 1 文字あれば通る。`ja` は漢字だけ（中国語）でも通る。`zh` は Han を 1 文字以上要求する、`en` は英字の割合を見るなどにする。
- 簡体字の判定は 22 文字だけ（个・来・为・吗・国・问・间・学・经・样 などが通る）。
- 制御文字・ゼロ幅文字・双方向制御・改行・URL/マークアップは見ていない。sim は React のテキストとして出す（`dangerouslySetInnerHTML` は drive 配下に無い）ので XSS にはならないが、読み上げや表示崩れの元になる。`[\p{Cc}\p{Cf}]` と `https?://|<` を弾く。
- 「運転の指図をしない」はプロンプトだけ。検証にしないなら、その旨を仕様に書く。

### W4. 生成の件数の上限が事実上働かない（CWE-362、Info 寄り）

`countChats`（175 行）は確認と INSERT の間が非原子的で、最長 60 秒の隙間がある。ただし鍵が tripId・day・データの版だけで決まるため、同じ旅で作れる束は日数 × 版の数に限られ、30 に届かない。実害は無い。`MAX_CHATS_PER_TRIP` は「データの版が増え続けた場合の保険」と理解して、仕様の説明（「旅程を作り直して鍵を変え続けられない」）を実態に合わせる。

## Info（問題なし・確認済み）

- I1 プロンプトインジェクション: `toChatWritingBrief` の自由文字列は `placeById`/`pleasureById` のマスターの名前だけ。他は enum（experience・topic・speaker・light）、整数（partySize・month）、conditions の列挙値。ユーザー入力（body は読まない）・時刻・金額は入らない。`previousProblems` は `code@path` の固定語彙。`plan.lang` は保存済みの TripPlan（plan-trip が zod で検証済み）から取る。注入の経路は見つからない。
- I2 ownerToken と順序: レート制限 → bodyLimit(1 KB) → パス検証 → 旅の読み出し(404) → 形と SHA-256 の照合(403 で「無い」と「違う」が同一) → 日の範囲(404) の順で、stop-deck と同じ。日数は所有者以外に漏れない。single-flight（`inFlight`）は所有者の確認のあとで参加するので、他人が処理に相乗りできない。
- I3 IDOR: 対象は path の id・n だけで、body・クエリは読まない。他の旅のトークンはハッシュが合わず 403。旅の id が公開値であるための 404/403 の区別は、threat.md が受け入れ済み。
- I4 ハッシュの比較は `===` だが、比べるのは SHA-256 のハッシュどうしでトークン自体は比べない。タイミングから元のトークンは分からない。トークンは HMAC 由来の 256 ビットでブルートフォースは非現実的。
- I5 レート制限: `chats.prepare` の IP あたり 10 件/分。認可より前。IP は `TRUST_PROXY` のときだけ XFF の右端（IPv6 は /64）。ただし stop-deck など他の route の枠とは scope が別なので、IP あたりの合計は route の数だけ足される（日次上限が全体を抑える）。
- I6 ログ: `chat.*` は tripId・day・行数・ms・理由コード・トークン数だけ。トークン・本文・材料・API キーは出ない。`http.request` は method・path(tripId は公開値)・status のみで、Authorization を出さない。`http.error` は `error.message` とスタックを出すが、chat 系の例外の文言は固定（`ChatWriterError` は理由コードのみ保持）。Anthropic の例外は gateway が `ChatWriterError` に包む。
- I7 応答: `toDeck` が欄を明示して組み立て、`keyHash`・`createdAt` は出ない（SAVE-2c）。`exposeErrorDetails` は `NODE_ENV === 'development'` のときだけ `detail` を返す。公開環境で NODE_ENV を development にしないこと（デプロイ設定の確認項目）。
- I8 失敗の記憶のメモリ: 追加されるのは認可済みで Claude を実際に呼んで外れた鍵だけで、1 件ごとに日次カウンタを消費する。掃除は `recentFailure` が全走査して期限切れを捨てる（O(n)）。n は日次上限で頭打ち。無制限には増えない。
- I9 旅の削除: `deleteTrip` が `trip_chats` を `trip_id` で消す。tripId 指定でほかの旅に波及しない。競合時の孤児は W2。
- I10 表とマイグレーション: `CREATE TABLE/INDEX IF NOT EXISTS` を `client.batch(..., 'write')` で流し（途中失敗は全戻り）、`schema_meta` は `max(version, excluded.version)` で下がらない。`trip_chats.key_hash` が主キーで、鍵に tripId を含むため旅をまたぐ衝突は無い。デプロイ順の注意: Vercel は `checkSchema` が版 3 を要求するため、`npm run db:migrate` より先にコードを出すと関数が `SchemaOutdatedError` になる。コミットメッセージの手順（main に入れる前に db:migrate）を守ること。旧コード（版 2 を要求）と DB 版 3 の組み合わせは問題なし。
- I11 sim の chat-api.ts: Bearer は `Authorization` ヘッダのみ（URL・本文・ログに出ない）、宛先は `VITE_API_BASE_URL` と `encodeURIComponent` した tripId。`ownerToken` が無い端末は `enabled: false` で送らない。応答は zod で検証し、`deckFits` で tripId・日・データの版・leg の範囲を照合してから使う。ログは status・code・例外名だけ。細かい点（任意）: text に長さの上限（60 文字）が無く、行 id の形（`^l\d{2}$`）も api 側の schema ほど厳しくない。API が正しい前提では実害なし。
- I12 秘密: 新しい秘密・env は無い。`ANTHROPIC_API_KEY` は既存。ハードコードされた鍵・トークンは無い。

## 対応の優先順

1. W1（失敗の記憶を DB かレート制限カウンタに寄せる、または会話の下位の枠）
2. W2（INSERT に旅の存在条件を付ける）
3. W3（NFKC・`\p{N}`・言語の取り違え・制御文字。鹿以外の動物語は仕様判断）
4. W4（仕様の文言の修正のみ）
