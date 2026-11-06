# code-reviewer レビュー: feat/drive-tune（apps/sim/src/features/drive）

対象: domain/simulation.ts・vehicle.ts・deer-spawn.ts・stages.ts・powertrain.ts・dashboard.ts、scene/RearMirror.tsx・Dashboard.tsx・dashboard-text.ts・dashboard-paint.ts。
仕様: docs/specs/drive-tune/functional.md、docs/changes/2026-11-06-a-local-feedback.md。component-guard の W-1〜W-3 は除く。
注意: このセッションには Bash が無く、`git diff` とテストの実行はしていない。ファイルを直接読んだ結果で、数値の見積もりは手計算。

## 件数

- Critical: 0
- Warning: 9
- Info: 6

## 良い点

- clearStage の順番（zone-exit → alert-release → stage-clear → completed）が仕様どおり。settlePending を `world.deer = []` より先に呼んでいる（simulation.ts:265-271）。
- 時計は `if (target > now) clockShiftMs += ...`（simulation.ts:285-287）で加算のみ。巻き戻る経路が無い。
- 鹿の乱数の消費順（between → u → pickWeighted → side → herdSize）が変わっていない。`guaranteed` と eyeshine→crossing の置き換えは rng を追加で引かない（deer-spawn.ts:54-64）。同じ種なら同じ鹿が保たれる。
- vehicle.ts は仕様どおり: μ(v) の clamp 0.85〜1.05、BRAKE_RISE_S の直線の立ち上がり、S は 0.6、ABS は dry を除く＋10 km/h 以上、摩擦円は横のグリップだけを `1 − 0.5 × brakeLevel` で減らす。powertrain.ts の 22.5〜97.5 km/h、1,200 / 2,500 / 3,000 rpm、8% も一致。シフトアップ直後の回転数は 1,500〜2,031 rpm で 1,200 を下回らず、ハンチングしない。
- stages.ts の統合は `startM <= last.exitM`（仕様の「0 以下」）で正しい。
- Dashboard の canvas は鍵が変わったときだけ描き直し（最大 12 Hz）、フォントの読み込み完了でも描き直す。RearMirror は 15 Hz に間引き、`live` で偽の GL 文脈を避けている。useFBO は外れるときに drei が dispose する。

## Critical（修正必須）

なし。

## Warning（推奨）

### W-1 [simulation.ts:268-270, 478-483] クリア時に「車の直後 10 m 以内」を通り過ぎた鹿が永久に pending になる

`settlePending` は `deer.s < vehicle.s - PASSED_BEHIND_M`（10 m）の鹿だけを avoided にする。直後に `for (const d of world.deer) leftBehind.add(d.id)` で、残りの鹿（前にいる鹿と、後ろ 0〜10 m の鹿）をまとめて leftBehind にする。leftBehind の鹿は tick と最終の settlePending の両方で skip されるので、後ろ 0〜10 m にいた鹿は二度と avoided にならない。出口の際に通り過ぎた鹿ほど回避率を下げる（水増しの逆）。仕様は「後ろに過ぎた鹿は回避」「まだ前にいる鹿は pending」。
→ クリア専用に判定する。

```ts
for (const e of world.encounters) {
  if (e.outcome !== 'pending') continue
  const deer = world.deer.find((d) => d.id === e.deerId)
  if (!deer || deer.s < world.vehicle.s) e.outcome = 'avoided'
  else internal.leftBehind.add(e.deerId)
}
```

leftBehind に入れるのは「前にいる」鹿だけにする。

### W-2 [simulation.ts:194-199, 246-247] ステージの移動のあとも、同じフレームの残りのステップが走る

`for (k < steps)` は `entered` のときだけ break する。16× のとき steps = 16 で、clearStage が途中で再生速度を 1× にしても、そのフレームの残りのステップ（最大 15）は次のステージの始まりで走る。5 km 手前に着いた直後に最大 15 × 16.7 ms × 速さ（最大 27.8 m/s）≒ 6 m 進む。仕様の「ステージの移動は再生速度を 1× にする」とはずれる（結果は決定的）。
→ clearStage を起こしたステップでも break する。`stepOnce` が戻り値に `entered || cleared` を返すか、`const idx = world.internal.stageIndex` を控えて `if (entered || world.internal.stageIndex !== idx) break`。

### W-3 [simulation.ts:249-253] ゾーンがルートの終端まで続く日は、stage-clear も alert-release も出ない

最後のゾーンの出口がルートの終点（`exitM >= lengthM - 1`）のとき、`s > stage.exitM` より先に `s >= lengthM - 1` の完走（249）が成立する。この経路は `stage-clear` を出さず、赤の最中でも `alert-release` を出さず、フラグも解除しない。仕様 R1 の「赤の最中なら alert-release → stage-clear → completed」を満たさない（音を鳴らす側のビープが止まらない可能性）。目的地がゾーンの中にある日（阿寒湖など）で起きうる。
→ 完走の判定を clearStage に寄せる。最後のステージで `s >= lengthM - 1` になったら `clearStage` を呼ぶ（`stage && (s > stage.exitM || (isLast && s >= lengthM - 1))`）。

### W-4 [stages.ts:44, trip-scenario.ts:55] 距離 0 の移動で時計が NaN / Infinity になる

`mps: leg.durationMin > 0 ? distance / duration : 50/3.6` は `distanceKm === 0 && durationMin > 0` で mps = 0 になる。`scheduledClockAt` は `Math.max(0, sM - leg.sM) / leg.mps` なので 0/0 = NaN か Infinity。`clockShiftMs` が NaN になると、後の `new Date(NaN).toISOString()` が RangeError を投げる（simulation.ts:147, 427 の toJst 経由。完走・アラートの記録で落ちる）。距離 0 の移動が実データで起きるかは確認していない。
→ trip-scenario.ts:55 を `leg.distanceKm > 0 && leg.durationMin > 0 ? ... : 50 / 3.6` にし、scheduledClockAt でも `Number.isFinite(result) ? result : toInstant(leg.departAt)` で守る。

### W-5 [deer-spawn.ts:48] `CANDIDATE_JITTER_M = 150` に届かない（実効は 140 m）

`jitter = Math.min(CANDIDATE_JITTER_M, step * 0.35)` で、step は最大 400 なので上限は 140 m。定数 150 は一度も効かない。仕様は「候補の間隔は 400 m（±150 m）のまま」。drive-3d で 140 のまま通っていたなら定数のほうが嘘。シードの再現性（既存の鹿の位置）を変えたくないなら定数を 140 に直し、変えてよいなら係数を 0.375 にする。どちらにするかは決めて、コメントと合わせる。

### W-6 [Dashboard.tsx:55-69] 毎フレームの割り当て（60 fps で捨てるオブジェクトと文字列）

useFrame のたびに `dashboardOf`（Dashboard とネストした nav の 2 オブジェクト）、`formatDashboard`（DashboardText と、String()・テンプレート・`new Date`・`toFixed`・`padStart` の文字列が約 10 個）、`dashboardKey`（さらに 1 文字列）を作る。canvas は 12 Hz に抑えているのに、文字列の組み立てはその 5 倍の頻度で走る。simulation.ts の冒頭の方針（「60 fps でゴミを出さない」）と合わない。
→ 描き直しの間隔を先に見る。`p.since += delta` のあと、`p.since < MIN_REPAINT_S && d.abs === p.abs && p.key !== ''` なら `formatDashboard` を呼ばずに return（ABS は `d.abs` で見られる）。針の角度だけは毎フレーム `dashboardOf` の値で足りる。さらに詰めるなら、針用に `speedKmh` と `rpm` だけを返す関数を分ける。

### W-7 [RearMirror.tsx:52, Dashboard.tsx:44] props で渡した BufferGeometry が dispose されない

`buildMirrorFace()` と `buildNeedle()` の結果を `useMemo` で作り、`geometry={...}` で渡している。R3F が自動で dispose するのは JSX で作った子（`<planeGeometry>` など）で、props に渡した既存のオブジェクトは対象外。「同じシードでもう一度」で DriveScene が作り直されるたびに GPU のバッファが増える（小さいが累積する）。canvasTexture・material は JSX なので問題なし。useFBO も drei が捨てる。
→ 同じファイルに `useEffect(() => () => geo.dispose(), [geo])`。または `<primitive object={geo} attach="geometry" dispose={null}>` ではなく、JSX の `<bufferGeometry>` の形にする。Cabin の他の部品も同じ書き方なら、まとめて直す（このレビューでは見ていない）。

### W-8 [RearMirror.tsx:66-83] ミラーの描画は全シーンの 2 回目で、4 フレームに 1 回だけ重くなる

`gl.render(scene, camera)` は layers も絞らず、道・森・鹿・空・ライトをすべて描く。解像度は小さい（256 × 72）が、描画コールと頂点の処理は 1 回ぶん増える。15 Hz に間引くと、平均は軽いが 4 フレームに 1 回だけ長いフレームになる（60 fps の中央値 16.7 ms は保てても、p95 が崩れる可能性）。さらに最初のフレームで必ず描くので、トーンマップ・色空間が違う描画先のためのシェーダの別バリアントのコンパイルが、開始直後の 1 フレームに重なる。コメント（18 行目「後ろは道の描画の窓（80 m）まで」）と、実際の `far = CAMERA_FAR_M`（39 行目）も食い違っている。
→ ミラーのカメラ用に `camera.layers` を設けて、森・鹿の遠いものを外す（または far を 80〜120 m にして空だけ別に）。開始時は `gl.compile` で先にコンパイルするか、最初の描画を数フレーム遅らせる。performance-analyzer の `__antlerMirrorRenderInfo` の数字で確かめる。

### W-9 [テスト] クリアまわりの不変条件にテストが無い

tune.test.ts は stage-clear の順序（142 行）と `clockMs >= before`（148 行）を見るが、次は固定されていない: (a) 次のステージへ移ったあとの時計が前に戻らない（今の時計のほうが進んでいる場合を含む）、(b) leftBehind の鹿が pending のまま残り、後ろの鹿は avoided になる（W-1 の境界の 0〜10 m）、(c) 16× のクリア直後に再生速度が 1×、(d) ゾーンが終点まで続く日（W-3）、(e) `mps = 0` の移動（W-4）。
→ 上の 5 つを tune.test.ts に追加する。

## Info（参考）

- I-1 [vehicle.ts:112 と目安] 40 km/h 乾燥の制動距離を手計算した。離散の立ち上がり（9 ステップ）と μ(v) の上昇（低速で最大 1.05 倍）を入れて約 8.4〜8.5 m。UC-3a の上限（7.9 × 1.1 = 8.69 m）まで 3% しか余裕が無い。テストが緑なら問題ないが、ステップ幅や立ち上がりの式を変えるときは最初にここが落ちる。
- I-2 [RearMirror.tsx:88-97] ミラーの面は描画先のテクスチャを自分で貼っている。フィードバックループにならないのは、ミラーのカメラが真後ろ（FOV 15°）を向き、ミラー本体が視錐台の外で culling されるから。カメラの向きや画角を変えるときは、面を `layers` で外す。
- I-3 [dashboard.ts:62, テスト] `NavHint.destination`（「目的地まで n km」）は、ステージ方式では最後のゾーンを出た瞬間に completed になるので、ゾーンの無い日（その場で completed）以外では見えない。UC-4d の「最後のゾーンの後は目的地まで」と実際の挙動がずれている。仕様か分岐のどちらかを直す（YAGNI）。
- I-4 [deer-spawn.ts:46-56] 長さ 80 m 未満の区間は `exitM < entryM` になり、3 候補がすべて `s = exitM`（入口より手前）に重なる。実データでは出にくいが、重なった 3 頭が同じ s に出る。`exitM = max(exitM, entryM)` で守れる。
- I-5 [functional.md R2] 仕様の「必ず出る候補（u < 0）」の記述は、実装では `guaranteed` フラグ（types.ts:124）。コードのほうが明確なので、仕様の文言を直すとよい。
- I-6 [simulation.ts:211-216] `stepVehicle` と `stepPowertrain` が毎ステップ新しいオブジェクトを返す（60〜960 個/秒）。World を「その場で書き換える」というファイル冒頭の方針とは合わないが、既存の書き方で、今回の差分の問題ではない。
