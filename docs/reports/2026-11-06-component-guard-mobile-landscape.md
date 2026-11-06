# component-guard レビュー: mobile-landscape (apps/sim/src/features/drive/)

日付: 2026-11-06 / 対象: 新規 11 ファイル + 変更 DrivePage / StartOverlay / BottomBar / use-keyboard-drive / DriverCamera / drive.css
制約: このレビューでは Bash が使えず `git diff` を取れなかった。変更ファイルは現在の全文を読んだ。変更前との差分は見ていない。

件数: Critical 0 / Warning 5 / Info 7

## 規約の確認

| 項目                               | 結果                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| components/ 内の fetch・データ取得 | 無し                                                                                                                                                   |
| useState 数                        | DrivePage 3（上限ちょうど）、useMobileDrive 2、useTouchDrive 2。TouchControls / RotateGuide は 0（hooks 側に分離済み）                                 |
| Zustand create()                   | 新規なし。store.ts 以外にも無し                                                                                                                        |
| useEffect                          | 全て外部購読か片づけ。`no-restricted-syntax` の disable に理由コメントあり（既存の use-keyboard-drive と同じ流儀）。派生値の計算に使っているものは無い |
| feature 間 import                  | 新規ファイルは drive 内と `@antler/*` のみ。barrel 違反なし                                                                                            |
| 依存方向                           | domain ← hooks ← components、domain ← scene。逆向きなし                                                                                                |
| `any`                              | 新規ファイルに無し                                                                                                                                     |
| props drilling                     | 最大 1 段（DrivePage → TouchControls / BottomBar / StartOverlay）。問題なし                                                                            |
| State 設計の宣言                   | useMobileDrive / useTouchDrive の冒頭に有り。DrivePage の宣言コメントに mobile の行は無い（Info I-1）                                                  |

## Critical

なし。

## Warning

### W-1 `driveLook` のモジュール・シングルトンは妥当だが、所有者が 3 か所に散っている

- `domain/look-input.ts:55`、書き手は `hooks/use-mobile-drive.ts`、読み手は `scene/DriverCamera.tsx:20`。
- 60 fps で useFrame から読むので React state にしない、という判断は正しい。選択肢のうち Zustand は `getState()` の transient 読みで同じことができる。ただし store.ts に置く必要があり、いまの規模ではクラス 1 つのほうが軽い。Zustand にする必要はない。
- 問題は寿命の管理。`reset()` は `useSceneLook` のアンマウント（:115）、`gyro.clear()` は `askGyro`（:62）と `useGyroLook` の cleanup（:89）の 3 か所で呼ばれる。書き手の hook ごとに片づけの責任が分かれている。
- 運転画面が同時に 1 つという前提はコメントにしか無い。StrictMode の二重マウントは reset が冪等なので問題ない。ただしテストを並列に動かすと（vitest は同一ファイル内は直列）、別ファイルでも module 単位で隔離されるので今は安全。同一ファイル内では `afterEach(() => driveLook.reset())` が要る。mobile.test.tsx で入っているか確認すること。
- 推奨: 今のまま出してよい。直すなら `useMobileDrive` が `LookInput` を `useState(() => new LookInput())` で持ち、`Scene` に安定した参照として渡す（`world` と同じ流儀）。グローバルが消え、片づけの責任も 1 か所になる。`memo(DriveCanvas)` は参照が安定なので破れない。
- 次の feature で運転画面が 2 つ並ぶ（分割表示など）なら、そのときに必ず直す。

### W-2 knob の移動量 36px が CSS の円の寸法と二重管理

- `components/hud/TouchControls.tsx:33` の `stick.x * 36` と、`drive.css:312` の `width: 48px`、`--drive-stick`（可変）。
- 入力側は `getBoundingClientRect()` の実寸（`use-touch-drive.ts:80-85`）で -1〜1 に正規化している。見た目だけ固定 px なので、`--drive-stick` がメディアクエリで変わると、指の位置と knob の位置がずれる。
- 推奨: `translate(calc(-50% + ${x * 100}% ...))` ではなく、CSS 変数 `--stick-x` / `--stick-y`（-1〜1）だけ渡し、移動量は CSS 側で `calc(var(--stick-x) * (var(--drive-stick) / 2 - 24px))` にする。

### W-3 useTouchDrive の state と ref の二重持ち

- `use-touch-drive.ts:41-43`。`stick` / `brake` の state と、同じ値の `current` ref を `send` で両方更新している。ref は「別のハンドラが最新値を読むため」だが、state の更新関数形（`setStick(prev => ...)`）では入力の送信（`target.setInput`）を副作用なしに書けないので、現状の形は理由がある。
- ただし `releaseAll`（:111-117）と `send` で更新箇所が 2 つに分かれ、片方だけ直すと食い違う。`send` 1 つに寄せる（`releaseAll` も `send` を経由する）と、更新の入口が 1 つになる。
- 加えて `send` は pointermove のたびに `setStick` の新しいオブジェクトで再描画し、値が変わらなくても `engine.setInput` まで届く。boolean 4 つが前回と同じなら `target.setInput` を呼ばない、で十分。

### W-4 useMobileDrive が 5 つの責務を持つ

- `use-mobile-drive.ts`。InputMixer、メディアクエリ 3 つ、ジャイロ許可、縦の一時停止、シーンの視線ハンドラ。
- 内部は小さい hook に分かれていて読みやすい（`useGyroLook` / `usePortraitPause` / `useSceneLook`）。ただし 1 ファイルに入っていて、戻り値の型 `MobileDrive` が 8 フィールドになっている。DrivePage はこの 8 つのうち 6 つを別々の場所に配っている。
- いま直す必要はない。次に機能を足す（例: 傾きの感度設定）ときに、`use-gyro-look.ts` と `use-scene-look.ts` へ分けること。

### W-5 `begin` と `retry` に同じ 3 行の重複、`retry` は ジャイロの許可を取り直す必要があるか未確認

- `DrivePage.tsx:107-118`。`sound.start()` / `drive.audio.start()` / `mobile.askGyro()` が両方にある。
- iOS では `requestPermission` は許可済みなら 2 回目はユーザー操作なしで通るので、動作上は問題ない。基準を取り直す意図（`askGyro` の :61 のコメント）は読み取れる。
- 推奨: `startSession()` を 1 つ作り、`begin` は `startSession(); setStarted(true)`、`retry` は `engine.restart(); startSession()` にする。

## Info

- I-1 `DrivePage.tsx:32-41` の State 設計コメントに、mobile-landscape の行（`useMobileDrive` が InputMixer・ジャイロ・視線を持つ）が無い。hook 側に宣言があるので重大ではないが、DrivePage が合成の起点なので 1 行足すと探しやすい。
- I-2 `usePortraitPause`（`use-mobile-drive.ts:95-107`）は `portrait`（`useMediaQuery` で既に購読済み）と同じクエリをもう一度 `matchMedia` で購読している。`useEffect(() => { if (driving && portrait) engine.setPaused(true) }, [engine, driving, portrait])` で同じ挙動になり、購読が 1 つ減る。
- I-3 `useMediaQuery`（`use-media-query.ts:30`）の `getSnapshot` が呼ばれるたびに `matchMedia()` で新しい MediaQueryList を作る。結果は正しいが、dev の二重呼び出しも含めて無駄。`useRef` か query ごとの Map で 1 つ持つとよい。
- I-4 `useKeyboardDrive(engine: InputTarget, ...)`（`use-keyboard-drive.ts:32`）の引数名が `engine` のまま。InputMixer の窓口も受けるので `target` に改名する。
- I-5 `use-touch-drive.ts:102` の `onPointerMove: () => undefined` は、ブレーキ側に不要なハンドラ。`PadHandlers` の `onPointerMove` を optional にして外せる。
- I-6 `useSceneLook`（`use-mobile-drive.ts:115`）は cleanup だけの effect。`useGyroLook` の cleanup と合わせて `useDriveLookLifecycle` のように 1 か所にまとめると W-1 の所有者が見やすくなる。
- I-7 `StartOverlay.tsx:55` は `scenario.trip.lang`、DrivePage の他の箇所（TouchControls・RotateGuide）は `snapshot.lang`。demo でも `trip` は必ずあるので落ちないが（`types.ts:30`）、同じ言語の出所に揃えたほうが後で迷わない。

## driveLook の設計の結論

- 60 fps で useFrame から読む値を React state にしない判断は妥当。`DriverCamera` は `look` を ref で持ち、`driveLook.target()` を毎フレーム呼ぶだけで、再描画を起こさない。
- 優先順位（ジャイロ → 指 → マウス）は `LookInput.target` に閉じていて、純粋な domain として単体テストしやすい。`now` を引数で受けるのも良い（テストで時計を差し替えられる）。
- 懸念は W-1 のみ。グローバルが残るなら、少なくともテストの `afterEach` で `driveLook.reset()` を入れること。

## 良い点

- 入力元を InputMixer（OR 合成）に分けたので、キーと指が互いの押下を離さない。engine に直接 setInput していた経路が 1 本に集約された。
- 指を離す契機（up・cancel・lostpointercapture・blur・visibilitychange・アンマウント）が網羅されている。縦に回転した際のアンマウントでも `target.setInput(NO_INPUT)` が走る（`DrivePage.tsx:173` のコメントどおり）。
- `gyro-permission.ts` は同期呼び出しの制約（iOS）をコメントで残し、例外・reject を全て false に落としている。
- TouchControls / RotateGuide は state を持たない、またはロジックが hook に出ていて、components/ の規約に合っている。
