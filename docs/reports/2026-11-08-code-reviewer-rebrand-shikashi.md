# code-reviewer: rebrand-shikashi（2026-11-08）

対象: `git diff origin/main` の 2 コミット（c03c061・fe2840c）。
仕様: `docs/specs/rebrand-shikashi/functional.md`。
エージェントは呼べなかったので、メインセッションが `.claude/agents/code-reviewer.md` の観点（可読性・設計・エラー処理・テストのしやすさ）で自分で確かめた。

## レビュー結果

### Critical（修正必須）

なし。

### Warning（推奨）

- [`apps/sim/src/shared/components/BrandLogo.tsx`・`apps/pwa/src/shared/components/BrandLogo.tsx`] 同じ形の部品が 2 つある。アプリをまたいで共有するなら `packages/alert-ui` に置くことになるが、凍結の公開 API に足すことになるので今回はしない（推奨で決定。仕様 R2）。違いは製品の行と既定のテーマ・高さだけ。⑤ の内部の名前の変更か、3 つ目の使い道が出たときに 1 つにする
- [PWA の `BrandLogo` の `theme`] PWA の画面はいまは night だけで、`trip` は使っていない。テーマで選ぶというユーザーの決定と sim との揃いのために残した（BRAND-8 のテストが両方を見る）
- [sim のテキストの表の `brand`] `plan-trip`・`brief-map`・`loss` の 3 つの表と `packages/trip` の記録の表に同じ `SHIKASHI SIMULATOR` がある。今までの `EZO ROAD` と同じ形を保った（表ごとに 4 言語が揃うことをテストが見るため）。ロゴの alt は `BrandLogo` の定数から出す

### Info（参考）

- `BrandMark.tsx`（SVG の印）と、ヘッダーの山と道の SVG・その CSS は使わなくなったので消した。`record-brand`・`plan-brand`・`brief-brand` の入れ物の class は残した（並走する sticky-cta の差分とぶつけない）
- OG 画像の eyebrow の位置は定数（`OG_BRAND_X`・`OG_EYEBROW_X`）にし、同梱のフォントで実際に描いたブランドの幅で重ならないことを確かめるテスト（BRAND-6）を足した。文字数の見積もりに頼らない
- edge の設定ページは名前を `BRAND` の定数にまとめた。CA の名前（`O = EZO ROAD`）は `make_tls.py` のまま
- 良い点: 名前の変更が画面の配置を変えていない（ヘッダーの中身だけ）。テストは文言の一致ではなく、画像の役割と accessible name で見ている
