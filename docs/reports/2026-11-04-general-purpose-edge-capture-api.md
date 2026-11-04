# edge-capture: apps/api `POST /api/captures` 実装報告

日付: 2026-11-04 / 範囲: `apps/api` の captures のみ（コミットしていない・`git add` もしていない）

## 結果

- `npx vitest run`: 22 ファイル・210 件 Green（このうち新規 73 件。既存 137 件は変わらず Green）
- `npx tsc --noEmit`: エラー 0 / `npx eslint src/`: エラー 0 / `prettier --check src tests`: 通る
- カバレッジ（trip-day.routes.test を除く 21 ファイル）: 全体 lines 97.4%・branches 90.8%。`domain/captures/rules` 95.8%
- 注意（既存の問題）: `trip-day.routes.test.ts` の AC-1（と、負荷が高いときは AUTH-2）が 5 秒のタイムアウトで落ちることがある（`--coverage` で 18 秒、並行セッションで負荷が高いと単独でも 6.6 秒）。captures を渡さないテストで、captures とは無関係。それ以外の 21 ファイル・205 件は常に Green。`local-ci` の vitest は `--coverage` なし
- `python scripts/ci_arch_check.py`: 違反なし。`npx eslint tests/factories/captures.ts`: エラー 0
- `docs/specs/edge-capture/resilience.md` の差分は 1 行（FAIL-7 の `ServerError` → `CaptureServerError`）。私の変更ではない（edge 側の実装に合わせた別セッションの修正と思われる）

## 作ったファイル（apps/api）

domain

- `src/domain/captures/errors/capture-errors.ts`（CaptureInputError・ConsentRequiredError・InvalidImageError・CaptureConflictError・StoreFullError）
- `src/domain/captures/models/capture-image.ts`（画像の判定結果の型・拒否理由）
- `src/domain/captures/rules/capture-rules.ts`（定数: 8 KB・1 MB・1.25 MB・16〜2048 px・id 40 文字・key の形）
- `src/domain/captures/rules/capture-image.ts`（`inspectCaptureImage`。A3 の全規則。例外を投げない）
- `src/domain/captures/policies/capture-identity-policy.ts`（key・論理パス・実ファイル名・正準 JSON・本文ハッシュの材料・再送の判定）

application

- `src/application/ports/repositories/capture.repository.ts`（`create`・`find`・`stats`）
- `src/application/ports/security/bytes-hasher.ts`（新しい技術ポート。下の判断 1）
- `src/application/usecases/captures/{submit-capture.usecase.ts, dto.ts}`

infrastructure

- `src/infrastructure/repositories/file-capture.repository.ts`
- `src/infrastructure/security/node-bytes-hasher.ts`
- `src/infrastructure/http/schemas/capture.schema.ts`
- `src/infrastructure/http/routes/capture.routes.ts`

差分（独立したブロックだけ）

- `src/infrastructure/http/error-mapper.ts`（5 例外 → INVALID_INPUT 400 / CONSENT_REQUIRED 422 / INVALID_IMAGE 400 / CAPTURE_CONFLICT 409 / STORE_FULL 503）
- `src/infrastructure/http/app.ts`（`captures?: CaptureRoutesDeps`）
- `src/infrastructure/config/env.ts`（CAPTURES_DIR / CAPTURES_MAX_ITEMS / CAPTURES_MAX_BYTES）
- `src/di/container.ts`（組み立て）、`.env.example`（3 行）、ルートの `.gitignore`（`data/captures-received/`）
- 既存テストの追従: `src/infrastructure/config/env.test.ts`（既定値の toEqual に 3 項目）、`src/di/container.test.ts`（`CAPTURES_DIR` を一時ディレクトリに向ける 1 行。向けないと既存テストが `apps/api/data/` に作る）

テスト・ビルダー

- `tests/factories/captures.ts`（合成 JPEG/PNG・Capture・multipart・メモリ Repository）
- テスト: `capture-image.test.ts`、`capture-identity-policy.test.ts`、`submit-capture.usecase.test.ts`、`file-capture.repository.test.ts`、`capture.routes.test.ts`、`container.captures.test.ts`

## Test List の網羅

AC-2、API-1a〜o、IMG-1a〜f、AUTH-1〜6、IDEM-1・2、CONC-1、FAIL-8（テスト名に ID を入れた）。

## 仕様のあいまいさで決めたこと

1. **画像の sha256 用に `BytesHasher` ポートを足した。** 既存の `Hasher.sha256Hex(text: string)` は文字列用。`Hasher` を広げると他のセッションと衝突するので、`ports/security/bytes-hasher.ts` と実装 `node-bytes-hasher.ts` を別に作った。本文ハッシュの計算（canonical JSON + `\n` + 画像 sha）は従来の `Hasher` を使う。
2. **JFIF の無い JPEG（APP0 なし）は通す。** A3 の「APP0 は JFIF の 1 つだけ」を「あれば JFIF 1 つ・サムネイル 0×0・長さ 16 ちょうど。無いのは可」と読んだ。メタデータは無いため。
3. **image の絶対パスは HTTP の層で 400。** 凍結の `CaptureSchema.image` の正規表現は `/etc/passwd.jpg` のような絶対パス（拡張子つき）を通してしまう。AUTH-3 の「絶対パス → 400」を守るため、`capture.schema.ts` で `image` が `/` で始まるものを拒否した（`CaptureSchema` は変えていない。保存には元々使わない）。
4. **画像が 1 MB 超は 400 `INVALID_IMAGE`（理由 `too_large`）。** 本文が 1.25 MB 以内で画像だけ 1 MB 超のとき。413 は本文全体の超過のみ。
5. **400 `INVALID_INPUT` の message に欄名と規則を入れた**（例 `入力が正しくありません: 知らない欄: lat`）。送られた値は入れない・300 文字で切る。ログの `http.error` には汎用文だけが残る（issues は mapper でだけ組み立てる）。
6. **STORE_FULL の判定は「保存済み >= 上限」。** 入ってくる画像の大きさは足さない（A5 の「以上」のとおり）。同じ id の再送（200 replay）は空きの確認より前に判定するので、満杯でも通る。
7. **件数・バイト数の数え方。** 起動時にディレクトリを走査し（`.json` の数と、画像ファイルの合計。JSON の無い孤児の画像も数える＝やや多めに数える）、保存のたびに「JSON のハードリンクを取れた側」が 1 回だけ加算する。起動時に `.tmp-*` の孤児も消す。
8. **`capture.received` は成功（201/200）のときだけ出す。** 失敗は既存の `http.error`（path・status・汎用エラー）で残る。フィールドは `id`・`source`・`imageBytes`・`status` のみ。
9. **画像の掃除は「JSON の取り合いに負けた」経路だけ。** 画像を自分が作り、JSON のハードリンクが EEXIST で負けたとき、既存 JSON の `file` が自分の画像名と違えば画像を消す。既存が読めない（壊れた JSON・ディレクトリ）ときは 409 側（本文ハッシュ null）。書き込みの例外（ディスク満杯など）では画像を消さない: 同じ画像 sha を共有する並行要求の JSON から画像を奪わないため。resilience.md の「画像だけ残る → 同じ中身の再送が EEXIST を無視して JSON を作り直す」に従う。一時ファイルは常に消す。
10. ルートは `parseBody` の失敗（壊れた multipart）を `.catch` で `CaptureInputError` にして 400 にしている（error-mapper に任せると 500 になるため）。

## 補足（呼び出し元向け）

- テストの factory は `node:zlib` の `crc32`（Node 22.2 以降）を使う。CI は node 22、engines は >=22。
- 実装中に `tests/factories/captures.ts` へ Bash の追記（`cat >>`・python 置換）を 1 回使った（`src/` ではなくテストのビルダー。hook の対象外）。以降は Edit/Write のみ。
- `env.test.ts` の既定値 toEqual は、ほかのセッションが env を足すたびに衝突しやすい。マージ時に統合が必要。
- 実サーバー（ポート）は起動していない（`app.request` のテストのみ）。
