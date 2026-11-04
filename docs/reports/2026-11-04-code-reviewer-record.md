# code-reviewer: record（A-7 旅の記録）

対象: `git diff fc970a2..HEAD` の packages/trip/src/record/・apps/api の record 関連・apps/sim/src/features/record/。
仕様: docs/specs/record/（functional.md・threat.md・resilience.md）。

注意: このレビューは Read / Grep だけで行い、テストと型チェックは実行していない。読んだのは summary.ts、run.ts、save-run / delete-trip / get-trip-record の各 usecase、drizzle-record.repository.ts、record.routes.ts、og-image-renderer.ts、shiori-svg.ts、text-fit.ts、schema.ts / migrate.ts、drizzle-unit-of-work.ts、rate-limit.ts、record-usecases.test.ts、sim の hooks 3 本。record-page.ts、trip-view.ts、view.ts（一部だけ）、sim の components は未読か一部だけ。

## レビュー結果

### Critical（修正必須）

なし（0 件）。

仕様の R2・R3・R6・R10 に反する挙動、認可の抜け、情報の漏れは、読んだ範囲では見つからなかった。

- 所有者の照合: `owner-policy.ts:9-16`。長さ一定の比較で、先に形を確かめている。
- run の保存: `save-run.usecase.ts:65-80`。照合・日数・冪等・件数・挿入を 1 トランザクションで行う。
- 削除: `delete-trip.usecase.ts:35-41` と `drizzle-record.repository.ts:74-79`。trip_runs / trip_requests / trips を 1 トランザクションで消し、`deleted !== 1` で戻す。
- 集計: `summary.ts:73-149`。ON の最新を優先し、OFF は `offResult` に分ける。

### Warning（推奨）

1. 並行書き込みの保証が実証されていない
   - 場所: `apps/api/src/infrastructure/db/drizzle-unit-of-work.ts:12`、`apps/api/src/application/usecases/record/save-run.usecase.ts:71-74`
   - 理由:
     - resilience.md は「SQLite の書き込みは 1 本ずつ」を根拠に、1 日 20 件の上限と冪等を件数確認＋挿入で守るとしている。
     - `db.transaction` は libsql の既定モード（私の記憶では deferred。コードでは未確認）で、読んでから書く形になる。
     - ファイル DB で 2 つのタブが同時に POST すると、後から書くほうが SQLITE_BUSY で 500 になるか、上限を超えるかもしれない。
     - 同時に走る SaveRun と Delete、または SaveRun 同士のテストは無い。CONC-1 のテストは逐次実行で、`Promise.all` を使う並行テストが record にはない（`drizzle-trip.repository.test.ts:105` にだけある）。
   - 直し方:
     - `Promise.all([saveRun, saveRun])` に同じ runId と 21 件目を流す並行テストを、ファイル DB で足す。
     - 落ちるなら、`client.transaction('write')` で始めるか、busy を再試行する。
     - 通るなら、通る理由を unit-of-work.ts にコメントで残す。

2. 保存済みの同じ runId の行が壊れていると 500 になる
   - 場所: `drizzle-record.repository.ts:20-23,29-37`、`save-run.usecase.ts:71,77-78`
   - 理由:
     - `findRun` は `DriveRunInputSchema` に合わない行を null として返す。
     - そのため、壊れた行と同じ runId の再送は、`findRun` が null（既存なし）→ `insertRun` が conflict で null → `findRun` がまた null → `throw new Error(...)`（500）になる。
     - 上限の数え上げ（`countRuns`）は壊れた行も数える。
     - FAIL-1 は読み出しだけをテストしていて、書き込み側が抜けている。
   - 直し方: `findRun` の失敗を「壊れた行」として区別し、再送なら 200 の代わりに専用エラー（409 など）にする。または壊れた行は上書きしない旨をログに出して、中身を返さず `replayed` で返す。テストを 1 本足す。

3. 同じ記録の OG 画像を同時に取られると、片方が 503 になる
   - 場所: `og-image-renderer.ts:53-75`
   - 理由:
     - キャッシュは描き終わってから入る。
     - 新しい run の直後に SNS のクローラーが同じ URL を複数同時に取ると、同じ鍵のミスが 2 枚の枠を埋める。
     - 3 件目の同じ鍵は 503 `OG_BUSY` で、共有カードに画像が出ない。
   - 直し方: 描画中の Promise を鍵ごとに共有する（single-flight）。

   ```ts
   private readonly inflight = new Map<string, Promise<Png>>()
   // cache ミスのとき
   const running = this.inflight.get(key)
   if (running) return running
   ```

   同じ鍵は 1 枠しか使わず、完了時に `inflight` から消す。UC-6c のテストの隣に「同じ鍵の同時要求は描画 1 回」のテストを足す。

4. OG のメモリの鍵が旅の中身に依存している
   - 場所: `record.routes.ts:125`、`get-trip-record.usecase.ts:42`
   - 理由:
     - 鍵は `trip.id:runs:lastSeq` で、plan・lang・描画コード（SVG のレイアウト）は入っていない。
     - 今は旅が不変で、プロセスの再起動でキャッシュも消えるので動く。
     - ただし将来、旅の更新・言語の変更・壊れた run の復旧（`runs` は有効な行だけを数える）が入ると、古い画像が返る。
   - 直し方: 鍵を組み立てる関数を 1 つにして、「旅が不変であることに依存する」とコメントする。または `created_at` か plan のハッシュを鍵に足す。

5. レート制限の枠が経路ごとに別になっている
   - 場所: `record.routes.ts:57-58,66,85,90,98,123`
   - 理由:
     - `limit(...)` を呼ぶたびに `rateLimit` が新しい Map を作る。
     - POST runs と DELETE は別々の 10/分、record と `/t/:id` は別々の 60/分になる。
     - 仕様 R12 は「書き込み（runs・DELETE）10 件」「読み出し（record・`/t/:id`）60 件」と読めるので、合算の意図ならずれている。
     - トークン総当たりへの効果は倍になるだけで、256 bit なので実害は小さい。
   - 直し方: 合算の意図なら `const writeLimit = limit(10)` を 1 つ作って共有する。別枠の意図なら R12 に「経路ごと」と書く。routes のテストで 12 件目が 429 になるのを、DELETE と POST の混合でも確かめる。

6. 検証の順が仕様の記述とずれている
   - 場所: `record.routes.ts:67-77`
   - 理由:
     - `zValidator('json', ...)` が認可より前にあるので、トークン無しで body も不正な要求は 401 でなく 400 になる。
     - 実害は小さいが、AUTH-1 のテストは body が正しい前提。
   - 直し方: テストに「トークンなし＋不正な body」の期待値を 1 行足して、どちらを正とするか固定する。

### Info（参考）

- `summary.ts:73-149`:
  - 集計の規則は R3 どおり。
  - UC-2a〜2h と「日数を超える run は数えない」のテストがある。
  - 空の plan（days が空）では `days.every` が true になるが、`latestRuns.length === 0` が先に効いて not-started になる。
- `summary.ts:96-102`: 同じ楽しみが 2 日にあると、最初の日だけで `protected` を決める（仕様どおり）。1 日目が衝突で 2 日目が完走だと、同じ楽しみが「守れていない」と出る。仕様の挙動なので、画面で気になるなら仕様側の見直し。
- `delete-trip.usecase.ts` と `trip-identity` の関係:
  - 所有者トークンは冪等キーの HMAC なので、削除して同じキーで作り直すと同じトークンが新しい旅の所有者になる。
  - UC-5b のテストが `again.ownerToken === a.ownerToken` で明示している。
  - 削除した旅のトークンが失効しない、という点を threat.md の「失効」の表に 1 行書くとよい。
- `view.ts:155-158`: OFF の日に `offResult` を足して二重表示にならないよう `alertEnabled !== false` で絞っている。
- `og-image-renderer.ts`: 使った順に並べ直す LRU（100 枚）で、`finally` で枠を戻すので、描画が例外でも枠が漏れない。
- テストの抜け: `apps/api/src/infrastructure/http/views/` に直接のテストファイルが無い。`shiori-svg` / `text-fit` のテストは `record.routes.test.ts` の UC-6a/6d にまとめてある。単体でも 1 本ずつ持つとよい（`text-fit` の `wrapText` は結合文字・絵文字・空文字・maxLines=1 の境界が未確認）。
- sim の hooks:
  - `useTripRecord` の再試行は「通信失敗か 5xx を 1 回」で、resilience.md の表と合っている。
  - `saveRun` は `DriveRunInputSchema.parse` が `ZodError` を投げる（`RecordApiError` ではない）。呼び出し側が型で区別できるよう、`RecordApiError(null, 'INVALID_RUN')` に包むと扱いやすい。
  - 削除成功後、`recordQueryKey` のキャッシュを破棄していることは確認していない（`RecordPage` は未読）。

## 良い点

- 層の分離が CLAUDE.md の規約どおり。domain は純粋で、usecase は `UnitOfWork` と ports だけに依存し、HTTP の知識は error-mapper に閉じている。
- 公開 URL を env だけから作り、`Host` を使わない。XSS 対策も CSP・エスケープ・`stripControl` の多重になっている。
- 記録 JSON が `RecordTrip` に絞られ、IDOR-2 のテストで runId・ハッシュ・予算・seed が出ないことを確かめている。
- 削除のテストが `h.rowsOfTrip` で複数の表の行を確かめ（`sqlite_master` の列挙かは `tests/factories/record-harness.ts` を未読のため未確認）、FAIL-2 でトランザクションの巻き戻しも確かめている。
