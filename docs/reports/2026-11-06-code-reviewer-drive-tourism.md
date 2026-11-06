# code-reviewer: drive-tourism（T1〜T15）

対象: コミット 3ef3eb3 と、その後の未コミットの変更・未追跡ファイル。コードは直していない。
読んだ範囲: api の chats domain / application / gateway / prompt / schema とそのテスト、sim の `chat/`・`hud/recommend*`・`RecommendCard`・`DrivePage`・`drive.css`・`chat-feed.css` とテスト。
テストは実行していない（Bash が使えないため）。指摘はコードの読みによる。

## レビュー結果

### Critical（修正必須）

なし。仕様の T1〜T15 と照らして、境界（空配列・restart・ステージ移行）に壊れる経路は見つからなかった。
確かめた点:

- 候補が空のとき `chosen` は undefined になり、楽しみ以外の話題へ落ちる（`chat-plan-policy.ts:102-103`）。
- 移動が無い日は `lines: []` で、Claude を呼ばずに保存される。
- `pausesOf` は、どの移動の両端にも無い拠点を `legs.length` に置く。cursor を進めず、`legs` が空でも落ちない。
- restart は `f.t < lastT` で初期化される。`advanceRecommend`・`advanceChat` ともに同じ作りで、テストもある（`recommend.test.tsx:82`）。
- ステージ移行は、`stage.index` が変わった時点で `ended` を戻し、その直後に `inside` / `danger` を見る。帯の 2 秒は `stageClearedAt` で待つ。
- 色の直書きなし（`drive` の css に hex・rgba が無い。`palette.ts` は対象外）。
- 絵文字なし。統計の実数の埋め込みなし。Capture まわりの変更なし。

### Warning（推奨）

- W1 [`apps/sim/src/features/drive/components/hud/recommend.ts:6,55` と `StageBanner.tsx:5,9`]
  純粋関数のモジュールが、コンポーネントのファイル（TSX）から `STAGE_BANNER_MS` を import している。
  帯が出ているかの判定も 2 か所に重複している（recommend は `<=` で「出ている」、StageBanner は `> MS` で「消す」。同じ意味だが別々に書かれている）。
  将来どちらかの閾値の扱いだけ変えるとずれる。
  → 純粋なモジュール（例: `stage-banner.ts`）に `STAGE_BANNER_MS` と `isStageBannerShown(t, stageClearedAt)` を置き、両方から使う。

- W2 [`apps/api/src/application/usecases/chats/chat-material.ts:52-54,28-29` と `chat-plan-policy.ts:111-119`]
  `pleasureBrief()` はマスターに楽しみが無いと null を返すが、その行は `topic: 'pleasure'` のまま Claude に渡る。
  プロンプトは「材料の pleasure の name を必ず入れる」と言っているので、材料の無い行に対して矛盾した指示になる。
  `laterStops` は `pleasureById` で絞っているのに、`stops` は絞っていない（非対称）。
  今のマスターと buildDayPlan の組み合わせでは起きにくいが、静かに壊れる。
  → `toChatMaterial` で `stops` も `pleasureById` で絞る。または `pleasureBrief` が null のときに `log.warn` を出す。テストを 1 本足す（存在しない id の stop）。

- W3 [`apps/api/src/domain/chats/policies/chat-plan-policy.ts:101-102`]
  楽しみの「順に回す」は、通し番号 `pleasureCount % candidates.length` で決めている。
  候補の数は移動ごとに変わる（ステージが過ぎると減る、done と later に切り替わる）。
  そのため、候補の集合が変わる移動の境目で、前の移動から引き継いだ回転の位置がずれ、先頭の候補が飛ばされたり順が入れ替わったりする。
  例: leg0 の候補が [A,B] で 1 行出す（A、`pleasureCount` = 1）。leg1 の候補が [B,C] だと、次は添字 1 の C から始まり、B はその後になる。
  1 つの移動に楽しみの行が 2 行以上あれば全候補が出るので、欠落ではなく順のずれ。移動ごとの楽しみの行が 1 行だけの日は B が飛ばされる。
  仕様は「楽しみの行ごとに 1 つ進む」で、候補集合をまたいだ位置の引き継ぎは決めていない。
  → 候補の id ごとに「何回出したか」を持ち、出した回数の少ない候補（同数ならしおりの順）を選ぶ。または、移動が変わって候補の集合が変わったら回転の位置を 0 に戻す。UC-1b に、楽しみの行が 1 行ずつの移動で各候補が出ることを確かめる行を足す。

- W4 [テスト: `chat-plan-policy.test.ts:139-211`、`recommend.test.tsx`]
  テストが振る舞いを確かめきれていない所:
  - UC-1a の「3 分の 2」は `*3 >= ts.length*2 - 2` と緩い。仕様は i mod 3 の厳密な割り当てで、直前の行でそれは確かめている。この緩い行は意味が薄い。
  - UC-1b は `if (first.length >= 2)` と `if (l.timing === 'done')` の条件つき。行が出ないと何も確かめずに通る。`expect(pleasures.some(...)).toBe(true)` を足す。
  - `lengthOf` の境界（2 時間・4 時間）と、`laterStopsOf` の重複除外・その日の楽しみの除外・日の順・3 件の上限（dedupe の後）のテストが無い。
  - UC-2c（応答の schema が pleasure を持つ）は、`chat.routes.test.ts` がペルソナの束を `chatResponseSchema.parse` で通すことで間接的に見ている。ただし `chat.schema.ts:34` の id の正規表現（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）に、マスターの全 `PLEASURES[].id` が合うことは確かめていない。1 件でも大文字・下線の id があると、厳格な応答の schema が本物の束を落とす。→ 「全ての `PLEASURES[].id` が schema の正規表現に合う」を 1 本足す。
  - `RecommendTracker`（通知は変わったときだけ、同じフレームを 2 回進めても同じ）に直接のテストが無い。DrivePage のテストはステージ 1 だけで、ステージ 2 の帯のあとに出る、は結合で見ていない（純粋関数では見ている）。

- W5 [`apps/sim/src/features/drive/chat/chat-text.ts:165-202`]
  見本の会話の楽しみの文が、全 24 の楽しみに同じ 3 種（ラジオは 2 種）。
  「〈名前〉では写真をたくさん撮ろうね」「〈名前〉に着いたら、ゆっくり見て回ろう」は、食事の楽しみ（豚丼・寿司など）や温泉では不自然。
  T9 の範囲では許容されるが、デモ（見本の場面は阿寒湖の 2 件）に出る文は見られる。
  → 少なくとも見本の場面で出る楽しみには合うことを確認する。または、楽しみの種類によらない言い方（「〈名前〉、楽しみだね」系）の割合を増やす。

### Info（参考）

- I1 [`fallback-deck.ts:75-91,114-123`] api は「位置を決める → 並べる → その順で話題を割り当てる」と明記して実装している（`chat-plan-policy.ts:29-32`）。見本は生成の途中で `talkIndex` を数え、あとで sort する。ゾーンの手前へ動かした行が前の行より手前に出ると、画面の順と i mod 3 がずれる（長いゾーンの場合だけ）。見本なので実害は小さい。
- I2 [重複の定数] `PLEASURE_CYCLE`（api の `chat-rules.ts` と sim の `fallback-deck.ts`、コメントで同期を促している）、`DEER_WORD`（api の `chat-writing-policy.ts:45` と sim の `tourism.ts:41`）。パッケージをまたぐので許容。`packages/trip` に置く案はあるが凍結外の変更になるので、今は不要。
- I3 [`ChatFeed.tsx:52-53` と `chat-feed.css:79-80`、`drive.css:272`] 写真の寸法（64x48、112）が tsx の属性と css の両方にある。css が正で、属性は CLS 対策。数字を定数にするより、コメントで「css と合わせる」と書く程度で足りる。
- I4 [`RecommendCard.tsx`] `ChatFeed` は `memo` だが `RecommendCard` はそうでない。`DrivePage` が約 10 Hz で描き直すたびに再描画される（カードが出ていない間は `null` を返すだけで安い）。出ている間も DOM の差分は無いので実害は小さい。`memo` を付ければ足りる。
- I5 [`RecommendCard.tsx:46,30`] eyebrow の文字と `aside` の `aria-label` が同じ文なので、読み上げで 2 回聞こえる可能性がある。`aria-labelledby` で eyebrow を指す案。
- I6 [`recommend.ts:73-77`] 区切りの地点を「道のりの比で route の添字を決める」自前の関数で出している。route は 20 m ごとに打ち直してあるので正確だが、`@antler/trip` の `pointAtKm` と二重の知識になる。性能の理由（毎回 O(n) にしない）があるなら、そのコメントを足す。
- I7 [`chat-api.ts:29-32`] `pleasure` は `topic` によらず通す。`topic !== 'pleasure'` の行に id が付いても写真が出る。api が計画から付けるので起きないが、`topic === 'pleasure'` のときだけ通す方が api の契約（T6）と合う。
- I9 [`chat-feed.css:36-41` と `functional.md` T14] 仕様の「会話の列は下を揃えずに上から積み」と、`.drive-chat` 内側の `justify-content: flex-end`（はみ出したら上を切るための指定）は、文面では逆に読める。外側の列は `flex-start` で仕様どおり。内側の意図をコメントにするとよい（UC-3e も内側の指定は見ていない）。
- I8 [書類・マージ前に対応] `chat-plan-policy.ts:31` の冒頭コメントは「同じ話題・同じ人を続けない」のまま（T1 で楽しみの行どうしは続いてよいと緩めた）。`functional.md` の Test List のチェックがすべて `[ ]` のまま（受け入れ基準は「全項目にチェック」）。T5 の「名前を必ず入れる」は検証しない（仕様どおり。プロンプトの文があることだけを確かめる）。

### 良い点

- 楽しみの割り当てが純粋関数で、`domain` は `@antler/*` を import していない。application が値を写す境界が守られている。
- `assemble` が `pleasure` を計画から取り、Claude の出力から取らない（AUTH-T1）。`toDeck` も欄を明示して組み立てる。
- 鍵の版を上げるだけで済ませ（`chat:v2`）、表を変えない判断と、そのテスト（FAIL-T1）がある。
- 応答の確かめ（`chat-api.ts`）は、`pleasure` が無い応答・マスターに無い id でも壊れず null に寄せる。テストもある。
- UC-3d がマスター全件に対して、名前・拠点の地名・差し込んだ文に数字・鹿の語・絵文字が無いことを確かめている。
- おすすめの出しどき（`advanceRecommend`）が純粋関数で、restart・ステージ移行・赤・ゾーンの各表が短いテストで読める。
- `RecommendTracker` が「出すものが変わったときだけ通知」で、10 Hz の描き直しを避けている。State設計がコメントで宣言されている。
- 操作要素なし・`alt=""`・`aria-live` を使わない・`prefers-reduced-motion` の扱い・色が CSS 変数だけ、という MUST が守られている。
