# セキュリティ監査: record（fc970a2..HEAD）

対象: apps/api の record（routes・usecases・views・repository）、apps/sim の record と plan-trip の所有者トークン、依存 @resvg/resvg-js。
方法: コードの読み取り、threat.md との突き合わせ、既存テスト（record.routes.test.ts）の確認、`npm audit --omit=dev`（0 件）。
パスは `apps/api/src/` を省略して書く（sim は `apps/sim/src/`）。

## セキュリティ監査結果

### Critical（即時対応）

なし（0 件）。

### High（早期対応）

なし（0 件）。重点 6 項目のどれにも、確信をもって High と言える欠陥は見つからなかった。

### Medium（計画的対応）

- [M1] [infrastructure/http/views/og-image-renderer.ts:61, routes/record.routes.ts:123-128] OG 画像の描画枠を使い切る可用性攻撃 | CWE-770 / CWE-400
  - 攻撃: キャッシュに無い鍵（旅の id・run 数・seq）が 2 件同時に描画中だと、3 件目以降は誰でも 503 OG_BUSY になる。IP ごとの上限（20/分）は IP を替える攻撃者（IPv6 の別 /64、複数の IP）には効かない。TRUST_PROXY=false のまま Cloudflare 等の裏に置くと、全利用者が同じ IP の枠を共有して自滅もする。
  - 影響: 共有直後に SNS のクローラーが 503 を受け取ると、カードの画像が出ないまま一定時間キャッシュされることがある（共有が A-7 の主目的）。
  - 修正: 待ち行列に入れて短く待つ（枠が空くのを数百 ms 待つ）。503 に `Retry-After` を付ける。同じ鍵の描画中は 1 本にまとめる（in-flight の Promise を共有）。デプロイの手順書に TRUST_PROXY の設定を明記する。

- [M2] [docs/specs/record/threat.md「残る課題」, routes/record.routes.ts:85-128] 共有する ID が、旅の読み取り権（予算・seed・TripDetails を返す `GET /api/trips/:id/day/:n`）と同じ | CWE-200 / CWE-639
  - 攻撃: 記録の URL を SNS で受け取った人が `/api/trips/{id}/day/1` を叩き、一人あたり予算・seed・リスク・日ごとの詳細を読む。URL はクローラー・SNS のログ・転送先に広く残る。
  - 影響: 個人は特定されないが、「見せる欄を絞った」（recordTripOf）設計の効果が、同じ id で別の API が全部返すために消える。失効の手段は「削除」だけ。
  - 修正: 仕様の判断（推奨で決定）は承知のうえで指摘する。ハッカソン後に、記録用の別の乱数 ID（`shareId`）を発行し、`/t/:shareId` と `/api/records/:shareId` はそちらだけを受ける。急ぐなら、`GET /day/:n` の応答から予算を外す。

### Low

- [L1] [routes/record.routes.ts:57-58] レート制限の保存先が route ごとに別（`limit()` を呼ぶたびに新しい Map）。runs の POST と DELETE が別々に 10/分 ずつ数えられ、「書き込み 10/分/IP」「トークン総当たり 10/分」の実効が 20/分になる（threat.md の表の記述とずれる）。トークンは 256 bit なので実害は無い。修正: `limit(...)` を 1 回作って writes の 2 route で共有する。
- [L2] [infrastructure/http/middleware/rate-limit.ts:56-59, middleware/client-ip.ts:最後の行] 既存の挙動だが record で公開 GET が増えて影響が大きくなった。(a) 鍵が取れないとき全員が `'unknown'` の 1 つの枠を共有する、(b) 鍵が 10,000 を超えると古い順に忘れるので、多数の IP から送ると他人の計数を押し出せる。修正: 本番で `unknown` が出たら警告ログ。プロキシの前段（Cloudflare 等）でも制限を掛ける。
- [L3] [routes/record.routes.ts:90-96 の delete 後, og-image-renderer.ts:33] 削除した旅の PNG がプロセスのメモリに残る（最大 100 枚、再起動か押し出しまで）。応答には出ない（読み出しのたびに DB を引く）ので threat.md は許容しているが、「削除は即時」の文言とはずれる。修正: `OgImages` に `evict(tripId)` を足し、DeleteTripUseCase の成功後に呼ぶ（鍵を `tripId` ごとに持てば簡単）。
- [L4] [infrastructure/repositories/drizzle-record.repository.ts:74-79] 削除は論理的には完全（run・冪等キーの行・旅を 1 トランザクションで消す。`trip_requests.trip_id` で絞っている）。ただし SQLite はページ内に値が残る（`secure_delete` 既定 OFF、WAL・バックアップにも残る）。修正: 接続時に `PRAGMA secure_delete = ON`、バックアップの保持期間を README に書く。
- [L5] [infrastructure/config/env.ts:22-26 の publicOrigin] `http://` を本番でも許し、既定が localhost。本番で `PUBLIC_API_URL` を付け忘れると、og:url・og:image が localhost を指す（機密の漏れではなく機能の不具合）。修正: `NODE_ENV=production` のとき `https://` を要求し、既定値のままなら起動を失敗させる。
- [L6] [apps/api/package.json の @resvg/resvg-js ^2.6.2] 2.6.2 から新しい版が出ていない（保守が止まり気味）。`npm audit` は 0 件で、既知の CVE は見つからなかった。SVG は自前で組み、外部参照（`<image>`・`href`）も持たないので、悪意のある SVG が入る経路は無い（escapeXml・制御文字除去・固定のフォント名）。ライセンスは MPL-2.0（ファイル単位のコピーレフト。改変せずに使うので問題なし、CREDITS に書く）。修正: lock を維持し、PNG 化の入力を今のまま「自前のテンプレートだけ」に保つ。`loadSystemFonts: true`（OG_FONT_FILES が空）の本番は、OS の全フォントを読むので起動時間が伸びる。フォントのファイルを指定する運用を推す。
- [L7] [apps/sim/src/features/plan-trip/hooks/useCreateTrip.ts:17-25, 所有者トークンの localStorage] 同一 origin の XSS が 1 件あればトークンを読まれて旅を消される。threat.md が受け入れ済み（失効手段は削除のみ）。sim の CSP（本番ビルドの CSP）を維持することが前提。トークンはログに出ない（`record.save.failed`・`record.delete.failed` は status だけ）ことを確認した。

### Info（問題なし・確認した点）

1. SSR の注入（CWE-79）: `hono/html` のタグ付きテンプレートで本文・属性とも自動エスケープ。`raw()` は定数の `STYLE` だけ（tokens 由来の固定値）。`class="tone-${l.tone}"` は列挙値。`<script>` は無く、CSP は `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`。Hono の secureHeaders は CSP を設定しないので route 側の値が上書きされない。noindex は X-Robots-Tag と meta の両方。Referrer は meta で `strict-origin`（パスの id は外に出ない）。リンク先 URL は env の正規表現（`^https?://[^/\s]+$`）を通り、`javascript:` は入れられない。入力はタイトルでも列挙値と Slug だけで、自由記述の入力が無い（Claude の生成物を信用せずエスケープする設計は妥当）。
2. Host ヘッダ: `c.req.url`・`Host`・`X-Forwarded-Host` を読む箇所は無く、og:url・og:image・リンクは env だけ（UC-7e のテストあり）。
3. OG の SVG: すべての文字が `escapeXml`（`& < > " '` と制御文字）を通る。数値は `String(number)`。フォント名・色は定数。`fitText`/`wrapText` で長さを制限。
4. 所有者トークンの照合（CWE-639/287）: 形（64 桁の小文字 16 進）が違えば 401 で照合しない → id の形が違えば 404 → 旅が無ければ 404 → ハッシュ不一致は 403。401 を先に返すので、トークン無しでは存在の区別がつかない（403 と 404 の区別は、公開 GET で ID の存在が分かるので許容）。比較対象は SHA-256 の 16 進どうしで、空文字・長さ違いは false。旅の id はパスからだけ、run の PK は（tripId, runId）、別の旅の runId と衝突しない。IDOR は成立しない（テスト IDOR-1）。
5. 書き込みの検証: `DriveRunInputSchema` は strictObject で、tripId・createdAt・seed を受け付けない。body は 16 KB（bodyLimit は content-length とストリームの両方を数える）。1 日 20 件、`day <= plan.days.length`。同じ runId の再送は保存済みを返し、内容は上書きしない。cors の `allowHeaders` に Authorization を足しただけで、origin は許可リスト。Cookie が無いので CSRF は成立しない。
6. 削除: 照合と 3 つの DELETE が同じトランザクション。`deleted !== 1` なら巻き戻す。応答は 204 と `no-store`。以後は 404。OG は読み出しごとに DB を引くので、削除後に返らない。
7. ログ: アクセスログは method・path・status・ms だけ。Authorization・ownerToken・run の中身は出ない。`http.error` は error.message と stack を出すが、zod の issue はパスとメッセージで値を含まない。
8. 偽の記録: 所有者は自分の旅に好きな run（衝突なし等）を送れる。自分の記録だけなので脅威ではない（Info）。

## 総合評価

- リスクレベル: Low〜Medium（Critical 0・High 0・Medium 2・Low 7）
- 推奨アクション（優先順）:
  1. M1: OG の描画の枠切れで 503 を返す前に短く待つ、同じ鍵の描画をまとめる（共有カードが出ないのが一番ありそうな失敗）
  2. L5: 本番の `PUBLIC_*_URL` が既定のままなら起動を止め、https を要求する（デプロイの設定ミス対策）
  3. L1: 書き込みのレート制限を 2 route で共有する（threat.md の表と一致させる）
  4. L3: 削除時に OG のメモリの画像を消す
  5. M2 は仕様で受け入れ済み。ハッカソン後に共有用の別 ID に分ける
- マージのブロッカーは無い（Critical 0）。
