# component-guard レビュー: drive-sound-tourism（2026-11-06）

対象: 作業ツリーの未コミット変更（base は main）。仕様は `docs/specs/drive-sound-tourism/functional.md`。
規約: `apps/sim/CLAUDE.md`、`.claude/rules/react-architecture.md`・`react-components-rules.md`・`react-hooks-rules.md`。
読んだファイル（変更のソース）: audio/{audio-graph,drive-audio,brake-voice,mix,notify-tone,music-tracks,use-drive-audio}.ts、chat/{advance-chat,chat-track,link-drive,tourism,use-chat-track}.ts（chat-text・chat-types は規約に関わる記述がないため、`any`・`useEffect`・`zustand` の grep だけ）、components/hud/{recommend.ts,recommend-tracker.ts,RecommendCard.tsx}。比較のため、変更されていない use-drive-sound-and-chat.ts・use-recommendation.ts・chat-feed-store.ts・DrivePage.tsx も読んだ。
実行はしていない（読み取りのみ）。main との差分は読んで推定したので、「既存」と書いた項目は main 側の確認が取れていない。

## 結論

Critical: 0 件。Warning: 3 件。Info: 6 件。

- components/ 内の直接データフェッチ、`useEffect` の派生値計算、Zustand `create()`、`any`、他 feature の内部 import はいずれも変更ファイルに無かった。他 feature の import は `@/features/plan-trip`（barrel）だけ。
- `radio-score.ts` の削除による import の取りこぼしは無い（`apps/sim/src` に参照なし）。

## Critical

なし。

## Warning

### W1: 純粋ロジックが components/hud/ にあり、hooks/ と純粋関数が components/ のファイルへ依存している

- `components/hud/recommend.ts:5` で `STAGE_BANNER_MS` を `./StageBanner`（.tsx のコンポーネント）から import している。出しどき（S16）の判定が、描画コンポーネントのファイルに引きずられる。
- `hooks/use-recommendation.ts:2-3` が `components/hud/recommend-tracker` と `components/hud/recommend` を import している。hooks/ が components/ に依存する向きになっている（規約は components が hooks を使う向き）。
- `components/hud/RecommendCard.tsx:4` が `../../chat/ChatFeed`（コンポーネントのファイル）から `htmlLang` を import している。
- `recommend.ts` と `recommend-tracker.ts` はどちらも描画を含まない。S16・S17 で `recommend.ts` の中身が増えた（`advanceRecommend`、`rotationSlot`、`RESUME_AFTER_MS`、`ROTATE_MS`）。
- 直し方（次の feature でよい）:
  - `STAGE_BANNER_MS` を `domain/` か定数だけのファイルに移し、`StageBanner.tsx` と `recommend.ts` の両方がそこを読む。
  - `recommend.ts` と `recommend-tracker.ts` を `hooks/`（または `domain/`）に移す。
  - `htmlLang` を `shared/` か `domain/` に出す。

### W2: DriveAudio に追加した状態の「State設計」宣言が無い

- `audio/drive-audio.ts:43-61` に `track`・`musicBlocked`・`musicErrors`・`musicLogged`・`squealAtS`・`crashed`・`zoneEnteredMs` が増えた。役割のコメントは各フィールドにあるが、`recommend-tracker.ts:14-20` や `chat-feed-store.ts:4-8` のような「State設計」ブロック（何を持つか・どこで持つか・派生値は何か）が無い。
- `apps/sim/CLAUDE.md` の MUST「新しい state を追加する前に State設計を宣言する」に当たる。ファイル先頭の説明（9〜14 行）に State設計の節を足す。
- 特に整理したい点: `musicBlocked`・`musicErrors`・`musicLogged` の 3 つはリセットのタイミングが違う。`start()` と設定変更では `musicBlocked` だけが戻り、`musicErrors`・`musicLogged` は画面の寿命まで戻らない。

### W3: close() が音楽イベントの listener を外さない（StrictMode で dispose → start されたとき、古い `<audio>` のイベントが新しいグラフに届く恐れ）

- `audio/audio-graph.ts:270-286` の `close()` は `media` を外すだけで、`musicListener` は `null` に戻さない。`attachMedia`（288-296）で付けた `ended` / `error` の listener も外していない。
- `audio/use-drive-audio.ts:36-44` の effect の片づけで `audio.dispose()` が走り、次の操作で `start()` が新しいグラフを作る（`drive-audio.ts:69-72` のコメントが想定している経路）。古い `media` が遅れて `error` / `ended` を投げると、`DriveAudio.onMusic`（198-220）が新しいグラフの状態として受け取り、`musicErrors` を増やして曲を進める。
- `removeAttribute('src')` と `load()` では、ブラウザによっては `error` が出ない。実害は小さい見込みだが、外部資源の寿命なので片づけで切っておくのが安全。
- 直し方: `close()` で `this.musicListener = null`、`media.onended = media.onerror = null`（または listener を保持して `removeEventListener`）。

## Info

### I1: RecommendCard の key による作り直しは正しく動く（確認結果）

- `RecommendCard.tsx:38` の `key={pleasure.id}` は、memo コンポーネントの返す根の `<aside>` に付いている。React は単一の子の key を比べるので、入れ替わり（S19）で DOM が作り直され、CSS のふわっと（`drive.css:462`、`@keyframes drive-recommend-in`）が再生される。`prefers-reduced-motion` の分岐もある（`drive.css:549`）。
- `useId`（28 行）は根の key の外（コンポーネント自身）にあるので、`aria-labelledby` の id は作り直しでも変わらない。
- 早期 return（29 行）は hooks の後にあり、hooks の順序は崩れない。
- 候補が 1 つだけのとき（`slot % 1`）は id が変わらず作り直さない。意図どおり。
- `memo` の props は `engine`（`useState` 由来で不変）と `lang`（文字列）だけで、親の約 10 Hz の描き直しでは再描画されない。

### I2: useSyncExternalStore の使い方は妥当

- `RecommendTracker.getSnapshot`（`recommend-tracker.ts:43`）は `this.current` を返し、出すものが変わったときだけ差し替える（80-85 行）。参照が安定していて、`subscribe` もアロー関数のプロパティで同一性が保たれる。
- 最初の購読者のときだけ運転を購読し、最後の購読者が抜けたら外す（49-65 行）。`subscribe` 内の `update()` は購読者へ通知しないが、React は購読の直後に `getSnapshot` を比べ直すので取りこぼさない。
- `DestinationTime`（`RecommendCard.tsx:76-78`）のセレクタは文字列（分単位）を返すので、分が変わったときだけ描き直す。`formatJstTime` は `Date` の加減算だけで軽い。

### I3: 作り直しの契約が暗黙（RecommendTracker は最初の engine に固定）

- `hooks/use-recommendation.ts:11-13` は `useState` の初期化で tracker を 1 回だけ作る。`engine` の props が替わっても作り直さない。現状は `DrivePage.tsx:70` の `useState(createEngine)` で engine が不変なので問題ない。
- 将来 `engine` を差し替えられるようにするなら、呼ぶ側に `key` を付けるか、フックの先頭に「engine は不変」のコメントを足す。`use-drive-audio.ts:11` には同じ趣旨のコメント（`key={scenario.seed}`）がある。

### I4: use-chat-track.ts の useMemo の依存は「値だけ」ではない

- `use-chat-track.ts:37-38` のコメントは「依存は値だけ」と書くが、依存配列（89-105 行）には参照型が入っている（`data`、`routes`、`zones`、`line`、`legStarts`）。
- 現状は `engine.world.scenario` が不変で、`route` も `useMemo`（`use-drive-sound-and-chat.ts:26-32`）で安定しているので作り直しは起きない。
- 作り直すと `buildFiller` と `fallbackChatDeck` が走るだけで、`advanceChat` は `track.key` が同じなら状態を保つ。ただしコメントは実態に合わせて直す（「scenario は engine ごとに不変なので参照でよい」など）。
- `placed.map(...)`（87 行）と `pleasures`（58 行）は同じ `placed` から二度作っている。1 つにまとめられる。

### I5: use-drive-sound-and-chat.ts（変更なし。既存）の ref 相当の書き方

- 変更はないが、この feature の経路の一部。`use-drive-sound-and-chat.ts:35-40` は `useState` に入れたオブジェクトを `useEffect` で書き換えて「最新の束」を渡している。`useRef` で足りる。`useEffect` を 1 つ減らせる。
- 今回の変更の範囲外なので、次に触るときでよい。

### I6: フックのファイルが hooks/ 以外にある（既存）

- `audio/use-drive-audio.ts`、`chat/use-chat-track.ts`、`chat/use-drive-sound-and-chat.ts` は `react-architecture.md` のとおりなら `hooks/` に置く。今回の変更は中身の追加だけで、配置は既存のまま。`use-drive-audio.ts` の `useEffect` は外部資源の片づけで、`eslint-disable` に理由がある。許容。
- 参考: `link-drive.ts` の購読は、StrictMode で effect が 2 回走ると `initialChatState()` から再開する。1 フレーム目に出る行（`atM` が 0 の話の行など）は 2 回 `feed.push` され、`key`（`c1`…）が重なる可能性がある。開発時だけで、条件も狭い。未確認。

## その他（設計ルールに関する確認結果）

- useState の数: `DrivePage` は 3 個（`engine`・`started`・`soundOn`）。上限内。`RecommendCard` は 0 個。`useDriveAudio` は `useState` で一度だけ作る持ち手が 2 つ。
- `useEffect`: 変更ファイルで新しく足されたものは無い。`use-drive-audio.ts` の 1 つは外部資源（document の購読・AudioContext の片づけ）で許容。
- Props drilling: 3 段以上の受け渡しは無い（`RecommendCard` は `engine` と `lang` を受け、`DestinationTime` へ 1 段）。
- `any`・`Math.random`: 変更ファイルに無い（`audio-graph.ts:65` はコメントのみ）。
- 仕様書の追跡表（`docs/specs/drive-audio-chat/functional.md:290`）が `radioScore` のまま。S6 で消したので表を直す（コードの問題ではない）。
