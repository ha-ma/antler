---
feature: og-font
target_paths:
  - apps/api/assets/fonts/
  - apps/api/scripts/fetch-og-fonts.mjs
  - apps/api/src/infrastructure/http/views/og-fonts.ts
  - apps/api/src/infrastructure/http/views/og-fonts.test.ts
  - apps/api/src/infrastructure/http/views/og-image-renderer.ts
  - apps/api/src/infrastructure/http/views/shiori-svg.ts
  - apps/api/vite.vercel.config.ts
  - apps/api/tests/vercel/bundle.test.ts
spec_confirmed_at: 2421c02
tier: 1
---

# 仕様: og-font（OG 画像のフォントを同梱して、日本語・繁体字・ハングルが「□」にならないようにする）

## 概要

記録ページの OG 画像（`GET /t/:id/og.png`。resvg でしおりの SVG を PNG にする）は、サーバーのフォントで文字を描く。Vercel の関数の Linux には CJK のフォントが無く、タイトルが「□」になる（deploy-a の Deferred）。
Noto Sans の JP / TC / KR の Bold（SIL OFL 1.1）を api に同梱し、resvg にそのファイルだけを渡す（システムのフォントを読まない）。

Tier 1 の理由: 認可・永続化・外部副作用・並行性のどれにも触れない（描画の入力と、同梱のファイルだけが変わる）。取得は開発時の 1 回で、実行時に外へ通信しない。

要件: ch6（ライセンス）、ch5（4 言語）、record R6（OG 画像）。ユーザー判断（2026-11-06）: Noto Sans JP（OFL）の同梱を許可。

**範囲外**: 記録ページの HTML（SSR。閲覧者の端末のフォントで出る）、sim の画面、フォントの太さを 2 つ以上にすること、IBM Plex Mono の同梱（下の Deferred）。

## Example Map

Story: 台湾から来た友人に旅の記録のリンクを送ったとき、SNS のカードに出るタイトルが「□□□」ではなく、読める文字で出てほしい。

- R1 取得と同梱（推奨で決定）: Noto Sans CJK の公式のタグ `Sans2.004`（github.com/notofonts/noto-cjk）の `Sans/SubsetOTF/{JP,TC,KR}/NotoSans{JP,TC,KR}-Bold.otf` を `apps/api/assets/fonts/` に置く。ライセンス本文（同タグの `LICENSE`）を `OFL.txt` として一緒に置く
  - 取得は `apps/api/scripts/fetch-og-fonts.mjs`（タグと sha256 を固定。違えば置かない。`--check` は通信せずに置いてあるファイルの sha256 を確かめる）
  - 太さは Bold の 1 つだけ。理由: Variable の Noto Sans JP は resvg が既定の太さ（Regular）でしか描けない。静的な OTF の Bold は SVG の 700 と 900 の指定に使える（900 は在る中で一番近い Bold）。1 つが約 4.7〜5.8 MB、3 つで約 15 MB
  - 地域別の Subset OTF を使う理由: 1 ファイルの大きさが OTC・Variable より小さく、文字の字形が言語に合う
- R2 描画（推奨で決定）: resvg には同梱の 3 つのファイルだけを渡し（`loadSystemFonts: false`）、システムのフォントには頼らない。`OG_FONT_FILES` に値があればそれが優先（上書きの口）。同梱のファイルが 1 つでも欠けているときだけ、システムのフォントに戻す
  - 言語ごとの family の順: ja・en は JP → TC → KR、zh は TC → JP → KR、ko は KR → JP → TC。その言語の字形が先になる。resvg は文字ごとに、足りるフォントに落ちる
  - 数字（旧 IBM Plex Mono）も同じフォントで描く
  - 毎回 3 つを読むが、測ると 1 枚 10〜25 ms（遅れて読む仕組みは作らない。推奨で決定）。描いた PNG は今までどおり旅の版でメモリに持つ
- R3 Vercel の関数（推奨で決定）: bundle（Vite の SSR）はフォントを `dist/vercel/` に写す（`publicDir: assets/fonts`）。`og-fonts.ts` は `new URL('./….otf', import.meta.url)`（bundle の置き場所）と `new URL('../../../../assets/fonts/….otf', import.meta.url)`（ソースから動かすとき）を、ファイル名のリテラルで書く。Vercel のファイルの追跡（nft）が辿り、3 つの .otf が関数に入る（手元で `@vercel/nft` で確かめた）
  - 関数の大きさ: 約 15 MB の増加（Vercel の関数の上限は展開後 250 MB）。実際の大きさと起動はデプロイでしか分からない（Deferred）
- R4 決まりの更新: CLAUDE.md の MUST「アセットは CC0 / CC-BY / 自作のみ」にフォントは OFL も可を足す。CREDITS.md に 3 つのフォントの名前・ライセンス・配布元・場所・使い方を書く。アセットのライセンスを検査するスクリプトは無い（調べた: scripts/・.claude/hooks/ に CREDITS・ライセンスの検査なし）
- R5 TC と KR も同梱する（推奨で決定）: OG 画像のタイトルは旅の言語（ja・en・zh 繁体字・ko）で出る。JP だけでは繁体字の一部とハングルが「□」になる（ハングルは JP のフォントに無い）。同じ OFL の Noto Sans TC と KR を足す

## ユースケース

### UC-1: ja・zh・ko のタイトルが読める

- **Given**: 同梱のフォントだけ（システムのフォントを読まない）
- **When**: ja・zh・ko のタイトルで OG 画像の SVG を描く
- **Then**: 文字列を替えると画素が変わり、フォントを渡さない描画より描かれた画素が多い。ko で KR を外すと「□」になって文字列を替えても画素が変わらない（検査自体が効く）

### UC-2: bundle にフォントが入る

- **Given**: `vite.vercel.config.ts` の build
- **When**: bundle を作る
- **Then**: `dist/vercel/` に 3 つの .otf と `OFL.txt`。handler.mjs が `./NotoSans…-Bold.otf` を URL で読む

## 状態パターン

### S-1: 同梱のファイルが欠けた・`OG_FONT_FILES` のパスが無い

- **Given**: フォントが 1 つ欠けている → **Then**: システムのフォントで描く（四角になりうるが、画像は返す。500 にしない）。起動のときにログ `og.fonts_missing`（warn）を 1 回出す（spec-adversary 1。壊れたことに気づけるように）
- **Given**: `OG_FONT_FILES` の指定のファイルが 1 つも無い → **Then**: 同梱のフォントに戻る（文字の無い画像を返さない。spec-adversary 7。推奨で決定）

### S-2: 取得したファイルが固定の sha256 と違う

- **Given**: 配布元が変わった・壊れた → **Then**: スクリプトは何も置かずに終了コード 1。検証してから一時ファイルに書き、最後にまとめて名前を替える（取得と検証に失敗したときは置いてあるファイルが変わらない）。`--check` は余計なファイル（`.tmp` など。bundle にも写る）があっても失敗する（spec-adversary 8）

## Questions（Deferred のみ残存可）

決着済み（2026-11-06）: 同梱の許可（ユーザー判断）、TC と KR も同梱・Bold のみ・3 つとも毎回読む・タグと sha256 の固定・言語ごとの順（推奨で決定）。

- [Deferred: 担当=ユーザー / 期日=2026-11-08 / 暫定挙動=数字（旧 IBM Plex Mono）も Noto Sans で描く。IBM Plex Mono（OFL、約 100 KB）を足すかは見た目の好み。足さなくても読める] OG 画像の数字の書体
- [Deferred: 担当=ユーザー（PO）/ 期日=2026-11-08 / 暫定挙動=タイトルの簡体字・絵文字・記号はどの同梱のフォントにも無いので「□」になる。旅の言語 zh は繁体字（ch5）で、Claude の生成物の検証が絵文字を止めているため、普通は出ない。Noto Sans SC を足すかは、簡体字の利用者が出てから] 簡体字・絵文字のタイトル
- [Deferred: 担当=人 A / 期日=2026-11-08 / 暫定挙動=関数にフォントが入ることは、`@vercel/nft` を `apps/sim/api/index.mjs` に当てて 3 つの .otf が出ることを手元で 1 回確かめた（テストにはしていない。nft はこのリポジトリの依存ではない）。bundle のテスト（AC-1）はファイルと URL の形までを見る] nft の確かめを CI に入れる
- [Deferred: 担当=ユーザー（実際のデプロイ）/ 期日=2026-11-07 / 暫定挙動=関数にフォントが入ること（nft）と PNG の描画は手元で確かめた。次の 2 つはデプロイでしか分からない: (1) ja・zh・ko の旅の `/t/:id/og.png` がタイトルを読める文字で返すか、(2) 関数の大きさ・コールドスタートが許容か（約 15 MB の増加）] 実際のデプロイでの確かめ

## Test List（Canon TDD Step 1）

- [x] FONT-1: 3 つのフォントと `OFL.txt` が置いてあり、sha256 が取得のスクリプトの固定値と合う（`--check`）
- [x] FONT-2: 3 つの合計が 16 MB 未満
- [x] FONT-3: 言語ごとの family の順（ja・en は JP、zh は TC、ko は KR が先。3 つとも並ぶ）
- [x] FONT-3b: family 名が実際のフォントの名前と合っている（共通の字で、TC を先にした描画と JP を先にした描画の字形が違う。名前を間違えると同じになる）
- [x] FONT-4a: ja のタイトルは文字列を替えると画素が変わり、タイトルを空にした描画との差が 5,000 画素を超える。フォントを渡さないと差は 0
- [x] FONT-4b: zh（繁体字）のタイトルも同様
- [x] S-1: 同梱が欠けている・`OG_FONT_FILES` のパスが無い → 警告 1 回で画像は返す。同梱が使えるときは指定のパスが無くても同梱に戻る
- [x] S-2: `--check` は余計なファイルで失敗する（スクリプトの実装。手元で確かめた）
- [x] FONT-4c: ko のタイトルは KR で描かれ、KR を外すと「□」になり文字列を替えても画素が変わらない
- [x] FONT-4d: ja のタイトルに混じったハングルは、JP が先でも KR に落ちて描かれる
- [x] FONT-5: 既定の `OgImageRenderer`（`fontFiles` 空）が 1200×630 の PNG を 3 秒以内に描く（実測は 10〜25 ms）
- [x] AC-1（bundle）: `dist/vercel/` に 3 つの .otf と `OFL.txt` があり、handler.mjs が `./NotoSans…-Bold.otf` を URL で読む（`apps/api/tests/vercel/bundle.test.ts`）

## 非機能要件

- [x] 性能: 1 枚の描画 10〜25 ms（手元で測った）。同時実行・キャッシュは record R6 のまま
- [x] セキュリティ: 実行時に外へ通信しない。取得は開発時だけで、タグと sha256 を固定して検証する（違えば置かない）
- [x] ライセンス: SIL OFL 1.1。ライセンス本文を同じ場所に置き、CREDITS.md に書く。フォントを改変しない・単体で売らない
- [x] 既存のテストが Green（api）。`OG_FONT_FILES` の上書きは今までどおり
