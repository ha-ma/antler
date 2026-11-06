# component-guard レビュー: drive/audio・drive/chat（コミット 0cc1a61）

対象: `apps/sim/src/features/drive/audio/`、`apps/sim/src/features/drive/chat/`（コンポーネントは AudioControls.tsx と ChatFeed.tsx の 2 つ。フックは use-drive-audio.ts と use-chat-track.ts）

## 結果: Critical 0 / Warning 3 / Info 5

## Critical

なし。

- components 内の fetch と useEffect はない。fetch は chat-api.ts にあり、TanStack Query の useChatDeck 経由。
- `useState` はコンポーネントに 0 個。use-drive-audio.ts に 2 個ある。
- Zustand の import と `create()` は 0 件。`any` は 0 件。`as unknown as` はテスト内の 1 件だけ。
- feature 間の import は `@/features/plan-trip`（barrel）経由の `ownerTokenOf` 1 件だけ。
- 派生値に useEffect は使っていない。派生値は useMemo で作っている。
- useEffect は use-drive-audio.ts の 1 つだけ。理由コメントと eslint-disable が付いている。購読と片づけという外部資源の寿命なので妥当。
- StrictMode の模擬アンマウントで先に dispose されても、次の操作で DriveAudio が作り直す（drive-audio.ts:61）。コンストラクタに副作用がなく、グラフの生成は `start()` 以降。そのため useState の初期化が 2 回走っても害はない。

## Warning

### W1. use-chat-track.ts: useMemo の依存が不安定になりやすい

- 場所: use-chat-track.ts:66
- 依存に `scenario`（オブジェクト全体）と `route.zonesKm`（配列の参照）が入っている。
- 組み込み側が `route = { totalM, zonesKm: zones.map(...) }` のように毎レンダーで作ると、毎回 `fallbackChatDeck` と `buildChatTrack` が走り、ChatTrack の参照も毎回変わる。
- linkDriveSoundAndChat は `track()` を約 10 Hz で呼ぶ。参照が毎回替わると、advanceChat の「取れたら途中から差し替え」の経路を毎フレーム通る恐れがある。
- 対応案:
  - `RouteInfo` は呼び出し側で useMemo して渡す、とコメントか型で縛る。
  - または依存を `scenario.trip.id`・`scenario.day`・`scenario.seed`・`scenario.data` などの原始値に絞る。
- drive-tune の後の組み込みの PR で、安定した参照のテストを 1 件足すとよい。

### W2. State 設計の理由づけが事実と合っていない

- 場所: audio-settings.ts:3〜8、chat-feed-store.ts:4〜9
- 「React の外からも触るので Zustand ではなく自前の store にした」とあるが、Zustand は `createStore`（vanilla）や `useStore.getState()` / `subscribe` で React の外から使える。理由としては成り立たない。
- 自前の store を選ぶこと自体は許容できる。
  - DriveEngine と形がそろう。
  - テストでストレージを差し替えられる（コンストラクタ注入）。
  - 画面ごとにインスタンスを作る。
- ただし sim/CLAUDE.md は「Client state: Zustand（feature 単位 store）」と決めている。逸脱する理由は「画面ごとに作る・ストレージ注入・DriveEngine と同形」に書き換えてほしい。
- `subscribe` / `getSnapshot` / listeners の定型が 3 クラス（DriveEngine、AudioSettingsStore、ChatFeedStore）に重複している。もう 1 つ増えるなら、`shared/` に小さな基底か `createExternalStore` を出すことを検討する。

### W3. use-drive-audio.ts: seed と createGraph が最初の 1 回しか効かない

- 場所: use-drive-audio.ts:19〜33
- `useState(() => new DriveAudio({ seed, createGraph, ... }))` なので、後から seed が変わっても反映されない。
- 再出発で seed が変わる設計なら、音の乱数が古い seed のままになる（「乱数はシード付きで再生できる」に関わる）。
- 画面ごとに seed が固定なら問題ない。その前提を JSDoc に書くか、seed を `audio.reseed(seed)` のように渡すか、組み込み側で `key={seed}` にする。

## Info

### I1. ディレクトリ構成が規約の形と違う

- audio/ と chat/ の下に、components / hooks / store.ts / types.ts / index.ts が分かれていない。hook、store、API が平置きになっている。
  - 例: `use-chat-track.ts` が hooks/ ではなく chat/ 直下にある。
  - `chat-feed-store.ts` と `audio-settings.ts` が store.ts ではない。
- drive の下のサブ領域として妥当で、Zustand ではないので store.ts の規約には触れない。
- `react-hooks-rules` の「hooks/ に置く」は paths が `src/features/*/hooks/**` なので、このファイル群には機械的には効かない。
- 組み込みの PR で drive の barrel（index.ts）から何を公開するかを決める。公開は `AudioControls`、`ChatFeed`、`useDriveAudio`、`useChatTrack`、`linkDriveSoundAndChat`、`ChatFeedStore` に絞る。

### I2. linkDriveSoundAndChat は組み込み時に effect が要る

- link-drive.ts は購読を返す関数で、これ自体は React に依存しない。
- 組み込む DriveScreen 側では、これを `useEffect` で呼んで戻り値を cleanup にすることになる。
- 画面に直接 effect を書かず、`useDriveLink(engine, audio, feed, track)` のようなフックに包み、理由コメント付きで置く。そうすればコンポーネントの effect はゼロに保てる。
- `track` は `() => ChatTrack` の getter。ref 経由で最新を返すこと（W1 とセット）。

### I3. useChatDeck / useChatTrack は設計どおり

- queryKey に tripId と day があり、`enabled` はトークンの有無と day で制御している。
- `staleTime: Infinity` で、retry は通信失敗の 1 回だけ。応答は zod で検証し、`deckFits` で版を確かめている。
- `ownerTokenOf` は localStorage を毎レンダーで読む。軽いので問題ないが、将来トークンが変わっても再取得されない。queryKey に入れるほどではない。

### I4. ChatFeed のアクセシビリティ

- `role="log"` に `aria-live="off"` を付け、別の `<p aria-live="polite">` に最後の行だけ入れる設計は、仕様（R13）に沿っている。
- 同じ文言が連続して出ると再読み上げされない可能性がある。会話の文は一意なので実害は小さい。
- `key={line.key}` は安定している。
- `data-dimmed={dimmed}` は文字列の "true" / "false" になる。CSS のセレクタが `[data-dimmed="true"]` であることを確かめる。

### I5. AudioControls

- `releaseSliderAfterPointer` は、ポインタ操作の後にスライダーの blur を行う。矢印キーをハンドルにするという意図は理解できる。ただし、キーボードで操作中のユーザーが同じスライダーをマウスで触った場合にフォーカスが失われる。ほかの HUD と揃えた意図的な設計なら、そのままでよい。
- 2 つ目のボタンは表示テキストでラベルが付いている。1 つ目は `aria-label`。どちらも妥当。
- `useSyncExternalStore` に `getServerSnapshot` がないのは、SPA なので問題ない。
