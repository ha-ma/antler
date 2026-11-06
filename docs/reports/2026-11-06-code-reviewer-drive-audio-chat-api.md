# code-reviewer: drive-audio-chat の api（コミット 7589dd0）

2026-11-06。対象は `POST /api/trips/:id/day/:n/chat`。仕様は `docs/specs/drive-audio-chat/functional.md`（R10・R11・R15〜R17、PLAN-_・WRITE-_・SAVE-*・AUTH-41〜45・AC-41）と `resilience.md`。実装者の記録は `docs/reports/2026-11-06-api-chat-implementation.md`。
コードは読んだだけで、動かしていない（Bash が無い環境。正規表現・Unicode の指摘は「要確認」と書いたものを node で確かめてほしい）。コードは直していない。

## レビュー結果

### Critical（修正必須）

- **C1 [apps/api/src/infrastructure/gateways/prompts/chat-writing.ts:23 と domain/chats/rules/chat-rules.ts:24]** プロンプトの長さの指示が検証と食い違う。
  - プロンプト: 「en は 12 語程度（100 文字を超えない）」。検証（R17）: **全言語 60 文字まで**（`Array.from(text).length > 60` → `too-long`）。
  - 英語 12 語は 60〜80 文字になりやすく、プロンプトに従った正しい出力が `too-long` で外れる。2 回とも外れると 502 になり、鍵が 10 分記憶される。実装者の「残したこと」3（実機未確認）で見つかるはずの問題を、いま潰せる。
  - 修正案: 「各言語とも 60 文字以内（ja・zh は 30 文字程度、ko は 40 文字程度、en は 8 語程度）」に直す。数字は `CHAT_TEXT_MAX_LENGTH` からテンプレートで埋めて、定数とプロンプトを離さない。ついでに 26 行目の「鹿」の重複（`「鹿」「シカ」「deer」「사슴」「鹿」`）も直す。
  - テスト案: `CHAT_WRITING` に `String(CHAT_TEXT_MAX_LENGTH)` が含まれ、`100` が含まれないことを確かめる。

Critical はこの 1 件。R11 の置き場所、usecase の順序、single-flight、INSERT-or-lose、応答の形は仕様どおりで、致命的な誤りは見つからなかった。

### Warning（推奨）

- **W1 [claude-chat-writer.gateway.ts:137 / prepare-chat.usecase.ts:236-251 / apps/sim/src/features/drive/chat/chat-api.ts:9]** 時間の予算が閉じていない。
  - Claude は 1 回あたり最大 30 秒（SDK の再試行を含めて 1 つの `AbortSignal`）。usecase の作り直しで最大 2 回 = 60 秒。Vercel の `maxDuration` は 60 秒（`apps/sim/vercel.json`、deploy-a resilience.md「関数の時間」）、sim の `TIMEOUT_MS` も 60 秒。
  - 最悪のとき、関数が 60 秒で殺される（INSERT に届かない。数え上げだけ進む）、または sim が先に中断して見本の会話に落ちる。deploy-a は「gateway の 30 秒が先に来る」前提だったが、作り直しで崩れている。
  - 改善案: usecase に締め切り（開始 + 約 50 秒）を持たせ、2 回目の呼び出しは残り時間で打ち切る（gateway の `timeoutMs` を要求ごとに渡す）。または chat は出力が短いので gateway の時間切れを 20 秒にする。sim の `TIMEOUT_MS` は関数の上限より長くする（例 65 秒。サーバーが先に 502 を返す形）。
- **W2 [chat-writing-policy.ts:24 EMOJI]（要確認）** 音符 `♪`（U+266A）・`♫` が `Extended_Pictographic` に入るはず（emoji-data の 2614..2685）。`music` の話題では Claude が `♪` を付けやすく、`emoji` で外れて作り直しになる。同じ範囲に `☀`（2600）・`☃`（2603）・`★`（2605）・`❄`（2744）も入るので、ペルソナの旅は 2 月で、`weather`・`scenery` の話題でも `❄`・`☃` が出やすい。プロンプト（28 行）は「絵文字・顔文字」としか言わず、音符記号を禁じていない。
  - 改善案: node で `/\p{Extended_Pictographic}/u.test('♪')` を確かめる。true ならプロンプトに「♪ ♫ ★ などの記号も使わない」を足す（検証は仕様どおり厳しいままでよい。文を直させる側を直す）。
- **W3 [chat-writing-policy.ts:51-53 SCRIPT_OK]** 文字種の検査が「含む」だけで、取り違えを見逃す。
  - `zh` は「かな・ハングルを含まない」だけなので、**英語の文がそのまま zh に入っても通る**（漢字が 1 文字も無くてよい）。`en` は英字が 1 つあれば通り、日本語混じりでも通る。`ja` は漢字だけ（中国語）でも通る。stop-events と同じ考えとのことだが、4 言語を 1 回で書かせるこの API では取り違えの確率が高い。
  - 改善案: zh は `Han` を 1 文字以上必須に足す。en は `KANA_OR_HANGUL` と `Han` を含まないことを足す。ja は仮名 1 文字以上必須。テスト（WRITE-2c）に `zh: 'Nice road'`・`en: 'Nice 景色'` を足す。
- **W4 [chat-writing-policy.ts:38 KOREAN_NUMBER / :35 KANJI_NUMBER]** 誤検出が残る。
  - ko: `이[십백천억]` は敬語の「〜이십니다／〜이십시오」（radio は존댓말）に当たる。「이천」（地名）も当たる。ほかに、ko の「만 원」「십 분」のように位だけの語は見逃す（仕様の「連なり」の範囲内）。
  - ko: `오십` は「어서 오십시오」（radio の挨拶）、`일만` は「일만 하지 말고」に当たる。
  - ja・zh: `十一月`・`十二月`（月の名前）が漢数字の連なりで外れる。`DEER_WORD` は「馬鹿」にも当たる（くだけた ja）。
  - zh: `千萬`（千萬別〜）・`萬一`（萬一〜）は日常語だが漢数字の連なりとして外れる（ja の「万一」は許容と書かれているが zh は書かれていない）。
  - 影響は作り直し（1 回）と 502 の確率が上がること。改善案: 当たりが多いなら、zh は `千萬`・`萬一` を先に除いてから判定する（`text.replace(/千萬|萬一/gu, '')`）。ko は `이십니` を除く。除いた語をテストに残す。
- **W5 [chat-writing-policy.ts:42 SIMPLIFIED]** 簡体字の一覧が 17 字（仕様の一覧そのまま）で、頻出の `个 来 为 国 吗 听 动 关 间 门 让 总` が入っていない。「来吧」「好听」のような短い文は見逃す。仕様の一覧は最低限と読み、十数字足すのが安い。仕様 R17 の一覧も合わせて更新すること。
- **W6 [chat-plan-policy.ts:109-118 departKm / 実装者の記録 6]** depart を動かした先の判定が仕様より厳しい。
  - 仕様 R11: 「**出口**が移動の終わりの 1 km 手前より先なら作らない」。実装: 動かした先（出口 + 0.2、切り上げ）が `距離 − 1` を超えたら作らない。出口が `(D − 1.2, D − 1]` のとき、仕様は作り、実装は作らない。
  - 実装のほうが「行を終わりの 1 km 手前に収める」意図には合うが、仕様（PLAN-1f）とずれたまま記録だけに残っている。PLAN-1f のテストは出口 49.5（D = 50）だけで、境界を踏んでいない。
  - 改善案: どちらかに揃える。仕様に合わせるなら `inside.exitKm > distanceKm - EDGE_MARGIN_KM + EPSILON` で判定する。実装を残すなら functional.md R11 と PLAN-1f を直し、出口 48.9・49.0・49.5 の 3 点を境界テストにする。
- **W7 [prepare-chat.usecase.ts:94-96 / 200-204]** 失敗の記憶と single-flight はプロセスの中だけ。本番は Vercel の関数（deploy-a）で、インスタンスをまたぐと効かない。
  - 仕様 R15 は「1 プロセス前提」で承認済みだが、「画面を開き直すたびに呼ばない」という目的は本番では弱い。実際の歯止めは IP あたり 1 分 10 件（`rate_limit_hits` は DB）と 1 日の上限（400）だけ。
  - 改善案（任意）: 失敗を DB に 1 行残す（`trip_chat_failures(key_hash, until_ms)`）か、費用の上限が許すなら現状のまま PR に「本番では記憶は効きにくい」と書く。少なくとも resilience.md の「残余リスク」に 1 行足す。
- **W8 [chat-plan-policy.test.ts]** テストが振る舞いを確かめているところと、足りないところ。
  - 良い: 40 シードで性質（ゾーンの外・1 km より離れる・丸め・話し手が続かない）を確かめている。実 SQLite を使う usecase のテスト。IDEM-41（同時 2 要求）と CONC-41（負け側）が実際に衝突を作っている。
  - 足りない: (a) PLAN-1c は「どの行が残るか」を見ていない（`[3,3,3,1,0]` の本数だけ）。同じ移動の中で**近い側が残る**ことを `km` で確かめる。(b) W6 の境界。(c) ゾーンの入口が `km` の 0.05 km 先の候補（丸めてゾーンの外になる）の扱い。(d) `pausesOf` の「拠点が見つからない」ときのフォールバック（`k = cursor`）。ここは見つからないのに `pause = cursor` のまま「残っている」と数える恐れがある。(e) 並びが変わっても気づける固定値（シード 918273 の最初の 5 行の cue を直書き）。`buildChatPlan` の乱数の引き方を変えると保存済みの束と食い違うので、変えたら `CHAT_KEY_VERSION` を上げる合図になる。
  - IDEM-41 は `vi.waitFor` の 50 ms 間隔に頼っている。2 本目が Claude に届く前に判定される恐れは小さいが、`ScriptedChatWriter` が呼び出しを数える前に `await Promise.resolve()` を数回入れるか、2 本目を `setImmediate` の後に出すと確実になる。
- **W9 [chat.routes.test.ts:88-90]** AC-41 が同梱データの鹿ゾーンの位置（268〜273 km）を直書きしている。データの再生成で壊れる。usecase 側のテスト（`dayPlan.zones` から作る）に合わせて、DayPlan から取る。
- **W10 [migrate.ts SCHEMA_VERSION 3]** main に入れるとマージの時点で全 api（Vercel）が、`npm run db:migrate` を流すまで 503 になる。実装者の「残したこと」2 にあるとおり。PR の本文に手順（preview → production の順、流してからマージ）を必ず書く。

### Info（参考）

- **良い点**
  - 層の分け方が既存の規約どおり。domain は `@antler/*` を import せず、`chat-material.ts`（application）で DayPlan を写している。応答は `toDeck` で欄を明示して組み立て、鍵のハッシュ・作成時刻・材料の欄を返さない（SAVE-2c）。
  - 乱数を「候補ごとに必ず 1 回引く」「割り当ては削って並べた後」にしているので、同じ旅は同じ列で、削っても話題・話し手が崩れない。stop-events と混ぜる印も変えている（`0x4348`）。
  - km の丸めが向き付き（入口の手前は切り下げ、出口の先は切り上げ）で、`EPSILON` と合わせて「丸めてゾーンに入る」を防いでいる。`departKm` の `for (;;)` も km が必ず増えるので終わる。
  - 保存の衝突を例外の文言ではなく `rowsAffected === 1` で見分けている。ログに本文・材料・トークンを出していない。ロスの gateway と同じ作りで、`note`（鹿の語・時刻が入る）を Claude に渡さない判断も正しい（マスターの地名に「鹿」は入っていないことを確認した）。
- **順序**（実装者の記録 12）は仕様 R15 と resilience.md の手順 4・5 に合っている。保存済み → 失敗の記憶 → 空の束 → 旅の上限 → 枠 → 1 日の上限 → Claude。単一の `inFlight.get` から `set` の間に `await` が無く、競合しない。拒否された Promise も `.finally` で Map から消える。
- **記憶する理由の読み**（記録 11）。R15 本文は「時間切れ・上流の失敗・認証の失敗は覚えない」と書いており、実装は仕様どおり。実装者が「食い違い」と書いた FAIL-41 とは矛盾しない（FAIL-41 は時間切れの話）。記録の言い方だけ直すとよい。
- **single-flight の合流側**は保存済みを読んだ場合も作った場合も同じ結果を受けるので、同時に来た 2 本目は 201（`Idempotent-Replayed` なし）になる。仕様の AC-41 は逐次の 2 回目なので問題ない。
- **今後の保守**: `REMEMBERED_FAILURES`（usecase の定数）は業務ルールなので `chat-rules.ts` に寄せると `CHAT_FAILURE_MEMORY_MS` と並ぶ。`assemble` の `if (!text)` は検証を通った後は届かない（`validateChatWriting` が空を外す）。`toChatWritingBrief` の `Number(dayPlan.date.slice(5, 7))` は日付の型から月を取るほうが安全。`pausesOf` は stop-events の `pausesOf` とほぼ同じ考えの複製（記録 8 に明記）。
- **鍵に入らない材料**: 天気・路面（`conditions`）、地名・楽しみの名前、`lightPeriod` の結果は鍵（`data.routes`・`data.zones`）に入らない。マスターの conditions だけ更新されると、保存済みの束は古い天気の話のまま返る。仕様どおり（`CHAT_KEY_VERSION` で手動に上げる運用）だが、PR に書いておくと安全。
- **数字の検出の外**: 全角・半角以外の数字（①、Ⅲ、アラビア・インド数字）、ko の位だけの語、ja の「数千」「万円」は通る。R17 の範囲外。
- **ゾーン近傍**: ゾーンの外であれば入口の 50 m 手前でも話の行は置ける（仕様の文言のまま）。depart も 0.2 km の直後にゾーンがあれば置く。R12 の赤の待ちに任せる設計なので問題は出ないが、体感で近すぎるなら `ZONE_MARGIN_KM` を外側にも効かせる案がある（仕様変更）。
- **sim の応答の検証との整合**（`chat-api.ts`）: api の `chatResponseSchema`（strict）の出力は sim の `ChatResponseSchema`（非 strict）に全部入る。欄・列挙・`km >= 0`・`leg` 整数が合っている。ずれ得るのは (a) sim の `lines.max(40)` と api の行の上限（depart は移動の数 + 話の行 10）。1 日の移動が 30 を超えないので実害なし。(b) sim は `id` の形・並び（移動 → km の昇順）・重複を確かめない。`advanceChat` が並びに頼るなら、`parseChatResponse` で昇順を確かめるか、`advanceChat` の側で並べ直す。(c) 2 つの zod が別々に書かれていて、契約を跨ぐテストが無い（sim のテストは手書きの `apiDeck()`）。api の `chatResponseSchema` の例を JSON 化して sim の `parseChatResponse` に通す契約テスト（fixture 1 つ）を足すと、片方だけ直したときに気づける。
- **未実施**: 本物の Claude での確認（記録の「残したこと」3）。C1 を直したあと、数回呼んで外れの理由（`chat.writer.invalid` の `reasons`）を数えると、W2〜W5 の優先度が決まる。
