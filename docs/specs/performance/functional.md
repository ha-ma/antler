---
feature: performance
target_paths:
  - apps/sim/src/features/drive/domain/frame-stats.ts
  - apps/sim/src/features/drive/domain/engine.ts
  - apps/sim/src/features/drive/components/FrameMeter.tsx
  - apps/sim/src/features/drive/hooks/use-frame-meter.ts
  - apps/sim/src/features/drive/scene/
  - apps/sim/src/app/routes.tsx
  - apps/sim/src/app/preload-drive.ts
  - packages/trip/src/record/run.ts
  - scripts/perf/
spec_confirmed_at: 925bb98
tier: 1
---

# 仕様: performance（A の性能を実測で確かめ、足りないところを直す）

## 概要

ロードマップ Day 5。要件は `ch6-nfr.md` の「A 性能」（PC の内蔵 GPU・1440 × 900 で 60 fps、スマホ（iPhone 13 / Pixel 6 相当）で 30 fps 以上、初回読込は 3D アセットを除いて 3 秒以内、アセットは A-2 中にプリロード、測り方は Chrome Performance と `requestAnimationFrame` の計測を A-7 に記録）と、`ch10-plan.md` の受け入れ基準（A-3 で PC 60 fps、スマホ横 30 fps）。
前の feature: drive-3d（R12 性能・UC-9c の fps の要約）、record（R2 の `frames`）、drive-tune・drive-season・drive-deer の未計測の申し送り（`docs/reports/2026-11-06-performance-analyzer-drive-season.md` W1〜W3）。

**Tier 1**: 認可・外部への副作用・並行性に触れない。記録の形（`packages/trip` の `FrameSummarySchema`）に省略できる欄 `dropped` を 1 つ足すが、run は JSON のまま保存して読むときに確かめる（`drizzle-record.repository.ts`）ので、表の作り直し（マイグレーション）は要らず、足す前に保存した run もそのまま読める。

**範囲外**: CSS・HUD の配置・タッチとジャイロの入力（mobile-landscape のセッション）、文言の表（i18n のセッション）、A-7 の画面に fps を出すこと（文言が増えるので i18n の後。記録には残る）、B（apps/pwa・edge）、`vite.config.ts` の `test` の節。

## Example Map

Story: 北海道のレンタカー旅行者として、ふつうのノート PC とスマホの横画面で、カクつかずに運転の練習をしたい。運転の画面にはすぐ入りたい。

- R1: 運転中の rAF の記録（A-7 に残す）
  - 走っている間（出発の後・一時停止していない）のフレームの間隔を数える（drive-3d UC-9c のまま。最新 7,200 フレームの窓から fps の中央値と 5 パーセンタイル）
  - **落ちたフレーム** = 間隔が 33.4 ms を超えたもの（60 Hz で vsync を 2 回以上逃した＝その瞬間 30 fps を割った）。窓ではなく走行の全体で数え、「同じシードでもう一度」で 0 に戻す
  - 走行の結果（`DriveResult.frames`）と記録（`FrameSummarySchema`）に `dropped` を足す。記録の欄は省略できる（足す前の run も通る）。0 以上の整数
- R2: 開発用の fps の表示（`/drive?fps=1`）
  - `fps=1` のときだけ、運転の画面の左下に R1 の要約（fps の中央値・5 パーセンタイル・落ちたフレーム / 数えたフレーム）を数字だけで出す。0.5 秒ごとに取り直す（要約は最大 7,200 個の並べ替えなので毎フレームはしない）
  - 読み上げない（`aria-hidden`）・押せない（`pointer-events: none`）。色・余白・角丸・文字は tokens の CSS 変数。`drive.css` には入れない（HUD の配置に影響させない）
  - 訳す文言を持たない（`fps`・`p5`・`drop` と数字だけ）
- R3: 実測（`scripts/perf/measure-drive.mjs`、結果は `docs/reports/2026-11-06-performance-measure.md`）
  - 本番ビルドを `vite preview` で出し、Playwright の Chromium（新しいヘッドレス、`--mute-audio`）で `/drive` の見本の場面を走る。「出発」→ W を押し続ける。ゾーンの外は 4× で早送り（区間の境界を多くまたぐ）、ゾーンの中は 1×、赤の間は Space、衝突したら「もう一度」
  - rAF の間隔はページに差し込んだ rAF のループで取る（アプリの計測と独立）。場面のタグ（ゾーンの外 / 中 / 赤）ごとに p50・p95・p99・最大・33.4 ms 超・50 ms 超
  - 場面: 既定（冬・圧雪・曇り）、`month=2&weather=snow`（雪の粒）、`month=10&weather=rain`（紅葉の葉 ＋ 雨。三角形が最も多い）、`month=7&weather=clear`（夏の葉）
  - 構成: PC = 1440 × 900・DPR 2（MacBook の内蔵 GPU。Canvas は DPR の上限 1.5 で 2160 × 1350）、スマホ = 844 × 390・DPR 3・タッチ・CPU 4× 減速（CDP `Emulation.setCPUThrottlingRate`）。vsync あり（要件の fps）と vsync なし（`--disable-gpu-vsync --disable-frame-rate-limit`。1 フレームの仕事の余裕）。GPU なし（SwiftShader）は参考の 1 行だけ
  - 合格: PC は vsync ありで各場面の fps の中央値 59 以上・5 パーセンタイル 55 以上・33.4 ms 超が 1,000 フレームに 1 以下。スマホ相当は 5 パーセンタイル 30 以上（95% のフレームが 33.4 ms 以内）
  - スマホの GPU（A15・Tensor のフィルレート・頂点）はこの方法では再現できない（M2 の GPU で描く）。実機の確認は Deferred
- R4: 足りないところを直す（計測の後に決める。見た目が変わるものは何を落としたかをここに書く）
  - （計測の結果を見て書く）
- R5: 初回読込と A-2 の間の先読み
  - 画面のルート（A-1・A-2・A-4 の確認・A-6・A-7・運転）はどれもルートの `lazy` で読む。入口のチャンクには React・ルーター・TanStack Query と共有のものだけ
  - A-2（`/trip/:id/brief`）のチャンクを読んだら、ブラウザが空いたとき（`requestIdleCallback`、最長 2 秒。無ければ 1 秒後）に運転のチャンク（DriveRoute・drive・3D）を先読みする。2 回目は読み直さない。失敗しても運転の画面に入ったときに普通に読む
  - 3D のチャンクを読む口は 1 つ（`scene/load-drive-canvas.ts`）。運転の画面の遅延読込と先読みが同じ import を使う
  - 初回読込の測り方: 本番ビルドの `/plan` を、Chrome の回線の制限（Lighthouse のモバイルと同じ 1.6 Mbps・RTT 150 ms、CPU 4× 減速）と制限なしで開き、LCP と読み込んだ JS の量を見る。合格: 制限ありで LCP 3 秒以内
- R6: CI で回すバンドルの上限（`scripts/perf/bundle-budget.mjs`、`local_ci_checks.toml` の検査）
  - 一時フォルダへ本番ビルドし、画面ごとに「最初に読む JS」（入口 ＋ その画面のチャンク ＋ それらが静的に読むチャンク）の gzip を上限と比べる。3D のチャンクも 1 つの上限を持つ。超えたら失敗
  - 上限は 2026-11-06 の計測の約 1 割増し。上げるときは理由をこの R6 に書く

## ユースケース

### UC-1: 落ちたフレームを数えて残す（R1）

- **Given**: 運転中
- **When**: rAF の間隔が 33.4 ms を超える
- **Then**: 落ちたフレームが 1 増え、走行の結果と記録の `frames.dropped` に入る

### UC-2: 開発用の fps の表示（R2）

- **Given**: `/drive?fps=1`
- **When**: 走る
- **Then**: 左下に fps の要約が 0.5 秒ごとに出る

### UC-5: 初回読込（R5）

- **Given**: A-1 を初めて開く
- **When**: 読み込む
- **Then**: 入口と A-1 のチャンクだけを読み、A-2 を開くと運転のチャンクを先読みする

### UC-6: バンドルの上限（R6）

- **Given**: 本番ビルド
- **When**: local-ci の検査を回す
- **Then**: 画面ごとの最初の JS と 3D のチャンクが上限以内なら通る

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（実機）/ 期日=2026-11-08（Day 6）/ 暫定挙動=CPU 4× 減速の計測で合格とみなす] iPhone 13 の Safari（Web インスペクタ）か Pixel 6 の Chrome で `/drive?fps=1` を走り、左下の fps の 5 パーセンタイルが 30 以上かを見る（GPU 側はこの方法でしか確かめられない）
- [Deferred: 担当=ユーザー / 期日=2026-11-08 / 暫定挙動=M2 の内蔵 GPU の計測で合格とみなす] Windows の PC の内蔵 GPU（Intel Iris Xe など）で同じく 60 fps を見る

## Test List（Canon TDD Step 1）

### 受け入れ（外側ループ）

- [ ] AC-1: 実測（R3）で PC の 4 場面が合格、スマホ相当の 4 場面が合格（`docs/reports/2026-11-06-performance-measure.md`）
- [ ] AC-2: バンドルの上限の検査（R6）が通り、初回読込（R5）の LCP が回線の制限ありで 3 秒以内

### UC-1: 落ちたフレーム

- [ ] UC-1a: 落ちたフレーム = 33.4 ms を超えた間隔の数（ちょうどは数えない）
- [ ] UC-1b: 数を外から渡すとそれを使う。空の列は null
- [ ] UC-1c: エンジンは 7,200 フレームの窓より前の落ちたフレームも数え、やり直しで 0 に戻す
- [ ] UC-1d: 一時停止の間のフレームは数えない
- [ ] UC-1e: 記録の `frames.dropped` は 0 以上の整数で、省略できる（足す前の run も通る）
- [ ] UC-1f: 走行の結果から作る run（`toDriveRun`）に `dropped` がそのまま入る

### UC-2: 開発用の fps の表示

- [ ] UC-2a: 表示の文字列は `fps <中央値> p5 <5 パーセンタイル>` と `drop <落ちた> / <数えた>`。まだ無ければ `fps --`
- [ ] UC-2b: `fps=1` のときだけ出す（`fps=0`・`fps=true`・無しは出さない）
- [ ] UC-2c: 0.5 秒ごとに取り直す（その間は前の値）。`aria-hidden`

### UC-5: 初回読込と先読み

- [ ] UC-5a: 画面のルートはどれも `lazy` で Component を返す（element を持たない）
- [ ] UC-5b: A-2 のルートを読んだら先読みを予約する。ほかの画面では予約しない
- [ ] UC-5c: 先読みは 3D のチャンクを読み、2 回目は同じ Promise
- [ ] UC-5d: `requestIdleCallback` があれば最長 2 秒で、無ければ 1 秒後に始める

### UC-6: バンドルの上限

- [ ] UC-6a: `node scripts/perf/bundle-budget.mjs` が上限以内で exit 0（local-ci の検査）

## 非機能要件

- [ ] 性能: R3 の合格（AC-1）
- [ ] 初回読込: R5 の合格（AC-2）

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC のテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型）
