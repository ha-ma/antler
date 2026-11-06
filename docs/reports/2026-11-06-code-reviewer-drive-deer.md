# code-reviewer: drive-deer（claude/drive-deer-4dd39d vs main）

対象: `apps/sim/src/features/drive/domain/{deer-spawn,deer-motion,deer-cases,detection,simulation,stages}.ts`、`types.ts`、`docs/specs/drive-deer/functional.md`。
方法: 読み取りのみ（テスト・ビルドは実行していない）。指摘はコードの記述から導いたもので、実行して確かめたものではない。

## レビュー結果

### Critical（修正必須）

なし（0 件）。

局面機械（wait → go → pause → resume / stand / leave → gone）を動きごとにたどったが、抜け出せなくなる局面や、s・d・heading の符号の誤りは見つからなかった。

- stop-midway と frozen の `dir` による境界判定は、左右とも正しい向きになっている。
- 群れの 2 頭目以降は `laneTimeS` が先頭の d で数えるので、同じステップで動き出す。
- `Deer.gone` は `move` でだけ立ち、`spawnAndMoveDeer` で消える。

### Warning（推奨）

- **[W-1] [deer-spawn.ts:84-91] 「候補の間は 60 m 以上」を満たしていない。** 候補は枠の 25〜75% に置くので、隣り合う候補の間は最小で `0.5 × slot` になる。`fits = floor(len / 60)` で `count` を抑えると `slot ≥ 60 m` になるだけで、間隔は 30 m まで縮む。短い区間（0.3 km 前後）では、ほぼ同時に 2 頭が動き出す。UC-1a のテストは回数しか見ていないので、このずれは検出されない。
  → 案 A: `fits = Math.max(MIN_ENCOUNTERS, Math.floor(len / (MIN_SPACING_M * 2)))`（枠の 25〜75% のとき間隔 ≥ 60 m）。案 B: 間隔の下限を満たす位置の引き方に変える。いずれにしても、`sorted(s)` の隣接差 ≥ 60 m（3 回に抑えられるときを除く）を検査するテストを足す。

- **[W-2] [deer-motion.ts:239, 261-263, 345-361] 毎ステップ `motionOf` が走り、RNG を 2 つ・配列 2 つ作り、文字列からシードを導く。** `stepDeer` で 1 回、`stepWait` → `triggerGapM` でもう 1 回呼ぶ。60 Hz × 最大 5〜8 頭では 1 秒に数百回の使い捨て割り当てになり、simulation.ts の「60 fps でゴミを出さない」方針に反する。`motionOf` は種・index・motion だけで決まる純粋な値なので、スポーン時に 1 回だけ引ける。
  → `Deer` に `params: MotionParams` を持たせる（`spawnDeer` で埋める）。型は apps/sim 内だけなので、記録の形は変わらない。または `WeakMap<Deer, MotionParams>` / `seed + index` をキーにしたキャッシュ。どちらでも `triggerGapM` の引数に渡して二重の呼び出しをなくす。

- **[W-3] [simulation.ts:403, deer-motion.ts 全体] 仕様 R5 の「鹿がよける」が実装されていない。** 5 km/h 未満では衝突にしないだけで、鹿は何も反応しない。立ちすくみの鹿の上を 3〜4 km/h で通り抜けられる。このとき `carStoppedMs` は 0.5 km/h 未満でしか数えないので、`frozen` は最大 12 秒そこに居続け、鹿の箱と車の箱が重なったまま走れる。悪用すると「ゆっくり寄ると当たらない」ことを覚えてしまう。
  → `DeerContext` に `carSpeed` はあるので、`stepDeer` で「車の箱と重なる（か 2 m 以内）かつ `|carSpeed| < COLLIDE_MIN_MPS`」の鹿を `leave`（その場から横へ逃げる）に移す。しきい値の定数は simulation.ts から deer-motion.ts へ移して共有する。

- **[W-4] [simulation.ts:48-49, 172-178] 記録の上限 50 を二重に持っている。** コメントに「@antler/trip の MAX_ENCOUNTERS_PER_RUN と同じ」とあるが値を直書きしている。record/utils/drive-run.ts:57 は `slice(0, MAX_ENCOUNTERS_PER_RUN)` なので、片方だけ変えると、衝突の記録が落ちるバグが静かに戻る（衝突が最後の要素に来る前提は `resultEncounters` の「末尾に hit を足す」形でかろうじて保たれている）。
  → `import { MAX_ENCOUNTERS_PER_RUN } from '@antler/trip'` に替える。sim は record feature の import のために既に依存している。

- **[W-5] [simulation.ts:487-492 と 519-525] 「車の後ろに過ぎたら回避」の判定が 2 か所に重複している。** `tick` 末尾のループと `settlePending` は同じ式で、`leftBehind` の読み方も同じ。片方だけ直すと食い違う。
  → `tick` 末尾のループを `settlePending(world)` の呼び出しに替える。

- **[W-6] [simulation.ts:98] `createWorld` 内の `const zone`（危険度の lambda 内）が、77 行目の `const zone`（`zoneStatusFromS`）を隠している。** さらに lambda 全体（91-102 行）が長く、ここだけ型の流れが追いにくい。
  → 同じファイルの外に `intervalRisk(plan, zones, scenario, i): number` として切り出す。変数名は `zoneFeature` などにする。同時に `Math.max(0, ...[])` の `0` を意図が分かる名前にする。

- **[W-7] [deer-motion.ts:261-299] `triggerGapM` の `dart` と `graze-dash` の枝がほぼ同じで、`syncedGap` の引数 7 個が位置引数。** 引数の取り違え（`rampMs` と `range` など）が型で検出できない。
  → 動きごとの設定を表にする（`{ ramp, range }` を `Record<DeerMotion, TriggerSpec>` で持つ）。`syncedGap(deer, m, spec, heading, speed, carSpeed)` のように、オブジェクトでまとめる。

- **[W-8] [detection.ts:142-151] 検知の抽選が、共有の `detectRng` から鹿の見え方の順に引かれる。** 同じシード・同じ入力の列なら再生できる（仕様どおり）が、運転が違うと「その鹿が見えた帯の順番」が変わり、後ろの鹿の抽選結果も変わる。つまり、1 頭の見逃しが運転によって別の鹿の運命を動かす。
  → 仕様が「検知の列」と指定しているため今は維持してよい。変えるなら `deriveSeed(seed, \`${deerId}-band${band}\`)` から 1 回引く形にすると、運転に依らず鹿ごとに決まる。調整時の再現性も上がる。Day 6 以降の候補として残す。

### Info（参考）

- **[deer-spawn.ts:58-61] `encounterCount` は `risk` が NaN だと NaN を返し、`count` が NaN になって候補が 0 件になる。** `Math.max(0, NaN)` は NaN のままで、`clamp` では守れない。現状は `Math.max(0, ...)` で NaN は出ないが（simulation.ts:95）、`riskOf` を別の呼び手が渡すときのために `Number.isFinite(risk) ? risk : DEFAULT_RISK` を一行足すと安全。
- **[deer-spawn.ts:120-144] `drawMotions` の乱数の使い方は決定的。** 回数の抽選（`rng()`）を必ず先に 1 回引き、`count` の違いは後ろの引き方にだけ効く。目の反射も最後に引くので、他の鹿の位置は動かない。至近の動きの置き換えは、引いた中に無いときだけなので重複しない。良い設計。
- **[deer-spawn.ts:121, 127, 135] `Record<string, number>` と `as DeerMotion` のキャストが多い。** 型を `Partial<Record<…>>` にして `Object.keys` を `entries` に替えると、`?? 0` と `as string` を減らせる。
- **[deer-spawn.ts:13-14 と simulation.ts:49] `MIN_ENCOUNTERS`/`MAX_ENCOUNTERS`（3〜8）と `MAX_RESULT_ENCOUNTERS`（50）と `MAX_ENCOUNTERS_PER_RUN` が名前で紛らわしい。** 前者を `ENCOUNTERS_PER_INTERVAL_MIN/MAX` にすると誤読が減る。
- **[deer-spawn.ts:146] 関数のコメントの「(UC-5d)」は古いテスト ID で、いまの UC-5d（箱の境目）とは関係がない。**
- **[deer-motion.ts:147-148] `spawnDeer(candidate, _t)` の `_t` は未使用で、「いまは使わない」と書いて残している（YAGNI）。** simulation.ts:383 とテストの呼び出しごと外す。
- **[simulation.ts:203] `advance(world, realDtMs, _zones)` の `_zones` も未使用。** コメントは「呼ぶ側の形を保つ」としているが、`decideAppear` が消えたいまは残す理由がない。呼び出し元とテストを一緒に直せば外せる。deer-cases.ts:72 の `advance(w, FRAME_MS, zones)` も同様。
- **[deer-motion.ts:64-72] `DeerContext.carD` はどこからも読まれていない。** 外すか、使う予定があるなら理由をコメントにする。
- **[simulation.ts:395-398] `.map((d) => (d.gone ? d : stepDeer(...)))`:** `stepDeer` の先頭で `gone` を見ているので、条件分岐は冗長。直後の `.filter(!d.gone)` で消えるので、`gone` の鹿を 1 ステップ残す必要もない。
- **[deer-motion.ts:60] `TURN_D = { fromR, fromL }` は値が負で紛らわしい。** `fromR: -0.6`（右から来る鹿が向きを変える位置）は車線の右端に近く、`fromL: -2.9` は左端寄り。「どちらも車の箱と重なる位置」というコメントを足すと、あとで値を変える人が助かる。
- **[deer-motion.ts:109-140] `motionOf` の速さの範囲（2.6〜4.6、3.5〜5、4〜6、9〜12 …）がリテラル。** 仕様の数値とそのまま対応しているので、動きごとの定数表にまとめると、仕様の差分が追える。
- **[deer-motion.ts:481-483] `ramp` の下限 0.15 がマジックナンバー。** 「動き出しの最初の速さの割合」と名前を付ける。
- **[deer-motion.ts:392 付近（stop-midway）] 右から来る stop-midway は d = 0 で止まる。** 鹿の箱は ±0.8 m、車の右端は −0.9 m なので、すき間は 0.1 m。当たりにはならないが、ハンドル操作の誤差で当たる微妙な数値。意図なら STOP_D の隣にコメントを残す。
- **[simulation.ts:435-447] `recorded` の分岐が 2 つに分かれ、片方は `find` だけ。** `encounterFor` を `create` 引数で切り替えるか、`if (recorded) { const e = withinRange ? encounterFor(…) : find(…); if (e) … }` にすると 1 本になる。
- **[simulation.ts:409, tick] 群れの頭ごとに `Encounter` が 1 件作られる（`d.id` が `-index` つき）。** 仕様 R1 の「群れは 1 回と数える」は候補の回数の話で、記録は頭ごとのまま。区間 8 回 × 群れ 5 頭で記録の 50 件上限に近づく。仕様の範囲外なので触らないが、A-7 の回避率の分母が群れで膨らむことは、変更記録に残すとよい。
- **[stages.ts:26-35] `capIntervals` は良い関数。** 変更なしなら同じ参照を返す（テストで `toBe`）。ただし `zoneIds` は切る前のままなので、8 km より先にしか無いゾーンの危険度も `riskOf` に入る。実害は小さい（最大値を取るだけ）が、気づいておくとよい。
- **[detection.ts:79-86] `detectBand` の戻り値が `number`。** `0 | 1 | 2` のユニオンにすると、`bandProbability` に範囲外が渡る誤りを型で防げる。帯の抽選ロジック自体（`last !== undefined && band <= last` で引き直さない、帯が戻っても再抽選しない、捉えたら `continue`）は仕様 R6 のとおり。
- **[detection.ts:94-96, 166, 177] 解除のたびに `INITIAL_DETECTOR` へ戻し、`captured` と `bands` を引き継ぐ形が 2 か所に書かれている。** `resetKeepingDraws(state)` のような小関数にすると、simulation.ts:312-316（`clearStage`）の同じ展開とも合わせられる。
- **[deer-cases.ts:46] `w.plan.intervals[0]?.entryKm ?? 0`:** 区間が無いと、静かに 0 + 400 m から走る。テストの前提が崩れても気づけないので、`throw new Error('ゾーン区間がありません')` にするとよい。
- **[deer-cases.ts 全体] テスト専用のコードが `domain/` に置かれ、カバレッジ（70%）の分母に入る。** `*.test-helper.ts` か `__tests__/` へ移し、coverage の `exclude` に入れる。`DEFAULT_REACTION_MS` も export しているがテストからだけ使う。
- **[types.ts:178-182] `Deer.startedAt` のコメントが「いまの段階（pose）が始まった時刻」のままで、実際は局面（phase）の開始時刻か、群れの未来の動き出し時刻。** `pose` ではなく `phase` と書き直す。
- **[types.ts:244] `World.decided` のコメント「出るか決めた候補の id」は古い。** 候補はすべて出るので、「鹿を置いた候補の id」。名前も `placed` に替えると、`candidatesToDecide`/`DECIDE_AHEAD_M` との対応も直せる（今回は名前が API に出るので、凍結外か確認してから）。
- **[削除された API の残り]** `decideAppear`・`guaranteed`・`spawnedHeads`・`MIN_DEER_PER_INTERVAL` は、このブランチの `apps/sim/src` と `packages` からすべて消えている（grep で確認）。docs/reports の過去のレビュー（drive-tune）に名前が残るだけで、コードの取り残しは無い。

### 良い点

- 乱数の使い方が一貫している。候補は区間・候補ごとに `deriveSeed` で分け、動きの係数も `seed + index` から引くので、s が動く動き（diagonal・parallel）でも係数が途中で変わらない（UC-3l）。
- 「毎ステップ |速さ| で判定し、動き出したら固定」（R4）を、`wait` の中の閾値判定だけに押し込んでいる。`go` 以降は距離の計算に触れない（parallel の横切りだけ例外で、これも仕様どおり）。
- 局面と動きの対応が `stepWait/stepGo/stepPause/stepStand` に分かれていて、1 関数 1 局面で読みやすい。
- 結果の記録は、衝突した鹿を必ず残す（`resultEncounters`）。record 側の `slice(0, 50)` と併せて、衝突が落ちない。
- 仕様の数値（重み・距離・オフセット・帯の確率）がコードの定数に 1 対 1 で出ていて、コメントに R/UC の番号がある。

## 取り込み（メインセッション）

| 指摘                       | 取り込み                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1                        | 仕様と変更記録を「枠は 60 m 以上（隣の候補とは 30 m 以上）」に直した（コードは変えない）                                                    |
| W-2                        | 次に回す（performance-analyzer の W-1 と同じ。鹿は 10 頭前後でゾーン内は 1×。実測で 1 フレーム 2 ms を超えたら spawn 時のキャッシュにする） |
| W-3                        | 仕様を「すり抜ける（鹿がよけたとみなす）」に直した。よける動きは入れない                                                                    |
| W-4                        | `@antler/trip` の `MAX_ENCOUNTERS_PER_RUN` を import した                                                                                   |
| W-5〜W-8                   | 次に回す（動作は正しい。読みやすさ）                                                                                                        |
| 未使用の引数・古いコメント | `types.ts` の `startedAt`・`decided` のコメントを直した。`_t`・`_zones` は呼び出し側の形を変えないため残す                                  |
