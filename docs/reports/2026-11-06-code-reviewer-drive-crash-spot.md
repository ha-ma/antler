# code-reviewer: drive-crash-spot（branch claude/drive-crash-spot-6469d4）

対象: R1（1 km 手前）・R2（スマホ固定）・R3（衝突の演出）・R4（鹿の発見・A-6 の spot・A-7 の集計）と `packages/trip` の省略できる `spotting`。
読んだ範囲: domain/spot.ts・crash.ts・stages.ts・simulation.ts（countSeen 周り・driveResult）・engine.ts・hooks/use-crash-sequence.ts・use-deer-tap.ts・scene/DeerPicker.tsx・DriverCamera.tsx・DrivePage.tsx・DriveRoute.tsx・hud/CrashOverlay.tsx・SpotCount.tsx・spot-text.ts（drive・loss）・loss/utils/collision-url.ts・record/utils/drive-run.ts・packages/trip の run.ts・summary.ts・text.ts・drive.css の該当部。テストは実行していない（コードの読みのみ）。

## Critical（修正必須）

なし。二重計上・タイマーの漏れ・衝突中のリトライ・URL の読み・シード外の乱数・色の直書き・絵文字は、下に挙げる範囲では問題を見つけなかった。確かめた根拠は「良い点」に残す。

## Warning（推奨）

- **W1: [packages/trip/src/record/run.ts:71, 81 / summary.ts:50-56] 「片方だけ古くても 400・読み込み失敗にしない」（spec R4 配る順番）は strictObject のため成り立たない。**
  - 新 sim → 旧 api: `DriveRunInputSchema` は `z.strictObject`。`spotting` を含む run を旧 api に送ると未知の欄で 400。
  - 旧 sim ← 新 api: `totals.spotting`（全 run が `spotting` を持つときだけ入る）を旧 `TripRecordSchema` が未知の欄として落とす可能性が高い（totals が strict なら読み込み失敗）。
  - 旧 api に戻した場合も、保存済みの `spotting` つき run は旧スキーマで不正行扱い（`drizzle-record.repository.ts:21`、`record.run.invalid` の警告）になる。
  - spec は「同時に出す」前提なので Critical にはしないが、受け入れ条件の文と実装がずれている。次のどちらかにする。
    - 文を「同時に出す。ずれると 400」に直す。
    - 順に出す（先に api の読みだけを広げる）と PR に書く。
  - sim は SW やキャッシュで古いバンドルが残るので、新 sim → 旧 api の向きは起きにくいが、逆（旧 sim ← 新 api）は起きうる。

- **W2: [apps/sim/src/features/loss/spot-text.ts:7-12 と packages/trip/src/record/text.ts:92-97] A-6 と A-7 の「自分で見つけた鹿」の文が二重定義で、en / zh の言い回しがずれている。**
  - en: `from over 60 m away` と `more than 60 m ahead`。
  - zh: `60 公尺外發現 {early} 頭` と `60 公尺以外 {early} 頭`（後者は「何が 60 m 以外か」が曖昧）。
  - 「60 m」は `SPOT_EARLY_M`（domain/spot.ts:9）と別に 4 言語 × 3 か所に文字で埋まっている（loss・trip・ja の説明文）。しきい値を変えると文が嘘になる。
  - 改善: 文は 1 か所に寄せる。`@antler/trip` の `text.ts` を正にして A-6 もそこから読む（loss は trip に既に依存している）か、文面だけでも揃える。しきい値は `{m}` のプレースホルダにして `SPOT_EARLY_M` を差し込む。

- **W3: [apps/sim/src/features/drive/hooks/use-deer-tap.ts:20-36] 押したままキャンバスの外で離すと `downs` に残る。**
  - `pointerup` を canvas 自身にだけ付けているので、ポインタをキャプチャしていない場合（マウスでキャンバスの外に出て離す）に `downs` の項目が残る。
  - マウスの pointerId は固定なので次の `pointerdown` で上書きされ、実害は小さい。タッチは `pointercancel` が来るため同様。
  - 視線のドラッグ側（use-touch-drive / look-input）が `setPointerCapture` していれば起きない。確認して、していなければ `lostpointercapture` か `pointerleave` でも消す。

- **W4: [apps/sim/src/features/drive/hooks/use-crash-sequence.ts:12-26] 「終わったか」を state にして、cleanup で `setEnded(false)` している。**
  - 動作は正しい。`crashed` が false に戻れば計りは止まり、`onEnd` は呼ばれない。最新の `onEnd` を ref で呼ぶので、同一性が変わっても計り直さない。
  - ただし cleanup 内の setState は、アンマウント時にも走る無駄な更新になる。
  - `crashed` の立ち上がりごとに増える id（`runId`）を持ち、`endedId === runId` で導出すると state のリセットが要らなくなる。または `DrivePage` 側で `key` を使う。
  - 今の形で eslint-disable が 1 行入っている点は許容範囲。

## Info（参考）

- I1: [apps/sim/src/features/drive/domain/crash.ts:4] `CRASH_MS` のコメントが「onFinish（A-6 へ移る）までの時間」のまま。spec 改定後は `onCrashEnd`。`onFinish` は当たったフレームで呼ぶので誤解を生む。直すのはコメントだけ。
- I2: [apps/sim/src/features/drive/domain/spot.ts:164-170（engine.ts）] `engine.spot()` が返す `'early' | 'late' | null` は DrivePage では捨てている（`void engine.spot(...)`）。将来の効果音用なら良いが、今は YAGNI。テストのためなら残して構わない。
- I3: [apps/sim/src/features/drive/components/drive.css:812-814, 837-843] 3D のキャンバスの親に `filter: blur(6px) brightness(0.6)` を 2.2 秒当てる。WebGL を全画面で再合成するので、低性能端末では衝突の直後にフレームが落ちうる。衝突後は World が止まるので結果への影響は無いが、performance-analyzer の対象（60 / 30 fps）に入れるとよい。reduced-motion では `animation: none` になっている点は良い。
- I4: [apps/sim/src/features/drive/scene/DriverCamera.tsx:26-38] 揺れは `performance.now()`（実時間）で、乱数を使わず時刻の正弦で決めている。シード規則には触れない。揺れの起点は「衝突後の最初の描画フレーム」、演出の計りは「React のコミット後」で、数フレームずれる。見た目には問題ない。
- I5: [packages/trip/src/record/summary.ts:50-56] `totals.spotting` には `SpottingSchema` の `early ≤ found ≤ appeared` の refine が無い（合計なので run が通っていれば成り立つ）。出力側の検証を省いているだけで問題は無い。上限（999）も付けていないのは、日をまたぐ合計だから妥当。
- I6: [apps/sim/src/features/record/utils/drive-run.ts:66-69] `spottingOf` は不正な値を黙って落とす。「run の保存を失敗させない」意図がコメントにあり、spec の方針（保存は壊さない）と合う。握り潰しにあたらないが、落としたときにログを 1 行出すと原因を追える。
- I7: [apps/sim/src/features/loss/utils/collision-url.ts:72, 18-20] `SPOT_RE`（3 桁）と `IntText`（9 桁）は別の上限。`spot` は別の文法なので意図どおり。`MAX_SPOT = 999` は `MAX_SPOTTED_PER_RUN`（packages/trip）と同じ値の重複なので、将来は片方から読むと良い（sim → trip の依存は既にある）。

## 良い点（確かめた根拠）

- 二重計上: `spotDeer` は `spotted` Set で 1 頭 1 回、`countSeen` は `seen` Set で 1 頭 1 回。`spotDeer` が先に押された鹿を `seen` に足してから `found` を増やすので、`appeared ≥ found` が常に成り立つ（domain/spot.ts:52-78）。`early ≤ found` も同じ分岐で保たれる。
- 一時停止・衝突・完走のあとは `outcome !== 'driving' || paused` で数えない（spot.ts:65）。衝突後に `found` が動かないので、`onFinish`（当たったフレーム）と `onCrashEnd`（3.5 秒後）の `result().spotting` は一致する。
- 「もう一度」は `createWorld` で `spotting`・`spotted`・`seen` を作り直す（simulation.ts:118, 138-139）。World に持つので、同じシードでもう一度すると 0 に戻る。
- タイマー: `useCrashSequence` は `crashed` が false に戻る・アンマウントで `clearTimeout` する。`EndBanner` を演出中は `outcome='driving'` として隠すので、衝突中に「もう一度」を押す道が無い（DrivePage.tsx:225-230）。キーボードの再開も `restart` の呼び出しは `retry` だけ。
- URL: `spot` は他の欄と別に読み、同名の 2 回は URL ごと不可（collision-url.ts:128-139）。順序 `found.early.appeared` と `checkSpotting` の `early ≤ found ≤ appeared`・`appeared ≥ 1` が書き込み側と読み側で一致。先頭 0 の禁止も正規表現で効いている。
- 色・文字: 追加した CSS（drive-phone・drive-hud__spot・drive-crash）に色の直書きは無く、`--ink`・`--ground`・`--line`・`--surface` のみ。`alert-danger` は使っていない。コードに絵文字も無い。4 言語の表は `*text.ts` に置かれ、zh は繁體字（發現・頭・公尺）。
- 乱数: 発見の判定・当たりの球・揺れのどこにも `Math.random` は無い。
- R2: スマホは `.drive-hud` の中に `pointer-events: none` で置かれ、下の鹿のタップを奪わない（drive.css:743-749）。HUD の他の層も `pointer-events: none`。
- R1: `STAGE_LEAD_M = 1000`、始点より前は 0 に丸め、`startM <= last.exitM` でまとめる（stages.ts:37-52）。
- 後方互換: `spotting` は `run`・`totals` ともに optional。古い run は `sumSpotting` が `undefined` を返して集計の欄を出さない（一部の合計を全体に見せない）。api は run を JSON のまま保存して再検証するので（drizzle-record.repository.ts:21）、列の追加は不要。
