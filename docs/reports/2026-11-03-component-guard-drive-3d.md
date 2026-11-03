# component-guard レビュー: drive-3d（apps/sim/src/features/drive/ と app/App.tsx）

日付: 2026-11-03 / ブランチ: claude/drive-3d-531e17 / 対象: components/・hooks/・scene/（R3F）・index.ts・apps/sim/src/app/App.tsx

方法: 対象ファイルを直接読んだ（この環境では Bash が使えず `git diff 5aa3820..HEAD` は実行していない。drive/ 配下は全部が新規なので、ファイル全体を対象にした）。lint・テスト・実機の描画は走らせていない。「実行して確かめた」ものは無く、すべて静的に読んだ結果。

前提（依頼どおり、指摘しない）: シミュレーションは React 外の DriveEngine、HUD は useSyncExternalStore、3D は毎フレーム world() を読む設計。zustand は未使用（別セッションが依存を足すまで）。PhoneScreen が drei の Html（別の React root）の中で Provider を持つ。

## 結論

Critical 0 / Warning 4 / Info 9

Critical の検出パターン（components/ 内の直接データフェッチ）は 0 件。fetch・XHR・useEffect でのデータ取得は feature 全体に無い（ゾーン DB はビルド同梱）。Warning のうち W1 と W2 は組み合わさって見た目の不具合（空の色が 3 秒かけず一瞬で切り替わる）になりうるので、先に直すのを勧める。

## Critical

なし。

## Warning

### W1. `phone` が毎回新しい要素になり、`memo(DriveCanvas)` が効いていない（アラート ON のとき）

- `components/DrivePage.tsx:86-89`（`phone` と `sceneProps` を毎レンダーで作る）、`:31`（`const Scene = memo(DriveCanvas)`）、`:93`
- DrivePage は useSyncExternalStore で 0.1 秒ごとに再レンダーする。そのたびに `<PhoneScreen .../>` が新しい ReactElement になるので、`phone` の参照が変わり、memo が破れる。Canvas → DriveScene → Atmosphere / Ground / Road / Forest / Headlights / DeerHerd / Cabin / DriverCamera が 10 Hz で再レンダーされる。useFrame で動かす設計（再描画しない）と食い違う。
- アラート OFF（`phone === null`）のときは memo が効く。つまり既定のデモ（アラート ON）だけで起きる。
- 直し方: `phone` を `useMemo(() => alertEnabled ? <PhoneScreen engine={engine} controller={sound.controller} muted={muted} /> : null, [alertEnabled, engine, sound.controller, muted])` にする。PhoneScreen は自分で engine を購読しているので、値の変化を props で渡す必要は無い。`useMemo` は `if (!supported) return` より前に置く（フックの順番）。`alertEnabled` はシナリオ固定なので実質変わらない。`sceneProps` も `Scene` に直接 props を渡して作らなくてよい。
- 副作用の確認は W2。

### W2. Atmosphere が render 中に ref を読み、`start` で useMemo と args が決まる。光の区分が変わると 3 秒のなじませが飛ぶ可能性

- `scene/Atmosphere.tsx:33`（`const start = SKY[scene.current.world.light]`）、`:49-61`（`now` の useMemo の依存が `[start]`）、`:120-123`（`<fog args>`・`<color args>`・`<hemisphereLight args>`・`<directionalLight args>` に `start` の値）
- `world.light` は走行中に変わる（`domain/simulation.ts:230`）。このコンポーネントが再レンダーされた時点で `start` の参照が変わると、(a) `now`（なじませの途中の値）が新しい区分の値で作り直され、(b) R3F は args が変わった要素を作り直すので fog・背景・ライトが新しい値で置き換わる。どちらも「区分が変わったら 3 秒ほどかけて寄せる」（ファイル冒頭のコメント）を無効にする。
- いまは W1 のせいで 0.1 秒ごとに再レンダーされるため、区分が変わった直後に必ず起きる見込み。W1 を直すと再レンダーされなくなり、症状は隠れるが、ref を render 中に読む作りは残る（`start` は初期値のまま古くなる）。
- これは静的に読んだ推測で、実機で空の色の切り替わりを見て確かめていない。args 変更でインスタンスが作り直されるのは R3F の仕様として知られている。
- 直し方: render では `scene.current` を読まず、初期値は props（`DriveScene` が `initial` として持つ値）で渡す。args は初回だけの値として固定し（`useMemo(..., [])` か定数）、変化は useFrame の中だけで反映する（すでに fog・hemi・sun は useFrame で上書きしているので、args は初期値のままで足りる）。

### W3. キー入力が修飾キー付きを区別せず、Mac で押しっぱなしになる

- `hooks/use-keyboard-drive.ts:26-37`
- `Cmd+A`・`Cmd+D`・`Cmd+S` などが A / D / S の運転入力になり、`preventDefault()` でブラウザのショートカットも潰す。さらに macOS は Cmd を押している間、Cmd 以外のキーの keyup を発火しないので、Cmd+A のあとに A を離しても `left` が true のまま（`blur` が来るまで）残る。
- 直し方: `apply` の先頭で `if (e.metaKey || e.ctrlKey || e.altKey) return` を足す（keyup 側は `pressed === false` のときは通して、離した扱いにはする）。

### W4. HUD のボタンにフォーカスがあると Space（ブレーキ）が効かない

- `hooks/use-keyboard-drive.ts:30`（`code === 'Space' && e.target instanceof HTMLButtonElement` なら return）
- 再生速度・一時停止・音トグルをマウスで押したあと、そのボタンにフォーカスが残る（BottomBar の音トグルは常に残る）。そこから Space を押すと、ブレーキではなくそのボタンが押される。ブレーキが効かないのは運転シミュレーションの根幹に関わる。
- 直し方の候補: (a) HUD のボタンは click 後に `blur()` する、(b) 走行中（`enabled`）はボタン上でも Space を運転に使い、`keydown`・`keyup` の両方で `preventDefault()` する。ただし Space によるボタン起動のキャンセルがブラウザごとに違う可能性があるので、(b) は実機で要確認。アクセシビリティ（キーボードでボタンを押せること）との兼ね合いがあるので、accessibility-checker と相談して決める。

## Info

### I1. DriveScene: 派生値を state で持ち、useFrame の中で setState している

- `scene/DriveScene.tsx:26`（`const [road, setRoad] = useState(...createRoadFrame(world().scenario.route))`）、`:42-45`
- ルートが変わったら作り直す分岐だが、いまはエンジンのシナリオが変わる経路が無い（`restart()` は同じ scenario を使う）。現状は到達しない分岐。必要になったら `useMemo(() => createRoadFrame(route), [route])`（route を props で受ける）か、`key={scenario.id}` で作り直すほうが、フレームの中での setState より素直。

### I2. DriveScene: render 中の副作用と外部の可変値の読み取り

- `scene/DriveScene.tsx:35-36`（DEV のとき `Object.assign(globalThis, ...)`）、`:53`（`world()` を render 中に読む）
- DEV 限定で本番には入らないが、render の中の副作用は StrictMode で 2 回走る。計測用の公開は `useEffect` か、useFrame の最初の 1 回に移すとよい。`world().scenario` は props の `scenario` として渡せば、render が外部の可変値に依存しなくなる。

### I3. GPU 資源の dispose が無い（画面を離れるとき）

- `scene/Road.tsx:35-38,46-51`（`road`・`surface` が変わって `cache` を作り直すとき、前の `cache.chunks` のジオメトリを dispose しない。アンマウント時も同じ）、`scene/Forest.tsx:31-49`、`scene/Ground.tsx:16-26`、`scene/Cabin.tsx:38-60`、`scene/Atmosphere.tsx:35-47`、`scene/DeerModel.tsx:39-52`（鹿 1 頭ごとの SpriteMaterial。鹿が消えるたびに増える）
- `<primitive object>` と、手で作って prop で渡したジオメトリ・材質は、R3F が自動では dispose しない（と理解している。バージョンごとの挙動は未確認）。いまは /drive が URL 直打ちの 1 画面なので影響は小さい。react-router を入れて SPA 遷移で出入りするようになったら、アンマウント用の `useEffect` の片づけ（理由コメント付き）か、`<primitive dispose={...}>` が要る。

### I4. useState の数は DrivePage がちょうど 3 個（上限）

- `components/DrivePage.tsx:48-50`（engine・started・soundOn）
- 規約内。ただし 1 個目は UI 状態ではなく、生成して保持するだけの値（`useRef` / `useMemo` でも同じ）。次に state を足すなら engine を `useRef` 側に寄せるか、スタート前後の状態を engine 側（`DriveSnapshot`）に入れるかを先に決めておくと、4 個目で規約違反にならない。

### I5. StrictMode で DriveEngine が 2 回作られる（dev のみ）

- `components/DrivePage.tsx:48`（`useState(createEngine)`）、`main.tsx` は StrictMode。
- 初期化関数は dev で 2 回呼ばれ、片方は捨てられる。純粋なので害は無いが、`createWorld` が重くなったら気づきにくい。

### I6. supportsWebGL2 が呼ぶたびに WebGL コンテキストを 1 つ作る

- `hooks/use-webgl2.ts:4-11`
- StrictMode の dev では 2 回。ブラウザのコンテキスト数の上限（Chrome は 16 前後）を食う。`getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()` で返すと安全。

### I7. HUD の再レンダーが 10 Hz で全部、一時停止中も続く

- `domain/engine.ts:83-88`（`sincePublish >= PUBLISH_MS` で、一時停止中も publish する）、`components/hud/*`（memo なし。`BottomBar` は `Math.round(speedKmh)` が変わらなくても再レンダー）
- 性能への影響は小さい。気にするなら、一時停止中は publish しない、または `BottomBar` を `memo` にする。

### I8. HUD の文言とマークアップの重複

- `components/hud/TopBar.tsx:57`（`aria-label="条件"` が HUD_TEXT に無い直書き。多言語化するときに漏れる）
- `components/StartOverlay.tsx:17-26` と `components/hud/BottomBar.tsx:13-22` に操作説明の `<dl>` が同じ形で 2 つある。`hud/Controls.tsx` に抜き出せる。

### I9. 構成と公開 API

- `features/drive/` は規約の構成（components / hooks / store.ts / types.ts / index.ts）に `domain/` と `scene/` を足している。`scene/*.tsx` は R3F の部品なので、規約が `components/**` に当てるルール（react-components-rules.md）の対象パスから外れる。名前付き export・1 ファイル 1 コンポーネントは守られている。`domain/` は React を使わない純粋なロジックで、置き場として妥当。この拡張は CLAUDE.md か `docs/specs/drive-3d/` に 1 行書いておくとよい。
- `index.ts` は `DriveEngine`・`DriveSnapshot`・`demoScenario`・`DEMO_TRIP`・`DriveScenario`・`Encounter` を公開しているが、feature の外（App.tsx）で使われているのは `DrivePage` だけ。A-6・A-7 で使う予定の分なら残してよいが、使われないうちは `DrivePage` だけに絞るほうが barrel の約束（公開 API だけ）に近い。
- `app/App.tsx:15` は `window.location.pathname === '/drive'` を render 中に読む（コメントで react-router までのつなぎと明記）。`<Suspense fallback={null}>` のため、3D の chunk を読む間は空白になる（初回読込 3 秒の目標があるので、読込中の表示を後で足す）。

## 確認して問題が無かったもの

- データ取得: components/・hooks/・scene/ に fetch・XHR・useEffect でのデータ取得は無い。TanStack Query が要る箇所も無い（Server state なし）。
- Zustand: `create()`・`zustand` の import は feature 全体に無い（依頼どおり意図的）。store.ts も無い。
- `any`: apps/sim/src の ts・tsx に `any` は 0 件（テスト含む）。`@ts-ignore`・`as unknown as` も無い。
- useEffect の使い方: 3 か所（`use-auto-pause.ts`・`use-keyboard-drive.ts`・`use-alert-sound.ts`）すべて hooks/ に隔離され、外部の購読か外部資源の片づけで、ESLint disable に理由が書いてある。派生値の計算に使っているものは無い。components/ に useEffect は無い。
- useState の数: DrivePage 3、DriveScene 2、DeerHerd 1。ほかは 0〜1。
- Props のバケツリレー: 深さは DrivePage → ZoneStatusPanel → StateMark の 2 段まで。3 段以上は無い。
- import: feature 間の import は無い。App.tsx は `@/features/drive`（barrel）経由。feature → app の import も無い。default export は無い（App の lazy は `.then(m => ({ default: m.DrivePage }))` で、feature 側は named のまま）。
- useSyncExternalStore: `subscribe`・`getSnapshot` はインスタンスのプロパティで参照が安定し、`snapshot` は publish のときだけ作り直される。`playback`・`zone`・`alert` は simulation.ts で置き換え（変更ではない）なので、スナップショットが後から書き換わる心配も無い。
- PhoneScreen: Html の別 root に合わせ、Provider と購読を中に持つ設計は合っている。値を props で渡さず自分で購読するので、W1 の `useMemo` の依存に alert の値を入れなくてよい。
- useFrame の優先度: すべて負の値（simulate -100 / resolve -50 / place -20 と DeerHerd の -49）で、R3F の自動描画を止めない。
- フックの順番: DrivePage は早期 return の前にフックをすべて呼んでいる。W1 の `useMemo` も return より前に置くこと。

## 直す順番の提案

1. W1（`phone` を useMemo）→ W2（Atmosphere の args と ref 読み取り）。同時に直す。W1 だけ直すと W2 の症状が隠れて見つけにくくなる。
2. W3・W4（キー入力）。実機の Mac で、Cmd+A のあとと、HUD のボタンを押したあとの Space を試す。
3. I1〜I3 は SPA 遷移（react-router）を入れる cycle で。
