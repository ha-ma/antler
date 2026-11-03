## 8. デザインシステムと UI 実装規約

> 出典: Claude Docs「EZO ROAD システム要件定義書 v1」https://claude.ai/artifact/Jr6zYHcjdSy5xEd1WaG7v8 （2026-11-03 エクスポート）。本文は原文のまま。変更は原文側で行い、再エクスポートする。


デザインシステムは Claude Design のアーティファクト [EZO ROAD Design System](https://claude.ai/artifact/Bhv9ssR8hr3i8DUkZTT7Qw) にある。`project/tokens.json`（色 2 テーマ・文字・余白・角丸・影）と `project/README.md`（原則とコンポーネント一覧、アートボード→ルート対応表）を正とする。画面の正は [UI キャンバス](https://claude.ai/artifact/92Ho3c3gpV3CdNwmLvUS5F)（v2 ページ）。

**実装規約（MUST）**

1. `tokens.json` をビルド時に CSS 変数（`--spruce` など）と TypeScript 定数に変換して使う。コンポーネント内で 16 進色を直書きしない。
2. テーマは `trip` と `night` の 2 つ。`data-theme` で切替。A-5（鹿ゾーン内）・A-6・B は night。
3. 3状態の色 `alert-safe / alert-zone / alert-danger` はテーマで変えない。`alert-danger` を検知以外に使わない。
4. 数値は `IBM Plex Mono`（`num-*`）、文章は `Noto Sans JP`。Google Fonts を `preconnect` し、B PWA はオフライン用に woff2 を同梱する。
5. `@ezoroad/alert-ui` を monorepo のパッケージとして切り、A と B が依存する。`AlertState` の props はデザインシステムの `components/AlertState/README.md` に従う。
6. タッチターゲット 44px 以上。アイコンのみのボタンに `aria-label`。スクリーンリーダーで 3D シーンは `role="img"` と説明文。
7. アイコンはインライン SVG（stroke）。絵文字を使わない。鹿のピクトグラムは 1 つの SVG を全画面で共有する。
8. 写真は `photo-placeholder` 色のプレースホルダで始め、差し替えはアセットマスター（`pleasures.json` の `image`）だけで完結させる。

**画面とルートの対応**：デザインシステム README の「対応表」を正とする（A1\_Plan → `/plan`、A3\_Drive → `/drive`、A7\_Record → `/t/:id`、B1〜B3 → `/b/drive` など）。
