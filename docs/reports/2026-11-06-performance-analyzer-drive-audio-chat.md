# パフォーマンス分析: drive-audio-chat（コミット 0cc1a61）

対象: `apps/sim/src/features/drive/audio/`・`chat/`。仕様 R9・R12・R13、resilience.md の観測要件。
方法: コードの読み取りと `vitest --maxWorkers=2`（audio・chat 7 ファイル 57 件すべて通過）。実機計測と `vite build` はしていない。数値はコードから見積もった桁で、実測ではない。

## 前提（確かめたこと）

- `linkDriveSoundAndChat`・`useDriveAudio`・`useChatTrack`・`ChatFeed` は、テスト以外のどこからも呼ばれていない（組み込みは PR 2）。いまのバンドルには入らない（tree-shake）。下の指摘は PR 2 の組み込み時に効く。
- `DriveEngine.frame()` は、約 100 ms ごと（または状態変化時）に `publish()` を呼ぶ。listener は同じ呼び出しの中で同期に走る。つまり `audio.update` と `advanceChat` は 3D のフレームの中で動く。約 10 Hz の処理も、フレーム予算（60 fps は 16.7 ms、30 fps は 33 ms）から引かれる。
- ルート `/drive` は `lazy(() => import('@/features/drive'))`。`use-chat-track.ts` が `@/features/plan-trip` の barrel を import するが、`routes.tsx` が PlanPage を同期 import 済みで、main に入っている。新しい取り込みコストはない。

## Critical

なし。

## Warning（改善推奨）

### W1. BGM の予約が 1 小節ぶんの音符を同じフレームで一気に作る

- 場所: `drive-audio.ts:131-145`（`scheduleMusic`）、`audio-graph.ts:158-168`（`scheduleNotes`）
- 内容: 1 小節は 13 音符（bass 2、pad 3、lead 8）。1 音符ごとに `createOscillator`・`createGain`・`connect`・`start`・`stop`・`onended` の closure を作る。つまり約 26 ノードを、2.86 秒（84 BPM × 4 拍）に 1 回、`update()`（3D のフレームの中）で作る。
- 影響: 2.86 秒ごとに 1 フレームだけ、メインスレッドで 1〜3 ms 程度（デスクトップの見積もり。スマホは 3〜5 ms 以上かも）の山ができる。平均では無視できるが、スマホ 30 fps（33 ms）で他のフレームが重いときに重なる。
- 改善（計測して山が見えたらでよい）: 小節単位でなく、先読み窓（例: 0.5 秒先まで）に入った音符だけを `update` ごとに予約する。1 回あたり 2〜4 音符に平らになる。さらに安くするなら、8 小節を `OfflineAudioContext` で 1 回だけ AudioBuffer にレンダリングし、`AudioBufferSourceNode(loop)` 1 本にする（ノードの作成が 0 になる。メモリは 8 小節 ≒ 23 秒でモノラル約 4 MB）。ただし、シード付きの曲を作るレンダリングの初期コストが出発時に要る。
- 計測: Performance パネルで `scheduleNotes` の self time。`performance.mark` を前後に入れ、p95 が 2 ms を超えるか見る。

### W2. BGM が 0（消音・BGM OFF・赤）でも音符のノードを作り続ける

- 場所: `drive-audio.ts:123-125`（`apply`）。`scheduleMusic` は `levels.music` を見ない。
- 内容: `musicGain` が 0 でも、毎小節 26 ノードを作って予約する。ノードはオーディオスレッドでも処理される（発振器 → フィルタ → 0 倍のゲイン）。
- 影響: BGM OFF・消音の利用者でも約 9 ノード/秒の割り当てと GC が続く。赤の間も同じ。
- 改善: `levels.music === 0` の間は予約を飛ばして `nextBarAtS` だけ進める（拍の位置は保つ）。または `music` が 0 から戻るときだけ今から始める。`nextBar` を進めるかは曲の連続性の判断（仕様 R5・R6 と合わせる）。
- 推定効果: BGM OFF の利用者のメインスレッドとオーディオスレッドの負荷が、ノード作成ぶんゼロになる。

### W3. `advanceChat` が毎回 3 つの Set と counts を複製する

- 場所: `advance-chat.ts:105`（`new Set(state.shown)`）、`:122-123`（`entered`・`exited`）、`:111`（`{ ...state.counts }`）
- 内容: 約 10 Hz で、何も変わらなくても 3 つの Set と 1 つのオブジェクトを複製し、さらに `{...state}` で新しい state を作る。サイズは小さい（shown は最大 40 行、zone の区間は数十）。
- 影響: 1 回あたり数 µs〜十数 µs、年間の GC 圧は 1 秒あたり約 40 個の短命オブジェクト。いまは無視できる桁で、フレーム予算の 0.1% 未満。ただし 3D の GC 停止と重なるとスマホではカクつきの一因になりうる。計測するまでは優先度を上げない。
- 改善: 変更があるときだけ複製する（copy-on-write）。`shown.has(r.id)` の判定のあとに、`add` が起きるときだけ `new Set`。road は `atM` 順に整列済みなので、走査も先頭から探さず「次の index」を state に持てば O(1) になる（現状は 10 Hz × 最大 40 行の全走査）。
- 補足: `advanceChat` は一時停止・走行終了の間は先頭で早期 return しており、複製しない。

### W4. `useChatTrack` の再計算が、呼び出し側の `route.zonesKm` の参照に依存する

- 場所: `use-chat-track.ts:55-66`（`useMemo` の依存に `route.zonesKm`）
- 内容: PR 2 で `route={{ totalM, zonesKm: ... }}` のようにインラインで渡すと、親が約 10 Hz で再描画するたびに `fallbackChatDeck` と `buildChatTrack`（整列・RNG・40 行の map）が走り直す。`track.key` は変わらないので動作は壊れないが、無駄な計算が 10 Hz で続く。
- 改善: PR 2 で `zonesKm` をシナリオから 1 度だけ作る（`useMemo` か scenario に持たせる）。`link-drive` の `track()` は常に最新の ref を返すので、参照が安定すれば十分。

### W5. パッドとベースの包絡が止める時点でゼロに届かず、クリックが出うる（性能ではなく品質）

- 場所: `audio-graph.ts` の `envelope`（`setTargetAtTime(0, 開始 + durS*0.6, durS*0.25)`）と `playOnce`（`stop(atS + durS + 0.3)`）
- 計算: pad は durS 2.86 s: 減衰の開始 1.71 s、時定数 0.71 s、停止 3.16 s で残りは e^(-2.04) ≒ 13%（ピーク 0.16 → 約 0.02）。bass（durS 1.43 s）は 停止時に約 8.6%（0.5 → 約 0.04）。lead は 0.7% で問題ない。
- 影響: 停止の瞬間に振幅が約 0.02〜0.04 飛ぶ。小音量でもプチッと聞こえうる。
- 改善: `stop` の前に `linearRampToValueAtTime(0, stop)` を入れる、または停止を `durS + 6τ` まで延ばす。ノードの寿命が少し延びるだけ（pad で約 +1 秒、同時に生きるノードが +数個）。

## Info

- I1（AudioContext の寿命）: 問題なし。`start()` が `graph ??=` で 1 つだけ作り、「もう一度」では resume だけ。`dispose()` は全 source を `stop` して `ctx.close()`（失敗は握りつぶす）。StrictMode で effect の片づけが先に走っても、次の `start()` で作り直す。ノードの外し忘れもない（音符・通知音とも `onended` で `disconnect`）。通知音は 1 回 4 ノード、2 秒の門あり。
- I2（常時回るノード）: エンジンの 2 本、ABS の LFO（矩形 440 Hz のまま。`abs` は常に false）、鳴き 1800 Hz、雑音 2 本は、ゲイン 0 でもオーディオスレッドで処理される。計 6 ソース、スマホでも通常は問題ない桁。BGM が長く 0 のとき `hiss`、ブレーキが無いとき `brakeNoise` と `squeal` を止める手もあるが、再開の管理が増えるので計測するまでやらない。
- I3（`setLevels`）: `changed()` で絞っており、停車中は呼ばれない。加速中は回転数が動くのでほぼ毎スナップショット（約 10 Hz）呼ばれ、8 個の AudioParam に `setTargetAtTime`（秒間約 80 イベント）。Blink は過去のイベントを刈るので溜まらない見込みだが、Safari は未確認。長い走行（10 分）で `performance.memory` と音の遅れを見る。ABS は `setValueAtTime` を毎回 3 本発行する（`abs` が false のうちは値が同じなので無害）。
- I4（スナップショットごとの割り当て）: `signalsFromSnapshot`・`mixLevels`（+ `engineVoice`・`brakeVoice`）・`chatFrameFromSnapshot` で、10 Hz に小オブジェクト約 5 個。`chatFrameFromSnapshot` の `encounters.filter(...).length` は配列を作るので、`for` で数えれば割り当てがなくなる（件数は小さい）。いまは問題ではない。
- I5（BGM の先読み 1 小節）: 2.86 秒。メインスレッドが 2.86 秒以上止まると音が切れる（`nextBarAtS < now` で今から再開。壊れはしない）。一時停止中に `frame` が `publish` を呼ばないなら、既に予約した最大 2.86 秒の後に BGM が途切れる。`musicDuck` は `paused` を見ない。一時停止の BGM の扱いを仕様と PR 2 で確認する。
- I6（「もう一度」の重なり）: `start()` は `nextBarAtS = null` にするので、前の予約が残っている（最大 2.86 秒）うちに押すと 2 小節が重なる。結果画面を見る時間があれば普通は尽きている。
- I7（ChatFeed）: `useSyncExternalStore` で行が増えたときだけ再描画。`React.memo` が無いので、親が 10 Hz で再描画すると毎回 4 行ぶん再描画する。`memo(ChatFeed)` で十分（props は `feed`・`lang`・`dimmed` のプリミティブ）。行の `key` は `c{seq}` で安定しており、既存の行はアニメーションし直さない。
- I8（CSS の合成）: アニメーションは `opacity`・`transform` のみ（合成だけで動く）。`backdrop-filter` なし、`will-change` なし、`prefers-reduced-motion` 対応あり。行の背景は半透明の `color-mix` で WebGL canvas の上に載るため、canvas が毎フレーム更新される分、合成は毎フレーム 1 レイヤーぶん増える。面積は最大 320px 幅 × 4 行で小さい。5 行目で最古の行が消えると、残りの行が一度にずれる（レイアウトは 4 要素で軽い）。PR 2 で置くときは `position: absolute` で canvas のレイアウトに影響させず、`contain: layout style` を付ける（`paint` は 8px の移動が切れるので付けない）。
- I9（バンドル）: 運転のチャンクは遅延読込のままで、音・会話の部品は純粋関数と Web Audio の API だけ。外部依存は追加していない（zod は chat-api で既存）。音声ファイルを使わない合成なのでアセットのバイト数はゼロ。ただし PR 2 の組み込み後に `vite build` で運転チャンクの増分を測る（見積もり: ソース 3,000 行のうちテストを除くと約 1,500 行 ≒ 圧縮前 40〜50 KB、gzip 後 10〜15 KB。実測ではない）。

## パフォーマンス予算

| 項目                                      | 現在（見積もり）                      | 目標        |
| ----------------------------------------- | ------------------------------------- | ----------- |
| `update` + `advanceChat` の 1 回（10 Hz） | 0.05 ms 未満（W1 の小節境界を除く）   | 0.5 ms 未満 |
| 小節境界のフレームの追加分（W1）          | 1〜3 ms（デスクトップ）、スマホは不明 | 0.5 ms 未満 |
| 運転チャンクの増分（gzip）                | 未計測（見積もり 10〜15 KB）          | 20 KB 以内  |
| 同時に生きる音のノード                    | 約 50〜60（予約済み 2 小節ぶん）      | 100 未満    |

## 次の一手

1. PR 2 の組み込み後に、実機（スマホ）の Performance で `scheduleNotes` の山を測る（W1）。2 ms を超えたら先読み窓方式にする。
2. W2（BGM が 0 のとき予約を飛ばす）は小さく安全な変更なので、次の PR で入れてよい。
3. W5 のクリックは耳で確かめる（pad・bass の終わり）。直すなら `stop` 直前のランプ。
4. W4 と I7 は PR 2 の組み込みで一緒に直す（`zonesKm` の安定化・`memo`・`contain`）。
