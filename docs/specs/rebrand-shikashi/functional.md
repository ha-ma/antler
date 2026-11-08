---
feature: rebrand-shikashi
target_paths:
  - apps/sim/index.html
  - apps/sim/public/brand/
  - apps/sim/src/shared/components/
  - apps/sim/src/app/App.test.tsx
  - apps/sim/src/features/plan-trip/text.ts
  - apps/sim/src/features/plan-trip/components/PlanHeader.tsx
  - apps/sim/src/features/plan-trip/components/plan-trip.css
  - apps/sim/src/features/brief-map/text.ts
  - apps/sim/src/features/brief-map/components/BriefHeader.tsx
  - apps/sim/src/features/brief-map/components/brief-map.css
  - apps/sim/src/features/loss/text.ts
  - apps/sim/src/features/record/components/RecordHeader.tsx
  - apps/sim/src/features/record/components/record.css
  - apps/sim/src/features/record/hooks/useRecordActions.ts
  - packages/trip/src/record/text.ts
  - packages/i18n-check/src/tables.test.ts
  - apps/api/src/infrastructure/http/views/shiori-svg.ts
  - apps/pwa/index.html
  - apps/pwa/public/brand/
  - apps/pwa/src/shared/components/
  - apps/pwa/src/features/connect/i18n.ts
  - apps/pwa/src/features/connect/components/ConnectScreen.tsx
  - apps/pwa/src/features/connect/components/connect.css
  - edge/detector/src/detector/pwa_server.py
spec_confirmed_at: 2c28b1f
tier: 1
---

# 仕様: rebrand-shikashi（サービス名を EZO ROAD から SHIKASHI に変え、ロゴを入れる）

> 2026-11-08 sticky-cta（`docs/specs/sticky-cta/functional.md`）が `apps/sim/src/shared/components/` に `ActionBar`（次へ進む主ボタンを画面の下に固定する帯）を足し、`plan-trip.css`・`brief-map.css`・`record.css` の本文の下の余白に帯の高さを足し、`plan-trip/text.ts` の表の末尾に帯の「直すところ」の文言を足した。`BrandLogo`・ヘッダー・名前の文言は変えていない。同じ日に `action-bar.css` の狭い画面の主ボタンの余白と折り方を直した（帯だけ）。

> 2026-11-08 result-countup（`docs/specs/result-countup/functional.md`）が `apps/sim/src/shared/components/` に `CountUpText` と `count-up.css`（結果の数字の数え上げ）を足した。`BrandLogo`・ヘッダー・名前の文言は変えていない。

## 概要

2026-11-08 にユーザーがサービス名を **SHIKASHI** に変えた。A（apps/sim ＋ apps/api のウェブアプリ）は **SHIKASHI SIMULATOR**、B（apps/pwa ＋ edge/detector の車載）は **SHIKASHI NAVIGATOR**。サービス全体を指すところ（CLAUDE.md・CREDITS.md・tokens.json の `name`・デザインの README）は **SHIKASHI**。
利用者に見える旧名「EZO ROAD」を全部替え、ブランドを出しているヘッダー（sim の `/plan`・`/brief`・`/t/:id`、PWA の接続画面）にユーザーが用意したロゴ（透過 PNG、960×231、昼と夜の 2 つ）を置く。

Tier 1 の理由: 認可・永続化スキーマ・外部副作用・並行性に触れない。変わるのは表示の文言・画像・ダウンロードの名前だけ。凍結の `packages/schema`・`packages/alert-ui` には触れない。

決めたことの記録と、替えたもの・残したものの一覧: `docs/changes/2026-11-08-shikashi-rebrand.md`。

**範囲外**: 内部の名前（npm の `@antler/*`・パッケージ名・リポジトリ名・ディレクトリ・環境変数・Turso / Blob / Vercel の名前・`ezoroad.local`・CA の名前と証明書の subject・localStorage と cookie の鍵）。これは計画の ⑤ で、走っているブランチが無いときに替える。色（tokens.json は変えない。ブランドの色を足さない）。SSR の共有ページと OG 画像へのロゴの画像（文字だけ替える）。

## Example Map

Story: 旅の前にシミュレーターを開いた人も、車でスマホをつないだ人も、同じ「SHIKASHI」のロゴを見て、いま使っているのが SIMULATOR（運転前）か NAVIGATOR（運転中）かが分かる。

- R1 名前（ユーザー判断 2026-11-08）: A の表示名は `SHIKASHI SIMULATOR`、B は `SHIKASHI NAVIGATOR`。4 言語とも同じ綴り（大文字だけなので i18n の検査では中立の文）
  - sim のページの `<title>`（`… | SHIKASHI SIMULATOR`）、`index.html` の `<title>`、記録の文言の表（`brand`・`openInApp`「SHIKASHI SIMULATOR で開く」）。表は sim の A-7・api の SSR・OG 画像が共有する
  - PWA の `index.html` の `<title>` と接続画面の見出し（`SHIKASHI NAVIGATOR 鹿アラート` など 4 言語）
  - edge の設定ページ（http の `/`）の `<title>`・各言語の見出し・「SHIKASHI NAVIGATOR を開く」
- R2 ロゴ（ユーザー判断 2026-11-08。配色は変えない）: 昼（trip）の画面は `shikashi-logo.png`（濃い茶の文字）、夜（night）の画面は `shikashi-logo-night.png`（明るい文字）。sim と PWA の `public/brand/` に置く
  - 置き場所: sim の `/plan`・`/brief`・`/t/:id` のヘッダー（いずれも trip）、PWA の接続画面の見出し（night）。今までの SVG の印（`BrandMark`・山と道の線）と置き換える
  - 製品の行（`SIMULATOR`・`NAVIGATOR`）はロゴの右に、tokens の `eyebrow`（12px・700・字間 0.12em）で `ink-muted` の色で書く（推奨で決定。ロゴの文字と競わず、4.5:1 を満たす）
  - ロゴの高さは 24px（sim のヘッダー）・28px（PWA の見出し）。`width`・`height` を書いて読み込みでずれない
  - 読み上げ: 画像の `alt` が `SHIKASHI SIMULATOR` / `SHIKASHI NAVIGATOR`。目に見える製品の行は `aria-hidden`（名前を 2 回読まない）
  - 部品は sim と PWA の `src/shared/components/BrandLogo.tsx`（それぞれ 1 つ。アプリをまたぐ共有は凍結の alert-ui に足すことになるので、しない。推奨で決定）
- R3 しおりの画像の保存名: `ezo-road-{id}.png` → `shikashi-{id}.png`（利用者の端末に残る名前なので替える。推奨で決定）
- R4 OG 画像: 左上のブランドの文字が長くなる（8 字 → 18 字）。右の eyebrow（`TRIP RECORD ・ 日付`）と重ならないよう、eyebrow を次の位置へずらす（推奨で決定。ブランドの字は小さくしない）
- R5 証明書の名前は残す（ユーザー判断 2026-11-08）: CA の subject（`O = EZO ROAD`）は替えないので、iPhone・Android のプロファイルの名前は「EZO ROAD」のまま。設定ページと runbook の「VPN とデバイス管理 → EZO ROAD」の手順は、そのまま「EZO ROAD」と書く（替えると利用者が探せない）
- R6 文書: CLAUDE.md・CREDITS.md（ロゴをプロジェクトの自作として）・デザインの README・tokens.json の `name`・antler 由来のエージェントの説明・今の runbook を SHIKASHI に。`docs/requirements/` の写しは本文を替えず、ch0-about.md に注記を 1 つ。日付の付いた履歴（`docs/reports/*`・`docs/changes/*`）は替えない

## ユースケース

### UC-1: シミュレーターのヘッダー

- **Given**: `/plan`（trip のテーマ）
- **When**: 開く
- **Then**: ヘッダーに昼のロゴ（`/brand/shikashi-logo.png`、alt `SHIKASHI SIMULATOR`）と `SIMULATOR` の文字。ページの `<title>` は `旅をつくる | SHIKASHI SIMULATOR`

### UC-2: ナビゲーターの接続画面

- **Given**: PWA の接続画面（night のテーマ）
- **When**: 開く
- **Then**: 見出しに夜のロゴ（`/brand/shikashi-logo-night.png`）。見出しの名前は `SHIKASHI NAVIGATOR 鹿アラート`（en は `SHIKASHI NAVIGATOR Deer Alert`）

### UC-3: 共有ページ

- **Given**: api の SSR の `/t/:id`
- **When**: 開く
- **Then**: ブランドの文字が `SHIKASHI SIMULATOR`、ボタンが「SHIKASHI SIMULATOR で開く」。OG 画像の左上も `SHIKASHI SIMULATOR`

## 状態パターン

### S-1: ロゴの画像が読めない

- **Given**: `/brand/*.png` が 404・オフライン → **Then**: `alt` の文字（`SHIKASHI SIMULATOR` / `SHIKASHI NAVIGATOR`）が出る。`width`・`height` があるので配置は崩れない

## Questions（Deferred のみ残存可）

決着済み（2026-11-08）: 名前・ロゴ・配色を変えないこと・残す内部の名前（ユーザー判断）。製品の行の文字の大きさと色・部品の置き場所・保存名・OG の配置（推奨で決定）。

- [Deferred: 担当=ユーザー / 期日=計画の ⑤ / 暫定挙動=鹿ゾーンのデータ（`packages/zones/data/zones.source.json`・生成物 `zones.geojson`・`packages/zones/data/README.md`）の加工者の表記は「EZO ROAD が作成」のまま。画面には出ない。替えると `zones.geojson` の hash が変わり作り直しが要るので、内部の名前の変更と一緒にする] 鹿ゾーンのデータの加工者の表記
- [Deferred: 担当=人 A / 期日=2026-11-09 / 暫定挙動=SSR の共有ページと OG 画像はブランドを文字で出す。ロゴの画像を入れるには、SSR は sim のオリジンの画像（手元の開発ではオリジンが違う）、OG は resvg への画像の埋め込みが要る] 共有ページと OG 画像のロゴの画像

## Test List（Canon TDD Step 1）

- [x] BRAND-1: sim の `BrandLogo` は trip で昼のロゴ、night で夜のロゴを、`width`・`height` 付きで出す。alt は `SHIKASHI SIMULATOR`、製品の行 `SIMULATOR` は `aria-hidden`
- [x] BRAND-2: `/plan` のヘッダーに `SHIKASHI SIMULATOR` の画像があり、`<title>` が `旅をつくる | SHIKASHI SIMULATOR`
- [x] BRAND-3: `/brief` と `/t/:id` のヘッダーにも `SHIKASHI SIMULATOR` の画像
- [x] BRAND-4: 記録の文言の表の `brand` と `openInApp` が 4 言語で SHIKASHI SIMULATOR（旧名を含まない）
- [x] BRAND-5: api の共有ページ（SSR）のブランドとボタンが SHIKASHI SIMULATOR。無い記録のページも同じ
- [x] BRAND-6: OG 画像の SVG の左上が `SHIKASHI SIMULATOR` で、eyebrow がブランドの文字の右端より右から始まる
- [x] BRAND-7: しおりの画像の保存名が `shikashi-{id}.png`
- [x] BRAND-8: PWA の `BrandLogo` は night で夜のロゴ。alt は `SHIKASHI NAVIGATOR`、製品の行は `aria-hidden`
- [x] BRAND-9: PWA の接続画面の見出しの名前が `SHIKASHI NAVIGATOR 鹿アラート`（4 言語の文言の表も旧名を含まない）
- [x] BRAND-10: edge の設定ページの `<title>`・4 言語の見出し・開くボタンが SHIKASHI NAVIGATOR。プロファイルの手順の「EZO ROAD」（CA の名前）は残る
- [x] BRAND-11: i18n の検査で `SHIKASHI SIMULATOR` ×4 が中立の文として通る

## 非機能要件

- [x] アクセシビリティ: ロゴの `alt`、製品の行の `aria-hidden`、製品の行の文字（`ink-muted`）が ground の上で 4.5:1 以上（trip `#4A5A53` / `#FBF8F1`、night `#B9C6BF` / `#0E1512`。tokens の usage のとおり）
- [x] 性能: ロゴは 2 つで 155〜223 KB。sim の JS のバンドルの上限には入らない（`public/` の画像）。PWA の dist の上限（64 MB）に対して小さい
- [x] ライセンス: ロゴはユーザーが用意したプロジェクトの自作。CREDITS.md に書く
- [x] 文書: CLAUDE.md・CREDITS.md・design README・tokens.json の `name`・エージェントの説明・runbook・ch0-about.md の注記・`docs/changes/2026-11-08-shikashi-rebrand.md`
- [x] 既存のテストが Green（sim・pwa・api・trip・i18n-check・edge）
