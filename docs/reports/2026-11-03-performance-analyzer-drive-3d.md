# パフォーマンス分析結果: drive-3d（performance-analyzer、2026-11-03）

対象: `apps/sim/src/features/drive/`（scene/・domain/simulation.ts・engine.ts・DrivePage）、`apps/sim/src/app/App.tsx` の遅延読込。
要件: ch6「A 性能」（PC 内蔵 GPU 1440×900 で 60 fps、スマホ 30 fps、初回読込は 3D アセットを除いて 3 秒以内）、functional.md R12。
コミット: レビューの途中で 0ec8993（component-guard / alert-contract-guard の Warning 修正）が入った。**結論と実測は 0ec8993 時点**（`useMemo` で `phone` を固定する修正を含む）。ソースは直していない。

## 結論（要約）

- **Critical は 0。** 要件を「破っている」と実測で言える項目は無い。ただし **内蔵 GPU の 60 fps とスマホの 30 fps は、この環境では測れていない（未計測のリスク）**。
- 1016 ms の停止は、コードと実測の両方から **「タブが隠れて rAF が止まっていた」可能性が最も高い**。シェーダーのコンパイルは否定できた（下の I-1）。
- three は初回読込（`index-*.js`）に **入っていない**。ただし `/drive` の出発画面が three 込みの 315 KB (gzip) の到着を待つ（W-2）。
- 直す価値があるのは 3 つ: tick の全ルート走査（W-1）、出発画面と three の分離（W-2）、ヘッドライトの `visible` 切替（W-3、いまの固定の場面では起きない）。

## 計測した環境と方法（再現できるように）

| 項目          | 内容                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| マシン        | Apple M2 の Mac。**要件の「PC 内蔵 GPU（Intel / AMD）」ではない**                                                                                                                                                                                                                                                                   |
| ブラウザ      | Google Chrome for Testing 148 系（playwright-core から起動、`--headless=new --use-angle=metal`）。WebGL は ANGLE Metal / Apple M2                                                                                                                                                                                                   |
| 画面          | 1440×900、deviceScaleFactor 1 / 1.5 / 2（R3F の dpr は 1〜1.5 に丸める）                                                                                                                                                                                                                                                            |
| 注意          | 計測中のマシンは別セッションの負荷が高かった（load average 18〜45）。ミリ秒の値は**ぶれる**。回数・個数・「出たか出ないか」は信頼できる。ミリ秒は静かな時間帯の再計測を採った                                                                                                                                                       |
| CPU（domain） | `vite.createServer().ssrLoadModule()` で本物の `DriveEngine` を Node から 60 fps 相当で回した（Node 22、M2）                                                                                                                                                                                                                        |
| 本番ビルド    | `npx vite build apps/sim`（dist は作業用のスクラッチに出力、リポジトリには残していない）                                                                                                                                                                                                                                            |
| スクリプト    | `/private/tmp/claude-501/-Users-ha-ma-Documents-herald-antler--claude-worktrees-drive-3d-531e17/be29cb5f-7843-4989-a536-d37e807070d5/scratchpad/bench/`（`bench3.mjs` = domain、`pw.mjs` / `pw2.mjs` = ブラウザ、`pw3.mjs` = 本番ビルドの読込、`pw4.mjs` = vsync 無効、`pw5.mjs` = React の commit 数）。リポジトリには入れていない |

**rAF の間隔が 16.7 ms に張り付く値は、vsync の上限であって余裕の証拠ではない。** 3D 担当の自己計測（p50 16.70 ms）も同じ。余裕を見るには下の「GPU の余裕」のように上限を外すか、GPU タイマーを使う。

## Critical（即時対応）

なし。

### Critical ではないが、リリース前に必ず埋める未計測

- **[R12 / ch6] 内蔵 GPU（Intel UHD / Iris Xe、AMD Radeon 680M 級）での 60 fps** | 影響: 要件の合否が未確認 | 理由: `dpr [1, 1.5]` なので、Retina 級の画面や Windows の拡大率 150% では 1440×900 の画面が **2160×1350（約 2.9 MP、MSAA あり）** で描かれる。今回の M2 は vsync を外すと p50 2.0〜2.5 ms / フレーム（DSF 1 でも 1.5 でも）で、約 6〜8 倍の余裕がある。Apple の GPU と Intel の内蔵 GPU の差は「塗りつぶし主体の場面で 5〜15 倍」が目安なので、**DSF 1.5 相当だと 12〜35 ms の幅になり、60 fps を割る可能性は残る**（推定。実機で測ること）
- 測り方（実機の Windows / Intel PC で）: `/drive` を Chrome で開き、DevTools の Performance で 10 秒記録。FPS メーターの 5 パーセンタイルと、GPU 列の「GPU」の太さを見る。コンソールで `__antlerDriveRenderInfo.render.calls` を読む。**1440×900・ブラウザの拡大 100% と 150% の 2 通り**で、鹿 3 頭が見える所（赤になる直前）で測る
- 重かった場合の順番（効果が大きい順の見積もり）: ① `dpr` を `[1, 1.25]` に（塗りつぶしが 0.69 倍）② `antialias: false`（MSAA 分）③ `PerformanceMonitor`（drei）で fps が落ちたら dpr を自動で下げる ④ 林の上限（トドマツ 1100）。3D 担当のメモにある順番（dpr → 林）と同じでよい

## Warning（改善推奨）

### W-1. tick（0.1 秒ごと）が全ルートを走査している | `domain/zone-status.ts` → `@antler/zones` の `projectOnRoute`

- 証拠: `tick()` が毎回 `zoneStatusAt` → `measureAlongRoute` → `projectOnRoute` を呼ぶ。後者は **ルートの全線分（デモで 1,779 本）** を回り、線分ごとに `toLocal` の配列 2 つとオブジェクト 1 つを作り、最後に `Math.min(...candidates.map(...))` で 1,778 個の引数を展開する（`packages/zones/src/route.ts`）。手がかり（`hintKm`）は「近い候補から選ぶ」だけで、走査の範囲は狭めない
- 実測（Node、M2、静かな時間帯）: `zoneStatusAt` 1 回 **p50 164 µs / p95 192 µs**。1× の 1 フレームは p50 1 µs（tick の無いフレーム）、tick のフレームだけ 160〜180 µs。**16× は 1 フレームに tick が 2.67 回** 入るので、平均 **0.45〜0.49 ms / フレーム（p99 0.9〜1.0 ms、最大 1.7 ms）**。そのうち約 9 割が tick
- 影響: いまの M2 では 16.7 ms の 3% で問題ない。ただし ① 遅い CPU（Intel U 系）では 2〜3 倍 ② **ルートの点数に比例**する（plan-trip が実際の道路を 300 km 引くと 10 倍以上）③ 引数の展開は点数が十数万を超えると `RangeError`（スタック超過）になりうる。ブラウザでも 16× のフレームで main thread が 6〜9% → 12% に上がった（`pw.mjs`）
- 改善: `projectOnRoute` に窓（`hintKm ± 300 m` の線分だけ。`road.ts` の `toRoadCoords` がすでに同じ作りで `hintS` の ±300 m を見ている）を入れ、`Math.min(...)` を 1 回のループにする。A は車の道のり `s` を持っているので、0ec8993 のとおり手がかりに `vehicle.s / 1000` を渡せば窓の中心は確実。**zones は B も使うので、PR に「挙動は同じ・探す範囲だけ狭める」と書くこと**
- 推定効果: tick 164 µs → 数 µs（線分 1,779 → 約 30）。16× の 1 フレーム 0.48 → 0.05 ms 前後
- 計測方法: `bench3.mjs` の `zoneStatusAt (1 tick, 1779 seg)` と `16x outside` の行を前後で比べる

### W-2. 出発画面が three・R3F の到着を待つ（空白時間が長い） | `App.tsx` / `DrivePage.tsx`

- 証拠: `App.tsx` は `DrivePage` ごと遅延読込（これは正しい。**`index-*.js`（248 KB / gzip 77 KB）に three は入っていない**。React DOM 202 KB と query-core 24 KB が中身）。しかし `DrivePage` が `DriveCanvas` を静的に import しているので、`drive-*.js`（1,147 KB / gzip 315 KB）が届くまで `Suspense fallback={null}` の**空白**が続く。出発画面（`StartOverlay`）は three を要らないのに待たされる
- `drive-*.js` の中身（ソースマップで計った、min 後）: **three 569 KB + react-reconciler 111 KB + R3F 31 KB + drei 6 KB = 約 720 KB（65%）**、zod 87 KB、drive の自作 113 KB（うち 74 KB はゾーン DB の `?raw` 埋め込み）、alert-ui 14 KB。drei のバレル経由でも troika・GLTFLoader・postprocessing などは入っていない（tree-shaking は効いている）
- 実測（本番ビルド、`vite preview`）:

| 条件                                 | `/`（シェル）の FCP | `/drive` で出発画面が出る | main thread の長いタスク                  |
| ------------------------------------ | ------------------- | ------------------------- | ----------------------------------------- |
| 制限なし                             | 380 ms              | 408 ms                    | 74 ms + 84 ms                             |
| CPU 4 倍遅く                         | -                   | 424 ms                    | 120, 153, 99, 65, 108 ms                  |
| CPU 4 倍遅く + 1.6 Mbps / RTT 150 ms | 832 ms              | **2,855 ms**              | 125, 160, 112, 72, 118 ms（計 約 590 ms） |

- 影響: 「初回読込は 3D アセットを除いて 3 秒以内」は、通常の回線なら満たす。**遅い回線 + 遅い CPU では 2.9 秒で、余裕がほぼ無い**。three 本体を「3D アセット」に数えるかは要件に書かれていないので、判断が要るなら ch9 の判断記録へ
- 改善: `DrivePage` の中で `DriveCanvas` だけを `lazy(() => import('../scene/DriveCanvas'))` にする。出発画面・HUD・エンジンは three なしで先に出る。**出発ボタンを押すまでに three が届いていればよい**（`<link rel="modulepreload">` や `requestIdleCallback` での先読みも可）
- 推定効果: 先に出るチャンクは約 370 KB (min) → gzip 約 100〜110 KB。1.6 Mbps で転送が約 1 秒短くなり、出発画面は 2 秒前後（推定）。計測方法: `pw3.mjs`（`startOverlay` の時刻）
- 付随: `createWorld` の `planRoute`（デモで 35〜55 ms）と `sunsetOf`（720 回の太陽高度）が `useState(createEngine)` で **最初の描画の中で同期実行**される。長いタスクの一部（CPU 4 倍で 150 ms 前後）。出発画面の後ろ（`useEffect` か idle）に回せば、出発画面が先に出る

### W-3. ヘッドライトの `visible` の切替で全マテリアルが再コンパイルされる（潜在） | `scene/Headlights.tsx`

- 証拠: `spot.visible = level.current > 0.01` で、昼（`SKY.day.headlight = 0`）は `visible = false`。three の `projectObject` は `visible === false` のライトを積まない（`WebGLRenderer.js:1875`）ので、`numSpotLights` が 0 ↔ 1 で変わり、**ライトを受ける全マテリアル（道路・雪原・林・車内・鹿）のプログラムが作り直される**（`WebGLPrograms.js:352,490`、`lightsStateVersion`）。同期のコンパイル + リンクで、数百 ms の停止になりうる
- いまのデモは **16:40 開始 = 薄暮（太陽高度 約 +2.6°）で、夜まで `headlight` が 0.8〜1 のまま**なので起きない（`programs.length` が 8 のまま変わらないことを確認済み）。**昼に始まる場面（plan-trip の昼の運転）で、昼 → 薄暮をまたぐ瞬間に起きる**
- 影響: 将来の場面で 1 回だけ 0.3〜1 秒止まる（推定。未検証）
- 改善: `spot.visible` は常に `true` にして、`intensity` だけ 0 ↔ 900 にする（ライトの数を変えない。スポットライト 1 つぶんの fragment は常に払うが、昼でも 1 灯なので軽い）。`PREWARM` と同じ考えで、起動時に光の区分ごとのライト数をそろえる
- 検証: 昼の場面（`startAt` を 12:00 にした DriveScenario）で `__antlerDriveRenderInfo.programs.length` を昼 → 薄暮で比べる

## Info（今は直さない）

### I-1. 1016 ms の停止の切り分け

| 候補                                                  | 判定             | 根拠                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| タブ（Browser pane）が隠れて rAF が止まった           | **最有力**       | `useAutoPause` が `visibilitychange` で一時停止する作り。自己計測の最大 1016 ms は「Browser pane が隠れた・再開の操作をした瞬間と重なっていた」。rAF は隠れている間止まり、戻った最初の間隔が「隠れていた時間」になる。計測側で `document.visibilityState === 'hidden'` の区間を除外すれば確かめられる |
| 最初の鹿のシェーダーのコンパイル                      | **否定**         | `programs.length` が **出発前 8 → 鹿が出たあと 8 → 衝突まで 8**（`pw.mjs` を 3 回）。最初の 3 フレームの先読み（`DeerHerd` の `PREWARM_FRAMES`）が効いている。鹿が出る前後と赤の開始の前後で 33 ms 超の rAF の間隔も長いタスクも無し（`pw2.mjs`、HEAD で 4 回 + その前に 2 回）                        |
| 起動時の同期処理                                      | 別の停止         | 開発サーバでは起動直後に長いタスクが 50〜708 ms 出る（Vite の変換込み）。本番ビルドでは 74 + 84 ms（CPU 4 倍で 5 回・各 65〜153 ms）。運転中の停止ではない                                                                                                                                             |
| GPU プロセス側の初回のパイプライン作成（ANGLE Metal） | **否定できない** | 9 回の走行のうち 1 回だけ、赤の開始の付近で 300 ms の rAF の間隔があり、長いタスクは無かった（main thread は止まっていない）。同じ操作を静かな時間帯に 6 回やって再現しなかった。負荷の高い時間帯（load average 18〜45）のノイズの可能性が高い                                                         |

- 次の一手: 自己計測と performance-analyzer の測定に `visibilityState` の記録と `PerformanceObserver({ type: 'long-animation-frame' })` を足し、Test List の「最初の鹿が出たフレームで 100 ms を超える停止が無い」を、**タブを隠さない条件**で E2E にする。実機の Intel PC でも同じ測定を 1 回

### I-2. 毎フレームの割り当て（GC）

- シミュレーション（domain）: 1× で 1 フレームの割り当ては小さい。**16× は 1 フレーム 25〜45 KB**（Node の heapUsed の差。GC を挟むとぶれる）。ほとんどは tick（W-1 の `toLocal` の配列）。`stepVehicle` が毎ステップ新しい `VehicleState` を返す、`deer.map().filter()` が毎ステップ配列を 2 つ作る、`boxesOverlap` が毎回軸の配列を作る、は 16× で 1 フレーム 16 回回るが、鹿が 3〜5 頭なので数 KB。**気にする量ではない**（V8 の scavenge は 1〜3 ms で、数秒に 1 回）
- 新しく入ったもの: 0ec8993 の `makeFlag` が `buildSimFlag` + `readAlertFlag`（zod のパース）を赤の間 0.1 秒ごとに呼ぶ。1 回 数十 µs 想定で問題なし
- scene: `Atmosphere` が毎フレーム `Color.set(文字列)` を 6 回と `getHexString()` を 2 回（文字列を作る）、`DeerModel` が鹿ごとに `deerPlacement` / `poseAt`（小さいオブジェクトを約 10 個）、`DeerHerd` が `liveIds().join(',')` を毎フレーム。どれも 1 フレーム 数 KB 以下。直すなら `Atmosphere` の `Color.set` を `setHex` の数値にする程度（任意）
- 道路・林の区間の作り直し: `buildRoadChunk` p50 0.39 ms（p95 1.3 ms）、`scatterChunk` p50 0.43 ms（p95 0.7 ms）。16× でも区間の境（約 0.9 秒に 1 回）に 1 区間ぶんだけ。**1 フレーム 2 ms 未満**。ジオメトリは `dispose` されており、`geometries` は 16 → 20 で頭打ち（1.4 km を 16× で走って確認）

### I-3. React の再描画の頻度

- 0ec8993 の `useMemo` 修正で、**`DriveCanvas`（`memo`）は運転中に再描画されない**ことを実測（React の commit フックで数えた）。R3F 側の commit は起動時の 3 回だけ。修正前のコード（9703a31）は `phone` の要素が毎回新しく、コード上は 10 Hz で Canvas に再描画が波及しうる形だった（component-guard W1 と同じ指摘。修正済み）
- HUD（`TopBar`・`DangerOverlay`）は **約 9.6 回/秒**（`PUBLISH_MS` = 100）。drei `Html` の別 root（スマホの画面）も約 9.6 回/秒。DOM の変更は約 125 件/秒。main thread の使用率: 出発前 4%（script 2〜3%）、運転中 8〜10%（script 6〜7%）、16× で 12%（script 9%）。**60 fps の予算に対して十分小さい**
- `useSyncExternalStore` のスナップショットは `encounters.map(...)` を含み、100 ms ごとに作り直し。件数が数件なので問題なし

### I-4. 描画コール・ジオメトリ・シェーダー（開発サーバ、M2、1440×900）

| 場面                     | 描画コール | 三角形                                 | programs | geometries |
| ------------------------ | ---------- | -------------------------------------- | -------- | ---------- |
| 出発前・停車             | 13         | 約 1.7 万                              | 8        | 16         |
| 走行中（鹿なし）         | 13〜14     | 1.7〜3.7 万（区間を 3 つ描くため増減） | 8        | 16〜17     |
| 鹿 3 頭が見える          | 35〜38     | 約 3.9 万                              | 8        | 20         |
| 衝突後（一時停止の描画） | 21         | 約 3.8 万                              | 8        | 20         |

- 鹿 1 頭あたり約 8 コール（実測 35 − 13 = 22 を 3 頭で割ると約 7〜8）。群れ 5 頭で約 55 コール。**描画コールは問題ない**（3D 担当の設計値と一致。自己計測の「34〜35」は鹿が見えている時の値だったと思われる）
- `canvas.width` の再設定は 0 回、カメラの同一性は走行中ずっと同じ（Canvas の再構成なし）、dpr は 1（DSF 1）/ 1.5（DSF 1.5 と 2）

### I-5. 16× の 1 フレームの仕事量

- 16× は 1 フレームに固定ステップ 16 回 + tick 2.67 回。実測 0.45〜0.49 ms（W-1 のとおり約 9 割が tick）。ゾーンの入口を越えたら `entered` で打ち切るので、入口を越えるフレームは軽い
- **追いつきの暴走は起きない**: `MAX_FRAME_MS` = 100 で 1 回に進める実時間を打ち切るので、最悪でも 6 倍 × 16 = 96 ステップ + tick 16 回（約 3 ms、推定）。重いフレームの次が重くなる悪循環にならない
- 鹿が出るのは 300 m 手前から。16× で走っていると、入口で 1× に戻るまでに鹿の判定は走るが、数 µs 単位

### I-6. ビルドの細部

- `packages/zones/src/data.ts` の `new URL('../data/zones.geojson', import.meta.url).href` が、**使われていない 74 KB のアセット**（`zones-*.geojson`）を dist に出す。同じ内容を `?raw` で `drive-*.js` にも埋め込んでいる（74 KB）。実際にフェッチされるのは埋め込みの側。`ZONES_GEOJSON_URL` を使う予定が無いなら、A の側で import しなければ消える（tree-shaking が `new URL` を落とさない）
- `chime-*.wav`（26 KB）は別アセット。出発ボタンで音を起こす時に取るので初回読込には入らない
- `@tanstack/react-query`（24 KB）は `index-*.js` に入っているが、いまは使っていない。`/drive` の初回読込が重くなる要因ではない
- zod（87 KB）が drive のチャンクに入る。alert-ui と schema が使うため。外せない

### I-7. その他

- `frameloop` が `always` のまま。**一時停止・終了・出発前も 60 fps で全部描き直す**（モバイルの電池）。止まっている間は `frameloop="demand"` + 必要時に `invalidate()` にできるが、視線（マウス）で動くので効果は限定的。スマホ（30 fps）の実装時に決める
- 描く範囲（前 720 m）が夜のフォグの far（300 m）より長い。見えない遠方は頂点処理だけで fragment はフォグで塗りつぶされるので、軽微。夜に範囲を縮めるなら `DRAW_AHEAD_M` を光の区分で変える
- スマホ（mobile-landscape）は未実装なので 30 fps は未計測。`dpr` を 1.5 までにしているので、3 倍の画面でも 1.5 に丸まる。`PerformanceMonitor` を入れる時に一緒に
- 乱数・時刻: シミュレーションは `performance.now()` を使わず固定ステップなので、同じシードで再生できる性質は性能対策で壊れていない

## パフォーマンス予算

| 項目                             | 現在（M2、開発機）                                                    | 目標・要件                           | 判定                              |
| -------------------------------- | --------------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| 初回読込（シェル `/`）           | JS 248 KB (gzip 77 KB)、FCP 380 ms                                    | 3 秒以内（3D 除く）                  | 満たす                            |
| `/drive` の出発画面              | 408 ms（制限なし）/ 2,855 ms（CPU 4 倍 + 1.6 Mbps）                   | 3 秒以内                             | 満たす（遅い回線は余裕なし）→ W-2 |
| three を含むチャンク             | 1,147 KB (gzip 315 KB)。うち 3D エンジン 約 720 KB                    | 初回読込に入れない                   | 満たす（`index` に three なし）   |
| フレーム時間（CPU、main thread） | 1× 6〜10% = 約 1.0〜1.7 ms、16× 12% = 約 2 ms                         | 16.7 ms 未満（60 fps）               | 満たす                            |
| domain の 1 フレーム             | 1× p50 1 µs / tick のフレーム 0.17 ms、16× 平均 0.48 ms（p99 1.0 ms） | 1 ms 未満                            | 満たす → W-1                      |
| 描画コール                       | 13（鹿なし）〜38（鹿 3 頭）、群れ 5 頭で約 55                         | 100 未満（目安）                     | 満たす                            |
| 三角形                           | 1.7〜3.9 万                                                           | 10 万未満（目安）                    | 満たす                            |
| シェーダーの数                   | 8 のまま変化なし                                                      | 鹿が出ても増えない                   | 満たす（昼 → 薄暮は W-3）         |
| 起動時の長いタスク（本番）       | 74 + 84 ms（CPU 4 倍で 5 本・計 約 590 ms）                           | 1 本 200 ms 未満（目安）             | 満たす（CPU 4 倍で余裕なし）→ W-2 |
| 60 fps（内蔵 GPU、1440×900）     | **未計測**（M2 では上限を外して p50 2.0〜2.5 ms）                     | 60 fps、5 パーセンタイル 30 fps 以上 | **要実機**                        |
| 30 fps（スマホ）                 | **未計測**（mobile-landscape が未実装）                               | 30 fps                               | **要実機**                        |

## 次の一手

1. 実機の Windows / Intel PC で `/drive` を 100% と 150% の拡大率で測る（上の手順）。60 fps を割れば dpr 1.25 → `antialias: false` → `PerformanceMonitor` の順
2. W-2（`DriveCanvas` だけ `lazy`）と W-1（`projectOnRoute` の窓）を、drive-3d の PR に入れるか次の feature に回すかをメインが決める。W-2 は 5 行ほどで効果が大きい
3. W-3 は昼の場面を作る feature（plan-trip 連携）の前に直す。いまは起きない
4. Test List に追加: 「最初の鹿が出たフレームで 100 ms を超える停止が無い（タブを隠さない）」「`programs.length` が鹿の出現・光の区分の切替で増えない」
