# セキュリティ監査: stop-events（2026-11-04、security-auditor）

対象: `git diff main...HEAD -- apps/api apps/sim/src/features/stop-events`（ブランチ feat/stop-events）。脅威モデル: `docs/specs/stop-events/threat.md`。コードは読むだけで、直していない。

## 総合評価

- リスクレベル: Medium（Critical なし）
- threat.md の Authorization Matrix と横断チェックは、コードと一致している。確認できたもの:
  - 認可: 両 POST とも、レート制限 → body 上限 → 検証 → UseCase の所有者照合 → 書き込み、の順になっている。Claude を呼ぶ前、DB に書く前に所有者を照合している。
  - トークン: 形が違う・無い・別の旅のトークンは、同じ 403 OWNER_REQUIRED になる。
  - 受け取る欄: events は `z.strictObject` と kind の判別共用体で、知らない欄は 400 になる。choice の計算値は保存した束から写す。位置は leg・km だけ。
  - body は読まない: 束の POST は body を読まない。
  - 参照元の限定: 束に無い sceneId・choiceId は 400。
  - SQL: すべて drizzle のパラメータ化で、生 SQL に文字列を連結していない。
  - ログ: ownerToken、API キー、Claude の本文、イベントの中身を出していない。`owner_required` は公開 ID の tripId だけ。events は件数と kind だけ。
  - エラー応答: `SceneWriterError` のメッセージは固定文で、`reason`（auth など）は応答に出ない。
  - CORS: 許可ヘッダは `X-Owner-Token` の追加のみ。`CORS_ORIGINS` は env で `*` を拒否。credentials は使わない。X-Owner-Token はカスタムヘッダなので、JSON の POST と合わせて preflight が必須になり、CSRF の経路にならない。
  - sim: Claude の文は React のテキストノードで描画している。`dangerouslySetInnerHTML`、localStorage 直書き、console 出力は stop-events 内に無い。

## Critical

なし。

## Warning

- [apps/api/src/application/usecases/stop-events/prepare-stop-deck.usecase.ts:84-98, 206-211 / apps/api/src/di/container.ts:93-95] failed の行は待ち時間なしで即座に再取得でき（`existing.status === 'failed'` は pending の古さの判定を通らず `reclaim` に進む）、そのたびに Claude を最大 2 回呼ぶ（MAX_WRITER_ATTEMPTS）。検証で外れ続ける旅・日があると、所有者は 1 分 10 件 / IP の上限いっぱいまで毎回 Claude の費用を使える。
  - 影響: 1 日の上限（既定 400、全体で共有）を、少数の IP から削れる。上限は plan-trip の旅の作成と共有なので、尽きると新しい旅が作れず 429 DAILY_LIMIT になる（可用性・費用）。CWE-770。
  - 修正: failed の行に冷却時間（例: 30〜60 秒）か、(trip, day) ごとの失敗回数の上限を置く。sim の「5xx は 1 回だけ再試行」とも矛盾しない。
- [apps/api/src/application/usecases/stop-events/prepare-stop-deck.usecase.ts:206-211] 1 日の Claude の枠は plan-trip と 1 つのカウンタを共有していて、用途別の取り分も旅ごとの上限も無い。旅の作成は公開で、ownerToken は誰でも 1 回の POST で手に入る。1 つの旅で「日数 × 最大 2 回」の呼び出しを起こせるので、複数 IP を使えば全体の枠を短時間で使い切れる。
  - 影響: 他の利用者の旅の作成が 429 になる。サービス拒否と費用。CWE-770。
  - 修正: 束側に別の上限（例: 全体の 1 日の取り分の半分まで）、または旅ごとの Claude 呼び出しの累計上限を置く。最低限、ch9 の予算の判断に「共有の枠が尽きたときの挙動」を書く。
- [apps/api/src/application/usecases/stop-events/record-trip-events.usecase.ts:98-110] 5,000 件の上限が「count → insert」の 2 文で、原子的でない。同じ旅への同時の POST は、それぞれが上限の手前と見て挿入できる。超過は最大 同時数 × 50 件。
  - 影響: 上限を数十〜数百件超えるだけで、実害は小さい（保存量は旅 × 5,000 件のまま）。CWE-367。
  - 修正: `INSERT … SELECT … WHERE (SELECT count(*) …) + n <= 5000` を 1 文にする。または「概ね 5,000」とドキュメントに書いて受け入れる。

## Info

- [apps/api/src/application/usecases/stop-events/stop-material.ts:60-95 / apps/api/src/infrastructure/gateways/claude-scene-writer.gateway.ts:117-141] プロンプト注入の経路は見つからなかった。
  - 材料: `toWritingBrief` の値はすべて、zod の enum・マスターの名前・数値・束の slug id。`TripInputSchema` は strictObject で、自由入力の文字列が無い。
  - 再試行の理由: `previousProblems` は `code@path`（コードと添字だけ）で、Claude の出力の中身を折り返さない。
  - 出力側: Claude の出力は json_schema と `validateStopWriting`（id・数・順の一致、言語ごとの文字種、絵文字・時刻・金額記号の禁止）を通ったものだけ保存する。
  - 残る前提: 「自由入力が材料に入らない」ことに依存している。将来 TripInput に自由記述（旅の名前・メモなど）を足すと、この経路が開く。`toWritingBrief` に「文字列は enum かマスター由来」だけを許す契約テストを置くとよい。
- [apps/api/src/domain/stop-events/policies/stop-writing-policy.ts:48-70] 統計・金額の混入の防御は、記号（%・件・円・¥・$）と数字の直後の元・萬・원 などが中心。数字を使わない綴り（"percent"、"yen"、"dollars"、"seventy"）は通る。プロンプトで統計の数字を禁じているので、残るリスクは小さい。気になるなら en の単語（percent、yen、dollar）を FORBIDDEN に足す。
- [apps/api/src/infrastructure/http/routes/trip-event.routes.ts:42-43 / apps/api/src/infrastructure/http/app.ts:73-82] events は JSON の検証が所有者の照合より先なので、トークンの無い呼び出しでも、body が不正なら 403 でなく 400 になる（threat.md AUTH-33 の想定は「有効な body」の場合だけ成り立つ）。
  - 影響: 情報の漏れは増えない。ただし zod の strictObject の「Unrecognized key」は、受けたキー名をそのままメッセージに並べる。最大 32 KB の攻撃者の文字列が、`http.error` のログ（message と stack）に入る。60 件/分/IP で、ログの量が膨らむ。CWE-117 / CWE-400。
  - 修正: `throwOnInvalidTripBody` で issues の数と各メッセージを切り詰める（例: 先頭 5 件・各 200 文字）か、ヘッダの形を先に見て 403 にする。
- [apps/api/src/infrastructure/http/routes/stop-deck.routes.ts:35-39] bodyLimit（1 KB）は、body を読まないルートでは chunked の送信を止めない。ただし body を読まないので実害は無い。
- [apps/api/src/infrastructure/http/middleware/client-ip.ts] TRUST_PROXY の既定が false なので、リバースプロキシの後ろでは全員が 1 つの IP に数えられる。束は 10 件/分で全体が止まる。デプロイ時に TRUST_PROXY の設定を確かめる（plan-trip から続く運用事項で、この feature の新規ではない）。
- [apps/api/src/domain/stop-events/policies/owner-policy.ts:19] `isTripOwner` は SHA-256 の 16 進どうしの比較。元のトークンは時間差から推測できないので問題ない（threat.md の Info のとおり）。
- 旅の存在の秘匿: id の形が違う・旅が無い → 404、旅があってトークンが違う → 403。brief-map の GET で旅の存在はすでに公開なので、新たに漏れる情報は無い（threat.md の意図どおり）。
- 依存パッケージ: この diff で package.json・lock の変更は無い（`@anthropic-ai/sdk` は既存）。監査の対象外。
