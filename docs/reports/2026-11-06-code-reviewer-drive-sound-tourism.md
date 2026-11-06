# レビュー結果: drive-sound-tourism（S1〜S19）

対象: worktree の未コミットの変更（main との差分）。仕様 `docs/specs/drive-sound-tourism/functional.md`。
範囲: audio/（audio-graph・drive-audio・brake-voice・mix・notify-tone・music-tracks・use-drive-audio・fake-audio-graph）、chat/（advance-chat・chat-track・chat-text・chat-types・link-drive・tourism・use-chat-track）、components/hud/（recommend・recommend-tracker・RecommendCard）、CREDITS.md、public/audio/。
実行はしていない（コードの読み取りのみ）。mp3 の中身（長さ・ラウドネス）と配布ページのライセンスの欄は確かめていない。

## Critical（修正必須）

### C1. `play()` の拒否をすべて「再生を拒まれた（blocked）」にしている

- `apps/sim/src/features/drive/audio/audio-graph.ts:210`
  `media.play().catch(() => this.musicListener?.('blocked'))`
- `DriveAudio.onMusic('blocked')`（`drive-audio.ts:201-206`）は `musicBlocked = true` にして、次の利用者の操作（start・音量・消音・BGM の操作。`drive-audio.ts:75-78`）までやり直さない。
- ブラウザの `play()` は自動再生の拒否（`NotAllowedError`）以外でも reject する。
  - `AbortError`: 読み込み中（play の Promise が未解決）に `pause()` や `src` の差し替え（読み込みの手順が `paused` を true に戻し、未解決の play を reject する）が入ったとき。`setMusic(null)`（`audio-graph.ts:192`）は、タブを隠す・消音・BGM OFF・走行の終わりで呼ばれる。`src` の差し替え（`audio-graph.ts:206`）も同じ。
  - 連鎖: `NotSupportedError` → blocked → 次の曲へ替えた `src` の差し替えで前の play が `AbortError` → blocked、と重なりうる。
  - `NotSupportedError`: 曲の読み込み失敗（404・壊れた mp3）。このとき `error` イベントも出る。
- 起きること（実機ではブラウザの仕様どおりに出る。テストはフェイクの `<audio>` が汎用の Error で reject するだけなので検出できない。`audio-graph.test.ts:73`）。
  1. S7「タブを戻しただけで BGM が戻らなくならないように」に反する。曲の読み込み中にタブを隠す、または消音すると `AbortError` で `musicBlocked` が立つ。タブを戻しても `syncMusic`（`drive-audio.ts:187`）が null を返し続け、BGM が戻らない。`drive.audio.music_failed` も誤って記録される。
  2. S7「読み込めない（error）: 次の曲に替える」に反する。読めない曲は blocked と error の両方を出す。`error` の処理で次の曲に替えても、`musicBlocked` が立っているので `setMusic(null)` になり、BGM が止まったままになる。「続けて 3 曲」の数え方も意味を失う。
- 修正案: 拒否の理由で分ける。
  ```ts
  media.play().catch((err: unknown) => {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'NotAllowedError') this.musicListener?.('blocked')
    // AbortError は自分の pause()/src 替えによるもの。NotSupportedError は error イベントが扱う
  })
  ```
  テストはフェイクを `DOMException('', 'AbortError')` / `'NotSupportedError'` / `'NotAllowedError'` の 3 通りで reject させ、blocked になるのは最後だけ、を確かめる。

## Warning（推奨）

### W1. 仕様の文面が一時停止の扱いで食い違っている（仕様の直し。コードは S5・m2 どおり）

- S5 本文は「一時停止の間は R6 のとおり流したまま（spec-adversary m2）」。コード（`mix.ts` の `musicOn` は `paused` を見ない）とテスト（`audio-player.test.ts:283-284`、`audio-model.test.ts:169`）は「流したまま」で一致している。
- 一方、UC-1（`functional.md:142`）と SND-1d（`:197`）は「消音・BGM OFF・一時停止・終わりで一時停止」と読める。ここでの「一時停止」は曲の pause のことで、ゲームの一時停止ではないが、紛らわしい。
- 修正案: UC-1・SND-1d の文面を「ゲームの一時停止では流したまま」に直す。

### W2. おすすめのカードの入れ替えが「12 秒ごと」にならない場合がある

- `recommend.ts:82-83`（`rotationSlot(realMs)`）と `recommend.ts:102-107`、`recommend-tracker.ts:73-78`
- 番号が走り始めからの実時間で決まり、候補の並びは今の位置で毎回作り直す（`ahead` は位置より先だけ）。
  1. 楽しみの位置を通り過ぎると `ahead` が 1 つ減り、`slot % length` の指す先が変わる。12 秒を待たずにカードが替わる。同じ楽しみが続けて出ることもある。
  2. ゾーンの後に出し直すとき（S16）、番号は途中から始まる。最初に近い順の 1 番目が出る保証がなく、出た直後（たとえば 1 秒後）に入れ替わりうる。
- 修正案: 「今出している楽しみの id」と「その表示を始めた realMs」を RecommendState に持ち、出し直しのとき・12 秒たったときだけ「いま出している id の次」へ進める。候補が消えた（通り過ぎた）ときだけ先頭へ戻す。`TOUR-6c` に「通り過ぎても 12 秒未満では替わらない」「出し直しで先頭から」を足す。

### W3. 補いの行の言い回しが、楽しみが 2 つのとき一巡ごとに続けて同じになる

- `chat-track.ts:55`（`table[(round + i) % table.length]`）
- 楽しみが 2 つだと、1 巡目の最後（i=1）が `table[round+1]`、次の巡の最初（i=0）が `table[round+1]` で、境界のたびに同じ言い回しが続く。楽しみの名前だけが違う。
- テストがこれを確かめている（`tourism-filler.test.ts:219-220`: `lines[1]` が `table[1](KOTAN)`、`lines[2]` が `table[1](ONSEN)`）。`:222-224` の「続けて同じ文にしない」は、名前が違うので描画後の `text.ja` の比較ではすり抜ける。
- S14 の趣旨（続けて同じ文にしない）に反するかは仕様の解釈次第（名前が違うので別の文とも読める）。
- 修正案: 言い回しの番号を「出した順の通し番号」で決める（`k = lines.length`、`table[k % table.length]`）。通し番号なら、言い回しの種類が 2 以上であるかぎり続けて同じにならない。テストはテンプレートの番号を比べる。

### W4. 短い音の読み込み失敗が記録されない

- `audio-graph.ts:226` `.catch(() => undefined)`
- S10 は「その音だけ鳴らさない」を求めており、挙動は合っている。ただしエラーを握りつぶしている。404・デコード失敗のどちらでも、利用者にも開発者にも分からない（ブレーキの鳴き・衝突の録音が鳴らない理由を追えない）。
- 修正案: `AudioGraphPort` に失敗の通知（`onMusicEvent` と同様のコールバック）を足し、DriveAudio が `drive.audio.sample_failed` を 1 音につき 1 回だけ `onError` へ流す。`music_failed` と同じ扱い。

### W5. 鳴きの再鳴動が約 10 Hz の刻みで、録音の長さも固定値

- `drive-audio.ts:176-181`、`brake-voice.ts:19`（`SQUEAL_SAMPLE_S = 1.1`）
- `apply()` はスナップショット（約 10 Hz）のたびにしか `squealDue` を見ない。再鳴動の間隔は 1.1〜1.2 秒になり、鳴きの間に最大 0.1 秒の無音ができる（S9 は「1.1 秒ごと」）。
- `CREDITS.md:36` は「1.75〜3.0 秒の 1 回分を切り出し」と書く（長さ 1.25 秒）。仕様と定数は約 1.1 秒。どちらかが古い。実ファイルの長さは未確認。
- 修正案: グラフが `AudioBuffer.duration` を返す（`sampleDuration('squeal')`）か、鳴き終わり（`source.onended`）で次を鳴らす。CREDITS の秒数を実ファイルに合わせる。

### W6. ゾーンの通知音の抑止（2 秒）は実時間、反応の行は 2.5 秒（シミュレーションの時間）

- `drive-audio.ts:122-126`、`advance-chat.ts:76`（`ZONE_ENTER_DELAY_MS`、シミュレーションの `t` で測る）
- 1× では反応の行が 2.5 秒後で鳴る（UC-3 のとおり）。4× では実時間 0.6 秒、16× では 0.16 秒後に出るので、2 秒の抑止に当たって通知音が鳴らない。画面の表示は変わらない。
- 仕様は「実時間 2 秒」と書いているので、仕様どおり。意図なら良いが、UC-3 の「反応の行は鳴る」は 1× 限定になる。仕様の注記に残すか、`SND-3c` に 4×・16× のテストを足して挙動を固定する。

### W7. 束が替わったときに、手前の楽しみの行が「飛ばした行」として後から出る

- `advance-chat.ts:140`（`nextTourismLine` の `find`）
- 束の差し替え（見本の会話 → api の会話。`advance-chat.ts:159-168`）で `shown` は空になり、`minM` は「これより手前は出さない」と定められている。`crossed` は `minM` を見る（`:189`）が、`nextTourismLine` は見ない。差し替えた時点で位置より手前にある楽しみの行（`atM <= posM`）は、15 秒ごとに 1 行ずつ「飛ばした行」として出てくる。見本の会話で既に聞いた話の繰り返しになりうる。
- 修正案: `r.atM > state.minM` を条件に足す（`nextTourismLine` に `minM` を渡す）。S15（ステージ移動で飛ばした行を後で出せる）は、`minM` より先にある行なので影響しない。束の差し替え後のテストを足す。

## Info（参考）

- I0. 「もう一度」の最初の `play()`（旧 W1 の確認結果）: `drive-audio.ts:90` の `syncMusic` は、前の走行が終わっていると `musicOn: false` で `play()` を呼ばない。ただし `DrivePage.tsx:115-119` は `engine.restart()` を先に呼び、`restart()` は同期で `publish()`（`engine.ts:172-178, 196-199`）するので、`link-drive` の `update()` → `apply()` → `syncMusic` が `running` のまま操作の中で走り、そこで `play()` が呼ばれる。S3 は満たされる。ただし `restart()` が非同期になる変更が入ると崩れるので、「もう一度」の start のテストを足すと安全。
- I1. `FakeAudioGraph`（`audio/fake-audio-graph.ts`）は `src/` の本番の側にある。import されなければバンドルされないが、カバレッジの対象・ESLint の本番向けの規則・「テストのファイルだけ」の境界から外れる。`*.test-util.ts` などに寄せ、coverage の exclude に入れるのが安全。
- I2. `DriveAudio.onMusic`（`drive-audio.ts:198`）は、どのグラフから来た出来事か見ない。`dispose()` → 再作成のあいだに古い `<audio>` の遅れた `blocked`（`close()` の `pause()` による `AbortError`）が新しいグラフに対して働く経路がある。C1 を直せば `AbortError` は無視されるので実害はほぼ無い。
- I3. `start()` の catch（`drive-audio.ts:100-105`）は、dispose された後（React の StrictMode で片づけが先に走った場合）の `resume()` 失敗も `drive.audio.start_failed` として記録する。ログのノイズだけ。
- I4. `use-chat-track.ts:101-104` の deps に `line`（`scenario.route`）と `legStarts` の配列が入っている。冒頭のコメント（「依存は値だけにする」）と食い違う。`scenario` が同じ参照なら再計算されないが、`tourismStops`（`metersBetween` の走査）と `buildFiller` は約 10 Hz で呼ばれると重い。参照が変わらないことのテスト、または値のキーにする。
- I5. 古いコメント: `components/DrivePage.tsx:107`（「ラジオ」）、`components/drive.css:451-452`（「現れるときだけ 0.2 秒ふわっと」。S19 で入れ替わりのたびに出る）。
- I6. `audio-graph.ts` の包絡の時間（0.01・0.005・0.6 倍）は意味のある名前の定数にできる（`envelope` / `decay`）。重要ではない。
- I7. 赤で BGM を 0 に下げる時定数は `MUSIC_DOWN_S = 0.04`（`audio-graph.ts:48`）。0.15 秒で目標との差は約 2.3%（約 −33 dB）。「0.15 秒以内に 0」は実質聞こえない程度。厳密な 0 は出ない。
- I8. 仕様の受け入れ基準のうち「ヘッドレスのブラウザで確かめる」が未チェック（`functional.md:247`）。C1 と W1 はこの確認（`<audio>` の実物）で検出できる。PR の前に実施を推奨。
- I9. 音源のライセンスの欄（OpenGameArt・BigSoundBank）は、このレビューでは取得して確かめていない（ネットワークなし）。リポジトリの記録（仕様の「ライセンスの確認」の表、CREDITS の確認日 2026-11-06）と一致していることだけ確かめた。

## 確認して問題がなかった点

- 色の直書き・絵文字・`Math.random`・統計の実数: `audio/` `chat/` `components/hud/` の変更範囲に無し。乱数は `createRng` / `deriveSeed`（雑音 `noiseSamples`、曲の順 `firstTrackIndex`、補いの話し手 `buildFiller`）で、シード付き。
- 旧 `radio-score.ts` と 1103515245 の参照は src から消えている。雑音は 32 ビットの mulberry32 に替わり、縮退しない（S6・S8）。
- iOS の再生: `<audio>` は 1 つで src を替え、`createMediaElementSource` は 1 要素 1 回（`audio-graph.ts:195-212, 288-297`）。最初の `play()` は `await graph.resume()` の前（`drive-audio.ts:90-91`）。IDLE の初期値は `outcome: 'driving'` なので最初の start では同期に呼ばれる。
- 鳴らさない設定ではグラフが null で、`<audio>` を作らない（S3）。`close()` は `<audio>` を止め、src を外し、`load()` で解放し、`ctx.close()` の失敗を握りつぶす（二重の close に安全）。
- 衝突の音は 1 回の走行で 1 回（`crashed`、`start()` で戻す）、消音なら鳴らず、走行の終わり（`outcome` が `collided`）の後も `playCrash` はエンジンの 0 に影響されない。音源が読めなくてもドスンの合成は鳴る（S10・S12）。
- 通知音: 赤は `notifyDuck` が 0、琥珀は 0.6 倍・1 音、アラート OFF は赤以外で 2 音、2 秒の間隔（`NotifyGate`）と入って 2 秒の抑止（`ZONE_CHIME_QUIET_MS`）。赤の後にまとめて出た行はそのときの状態で決まる（S11）。
- 鳴きの条件: 強さ 0.7 以上・20 km/h 以上・走行中・一時停止でない。S キー（0.6）では鳴かず、ABS は 0.6 倍で 14 Hz の断続、条件を外れたら `squealAtS = null` で踏み直しからすぐ鳴る（S9）。
- 会話の実時間: フレームごとの「差 ÷ 再生速度」の和（`advance-chat.ts:173-176`）。途中で速度を変えても正しい。入口の 300 m 手前・ゾーンの中・赤・待たせている行・一時停止・終わりで足さない。S15 の「飛ばした楽しみの行は出したことにしない」は `newlyShown` で実装されている（`:193`）。
- おすすめのカード: 4 秒の出し直し（`resumeAtMs`）、帯・赤・ゾーン・ステージ無しで出さない、変わったときだけ購読者に知らせる、`key={pleasure.id}` で作り直して 0.2 秒のふわっと、`prefers-reduced-motion` で無効（`drive.css:549-553`）。
- CREDITS: 曲 3 つ・鳴き・衝突が、作者・出典 URL・CC0 1.0・確認日・場所つきで載っている。`CC0-1.0.txt` は音源と同じ場所にある。曲・短い音の大きさと CREDITS の記載は `music-assets.test.ts` が検査する。CC0 以外の音源は無い。
- 良い点: 音の値の決定（`mix.ts`・`brake-voice.ts`）が純粋関数で、グラフが `AudioGraphPort` の差し込み口になっており、フェイクで DriveAudio の挙動をテストできる。会話・カードの時間も純粋関数（`advanceChat`・`advanceRecommend`）で、フレーム列でテストされている。
