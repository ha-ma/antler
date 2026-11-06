---
feature: performance
target_paths:
  - apps/sim/src/features/drive/domain/frame-stats.ts
  - apps/sim/src/features/drive/domain/engine.ts
  - apps/sim/src/features/drive/domain/quality.ts
  - apps/sim/src/features/drive/components/FrameMeter.tsx
  - apps/sim/src/features/drive/components/FrameMeterReadout.tsx
  - apps/sim/src/features/drive/components/DrivePage.tsx
  - apps/sim/src/features/drive/hooks/use-frame-meter.ts
  - apps/sim/src/features/drive/scene/
  - apps/sim/src/app/routes.tsx
  - apps/sim/src/app/preload-drive.ts
  - apps/sim/src/app/DriveRoute.tsx
  - packages/trip/src/record/run.ts
  - scripts/perf/
spec_confirmed_at: 7435a29
tier: 1
---

# 仕様: performance（A の性能を実測で確かめ、足りないところを直す）

## 概要

ロードマップ Day 5。要件は `ch6-nfr.md` の「A 性能」（PC の内蔵 GPU・1440 × 900 で 60 fps、スマホ（iPhone 13 / Pixel 6 相当）で 30 fps 以上、初回読込は 3D アセットを除いて 3 秒以内、アセットは A-2 中にプリロード、測り方は Chrome Performance と `requestAnimationFrame` の計測を A-7 に記録）と、`ch10-plan.md` の受け入れ基準（A-3 で PC 60 fps、スマホ横 30 fps）。
前の feature: drive-3d（R12 性能・UC-9c の fps の要約）、record（R2 の `frames`）、drive-tune・drive-season・drive-deer の未計測の申し送り（`docs/reports/2026-11-06-performance-analyzer-drive-season.md` W1〜W3）。

**Tier 1**: 認可・外部への副作用・並行性に触れない。記録の形（`packages/trip` の `FrameSummarySchema`）に省略できる欄 `dropped`・`counted` を足すが、run は JSON のまま保存して読むときに確かめる（`drizzle-record.repository.ts`）ので、表の作り直し（マイグレーション）は要らず、足す前に保存した run もそのまま読める。
**配る順**（spec-adversary 12）: `FrameSummarySchema` は `strictObject` なので、古い API は新しい欄を知らない欄として 400 で弾く。sim と api は同じ配備（`build:vercel`）で出すが、別々に出すときは api を先に出す。戻すときは欄の省略（optional）を残したまま戻す（欄ごと消すと、`dropped` を持つ run が読むときの検証に落ちて A-7 から消える）。

**範囲外**: CSS・HUD の配置・タッチとジャイロの入力（mobile-landscape のセッション）、文言の表（i18n のセッション）、A-7 の画面に fps を出すこと（文言が増えるので i18n の後。記録には残る）、B（apps/pwa・edge）、`vite.config.ts` の `test` の節。

> 2026-11-06 main（mobile-landscape #49・i18n #50）を取り込んだ。`DrivePage.tsx` は両方を残した（`.drive__content`・縦の案内・指の入力・旅の言語は main のまま、末尾に開発用の fps の表示）。実測（R3・R5）は取り込みの前の本番ビルドで測った。取り込み後もバンドルの上限（R6）を測り直して通した。記録の検証の文（`FrameSummarySchema` の refine）は利用者に出ないので英語にした（i18n R4 の検査）。

## Example Map

Story: 北海道のレンタカー旅行者として、ふつうのノート PC とスマホの横画面で、カクつかずに運転の練習をしたい。運転の画面にはすぐ入りたい。

- R1: 運転中の rAF の記録（A-7 に残す）
  - 走っている間（出発の後・一時停止していない）のフレームの間隔を数える（drive-3d UC-9c のまま。最新 7,200 フレームの窓から fps の中央値と 5 パーセンタイル）
  - **落ちたフレーム** = 間隔が 40 ms を超えたもの（その瞬間に 25 fps を割った。30 fps に張り付く端末で 1 フレームを、60 Hz で vsync を 2 回以上逃した）。33.4 ms にしないのは、30 fps に張り付く端末（省電力・低電力モード）の 33.3 ms の前後の揺れを数えないため（spec-adversary 2・3）。120 Hz の画面でも同じ線（その瞬間に 25 fps を割った）で、vsync の回数ではない
  - 落ちたフレームと**数えたフレーム**（`counted`）は窓ではなく走行の全体で数え、「同じシードでもう一度」で 0 に戻す。`dropped / counted` が走行の全体の割合（`frames` は窓の数なので分母にしない。spec-adversary 1）
  - 一時停止の間と、終わった後（衝突・完走のバナーの間）は数えない（タブを隠すと自動で一時停止する。`use-auto-pause`。code-reviewer W3）。出発・やり直しの直後の区間の作り直しも、利用者に見える引っかかりなので数える
  - 走行の結果（`DriveResult.frames`）と記録（`FrameSummarySchema`）に `dropped`・`counted` を足す。記録の欄は両方とも省略できる（足す前の run も通る）。0 以上 1,000 万以下（60 fps で約 46 時間）の整数。片方だけ、`dropped` が `counted` を超えるものは弾く
  - fps は 1000 で頭打ちにする（1 ms 未満の間隔でも記録の上限 `max(1000)` で run が弾かれない。spec-adversary 12）
- R2: 開発用の fps の表示（`/drive?fps=1`）
  - `fps=1` のときだけ、運転の画面の左下に R1 の要約（fps の中央値・5 パーセンタイル・落ちたフレーム / 数えたフレーム（走行の全体））を数字だけで出す。0.5 秒ごとに取り直す（要約は最大 7,200 個の並べ替えなので毎フレームはしない）
  - 読み上げない（`aria-hidden`）・押せない（`pointer-events: none`）。色・余白・角丸・文字は tokens の CSS 変数。`drive.css` には入れない（HUD の配置に影響させない）
  - 訳す文言を持たない（`fps`・`p5`・`drop` と数字だけ）
- R3: 実測（`scripts/perf/measure-drive.mjs`、結果は `docs/reports/2026-11-06-performance-measure.md`）
  - 本番ビルドを `vite preview` で出し、Playwright の Chromium（新しいヘッドレス、`--mute-audio`）で `/drive` の見本の場面を走る。3D が 1 秒描いてから「出発」→ W を押し続ける。ゾーンの外は 4× で早送り（区間の境界を 4 倍の頻度でまたぐ。要件より重い）、ゾーンの中は 1×、赤の間は Space、衝突したら「もう一度」。場面ごとにブラウザを起動し直す（GPU のプログラムのキャッシュを持ち越さない）。状態の問い合わせは 300 ms ごと
  - rAF の間隔はページに差し込んだ rAF のループで取る（アプリの計測と独立）。フレームのタグ: `settle`（出発・やり直しから 2 秒。判定から除いて別に出す）・`onset`（赤のバナーが DOM に出てから 1 秒。MutationObserver で出た瞬間を取る）・`danger`・`zone`・`approach`。タグごとに p50・p95・p99・最大・33.4 ms 超・50 ms 超
  - 場面: 既定（冬・圧雪・曇り）、`month=2&weather=snow`（雪の粒）、`month=10&weather=rain`（紅葉の葉 ＋ 雨。三角形が最も多い）、`month=7&weather=clear`（夏の葉）
  - 構成: PC = 1440 × 900・DPR 2（MacBook の内蔵 GPU。Canvas は DPR の上限 1.5 で 2160 × 1350）、スマホ = 844 × 390・DPR 3・タッチ・CPU 4× 減速（CDP `Emulation.setCPUThrottlingRate`。主スレッドだけが遅くなる）。vsync あり（要件の fps。判定する）と vsync なし（`--disable-gpu-vsync --disable-frame-rate-limit`。1 フレームの仕事の余裕。p50 が 16 ms を下回れば上限が外れている）。GPU なし（SwiftShader）は参考の 1 行だけ
  - 行が有効な条件: renderer が実際の GPU（SwiftShader・llvmpipe でない）、Canvas が計測の終わりに 2160 × 1350（PC）/ 1266 × 585（スマホ）（R4 の自動の段で DPR が下がっていれば NG になる）、`approach` 600 フレーム以上・`zone` 300 フレーム以上・`onset` 30 フレーム以上（赤の出始めを測れていない行は合格にしない。code-reviewer W5）。1 場面が 150 秒
  - `settle`（出発・やり直しから 2 秒。やり直しは押す前から）と `ended`（衝突・完走のバナーの間。衝突した瞬間のフレームを含む）は判定に入れず、行に別に出す（`settle` は R1 の記録には入る。計測では出発の前に 3D を 1 秒描かせてから押す）。50 ms を超えたフレームは間隔とタグを行の `long` に残し、報告に書く
  - 合格（vsync あり。`approach`・`zone` のそれぞれで）: PC は fps の中央値 59 以上・p95 18.2 ms 以下（fps の 5 パーセンタイル 55 以上）・33.4 ms 超が 1,000 フレームに 1 以下・最大 50 ms 以下、`onset` に 33.4 ms 超が 0。スマホ相当は fps の中央値 30 以上・p95 34 ms 以下（30 fps の 33.3 ms に揺れの余裕 0.7 ms）・50 ms 超が 1,000 フレームに 1 以下・最大 100 ms 以下、`onset` に 50 ms 超が 0
  - スマホの GPU（A15・Tensor のフィルレート・頂点）はこの方法では再現できない（M2 の GPU で描く）。実機の確認は Deferred。CPU 4× 減速が効いていることは、同じ計算のループが 69 ms → 274 ms になることで確かめた
- R4: 足りないところを直す（計測の後に決めた。報告 `docs/reports/2026-11-06-performance-measure.md`）
  - 実測（R3）では main の時点で PC・スマホ相当の 8 場面とも合格だった（vsync ありで 60 fps に張り付き、4× の早送りで区間の境界をまたいでも 33.4 ms 超 0）。M2 の GPU で描くので、弱い内蔵 GPU とスマホの GPU は測れていない（Deferred）
  - そこで描くものは変えず、**描画の解像度（DPR）を自動で下げる段**を安全網として入れる（推奨で決定）: 最初の 2 秒の窓（シェーダの組み立て・先読みの評価が重なる）は判定せず、その後、2 秒の窓の fps が「遅い」の線を下回る窓が 2 つ続いたら DPR を 1.5 → 1.25 → 1 と 1 段下げる。「遅い」の線は目標で変える: PC（細かいポインタ）は 45 fps（60 Hz で 4 フレームに 1 回以上逃している）、スマホ（`(pointer: coarse)`）は 27 fps（目標は 30 fps 以上なので、30 fps の張り付きや 32〜44 fps では下げない。performance-analyzer W1）。下げたら戻さない（行ったり来たりで画面がちらつかない）。1 秒を超える間隔（タブを隠した・止めた後の 1 フレーム）は数えない。端末の DPR より上げず、1 より下げない。出発の前の画面でも測る（3D は出発の前から描いている）
  - **見た目が変わるもの**: 遅い端末だけ、画面の細かさ（DPR）が 1.5 → 1.25 → 1 に下がる（輪郭が少し粗くなる）。木・鹿・雪や雨の粒・ミラー（256 × 72・15 Hz）・霧の距離は変えない
  - 直さなかったもの（実測で不要と判断）: 区間の境界の道路と林の作り直しの分散（W1。vsync ありで 4× でも落ちない）、霧で隠れる木の打ち切り（W2）、雪・雨の粒の数（雪 2,000・雨 1,500 のまま）、ミラーの頻度・解像度、影（もとから無い）、木のインスタンス化（もとから InstancedMesh）。実機で 30 fps を割ったら、W2 → 粒の数 → ミラーの頻度の順に見直す
- R5: 初回読込と A-2 の間の先読み
  - 画面のルート（A-2・A-4 の確認・A-6・A-7・運転）はルートの `lazy` で読む。**A-1 だけは入口のチャンクに入れる**: `/` と知らないパスの行き先で、遅延読込にすると入口の JS を実行してから A-1 のチャンクを取りに行くので 1 往復（Slow 4G で約 0.56 秒）遅れる（推奨で決定）
  - A-2（`/trip/:id/brief`）のチャンクを読んだら、ブラウザが空いたとき（`requestIdleCallback`、最長 2 秒。無ければ 1 秒後）に運転のチャンク（DriveRoute・drive・3D）を先読みする。2 回目は読み直さない。失敗しても運転の画面に入ったときに普通に読む。データ節約（`navigator.connection.saveData`）の端末では先読みしない（spec-adversary 9。推奨で決定）
  - 3D のチャンクを読む口は 1 つ（`scene/load-drive-canvas.ts`）。運転の画面の遅延読込と先読みが同じ import を使う
  - 初回読込の測り方（`scripts/perf/measure-load.mjs`）: 本番ビルドを `vite preview`（gzip。本番の Vercel は brotli なのでさらに小さい）で出し、キャッシュなしの Chromium（844 × 390・DPR 3）で開いて、通信が止んでから 1 秒待ち、FCP・LCP（写真など後から来る候補も入る）・load・読んだ JS / CSS の転送量を 3 回の中央値で取る。ウェブフォントは読んでいない（`tokens` の文字は端末の Noto Sans JP / ヒラギノ）
  - 回線: **Fast 4G**（RTT 150 ms・下り 9 Mbps・上り 1.5 Mbps）＋ CPU 4× 減速、**Slow 4G**（Lighthouse のモバイルの値を DevTools で当てたもの: RTT 562.5 ms・下り 1,474.6 kbps）＋ CPU 4× 減速、制限なし
  - 合格: Fast 4G で `/plan` と `/drive`（3D の前の出発の案内）の LCP が 3 秒以内（推奨で決定。要件に回線の条件が無いので、旅行者がふつうに使う 4G を取る）。Slow 4G は記録して、3 秒を超えるならその分を報告に書く
- R6: CI で回すバンドルの上限（`scripts/perf/bundle-budget.mjs`、`local_ci_checks.toml` の検査）
  - 一時フォルダへ本番ビルド（manifest つき）し、画面ごとに「最初に読む JS ＋ CSS」（入口 ＋ その画面のチャンク ＋ それらが静的に読むチャンク）の gzip を上限と比べる。3D は 3D のチャンクとそれが読む共有のチャンクのうち運転の画面の最初の JS に無いもの（three・R3F が共有のチャンクに分けられても抜けない）。全部の JS ＋ CSS の合計にも上限。超えたら失敗
  - ルートの表にも 3D・地図のライブラリの表にも無い遅延読込の口があれば失敗（新しい画面を足したら上限も足す。spec-adversary 11）。feature の barrel が共有のチャンク（`_<feature>-<hash>.js`）に移ったときは、その名前で解く（2 つあれば止める。code-reviewer W8）
  - スクリプトの純粋な部分（`resolveKey`・`closure`・`unknownDynamicEntries`）は小さな manifest で自己テストする（`bundle-budget.test.mjs`。import してもビルドしない。code-reviewer W9）
  - 上限は 2026-11-06 の計測の約 1 割増し（gzip -9 の KB）: `/plan` 205（実測 186.1）・A-2 232（211.3）・A-6 226（205.3）・A-7 214（194.6）・運転 290（263.9）・A-4 の確認 217（197.7）・3D 271（246.5）・全部 1,075（975.8）。main の `/plan` は 228.6。上げるときは理由をこの R6 に書く

## ユースケース

### UC-1: 落ちたフレームを数えて残す（R1）

- **Given**: 運転中
- **When**: rAF の間隔が 40 ms を超える
- **Then**: 落ちたフレームが 1 増え、走行の結果と記録の `frames.dropped`（分母は `frames.counted`）に入る

### UC-2: 開発用の fps の表示（R2）

- **Given**: `/drive?fps=1`
- **When**: 走る
- **Then**: 左下に fps の要約が 0.5 秒ごとに出る

### UC-4: 解像度を自動で下げる（R4）

- **Given**: 遅い端末で運転の画面
- **When**: 最初の窓の後、2 秒の窓の fps が 45 未満（スマホは 27 未満）の窓が 2 つ続く
- **Then**: DPR が 1 段下がる（1.5 → 1.25 → 1）。戻さない

### UC-5: 初回読込（R5）

- **Given**: A-1 を初めて開く
- **When**: 読み込む
- **Then**: 入口（A-1 を含む）のチャンクだけを読み、A-2 を開くと運転のチャンクを先読みする

### UC-6: バンドルの上限（R6）

- **Given**: 本番ビルド
- **When**: local-ci の検査を回す
- **Then**: 画面ごとの最初の JS ＋ CSS、3D、全部の合計が上限以内で、上限の無い遅延読込の口が無ければ通る

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（実機）/ 期日=2026-11-08（Day 6）/ 暫定挙動=CPU 4× 減速の計測で合格とみなす] iPhone 13 の Safari（Web インスペクタ）か Pixel 6 の Chrome で `/drive?fps=1` を走り、左下の fps の 5 パーセンタイルが 30 以上かを見る（GPU 側はこの方法でしか確かめられない）
- [Deferred: 担当=ユーザー / 期日=2026-11-08 / 暫定挙動=M2 の内蔵 GPU の計測で合格とみなす] Windows の PC の内蔵 GPU（Intel Iris Xe など）で同じく 60 fps を見る

## Test List（Canon TDD Step 1）

### 受け入れ（外側ループ）

- [x] AC-1: 実測（R3）で PC の 4 場面が合格、スマホ相当の 4 場面が合格（`docs/reports/2026-11-06-performance-measure.md`）
- [x] AC-2: バンドルの上限の検査（R6）が通り、初回読込（R5）の LCP が Fast 4G ＋ CPU 4× で 3 秒以内（`/plan` 0.91 秒・`/drive` 1.28 秒。Slow 4G は報告に記録）

### UC-1: 落ちたフレーム

- [x] UC-1a: 落ちたフレーム = 40 ms を超えた間隔の数（ちょうど・30 fps の揺れの 33.4〜36 ms は数えない）
- [x] UC-1b: 走行の全体の数（dropped・counted）を外から渡すとそれを使う。空の列は null
- [x] UC-1g: [ADDED spec-adversary 12] 1 ms 未満の間隔でも fps は 1000 で頭打ち
- [x] UC-1c: エンジンは 7,200 フレームの窓より前も走行の全体で数え（dropped・counted）、やり直しで 0 に戻す
- [x] UC-1d: 一時停止の間と、終わった後（衝突・完走のバナーの間）のフレームは数えない
- [x] UC-1e: 記録の `frames.dropped`・`counted` は 0 以上 1,000 万以下の整数で、両方とも省略できる（足す前の run も通る）。片方だけ・`dropped > counted` は弾く（code-reviewer W11）
- [x] UC-1f: 走行の結果から作る run（`toDriveRun`）に `dropped`・`counted` がそのまま入る

### UC-2: 開発用の fps の表示

- [x] UC-2a: 表示の文字列は `fps <中央値> p5 <5 パーセンタイル>` と `drop <落ちた> / <数えた（走行の全体）>`。まだ無ければ `fps --`
- [x] UC-2b: `fps=1` のときだけ出す（`fps=0`・`fps=true`・無しは出さない）
- [x] UC-2c: 0.5 秒ごとに取り直す（その間は前の値）。`aria-hidden`

### UC-4: 解像度を自動で下げる

- [x] UC-4a: 段は 1.5 → 1.25 → 1。端末の DPR より上げない
- [x] UC-4b: 2 秒の窓の fps が 45 未満の窓が 2 つ続いたら 1 段下げる。60 fps では下げない
- [x] UC-4c: 遅い窓と速い窓が交互なら下げない
- [x] UC-4d: 下げたら戻さない。1 より下げない
- [x] UC-4e: 1 秒を超える間隔は数えない
- [x] UC-4f: Canvas の中で、20 fps が 4 秒続くと DPR 1.25、さらに 4 秒で 1。60 fps では変えない（DPR は Canvas の prop にする側へ渡す。描き直しで戻らない）
- [x] UC-4g: [ADDED performance-analyzer W1] 最初の窓（シェーダの組み立てなど）は遅くても判定しない
- [x] UC-4h: [ADDED performance-analyzer W1] スマホ（粗いポインタ）は 30 fps の張り付きや 40 fps では下げず、27 fps を割ったら下げる

### UC-5: 初回読込と先読み

- [x] UC-5a: 入口の A-1 を除いて、画面のルートは `lazy` で Component を返す（element を持たない）
- [x] UC-5b: A-2 のルートを読んだら先読みを予約する。ほかの画面では予約しない
- [x] UC-5c: 先読みは 3D のチャンクを読み、2 回目は同じ Promise
- [x] UC-5d: `requestIdleCallback` があれば最長 2 秒で、無ければ 1 秒後に始める
- [x] UC-5e: [ADDED spec-adversary 9] データ節約（Save-Data）の端末では予約しない

### UC-6: バンドルの上限

- [x] UC-6a: `node scripts/perf/bundle-budget.mjs` が上限以内で exit 0（local-ci の検査）
- [x] UC-6b: [ADDED code-reviewer W8・W9] 共有のチャンクに移った barrel を解き（2 つあれば止める）、closure は静的に読むチャンクと CSS をたどり、知らない遅延読込の口だけを返す（`bundle-budget.test.mjs`）

## 非機能要件

- [x] 性能: R3 の合格（AC-1）
- [x] 初回読込: R5 の合格（AC-2）

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC のテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型）
