# accessibility-checker: rebrand-shikashi（2026-11-08）

対象: `apps/sim/src/shared/components/BrandLogo.tsx`・`brand-logo.css`、`apps/pwa/src/shared/components/BrandLogo.tsx`・`brand-logo.css`、sim の `PlanHeader`・`BriefHeader`・`RecordHeader`、PWA の `ConnectScreen`（見出し）、edge の設定ページ（`pwa_server.py`）。
仕様: `docs/specs/rebrand-shikashi/functional.md`。
エージェントは呼べなかったので、メインセッションが `.claude/agents/accessibility-checker.md` の観点（WCAG 2.1 AA）で自分で確かめた。画面は Playwright で 390×844 と 1280×800 を撮って見た。

## 結果

### Critical（WCAG 違反）

なし。

### Warning（改善推奨）

- [sim `BrandLogo` 24px] ロゴの文字（SHIKASHI）は画像の下半分にあり、24px の高さでは字が約 11px になる。名前は alt と `<title>` にあり、ロゴは装飾ではなく名前の画像なので 1.4.5 の例外（ロゴタイプ）に当たる。読みやすさを上げるなら 28px に。今回はヘッダーの高さを変えない（並走する sticky-cta とぶつけない）ために 24px のまま
- [記録の 1280×800 のヘッダー] 共有の入力と「しおりを画像で保存」が 2 行に折り返して、ヘッダーが 155px ある。ロゴを旧来の幅に戻しても同じ高さだった（Playwright で確かめた）ので、この変更の前からある。記録の画面のボタンを扱うセッション（sticky-cta）に渡す

### 確かめたこと

- 1.1.1 画像: ロゴの `<img>` の alt は「SHIKASHI SIMULATOR」/「SHIKASHI NAVIGATOR」。目に見える製品の行（SIMULATOR・NAVIGATOR）は `aria-hidden` で、名前を 2 回読まない（BRAND-1・BRAND-8）
- 1.3.1 構造: PWA の `<h1>` の名前は「SHIKASHI NAVIGATOR 鹿アラート」（画像の alt ＋ 4 言語の一語。BRAND-9 のテストが accessible name を見る）。sim のヘッダーは見出しにしない（今までどおり。ページの h1 は本文の見出し）
- 1.4.3 コントラスト: 製品の行は `ink-muted`。trip `#4A5A53` / ground `#FBF8F1` で 6.88:1、night `#B9C6BF` / ground `#0E1512` で 10.48:1。ロゴは昼と夜の版をテーマで選ぶ（昼の濃い茶の文字を夜の背景に置かない）
- 1.4.4 / 1.4.10 拡大・リフロー: ヘッダーは `flex-wrap`。390px 幅でロゴ・ステップ・言語の切り替えが折り返し、横スクロールが出ない（`plan-390x844.png`）
- 2.4.2 ページの title: 「旅をつくる | SHIKASHI SIMULATOR」など。PWA は「SHIKASHI NAVIGATOR 鹿アラート」
- 3.1.2 言語: ブランド名は 4 言語で同じラテン文字（大文字だけ）。PWA の見出しは `main` の `lang` の中
- 画像が読めないとき: `width`・`height` があるので配置は崩れず、alt の文字が出る（S-1）
- edge の設定ページ: 見出し・ボタンの名前が SHIKASHI NAVIGATOR。プロファイルの手順の「EZO ROAD」は端末に出る CA の名前で、「証明書の名前」と添えた（何を探せばよいかが分かる）
- 操作要素の追加・削除は無い（44px・フォーカスは変わらない）

### スコア: 95/100
