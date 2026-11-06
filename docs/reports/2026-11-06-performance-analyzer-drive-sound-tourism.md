# パフォーマンス分析結果: drive-sound-tourism（未コミットの変更）

対象: `git diff main`（29 ファイル）。コードの読み取りのみ。vitest・ビルド・サーバ起動・再生はしていない。数値の見積もりは実測ではなくコードからの推定で、末尾に測り方を書いた。

## 結論

Critical は 0 件。初回読込・JS 上限・フレームへの影響は、制約（初回 3 秒、運転 290 KB gzip、PC 60 / スマホ 30 fps）に収まる見込み。Warning は 3 件、いずれも小さい。

## 確認項目ごとの結果

### (1) 音源が「出発」の前に読まれないか: 問題なし

- `apps/sim/public/audio/` は Vite の public 配信で、バンドルに入らない。mp3 の URL は文字列でしか参照されない（`music-tracks.ts:18-62`）。`import 'x.mp3'` や `new URL(..., import.meta.url)` は無く、`index.html`・`vite.config.ts`・`vercel.json` に preload・prefetch・Service Worker の登録も無い。
- 音を鳴らす経路は `DrivePage.tsx:111,118` の `audio.start()` だけ。
  - `start()` は `createGraph()`、`loadSamples()`（`drive-audio.ts:84-85`）、`syncMusic()` → `setMusic(url)` → `attachMedia()` の順に進み、ここで初めて `<audio>` を作って `src` を入れる（`audio-graph.ts:196-215`）。
  - `useDriveAudio` は `DriveAudio` を作るだけで、`WebAudioGraph` は `start()` の中で作る。マウント時に AudioContext も `<audio>` も作らない。
- 初回バンドルに足されるのは `music-tracks.ts`（約 2 KB 相当の文字列と小さな関数）だけ。`audio-graph.ts` の `SAMPLE_FILES` の import も文字列のみ。
- 出発後の転送は、BGM 1 曲が 1.0〜2.0 MB（`calm-track.mp3` 1,994,545 B、他 2 曲は約 1.05 MB）、SFX が 7.9 KB と 15.7 KB（計約 23 KB）。BGM は `preload='auto'`（`audio-graph.ts:243`）だが、`src` を入れるのは今の 1 曲だけ。曲の終わりに次を取る（`drive-audio.ts:218`）。先読みはしない。
- 「出発」直後に 3D の描画・API と帯域を取り合う。Slow 4G（約 400 KB/s）だと最大 2 MB は約 5 秒かかる。`<audio>` はストリーミング再生なので、再生開始は先頭の数十 KB が来た時点でよく、SFX の約 23 KB は先に届く。仕様の 3 秒は「出発」前の初回読込なので、制約には触れない。→ I1。

### (2) フレームごとの処理: 軽い

呼び出しは `link-drive.ts:26-38` の `onPublish`（約 10 Hz）。React の描画とは別で、60 fps のフレームには載らない。

- `drive-audio.ts:123-129 update()` → `apply()` → `mixLevels()` で、1 回あたり小さなオブジェクトを 1〜2 個作る（`engineVoice`・`brakeVoice`・`AudioLevels`）。10 Hz なら GC への影響は無視できる。
  - `changed()` で値が動いたときだけ `setLevels` を呼ぶ。ただし走行中は `engineFreqHz` が毎回 0.25 Hz 以上動くので、実質 10 Hz で呼ばれる。
- `syncMusic()` は毎回 `assetUrl()` で文字列を 1 本作り、`setMusic()` を呼ぶ。
  - `setMusic` は同じ URL なら `src` を触らず、`media.paused` のときだけ `play()` する（`audio-graph.ts:196-215`）。
  - `play()` の拒否は `musicBlocked` で止まり、`play()` の連打は起きない（`drive-audio.ts:138` の設定購読でだけ解除）。
- `advance-chat.ts:204` の `track.road.filter(...)` は毎回、道の行の全件を走査する。
  - 件数はその日の楽しみの数（数十行）で、10 Hz では数 µs。許容。
  - `Set` のコピーは行が出たときだけ（`newlyShown.length > 0`、`advance-chat.ts:212`）。
  - 観光の行の条件は先に `realMs - lastLineRealMs >= 15 s` で絞られる。
- `chatFrameFromSnapshot` の `encounters.filter(...)` は毎回配列を 1 つ作る（`advance-chat.ts:140`）。遭遇は少数なので許容。
- `recommend-tracker.ts:update()` は、出す条件が真の間 10 Hz で `pickRecommendation` を呼ぶ。
  - 毎回 `filter → sort → map → spread` と `nearbyPleasures`（`PLEASURES.filter` に `stops.includes` と `months.includes` を含む）を実行する。
  - 母数は `pleasures.json` で数十件程度と読める。1 回あたり数〜数十 µs と推定され、10 Hz で約 0.01〜0.05 % の CPU。
  - `same` の判定で通知を抑えているので、React の再描画は起きない。→ W2。

### (3) Web Audio ノードの解放: 漏れは見つからない

- `playNotify` / `playCrash` はともに `playOnce`（`audio-graph.ts:338-352`）を通る。`source.stop(at + dur + 0.3)` を予約し、`onended` で `source` / `env` / 途中のノード（`low`）を `disconnect` する。`playNotify` は 2 音ぶんの Osc + Gain、`playCrash` は Osc + Gain と BufferSource + Biquad + Gain で、いずれも漏れない。
- `playSample`（鳴き・衝突の録音、`audio-graph.ts:261-273`）も `onended` で `source` と `env` を `disconnect` する。
- 鳴きは 1.1 秒ごとに鳴らし直す（`SQUEAL_SAMPLE_S`）。前の音が `onended` で消えるので、ノードは同時に 2 個程度。
- 常駐のノード（エンジン 2 Osc、LFO、雑音、BGM の MediaElementSource）は `close()` で後始末される（`audio-graph.ts:228-244`）。
  - `sources` の `stop()` → `media.pause()` → `removeAttribute('src')` → `load()`（ネットワーク接続の解放）→ `ctx.close()`。
  - `<audio>` は `src` を外して `load()` を呼ぶので、読み込み中の取得も止まる。
  - `ended` / `error` のリスナは `media` ごと参照を切るので GC される。
- 読み込み途中の `fetchBytes → decodeAudioData` が `close()` の後に走っても、`.catch(() => undefined)` で握りつぶすだけ。例外は出ない。
- → W1: 衝突の 1 回限りの再生と、ABS 時の `squealBus` への書き込みは軽微。

### (4) RecommendCard の 12 秒ごとの作り直し: 軽い

- `key={pleasure.id}` の付いた `<aside>` 以下だけが作り直される（`RecommendCard.tsx:41`）。`RecommendCard` 自体は `memo` で、`useSyncExternalStore` が変化を返したときしか描かない。
- 12 秒に 1 回の再描画で、ノードは `aside` + `img` + 数個の `p` 程度。コストは無視できる。
- `<img>` は新しい `src` を `decoding="async"` で取る。初回の写真は 1 枚ずつ取得され、2 回目以降はブラウザのキャッシュ。ふわっとの CSS アニメーションは `opacity` / `transform` なら合成のみ。`width` / `height` 属性があるので CLS は出ない。→ I2。

## Critical（即時対応）

なし。

## Warning（改善推奨）

- W1 `audio-graph.ts:171-176 setLevels` | `abs` の有無にかかわらず毎回 `setValueAtTime` を 4 本（`absGain`・`squealBus`・`absDepth`、abs 時は `absLfo.frequency` も）と、`setTargetAtTime` を 5 本（`engineOsc`・`engineSub`・`engineFilter`・`engineGain`・`brakeGain`）と `musicGain` に 1 本、計 10 本以上積む。走行中は 10 Hz なので毎秒 100 本以上の AudioParam イベント。
  - 影響: イベントは時刻が過ぎれば内部で捨てられるので、実害は小さい（audio スレッドの負荷が僅かに増える程度）。
  - 改善: abs の値は前回と同じなら書かない（`absHz` の変化は `changed()` に入っているので、abs が変わったときだけ書けばよい）。優先度は低い。
  - 効果: audio スレッドのイベント処理を約 3〜4 割減らせる見込み。ただし体感差は出ない。
- W2 `recommend-tracker.ts:update` + `recommend.ts:pickRecommendation` | 出している間は 10 Hz で毎回、`filter → sort → map → spread` と `nearbyPleasures` をやり直す。結果は 12 秒の入れ替え（`rotationSlot`）か、位置が次の楽しみを越えるときにしか変わらない。
  - 影響: 1 回数〜数十 µs。数値上は無視できるが、無駄な割り当てが毎秒 10 回出る。
  - 改善: `stops` を作る時点（`stopPositionsM`）で `atM` 昇順にしておき、`nearbyPleasures(scenario)` はコンストラクタで 1 回計算して持つ。`filter + sort` を「`stops` の先頭から位置を越えたぶんを捨てる」索引（カーソル）にする。または `slot` と「先の楽しみの数」が前回と同じなら再計算しない。
  - 効果: 割り当てを毎秒 10 回 → 12 秒に 1 回。実測で差が出る規模ではない。
- W3 `drive-audio.ts:181-189 syncMusic` | 毎回の `update()` で `assetUrl()` が URL の文字列を作る。10 Hz で小さな文字列が 10 個/秒。
  - 改善: `current track` が変わるときだけ URL を作る（`track` のインデックスで URL をキャッシュする）。
  - 効果: 無視できる。やるなら W2 とまとめて。

## Info

- I1 BGM の転送（最大約 2 MB）は「出発」後に走る。仕様の「初回読込 3 秒」には入らないが、遅い回線では 3D の初回描画と帯域を取り合う。`calm-track.mp3` が 1.99 MB と他の約 2 倍。−18 LUFS・モノラル 64 kbps なので、曲の長さが約 4 分と読める（64 kbps ≒ 8 KB/s なら 250 秒）。気になるなら 3 曲の長さを揃えるか、最初の曲を 1 MB 台のもの（`firstTrackIndex` はシードで決まるため、どれが来るかは場面による）にする。急がない。
- I2 12 秒ごとの `img` の差し替えは、写真が初めて出るときだけネットワークを使う。写真の合計は未計測。次の候補の `<img>` を `new Image().src` で先読みする案もあるが、必要になってから（premature）。
- I3 `RecommendTracker` は購読者が 0 になると運転の購読をやめる設計で、リークは無い（`recommend-tracker.ts:56-63`）。`linkDriveSoundAndChat` の戻り値も `offPublish` / `offCue` を両方外す。
- I4 `advance-chat.ts` の `track.road.filter` を道のりの昇順カーソルにする案は、行が数百行を超えるときの話。いまは不要。

## パフォーマンス予算（計測してから埋める項目を含む）

| 項目                    | 現在                                 | 目標                  | 備考                                                                                                                                               |
| ----------------------- | ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 運転の最初の JS（gzip） | 未計測（変更前 263.9 KB）            | 290 KB 以内           | `music-tracks.ts` と `fake-audio-graph.ts`（テスト用）。`fake-audio-graph.ts` がテスト以外から import されていないか、`src` の import 元で確かめる |
| 「出発」前の音源の転送  | 0 B（コードから）                    | 0 B                   | `scripts/perf/measure-load.mjs` の転送量で 0 を確認                                                                                                |
| 出発後の音源            | 約 1.0〜2.0 MB（BGM）＋ 23 KB（SFX） | 追加の予算なし        | Slow 4G で最大約 5 秒。再生開始は先頭の数十 KB でよい                                                                                              |
| 10 Hz の購読のコスト    | 推定 数十 µs/回                      | 1 ms/回未満           | `performance.now()` を `onPublish` の前後に挟んで 100 回の p95 を取る                                                                              |
| 3D のフレーム           | 変更の影響なし                       | PC 60 / スマホ 30 fps | 音とチャットは React の描画の外。DrivePage の約 10 Hz の再描画にカードが足す分は `memo` で止まる                                                   |

## 測り方

1. 初回読込: `scripts/perf/measure-load.mjs`（本番ビルド + `vite preview`）で読んだ JS / CSS / 転送量を取り、`audio/` への要求が 0 であること（出発の前）を確認する。Network のウォーターフォールで「出発」を押した後の `calm-track.mp3` などの要求の開始時刻を見る。
2. 10 Hz の処理: `onPublish` を `performance.now()` で挟んで p95 を取る（Playwright の運転の走行ログ、`docs/specs/performance/functional.md` の R の測り方と同じ走り方）。
3. Web Audio のリーク: Chrome DevTools の Memory で、衝突・通知・鳴きを繰り返した後に Detached の `AudioNode` が増えないことを見る。`chrome://webrtc-internals` ではなく Web Audio タブ（DevTools の「Web Audio」パネル）のノード数が、鳴らし終わると元に戻ることを見る。
4. バンドル: 「画面ごとの最初の JS ＋ CSS」の gzip の上限の検査（performance R6）に、運転 290 KB が入っているので、通常の CI のままで足りる。

## 確認できなかったこと

- `fake-audio-graph.ts` を本番コードが import していないか（`grep` ではテストのファイルからだけだったが、`.tsx` の絞り込みが zsh で失敗したため網羅は未確認）。
- `pleasures.json` の件数（`"id"` が 24 件ヒットしたが入れ子の可能性あり）。W2 の見積もりはこの桁による。
- 3 曲の実際の再生時間。
