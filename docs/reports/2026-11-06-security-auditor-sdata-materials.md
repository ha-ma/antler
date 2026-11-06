# セキュリティ監査: コミット 742726f と Git 対象外データ（2026-11-06）

対象: コミット 742726f、dataset/private/mapillary-doto/、dataset/external/deer3d/。読み取りのみ。

## Critical

なし。

## High

なし。

## Medium

なし。

## Low

- L1 [コミット 742726f の Author 行] git の author メールアドレス（個人の Gmail）がコミットメタデータに入る。通常の Git の挙動で、今回の変更による新規の漏れではない。公開リポジトリにする場合は noreply アドレスの利用を検討（CWE-359）。
- L2 [manifest.json] `creator_username`（39 人）、`sequence`、`month`、`area_rough`（0.1 度）が残る。CC BY-SA の帰属表示に必要で、`not_recorded` の方針と矛盾しない。再配布や公開する場合は帰属表示の目的以外に使わない。
- L3 [~/.config/antler/mapillary_token] 権限は 0600 で適切。リポジトリ外にある。取得 API が動かないため使わないなら失効を検討。

## 確認結果

1. 秘密・個人情報（コミット 742726f）
   - Mapillary トークン: コミット全文と manifest.json に同じ文字列は無い（grep 一致 0、トークン長 54）。
   - 緯度経度らしき数値、MLY トークン形式、機種名（make / model、主要メーカー名）、`/Users/` パスはコミットに無い。
   - メールアドレスは author 行のみ（L1）。
   - 変更ファイルは CREDITS.md、dataset/README.md、docs/reports、ch9-decisions.md、roadmap.md の 5 つ。dataset/private と dataset/external のファイルはコミットに含まれない（`git ls-files` で該当なし）。
2. Git の対象外: `git check-ignore -v` で両方とも対象外（.gitignore:52 の `dataset/private/`、:50 の `dataset/external/`）。メインのチェックアウトで確認。
3. manifest.json（Mapillary）: キーは area_rough、attribution、camera_type、creator_username、image、image_id、month、region、sequence、sha256、size、source_page_url、source_sha256 のみ。緯度経度、captured_at、make / model、creator_id は無い。area_rough 1,500 件すべてが 0.1 度に丸め済み。
4. 画像 1,500 枚: JPEG のセグメントを SOS まで全件解析した。残るのは SOF2（C2）、DHT（C4）、DQT（DB）、APP0（JFIF）のみ。APP1（EXIF・XMP）、APP2（ICC）、APP13（IPTC）、APP14、COM は 0 件。EOI の後ろの追加データも、複数の SOI も無い。manifest 記載の sha256 と 1,500 件すべて一致し、未記載のファイルも無い。先頭 64KB 内で「GPS」の 3 バイトが偶然ヒットしたファイルが 6 件あったが、ヘッダ外の圧縮画素データ内で、メタデータではない（偽陽性）。
5. deer3d: manifest.json の files と license_evidence の 24 件の SHA-256 がすべて一致（不一致 0、欠落 0）。manifest に載っていないファイルも無い。

## 総合評価

- リスクレベル: Low
- 推奨アクション: 対応必須の項目なし。画像を共有・公開するときは CC BY-SA 4.0 の帰属表示と、ch6 の許可リスト外であること（評価専用）を守る。
