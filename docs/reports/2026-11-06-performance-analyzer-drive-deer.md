# パフォーマンス分析: drive-deer（claude/drive-deer-4dd39d vs main）

対象: `apps/sim/src/features/drive/` の domain/deer-motion.ts・deer-spawn.ts・detection.ts・simulation.ts と scene/DeerHerd.tsx。
方法: コードを読んだ静的解析のみ（vitest・dev サーバは動かしていない）。下の数値はすべてコードからの見積もりで、実測ではない。

## 結論

Critical は 0 件。60 fps（PC）/ 30 fps（スマホ）の予算を壊す箇所は見つからなかった。
理由は、同時に生きている鹿が最大でも十数頭に収まる設計で、16× の早送りがゾーンの外に限られるから。

- 候補どうしは 60 m 以上離れ、置くのは 300 m 手前から。同時に置かれる候補はおよそ 5 つまで。群れは最大 5 頭なので、頭数は 10 前後が上限。
- 16× はゾーンの中では使えない（playback.locked）。入口を越えた時点で打ち切る（simulation.ts:229）。

ただし、ステップごとの無駄な確保が 2 点ある（W-1・W-2）。スマホで 16× のときに GC を増やす方向なので、直しておくとよい。

## Critical

なし。

## Warning

### W-1 motionOf を毎ステップ、1 頭につき 1〜2 回呼び、そのたびに乱数列を 2 本作り直す

- deer-motion.ts:239（stepDeer）で、graze と eyeshine 以外は毎ステップ `motionOf(deer)` を呼ぶ。
- deer-motion.ts:262（triggerGapM）が内部でもう一度 `motionOf` を呼ぶ。呼ばれるのは `wait` 局面（stepWait:348）と、parallel の `go` 局面（stepGo:386）。待っている鹿は 1 ステップに 2 回になる。
- 1 回の `motionOf`（:93-144）の中身:
  - `deriveSeed` が 2 回。うち 1 回は `` `motion-${deer.index}` `` で文字列を作る。
  - `createRng` が 2 回（クロージャ 2 つ）。
  - 乱数を 7 回引く。
  - 配列 2 つとオブジェクト（MotionParams）1 つ。多くの分岐でさらに `{...base}` を作る。
  - `lerp` は分割代入 `[a, b]` を引数に取る。
- 係数は候補の種（seed と index）だけで決まり、s・t・車の状態に依存しない（ファイル冒頭のコメントどおり）。つまり毎回同じ値を作り直している。
- 影響の見積もり:
  - 1 回あたり 0.5〜1 µs 程度。
  - 10 頭 × 2 回 × 16 ステップ × 60 fps ≒ 19,000 回/秒で、約 10〜20 ms/秒（CPU 1〜2%）。
  - 16× の間だけ。1× なら 1/16。
  - 一度に確保する量は少ないが、スマホの GC に積み上がる。
- 改善（どちらでも可）:
  - (a) `spawnDeer` で `motionOf` を 1 回引き、Deer に `params` として持たせる。ただし Deer を凍結 API に近い型として扱うなら、(b) のほうが影響が小さい。
  - (b) モジュール内の `Map<string, MotionParams>` を、キー `${seed}:${index}:${motion}` で持つ。キーの文字列作りで相殺しないよう、`WeakMap<Deer 生成時の base オブジェクト>` か、候補 id ごとの Map にして `clearStage` でクリアする方法もある。
  - `triggerGapM(deer, ctx)` に `m` を渡せる内部版を作り、stepWait と stepGo が持っている `m` を再利用する（公開の `triggerGapM` はテスト用に残す）。
- 推定効果: 該当部分を約 1/10 以下。ステップあたりの確保がほぼ 0 になる。
- 優先度: 実測してから。下の計測方法で 16× の `advance` が 1 フレーム 2 ms を超えるなら先に直す。

### W-2 動かない鹿でも、毎ステップ `world.deer` を map+filter で作り直す

- simulation.ts:395-398 は毎ステップ新しい配列を 2 つ（map と filter）作る。
- 動いている鹿は `move`（deer-motion.ts:458-465）で毎ステップ `{...deer}` の新オブジェクトになる（約 15 フィールド）。
- simulation.ts:36 のコメント「World は毎フレーム作り直さず、その場で書き換える（60 fps でゴミを出さない）」と食い違う。
- 見積もり: 10 頭 × 960 ステップ/秒（16×）で約 1 万オブジェクト/秒。新世代 GC で処理できる量なので、PC では問題にならない。スマホの 30 fps では、長く続けると GC の小さなカクつきの原因になりうる。
- 改善: `gone` が無く、`s > carS - 60` を満たす鹿が全員のままなら、`world.deer` を差し替えない（その場で filter するか、変化があったときだけ作り直す）。`stepDeer` が返す値を immutable にしておく利点（純粋関数・テストのしやすさ）は残し、呼び出し側だけを変える。
- DeerModel は `world.deer.find` で id を引くだけなので、参照が毎ステップ変わっても影響しない（DeerModel.tsx:58）。

### W-3 `candidatesToDecide` が毎ステップ全候補を走査して配列を作る

- deer-spawn.ts:152、呼び出しは simulation.ts:381。
- 候補は `s` 昇順に並んでいる（deer-spawn.ts:103）。しかも drive-deer R1 で「すべて出る」ようになり、候補の数が増えた（1 区間 3〜8 + 目の反射 0〜2）。
- 見積もり: 区間 10 個なら約 100 件。100 × 960 回/秒 ≒ 10 万回/秒の比較と Set 検索で、ほぼ無害（1% 未満）。長い旅（区間 30 個以上）で効き始める。
- 改善: 「次に置く候補の添字」を `internal` に持ち、`c.s - carS <= DECIDE_AHEAD_M` の間だけ進める。早送りでは添字を進めるだけにする。ステージ移動（clearStage:321）で車が前へ飛ぶので、添字は `findIndex` で張り直す。
- 今は直さなくてよい。長い旅の本番データで候補数が 200 を超えたら直す。

## Info

### I-1 tick（0.1 秒ごと）の計算量は問題ない

- simulation.ts:435-450 は鹿ごとに `encounters.find`（最大でも E ≒ 50〜100）。simulation.ts:487-492 の回避判定は `encounters × deer.find`。どちらも E × D ≒ 1,000 回/tick。
- 16× では 1 フレームに約 2.7 tick。計 3,000 回/フレーム程度で、無視できる。
- `Map<deerId, Encounter>` にすればほぼ 0 にできるが、効果が小さいので急がない。

### I-2 detection.ts の鹿ごとの帯の状態は軽い

- detection.ts:144-151 で、`captured` と `bands` を `{...captured, [id]: ...}` で作り直す（イミュータブル）。
- 呼ばれるのは「初めて条件を満たした」ときと「見逃したまま近い帯に入った」ときだけ。1 頭あたり最大 3 回（帯は 0・1・2）。
- 辞書のコピーは O(K)（K は走行中に見た鹿の数）。ただし `captured` と `bands` は clearStage でも持ち越す（simulation.ts:312-316）ので、K は旅全体で増える。K ≒ 100 でも 3 回 × 100 キーのコピーで、1 回の抽選あたり約 1 µs。問題なし。
- `detectBand`（:79-81）は `filter` で配列を作る。tick あたり数回で無視できる。

### I-3 DeerHerd の再描画

- scene/DeerHerd.tsx:14-15・47-51 で、毎フレーム `liveIds`（filter+map）と `join(',')` をする。10 頭なら 1 フレームあたり数百 ns で問題ない。React の再描画は id の並びが変わったときだけ（:49-51）。新しいフィールド（phase・motion・seed）は id の並びに影響しないので、再描画の原因にならない。
- 注意点（今の変更のせいではない）:
  - 群れが出ると、1 フレームで最大 5 つの DeerModel が一度に mount される。assets は共有、プリウォームあり（:24-46）なので、シェーダーのコンパイルでの固まりは防いである。DeerModel 側の mount 時に何を作るかは今回読んでいない。
  - `liveIds` の `!d.gone` は、simulation.ts:398 で既に取り除いているので冗長。

### I-4 spawnDeer・createCandidates・drawMotions

- どれも候補ごとに 1 回（createCandidates は createWorld で 1 回）。ホットループではない。
- drawMotions（deer-spawn.ts:120-144）は `Object.keys` と `delete bag[...]` を使う。count は最大 8 なので無視できる（`delete` は辞書モードになるが、オブジェクトが小さく 1 回だけ）。

### I-5 O(n²)

- 鹿どうしの二重ループは無い。checkCollision は車 1 台 × 鹿 D 頭（simulation.ts:405）で O(D)。
- 唯一 O(D × E) なのは I-1 のみ。

## 計測方法（直す前にこれで決める）

1. `advance` を 16× で 1 フレーム分（realDt 100 ms ＝ 6 ステップ × 16 倍 ≒ 96 ステップ）、鹿 10 頭（群れ 5 + 候補 5）の状態で 1,000 回回し、`performance.now()` の平均と p95 を取る。条件は、ゾーンの外（早送りが効く）で、候補が 300 m 以内に 5 つ並ぶ位置。
2. 目安は、PC で `advance` が 1 フレーム 2 ms 以内、スマホ（4× スロットル相当）で 6 ms 以内。W-1 を直す判断はこの数字で行う。
3. GC は Chrome DevTools の Performance で Minor GC の頻度を見る。16× の 10 秒間で Minor GC が 1 秒に 10 回を超えるなら W-1・W-2 を直す。
4. `motionOf` と `stepDeer` の単体は、10 頭 × 10 万ステップを Node で回すマイクロベンチで見られる（DOM 不要）。

## パフォーマンス予算

- 1× の `advance`（1 フレーム 1 ステップ、鹿 10 頭）: 見積もり 0.05 ms 未満 → 目標 0.2 ms 以内。
- 16× の `advance`（最大 16 ステップ/フレーム）: 見積もり 0.3〜0.6 ms → 目標 PC 2 ms 以内、スマホ 6 ms 以内（実測で確認）。
- 鹿 1 頭のステップあたりの確保: 現状 約 10 オブジェクト（motionOf 1〜2 回 + move の spread）→ W-1・W-2 を直すと 1 個以下。
- DeerHerd の React 再描画: 鹿が出た・消えたときだけ（現状どおり）。

## 取り込み（メインセッション）

Critical 0。W-1〜W-3 は次に回す（予算を壊さない見積もり。実測で 1 フレーム 2 ms か Minor GC 1 秒 10 回を超えたら W-1 → W-2 の順に直す）。
