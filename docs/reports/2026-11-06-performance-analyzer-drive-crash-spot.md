# performance-analyzer: drive-crash-spot（静的レビュー、2026-11-06）

対象: claude/drive-crash-spot-6469d4（`git diff main...HEAD` ＋ `git diff HEAD`）。コードの読み取りのみ。実測はしていない（下の「計測」で確かめる）。
目標: PC 60 fps / スマホ 30 fps（docs/specs/performance/functional.md R3 の合格線: スマホ p95 34 ms 以下、50 ms 超が 1,000 フレームに 1 以下）。

## Critical

なし。衝突の演出は「走行が終わった後の約 3.2 秒」だけで、合格線の計測区間（approach・zone・onset）には入らない。下の W1・W2 は、スマホで演出の間にフレームが落ちる可能性が高いが、判定の対象外になりやすい。落ちても run の記録（frames）に残るので、`dropped` を汚す点は要注意。

## Warning

### W1. `.drive__scene` に filter（blur ＋ brightness）をアニメーション ― drive.css:812-814, 837-844

- 事実: `.drive__scene` は WebGL の Canvas の親。R3F は衝突後も毎フレーム描き続ける（`frameloop` は既定の always、DriveCanvas.tsx:21）。つまり「毎フレーム内容が変わる大きな層」に「半径が毎フレーム変わる blur」を 1.0〜3.2 秒かけている。
- 影響: ぼかしの半径が変わるたびに、層全体（PC は 1440×900 × DPR、スマホ横は 844×390 × DPR 3 ≒ 2532×1170 = 約 300 万画素）を中間テクスチャに取り直して 2 パスで畳み込む。Chrome では compositor で動くが、中身が毎フレーム変わるのでキャッシュが効かない。GPU が WebGL の描画と同じ予算を奪う。iOS Safari は大きな WebGL 層への filter が特に重く、CPU 4× 減速の計測（R3）にも出ない（GPU の仕事なので）。
- 見積り: M2 クラスでは気づかない。弱い内蔵 GPU・スマホでは、blur ＋ 描画で 1 フレームが 33 ms を超える可能性がある（推測。実測が要る）。
- 改善（見た目を保つ順）:
  1. 衝突の演出が始まったら（または揺れが終わる 0.8 秒の時点で）Canvas の `dpr` を 0.5 前後に落とす。CSS の拡大（双線形補間）が自然なぼかしになり、画素数は 1/4〜1/9。filter は不要。DriveCanvas の `dpr` state を使えば足りる（AdaptiveDpr の「下げたら戻さない」と同じ仕組み）。効果が最も大きい
  2. 揺れが終わった後（0.8 秒以降）は 3D の中身が動かない（`world.t` は止まる）。blur を固定値（例 4px）にして、半径を動かさず `opacity` の暗転（vignette 側）で時間変化を見せる。層が変わらなくなれば合成のキャッシュが効く。さらに R3F の `frameloop` を `demand` にして `invalidate()` を止めれば、描画自体が 0 になる
  3. 妥協案: `filter` を `blur(6px)` の一定値にし、`steps(4)` で 4 段にする（再計算が 4 回だけ）
- reduced-motion は filter 無しで対応済み（drive.css:851）。

### W2. `.drive-crash__vignette` の box-shadow アニメーション（spread 80vmax、blur 25vmax）― drive.css:796-800, 825-835

- 事実: box-shadow は compositor で動かせない。毎フレーム main thread で paint ＋ raster が走る（全画面 2900 ms）。inset の影は blur 半径 25vmax（PC 225px、スマホ横 約 98px）のガウスぼかしを毎フレーム作り直す。しかも W1 の blur と同じ 1.0〜3.2 秒に重なる。
- 影響: スマホの CPU ラスタ・GPU ラスタとも負荷が高く、全画面の再描画なので W1 とも競合する。
- 改善: 影を動かさず、`transform` と `opacity` だけで動かす（compositor のみ）。
  - `.drive-crash__vignette::before` に `width/height: 300vmax` の正方形、中央配置、`background: radial-gradient(circle, transparent 0 20%, var(--ground) 55%)`、`will-change: transform`。`transform: scale(2.4) → scale(0.5)` を keyframes に（中心が閉じていく）。0〜15% の「周りが暗くなる」は `opacity` で足す
  - グラデーションは 1 回だけラスタされ、アニメーションは合成だけになる。見た目はほぼ同じ（ぼかし幅はグラデーションの勾配で決まる）
- 見積り: main thread の paint が 0 になり、W1 の改善と合わせてスマホで演出中のフレーム落ちを避けられる見込み。

## Info

### I1. countSeen を 0.1 秒ごとに呼ぶ ― domain/spot.ts:52-57, simulation.ts:458

- 問題なし。鹿は少数（`world.deer` の走査 O(n)）、`seen` は Set で 1 回済みは早く抜ける。ただし毎回 `deerVisible` → `distanceToCar` → `poseAt` を 2 回（車と鹿）呼ぶ。`poseAt` は segmentIndex（二分探索か線形かは未確認。road.ts:72）＋ オブジェクト 2 つの割当。直前のループ（simulation.ts:441-443）が同じ鹿の `poseAt` と距離をすでに計算しているので、重複計算ではある。
- 優先度は低い（10 Hz × 鹿 十数頭 ≒ 毎秒数百回）。直すなら、そのループで出した `distanceM` を `countSeen(world, distances)` に渡す。premature optimization になるので、実測で `engine.frame` が目立ったら。
- `deer.gone` と 150 m 超は `deerVisible` の先頭で落ちるが、`distanceToCar` が先に走る（`deer.gone` の判定は距離計算より前なので OK）。

### I2. spotTargets / pickDeer はタップごと ― spot.ts:82-114, DeerPicker.tsx:19-33

- 問題なし。タップは人の操作の頻度（毎秒数回以下）、配列の割当は鹿の数だけ。`Raycaster` と `Vector2` は `useState` の初期化で 1 回だけ作っている（DeerPicker.tsx:19）。`[origin.x, ...]` の 2 つの配列は1 タップ 2 個で無視できる。
- `useThree((s) => s.gl)` と `s.camera` の購読は、camera が差し替わらない限り再描画しない。DeerPicker は `null` を返すので、再描画しても DOM・シーンのコストは 0。
- 軽微: `onSpot` が `useDeerTap` の `latest` ref 経由で最新を呼ぶ作りは良い（購読の付け外しが起きない）。

### I3. use-deer-tap の pointer イベント ― hooks/use-deer-tap.ts

- `pointermove` を購読していない（down/up の位置だけ比較）ので、ドラッグ中のコストは 0。良い設計。`downs` の Map はポインタごとの 1 要素。
- `getBoundingClientRect()` は pointerup のたびに 1 回（強制レイアウトだが、タップごとなので問題なし）。
- `touch-action: none` は `.drive__scene` にあるので、タップ判定の 300 ms 遅延は無い。

### I4. DriverCamera の衝突の揺れ ― scene/DriverCamera.tsx:30-50

- 問題なし。`crashShake` は 0.8 秒だけ sin 3 個。戻り値のオブジェクトは 1 フレーム 1 個（`STILL` と `NO_SHAKE` は定数）。0.8 秒 × 60 = 約 48 個で GC に出ない。
- `prefersReducedMotion()` は衝突につき 1 回（`??=`）。毎フレームの `matchMedia` ではない。
- `crash.current ??= {...}` の `{at, reduced}` は衝突のたびに 1 個。
- `cam.rotation.set(..., 'YXZ')` にロールを足したのでオイラー角の再計算が 1 回。無視できる。

### I5. drei Html の削除 ― Cabin.tsx, DriveScene.tsx, PhoneScreenHtml.tsx（削除）

- 勝ち。drei の `Html` は毎フレーム、投影行列から CSS の `matrix3d` を作って DOM の style を書き換え（transform は毎フレーム変わる）、別の React ルートを持っていた。これが無くなり、3D の毎フレームの DOM 書き込みが 0 になる。車の揺れ・視線で動くスマホのため、層ごと再合成されていた分も消える。
- バンドル: Html は drei の一部なので tree-shaking で減る分は小さい（`@react-three/drei` の他のものを使っていれば同じ）。`vite build` のサイズは未計測。performance R6 の上限は `npm run build` の後に `scripts/perf` で確認する。
- PhoneScreenHtml が `PhoneScreen` に置き換わり、同じ React ツリーの中。別の React ルートの生成（`createRoot`）が消えた分、出発時の初期化も少し軽い。

### I6. PhoneScreen が HUD の DOM に（transform: scale 0.6 / 0.42）― PhoneScreen.tsx, DrivePage.tsx:185, drive.css:737-760

- 再描画の頻度: `useDriveSnapshot` は `useSyncExternalStore(engine.subscribe, engine.getSnapshot)`。エンジンの `publish()` は 0.1 秒ごとと状態の変化で新しい snapshot を作る（engine.ts:210-214）。つまり PhoneScreen は 10 Hz で描き直す。
- ただし DrivePage 自身が同じ snapshot を購読している（DrivePage.tsx:93）ので、HUD 全体がすでに 10 Hz で描き直されている。PhoneScreen の購読が増えても、同じコミットの中で処理される（React が束ねる）ため追加の描き直しは実質 0。`PhoneScreen` は `memo` されていないが、props（`engine`・`controller`・`muted`）が変わらないので、`memo` で包めばさらに子の再計算を省ける。`AlertState` の props（`state`・`distance`・`side`・`lang`）が変わらない間は一致するので、`memo(PhoneScreen)` ＋ `useDriveSnapshot` の代わりに alert だけを `useSyncExternalStore` で選ぶ（`getSnapshot` で `snapshot.alert` を返す。同一参照なら描き直さない）手がある。ただし `alert` が 0.1 秒ごとに新しいオブジェクトなら効果は無い。要確認（makeSnapshot の中身を見ていない）。優先度は低い。
- `transform: scale()` 自体は静的で、層のラスタ（180×360 の箱を 0.6 倍）は 1 回。距離の数字が 10 Hz で変わると、この小さな層だけ再ラスタ（約 108×216 CSS px）。`.drive-phone` の `box-shadow: var(--shadow-card)`（blur 40px）は静的なので毎回は再計算しない（子が変わるたびに親の影が再ラスタされる場合があるが、`pointer-events: none` の小さな層）。
- 注意: `.drive-phone` と `.drive-phone__screen` に `will-change` は無い。danger の 1 Hz 点滅（AlertState）が走ると、この箱の中だけが 1 Hz で再描画される。許容範囲。
- 3D の上の DOM が増えると合成する層が 1 つ増える。`.drive__scene` に blur がかかる W1 の間は、この HUD の層は filter の外（兄弟）なので影響しない。

### I7. 追加の観察

- 衝突後 0.8 秒以降は 3D が動かないのに R3F は毎フレーム描画する。W1 の改善 2 で止めるか、`CRASH_MS`（約 3.5 秒）の間だけなので、止めなくても害は小さい。
- `useCrashSequence` は `setTimeout` 1 回。問題なし。
- `SpotCount` は `spotting.appeared === 0` で `null`。10 Hz の描き直しで文字列を作るだけ。問題なし。

## 計測（推奨）

1. スマホ相当（844×390・DPR 3・CPU 4× 減速。scripts/perf/measure-drive.mjs の構成）で、衝突を起こす場面（`onset` の後にそのまま衝突させる）を追加し、衝突〜3.5 秒のフレーム間隔の p95 と最大を取る。W1・W2 を直す前後で比べる。GPU の負荷は CPU の減速に出ないので、実機（iPhone 13 / Pixel 6）の Chrome DevTools の Performance（Layers・Rasterize・GPU のトラック）か Safari の Web Inspector の Timelines で見る。
2. 判定の線は performance R3 のスマホ「50 ms 超が 1,000 フレームに 1 以下・最大 100 ms 以下」を使う。
3. 演出中に `FrameSummary.dropped` が増えるなら、record の frames に衝突の演出分が入る。演出の間（`world.outcome === 'collided'`）はフレームの計測から外すかを performance の R1 と照らして決める（別のコミットで）。

## パフォーマンス予算

- 衝突の演出中のフレーム: スマホ p95 34 ms 以下を目標（現在は未計測）
- 描画の画素数: 演出中は DPR 0.5 前後（W1 改善 1）で 1/4〜1/9
- main thread の paint: 演出中 0（W2 改善後。現在は 2.9 秒間 毎フレーム）
