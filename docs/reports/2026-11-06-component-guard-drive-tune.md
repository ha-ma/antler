# component-guard レビュー: feat/drive-tune（dfd3ae6）の React 側

対象: apps/sim/src/features/drive/ の components/DrivePage.tsx、components/StartOverlay.tsx（hud/ ではなく components 直下にある）、components/hud/RoutePanel.tsx、StageBanner.tsx、hud-text.ts、hooks/use-alert-sound.ts、components/drive.css（色の確認のため）。scene/ は対象外。
仕様: docs/specs/drive-tune/functional.md の R1・R4・R6。

## 件数

- Critical: 0
- Warning: 3
- Info: 4

## 検査結果（問題なし）

- 色の直書き: components/ 配下に `#hex` / `rgb()` / `hsl()` は 0 件。drive.css の新規ルール（route・stage・start）は `var(--spruce)`、`--on-spruce`、`--surface`、`--line`、`--ink-muted`、`--space-*`、`--radius-*` だけを使っている。
- 絵文字: 0 件。`→` は文字で、アイコンではない。
- useEffect: components/ 内に 0 件。hooks/ の use-alert-sound.ts に 1 件（コントローラの dispose）で、理由コメントと eslint-disable の理由がある。派生値の計算には使っていない。
- データ取得: components/ に fetch や useEffect での取得は無い（DriveScreen の TanStack Query は既存どおり）。
- useState: DrivePage は 3 個（engine・started・soundOn）で上限内。State 設計のコメントも更新されている。
- feature 境界: 他 feature の内部 import は無い。`@antler/trip`、`@antler/alert-ui`、`@antler/schema` は packages なので可。
- Zustand: create() は無い。
- any: 無い。
- props drilling: DrivePage → 各 HUD は 1 段だけ。3 段以上の受け渡しは無い。
- renew の安全性: `AlertSoundController.dispose()` は `release()` を呼ぶだけで port を閉じない（packages/alert-ui/src/sound/sound-controller.ts:109）。そのため、同じ port で作り直したコントローラは、古いコントローラの dispose の後も鳴る。R1 の「同じ出力先で作り直す」と整合している。

## Warning

### W-1 フレームごとのイベント処理が DrivePage に入っている（hooks 分離）

DrivePage.tsx:70-85 の `onFrame` の中で、`engine.frame(dt)` の戻りのイベントを見て、`stage-clear` なら `renewSound()`、`collided` / `completed` なら `onFinish` を呼んでいる。ステージ移動と音の再生成を結ぶ今回の新しいロジックがコンポーネントに入っている。
対応案: `hooks/use-drive-frame.ts`（仮）に `useDriveFrame({ engine, started, sound, onFinish })` として抜き出し、DrivePage は返ってきた `onFrame` を渡すだけにする。テストもフックだけで書ける。

### W-2 DrivePage が `engine.world.internal` を直接読んでいる

DrivePage.tsx:154 の `noZone={engine.world.internal.stages.length === 0}`。`internal` はエンジン内部の状態で、UI に出す前提ではない。さらに、`useDriveSnapshot` を経由しないので購読の対象にならない（再描画のきっかけにならない）。今回 `snapshot.stage.count`（engine.ts:219-220）が増えたので、`snapshot.stage.count === 0` で足りる。
対応案: `noZone={snapshot.stage.count === 0}`。DrivePage.tsx 内で world の internal に触れる所をなくす。

### W-3 RoutePanel が毎描画で楽しみの一覧と地点名を計算している

RoutePanel.tsx:20-25 で `placeById` と `pleasureById` を引き、`flatMap` で一覧を作っている。スナップショットは 10 Hz で変わるので、変わらない値（scenario 由来）を毎回作り直している。同じ地点名の解決が StartOverlay.tsx:8-10 の `placeName` にもあり、重複している。
対応案: `hooks/use-route-guide.ts`（仮）に `useRouteGuide(scenario)` を作り、`useMemo` で `{ from, to, pleasures }` を返す。または domain 側の純関数にして、StartOverlay と共有する。

## Info

- I-1: `STAGE_BANNER_MS`（StageBanner.tsx:5）が、コンポーネントのファイルから export されている。他に参照は無い。コンポーネントのファイルから定数を export すると react-refresh のルールに触れやすい。時計の長さは domain の定数なので、domain に置くか、export をやめる。
- I-2: `renewSound` は、アラート OFF（`snapshot.alertEnabled === false`、スマホ非表示）でもステージ移動のたびにコントローラを作って unlock する。実害は無い（port は解除済み）。`alertEnabled` のときだけにする案もある。
- I-3: `"D"`、`"→"`、`"km"`、`" / "` の記号が JSX に直接書かれている（RoutePanel.tsx、StartOverlay.tsx）。地の文は HUD_TEXT に集めている方針なので、4 言語化（Deferred）のときに拾い漏れやすい。今は ja のみなので対応は急がない。
- I-4: `start()` を続けて呼ぶと、前の port を閉じずに新しい port を作る（use-alert-sound.ts:36-39）。「同じシードでもう一度」のたびに AudioContext が増える。R7 から続く挙動で、今回の差分ではない。WebAudioPort 側に close があるなら、`start()` で前の port を片づける。

## 受け入れ（今回の範囲の確認）

- R1 ステージ帯: `outcome === 'driving'` かつ `t - stageClearedAt <= 2000` の間だけ出る。シミュレーションの時計で判定しており、仕様どおり。最後のステージのクリアでは `completed` になり出ない。
- R4 区間の案内: 区間（D の番号・出発地 → 到着地）、目的地までの km と到着予定、ステージ n / m、楽しみの名前と一言を出している。楽しみが無い日は一覧の見出しごと出さない。ステージが 0 の日は行を出さない。
- R6: 音の合図の差し込み口は engine 側（scene と domain）の担当で、この範囲では見ていない。
