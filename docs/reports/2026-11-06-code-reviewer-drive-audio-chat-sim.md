# code-reviewer: drive-audio-chat（sim 側の部品）

- 対象: `apps/sim/src/features/drive/audio/`・`apps/sim/src/features/drive/chat/`（コミット 0cc1a61）
- 仕様: `docs/specs/drive-audio-chat/functional.md`（R1〜R19）、`docs/reports/2026-11-06-spec-adversary-drive-audio-chat.md`
- 範囲外（見ていない）: 運転画面への組み込み、api 側（`apps/api/src/domain/chats/` など）
- 方法: コードの読み取りだけ。テスト・型チェックは実行していない（この環境では Bash が使えなかった）
- コードは直していない

## レビュー結果

### Critical（修正必須）

なし。R3〜R8・R12 の数値と順序は、読んだ範囲で仕様どおり。

### Warning（推奨。PR 2 の組み込みの前に直すと安い）

W1. [advance-chat.ts:101-108, 120 / fallback-deck.ts:94 / chat-schedule.test.ts:207] 束の差し替えで、見本の会話の行 id が api の束の行を隠しうる

- 見本の会話の id は `l01`、`l02`…（fallback-deck.ts:94）。api の束も R11 で同じ形の `l{2 桁}`。差し替え（advance-chat.ts:101-108）は `held` と `minM` だけを直し、`shown`（出した行の id の集合）を引き継ぐ。見本で `l03` まで出した後に api の束へ替わると、api の `l03` が「替わった時点より先」にあっても出ない
- 起きにくいが、静かに行が消えるうえ、CHAT-4e のテストは新しい束の id を `n01`・`n02` にしていて、この衝突を避けてしまっている（テストが偽の安心を与えている）
- 修正案（どちらでもよい）:
  ```ts
  // shown の鍵を束ごとに分ける
  const idKey = (r: { id: string }) => `${track.key}#${r.id}`
  ...
  if (r.atM > from && r.atM <= posM && !shown.has(idKey(r))) { shown.add(idKey(r)); ... }
  ```
  または差し替えのときに `shown: new Set()` にする（`minM` が「替わった時点より手前」を止めているので足りる）。後者のほうが簡単。ただし後退して `minM` より手前に戻った場合の扱いを決める（`minM` が手前の行を止めるので問題なし）
- テスト: 見本の束と api の束で同じ id（`l02` など）を使い、api の `l02` が替わった時点より先にある並びを足す

W2. [link-drive.ts:34 / advance-chat.ts:100] restart の検知が内部の項目の比較に頼っている

- `if (state.lastT < before.lastT) feed.reset()` は「`advanceChat` が内部で `t` が戻ったら初期化する」ことを、呼ぶ側が `lastT` の大小で推測している。`advanceChat` の中の判定（`f.t < previous.lastT`）を変えると、表示のリセットが黙って壊れる
- `t` が戻らない restart は検知できない。たとえば前の走行が開始直後（lastT がごく小さい）で終わり、新しい走行の最初の `t` がそれ以上のとき。実際には起きにくいが、restart を `t` の逆戻りで推測する設計そのものが弱い
- 改善案: `advanceChat` の戻り値に `reset: boolean` を足す。もっと確実にするなら、`DriveEngine.restart()` が走行の通し番号（`runId`）をスナップショットに載せ、`ChatFrame` に渡して比べる（PR 2 で drive-tune と合わせる）
- 影響は小さいが、表示のリセットは R12 の「restart は最初から」の一部なので、テストを足す。`linkDriveSoundAndChat` の restart 経路（`t` が戻る → 表示が消える → 最初の行がまた出る）は現在どのテストにも無い（AC-42 は restart を流していない）

W3. [drive-audio.ts:63-80] `start()` を「もう一度」で呼ぶと、BGM が重なる・曲が頭に戻らない

- `start()` は `nextBarAtS = null` にするので、次の `update()` で「今から」新しい小節を予約する。直前に予約済みの小節（最大 1 小節ぶん。2.9 秒）の音符はキャンセルできず、新しい小節と重なる。さらに `nextBar` を 0 に戻さないので、曲は途中から続く（R5 の「同じシードは同じ曲」は頭から始まる前提と読める）
- 改善案: 「もう一度」のときは `nextBarAtS` を触らず（resume だけ）、曲を頭から始めたいなら予約済みの音符を止める手段（`AudioGraphPort` に `cancelScheduled()`）を足す。仕様に書いていないので、どちらかを R5 に決めて書く
- テスト: 「`start()` を 2 回呼んでも `createGraph` は 1 回だけ」（AUD-3h の「AudioContext は 1 つを使い回す」）を確かめるテストが無い。`audio-player.test.ts` も `audio-ui.test.tsx` も `start()` は 1 回しか呼んでいない

W4. [use-drive-audio.ts:24-32] `seed` と `createGraph` が最初の描画の値で固まる

- `useState(() => new DriveAudio({ seed, createGraph }))` なので、同じ画面のまま別の場面（seed が違う）に替わると、BGM は古い seed の曲のまま。R5「同じシードは同じ曲」の単位は走行（シナリオ）なので、場面が替わったら DriveAudio を作り直す必要がある
- 改善案: 組み込みで `key={scenario.seed}` を付けて画面ごと作り直す（フックの外で保証するならフックの説明に書く）。または `useDriveAudio` が seed の変化で作り直す
- 関連: DriveAudio の寿命は、StrictMode（effect の片づけ → 再実行）と整合している。`start()` が「dispose の後に作り直す」作りなので、音は片づけの後も次の操作で鳴る（audio-ui.test.tsx:69-90 が確かめている。良い点）

W5. [chat-api.ts:56-58, 84-87, 89-93] エラーの握り潰しと、`errorCode` の落とし穴

- `fetch` の失敗（通信・時間切れ・中断・`AbortSignal.any` が無い古いブラウザの TypeError）を `catch {}` で全部 `ChatDeckError(null, null)` にし、ログを出さない。見本の会話に落ちる理由が、運用でも手元でも見えない
- （`AbortSignal.any` の互換は I12 に移した。プロジェクト共通のパターン）
- `errorCode`: `body.error` が `null` のとき `error.code` で TypeError になる（`'error' in body` は通る）。この関数は `try` の外で呼ばれるので、`ChatDeckError` ではない例外が TanStack Query に渡る（結果は「やり直さない」になるが、`logger.warn` が飛ぶ）
- 改善案:
  ```ts
  } catch (cause) {
    logger.warn('drive.chat.network', { reason: cause instanceof Error ? cause.name : 'unknown' })
    throw new ChatDeckError(null, null)
  }
  ...
  const error = (body as { error?: { code?: unknown } | null }).error
  return typeof error?.code === 'string' ? error.code : null
  ```

W6. [chat-text.ts:68-157 / fallback-deck.ts] 見本の会話の文が、場面を見ずに季節・天気・光・話し手を決めつけている

- `weather` の「窓の外が白く光ってる」「遠くの山まで真っ白」、`light` の「日が傾いてきたね。早めにライトをつけよう」は、場面の天気・光に関係なく出る。夏の昼の旅（見本の運転はともかく、トークンが無い・api 失敗の旅のとき）に雪と夕方の話をする。「温かい飲み物」も同様
- 1 人旅の `radio`（ラジオの DJ）に「おやつあるよ」「ありがとう（運転してくれて）」を言わせている
- R17 の趣旨（運転の指図・長い問いかけをしない）に対し、反応の表の「前をよく見ていこう」「Eyes on the road.」は運転への軽い指図にあたる。人が書いた文なので許容もできるが、仕様と並べて判断してほしい
- 改善案: 場面の天気・光（`scenario.weather` / 時間帯）で見本の文を選べる形にする（`FALLBACK_TEXT[topic]` を中立の文にして、雪・夕方は別の鍵）。最低限、季節・光に依存する文は中立に書き直す。`radio` 用の文は分ける

W7. [テストが確かめていない振る舞い]

- `advanceChat`（chat-schedule.test.ts）:
  - 赤の間の待ちが 3 行を超えたときの捨てかたは、CHAT-4c が暗黙に通している（t=200 で l01〜l04 の 4 行を越え、l01 が出ない）。ただし捨てられた行を名指しする assertion は無い。放出のフレーム自体で新しい行を越える並びは通らない（W9）
  - zone-enter の 2.5 秒の前に出たとき、入った行を出さず zone-exit だけが出ること（advance-chat.ts:145 のコメントにある振る舞い）。この場合 zone-exit の行だけが出るのは仕様の穴かもしれない（W8）
  - 赤の待ちの途中の一時停止（t が進まないので待ちも止まる）
  - 赤の待ちの途中で束が替わる（待ち行列を捨てるが `releaseAt` は残る）。CHAT-4e は赤の中で替えているが、赤が終わった後に 1.5 秒待って何も出ないことまでは見ていない
- AC-42（acceptance.test.tsx）:
  - 説明に「エンジンが半分になる」とあるが、`danger?.engine` を `cruising?.engine` と比べていない（`music` が 0 と `brakeNoise > 0` だけ）。エンジンの半減は audio-model.test.ts の純粋関数で確かめているが、AC は「配線を通して」を確かめるためのもの
  - 赤の中で `encounters: [avoided]` が同時に入っているが、実際は避けた後に赤が終わる。順序が逆で、avoided の待ちの検証としては現実の並びと違う
- useChatDeck: `retry: shouldRetryChat` が TanStack Query で実際に効くか（通信の失敗は 1 回やり直し、502 はやり直さない）を `fetch` のスタブで通して確かめていない。`shouldRetryChat` の関数単体は確かめている。`retryDelay: 500` の数字も根拠が無い（名前を付けるか、テストでは 0 にできるようにする）
- 同じ `FakeGraph` が audio-player.test.ts・acceptance.test.tsx にあり、audio-ui.test.tsx にも `fakeGraph()` がある（3 つ）。`audio/test-helpers.ts` に寄せる

W8. [advance-chat.ts:141-153] ゾーンの短い出入りで、zone-exit が zone-enter なしで出る

- ゾーンに入って 2.5 秒以内に出ると、`pendingEnterAt = null` で zone-enter は取り消されるが、`exited.add(left)` と `react('zone-exit')` はそのまま動く。「入った」と言わないまま「注意の区間を抜けたね。おつかれさま」と言う
- さらに、その区間は `entered` に入っているので、同じ区間にもう一度入っても zone-enter は出ない
- 改善案: zone-enter が出ていない区間の zone-exit は出さない（`entered` とは別に `announced` 集合を持つ）。または仕様に「短い出入りでは両方出さない」と書く（spec-adversary が R12 の重複を指摘した流れで、この端が漏れている）

W9. [advance-chat.ts:176-179] 赤の放出のフレームで、待たせていた行が黙って落ちる

- 放出のフレームでは `emitted = [...held, ...due].slice(-Math.max(MAX_HELD, due.length))`。`held` が 3 行で、そのフレームでさらに 1〜2 行を越えると、合わせて 4〜5 行のうち 3 行（`due` が多ければその数）しか出ず、待たせていた古い行が 1〜2 行落ちる。R12 は「待たせるのは新しい順に 3 行まで」と、それを「まとめて出す」までで、放出のフレームの新しい行を待ちの枠に数えるとは書いていない。待ちの間の行（180 行目）は同じ式で 3 行に切るので、整合はしているが、仕様の読みを 1 つ選んでいる
- 画面は新しい 4 行までしか見せないので、見た目の差は小さい。ただし通知音・読み上げは「最後の行」だけなので影響は無く、落ちるのは `FeedLine` の履歴だけ。判断の問題として、どちらかを R12 に書く（推奨: 放出のフレームの `due` は枠に数えず `[...held, ...due]` をそのまま出す。`held` は既に 3 行以下）
- このフレームを通すテストが無い（放出のフレームで `due` が空でない並び）。テスト: `held` 3 行 → 放出の `t` で 1 行を越える → 期待を 4 行（または 3 行）に固定

### Info（参考）

I1. 良い点

- `advanceChat` が純粋関数で、`ChatState` を受けて返す。時間は `f.t` だけに頼り、乱数・実時間を持たない。テストが `run()` のヘルパーで読みやすい
- 仕様の端を実装している: 後退して戻っても `shown` で 2 回出さない、区間ごとに 1 回（`entered` / `exited`）、一時停止は早期 return、赤の後の数え直し（`wasDanger` と `releaseAt`）、アラート OFF では enter / exit を出さず avoided だけ出す
- `mixLevels` が R6・R6a の表そのまま（赤: BGM 0・エンジンとブレーキ半分・通知 0。琥珀: BGM 0.6 倍。OFF の琥珀は BGM そのまま・通知は鳴る）。`musicDuck` と `notifyAllowed` の関数名と説明が意図を伝えている。audio-model.test.ts がそれぞれの行を 1 つずつ確かめている
- `DriveAudio.notify()` は、鳴らせないとき（`levels.notify <= 0`）に `NotifyGate` を使わない順序になっている。赤・琥珀で出た行が、2 秒の門だけを消費して後の緑の行を黙らせることがない
- `start()` は `new AudioContext()` を、最初の `await` より前（ボタンの操作の同期の部分）で作る。ブラウザの自動再生の決まりを守る作り。失敗は例外にせず `false` と `onError` に流す（FAIL-44）
- 音の合成に `Math.random` を使わず、乱数はシード付き（`radioScore`、ノイズの LCG）。`WebAudioGraph` は `createContext` を差し込める
- `AudioSettingsStore` が「読めなくても書けなくても既定値」で動く。`parseAudioSettings` が壊れた値を 1 項目ずつ既定値に戻す
- UI: 色・文字・余白は CSS 変数だけ、絵文字なし（インライン SVG）、`prefers-reduced-motion`、ポインタを通す、操作 44px、`role="log"` ＋別の `aria-live="polite"`（常に DOM にある）。State 設計の宣言も書いてある（CLAUDE.md の MUST）
- `CREDITS.md` に自作の音の出所が書いてある

I2. [engine-voice.ts:15] `LOUD_RPM = 4000`（回転数の割合の分母）は仕様に無い数字。R3 は「回転数の割合」としか書いていない。コメントに「900 rpm で 0、4,000 rpm で 1」とあるので追えるが、R3 に同じ数字を書き戻すか、Deferred の「音の釣り合い（実機）」の対象に入れる

I3. [audio-graph.ts:52-55] ノイズの LCG は `x * 1103515245` が 2^53 を超え、下位ビットが丸められる。決定的ではあるが乱数の質は低く、周期の短い音色になりうる。`Math.imul(x, 1103515245) + 12345 >>> 0` に変える（ブレーキ・ヒスは耳で確かめて問題なければそのままでもよい）。エンジンの基音は 30〜120 Hz で、小さなスピーカー（スマホ・ノート PC）ではほぼ聞こえず、のこぎり波の倍音とローパス（`200 + freq × 6` Hz。数字に名前が無い）に頼る。実機で聞く Deferred に入っている

I4. [drive-audio.ts:124-144] BGM の予約は `update()`（約 10 Hz の公開）に乗っているので、メインスレッドが 1 小節（約 2.9 秒）以上止まると BGM が途切れる（戻ったら今から始め直す作りで、壊れはしない）。消音・BGM OFF の間も音符のノードを作り続ける（`music` が 0 なだけ）。性能が気になるなら、BGM が 0 の間は予約を止めて、戻ったときに今から始める

I5. [drive-audio.ts:63 / 組み込みの注意] Safari では、操作の中でも `AudioContext.resume()` が解決しないことがある。組み込み（PR 2）は `await audio.start()` で運転の開始を待たせず、`void audio.start()` で並走させること。`setHidden` も `running` の間だけ効くので、`interrupted`（iOS の電話など）は拾わない

I6. [依存の向き] `audio/AudioControls.tsx` が `../components/hud/pointer-focus` を import している。音の部品が HUD の部品に依存する向きなので、`pointer-focus` は `drive/shared` のような共通の場所に置くほうが素直。`chat/link-drive.ts` は `audio/` にも依存しているので、音と会話をつなぐ接着剤はどちらにも属さない（`drive/link/` など）ほうがよい。今は feature 内なので規約違反ではない

I7. [advance-chat.ts:94-204 の読みやすさ] 1 関数が約 110 行で、restart・差し替え・話の行・反応・赤の待ちの 5 つを `let` の更新でつないでいる。動いていて、コメントの説明も丁寧。`collectRoadLines` / `collectReactions` / `applyDangerHold` に分けると、W1・W8 のような端を直すときに差分が小さくなる（今は不要。次に触るときで）。`ChatState` の 14 項目のうち、`entered` / `exited` / `pendingEnterAt` / `zoneInterval` は `zone: ZoneTrack` に束ねられる。`slice(-Math.max(MAX_HELD, due.length))`（177 行）は読み手が止まるので、`[...held, ...due]` を残す理由を 1 行書くか、`due` の数で切らない書き方にする

I8. [signals.ts:41-58] `signalsFromSnapshot` は drive-tune の合図（rpm・ブレーキの強さ・ABS）が来るまでの仮。`brake: braking ? 1 : 0` は R4 の「合図が無ければ 1 / 0」どおり。後退中の `S` は `speedKmh > 0.5`（前進中）のときだけブレーキ扱いで、仕様どおり。PR 2 で差し替える箇所は、この関数と `DriveAudioSignals.rpm` だけに閉じている（良い切り口）

I9. [use-chat-track.ts:25-31] `queryFn` の `ownerToken ?? ''` は `enabled` で守られているので到達しないが、空文字で Authorization を送る可能性が残る形。`enabled` を通った後のため `!`（または早期 throw）にするほうが意図が出る。`queryKey` にトークンを含めない点は、トークンが localStorage にしか無く、端末ごとに固定なので問題なし。`apiBase()` は他の feature に 6 つ同じ実装がある（既存パターンに合わせてあるが、共通化は別の PR で）

I10. [AudioControls.tsx / audio-controls.css] 消音ボタンの `aria-pressed=true`（消音中）がブランド色（spruce）で強調され、「良い状態」に見える。ラジオのボタンの pressed（ON）と意味が逆向きなので、見た目の意味がそろわない。消音中は `clay-deep` の枠にするなど、色の使い分けを検討（tokens.json の `clay` は「注意」用）。消音中にスライダーを `disabled` にするのは、値が見えて戻せる点でよい

I11. [ChatFeed.tsx / chat-feed.css] 話し手の名前 `<span>` に `lang` が付いていない（一言には付いている。`zh` は `zh-TW`）。`.drive-chat__live` の `position: absolute` は、親が `position: relative` でないので、祖先に対して配置される（1px で隠れているので害は無いが、`.drive-chat` に `position: relative` を足すと安全）。surface は 92% の不透明度で 3D の空の上に載るので、昼の明るい場面での `ink-muted` のコントラストは accessibility-checker で確かめる

I12. [chat-api.ts:84] `AbortSignal.any`（Safari 17.4 以降）は、ここだけでなく drive/api/trip-day.ts・brief-map・record・loss・stop-events の取得も同じ書き方。この commit の問題ではなく、プロジェクト共通のパターン。古い Safari では `fetch` の前に TypeError になり、会話は必ず見本の会話に落ちる（W5 のログがあれば気づける）。直すなら共通の小さな関数にして別の PR で

## 仕様との対応（確認できたもの）

- R1: `gameAudioEnabled`（本番 true、開発は `VITE_GAME_AUDIO=on`）、`createGraph` が null なら AudioContext を作らない、`start()` で 1 つだけ作り使い回す、`dispose()` で close
- R3・R4: 回転数・周波数（rpm ÷ 30）・大きさ・ブレーキ・ABS の数値はテストの例と一致
- R5: 84 BPM・8 小節・帯域 300〜3,000 Hz・シードで決まる。音の高さの範囲もテストで確認
- R6・R6a・R8: 上記 I1。通知音の 2 秒は実時間（`nowMs`）、会話の待ちは `t`（シミュレーションの経過）で分けている
- R9: 変化があるときだけ `setLevels`、BGM は 1 小節先まで、ノードは音符・通知音だけ（終わったら外す）
- R12: 後退・16×・赤の待ち・一時停止・差し替え（W1 の例外あり）・restart（W2 の弱さあり）
- R13・R14: 見える行は 4 行まで、`role="log"` ＋別の `aria-live`、赤で `data-dimmed`、操作は 44px
- R18・R19: 日・版・移動の数を確かめる、通信の失敗だけ 1 回やり直す、見本の会話は api の束と同じ形
- 未確認（実行していない）: テストの合否、型・lint、カバレッジ

## 次にやること（優先順）

1. W1（shown の鍵）と、衝突する id でのテスト
2. W2（restart の合図を `advanceChat` の戻り値か `runId` にする）と、restart のテスト
3. W3・W4（`start()` の再呼び出しのテスト、seed の寿命を組み込みで決める）
4. W5（エラーのログと `errorCode`）
5. W6・W8 は仕様側の判断（見本の文を場面に合わせるか、短い出入りの扱い）。推奨: 見本の文は中立に書き直す、短い出入りは両方出さない
