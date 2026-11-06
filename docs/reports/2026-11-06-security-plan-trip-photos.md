# セキュリティ監査: plan-trip-photos（2026-11-06）

対象: apps/sim/scripts/fetch-photos.ts、utils/photo-rules.ts、utils/photos.ts、components/PhotoCredit.tsx、apps/sim/public/photos/*.jpg（24 枚）、apps/sim/vite.config.ts の CSP、packages/trip/src/input.ts（weight 任意化）。通信は行っていない（読み取りのみ）。

## 結論

Critical 0 / Warning 4 / Info 4。リスクレベル: Low。通信先の制限・リダイレクト拒否・受信中の上限・先頭バイト判定・保存名・外部リンク・CSP の整合は妥当。

## Critical

なし。

## Warning

1. [photo-rules.ts:90-108 stripJpegMetadata] 除去が拒否リスト（APP1・APP13 のみ）。APP3〜APP12・APP14・COM（0xFE）は残る。EOI 後ろの追加データ（MPF や埋め込みサムネイルの後続）も残る。CWE-212 / CWE-200。
   - 実測: 同梱 24 枚は APP1/APP13 とも 0 個。残るのは APP2（ICC。24 枚中 10 枚）だけで、末尾は FFD9 で終わる。いまのファイルに実害はない。
   - 修正: 許可リスト方式（APP0・APP2 と DQT・SOF・DHT・SOS 以降だけ残す）にする。EOI で切る。COM も落とす。
2. [fetch-photos.ts:218 manifest の書き込み] 一部の取得に失敗しても photos.json を成功分だけで上書きする。前回の記録にある写真が記録から消え、public/photos/ に帰属表示の無い画像が残りうる（CC BY の表示義務の漏れ）。CWE-693。
   - 修正: 失敗が 1 件でもあれば manifest を書かない。または既存の記録とマージする。さらに「public/photos/*.jpg と photos.json が 1 対 1 で、sha256 が合う」ことを CI のテストで確かめる（現状、sha256 を照合するテストは見つからなかった）。
3. [photos.ts:34-35 width/height] 幅は 800 以下だが高さの上限が無い。PNG は IHDR の値を信じるだけ。2 MB 以内でも巨大な高さを宣言する画像（展開爆弾）を同梱できる。取得時（fetch-photos.ts:172）も幅しか見ない。CWE-400。
   - 修正: height も上限を置く（例 2000）。両方の検査を imageSize の同じ関数で行う。
4. [fetch-photos.ts:94-95 Retry-After] サーバーの値を上限なしで待つ（Retry-After: 999999999 で実質停止）。API の JSON（119 行目 res.json()）も受信サイズの上限が無い。いずれも開発者の手元での可用性のみ。CWE-770。
   - 修正: 待ち時間を 120 秒などで頭打ちにする。API の応答も readCapped と同じ上限で読む。

## Info

- [photo-rules.ts:129 plainText] `&#99999999;` のような不正な文字参照で String.fromCodePoint が RangeError を投げ、スクリプトが落ちる（そのファイルだけ失敗にするのが望ましい）。React は文字として描画するので XSS にはならない。ただし author に `|`・改行・Markdown のリンクが入ると、標準出力の CREDITS.md の行を壊す。貼る前に `|` をエスケープする。制御文字・双方向制御文字（U+202E など）も落とすとよい。
- [photos.ts:26 licenseUrl] https のみで、ホストは固定していない。`javascript:` は https の検査で弾かれ、`rel="noopener noreferrer"` もあるので問題ない。ホストを creativecommons.org / wikimedia 系に固定するとさらに堅い。データは取得スクリプトが書く。
- [fetch-photos.ts:31-32 User-Agent] 個人情報は入っていない（意図どおり）。Wikimedia の方針は連絡先を求めるため、制限（403/429）を受ける可能性がある。可用性だけの話。
- [fetch-photos.ts:39 REVIEW] 全件に同じ「目視した」文言を機械的に入れている。顔・商標・鹿の確認は実際には機械で確かめていない。記録が確認の証跡になるのは、人が見た場合だけ。
- 問題なしの確認: 通信先は https・ホスト完全一致・ポート/ユーザー情報なしで、thumburl もこの関数を通る。`redirect: 'error'` で転送先に外れない。保存名は id の正規表現（`^[a-z0-9]+(-[a-z0-9]+)*$`）と photos.ts の `photos/{id}.` の検査で、パストラバーサルは起きない。拡張子は先頭バイトから決める（Content-Type は不使用）。CSP の `img-src 'self'` は同梱画像（/photos/*.jpg）と整合し、実行時に Commons へ通信しないので外部ホストの許可は要らない。PhotoCredit は target=_blank に rel="noopener noreferrer" があり、author は React の文字として出す（dangerouslySetInnerHTML なし）。input.ts は weight を optional にしただけで strictObject・件数上限（10）・重複検査・area 検査を保っている。入力面は広がらない。weight は受けて使わないので、過大な値でも min(1)/max(5) の範囲を保つ。

## 推奨アクション

1. 許可リスト方式に変えて stripJpegMetadata を直す（Warning 1）。
2. manifest の上書き条件と、画像と記録の 1 対 1・sha256 照合テストを足す（Warning 2）。
3. height の上限、Retry-After の頭打ち、API 応答の上限（Warning 3・4）。
4. マージを止めるものはない。
