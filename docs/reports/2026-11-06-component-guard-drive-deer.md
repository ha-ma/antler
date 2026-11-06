# component-guard レビュー: drive-deer（claude/drive-deer-4dd39d vs main）

対象: `apps/sim/src/features/drive/` の types.ts、domain/deer-*.ts・detection.ts・simulation.ts・eyeshine.ts、scene/DeerHerd.tsx・DeerModel.tsx・deer-models.ts・DriveScene.test.tsx。
規約: apps/sim/CLAUDE.md、.claude/rules/react-architecture.md、state-management.md。
注: このレビューは Bash を使えないため `git diff` ではなく、ファイルを直接読んで行った。

結果: Critical 0 / Warning 0 / Info 3

## Critical

なし。

## Warning

なし。

- components/ 内の fetch / useEffect: scene/ と domain/ に useEffect と fetch は無い（grep 済み）。
- useState の数: DeerHerd.tsx は 1 個（20 行）、DriveScene.tsx は 2 個（26・27 行）、Atmosphere.tsx は 1 個。いずれも 3 個以内。
- Zustand create(): drive 内の domain/ に `create(` と zustand の import は無い。
- feature 間の import: drive から他 feature への import は `chat/use-chat-track.ts:3` の `@/features/plan-trip`（barrel 経由）だけで、バイパスは無い。今回の差分に新しい feature 間 import は無い。
- Props drilling: DeerHerd から DeerModel へは `id` と `assets` だけを渡す（1 段）。シーンの状態は `useSceneFrame()` で読む。
- default export は無い（named export のみ）。

## 型の整合（新しい Deer 形状: motion / seed / phase）

- `types.ts:159-185` の `Deer` は `motion: DeerMotion`、`seed: number`、`phase: DeerPhase` を持つ。
- scene/DeerHerd.tsx は `world.deer` の `id` と `gone` だけを読む。新しいフィールドに触れないので、型は一致する。
- scene/DeerModel.tsx は `pose`・`heading`・`s`・`d`・`gone` だけを読む。
  - `deerPlacement`（layout.ts:65）は `Pick<Deer, 's' | 'd' | 'heading'>`。
  - `gazeHeading` と `deerEyeshine`（eyeshine.ts:47・60）は `Pick<Deer, 's' | 'd' | 'heading' | 'pose'>`。
  - `HEAD_PITCH[deer.pose]`（DeerModel.tsx:86）は `DeerPose` の 4 値（idle / walk / run / look）と一致する。
  - Pick 型なので、Deer の拡張で壊れない。
- scene/deer-models.ts は `Deer` を import しない。`deerLooks(id)` は id のハッシュだけを使う。型の影響は無い。
- scene/DriveScene.test.tsx:12-30 の `deer()` ヘルパーは `motion` / `seed` / `phase` / `index` / `startedAt` / `gone` をすべて入れている。`Deer` の必須フィールドは満たしている。
- `motion` / `phase` / `seed` を使う側は domain/ だけ（deer-motion.ts・deer-spawn.ts・simulation.ts・deer-cases.ts）。

## Info

1. `scene/DriveScene.test.tsx:68-72` の群れの 3 頭に `pattern: 'herd'` を指定しているが、`motion` は既定の `'graze'` のまま。
   - `DeerCandidate` の規約（herd は `motion: 'herd'` で、pattern は `MOTION_PATTERN` で引く）と食い違う。
   - テストは smoke でシーンを描くだけなので失敗はしない。
   - ただし将来 scene が `motion` を見るようになると、このフィクスチャが紛らわしくなる。`over` に `motion: 'herd'` を足すと整合する。
2. `domain/deer-motion.ts:148` の `spawnDeer(candidate, _t)` の第 2 引数は使っていない（コメント 147 行に理由あり）。
   - 呼び出し側は simulation.ts:383 と多数のテスト。
   - 引数を消すと API が軽くなる。ただし現状でも ESLint は通る前提で、実害は無い。
3. `scene/DeerModel.tsx` は `deer.motion` / `deer.phase` を使わず、動き（stop-midway・turn-back など）は pose と heading の結果だけで見せている。
   - 設計どおりの分離（scene は World の描画だけ）で、問題ではない。
   - 動きごとの見た目の違い（dart の走り出しなど）が必要になったら、domain 側で `pose` / `heading` に落としてから scene に渡す方針を保てる。

## 確認できなかったこと

- `git diff main --stat` を実行できなかった（Bash 無し）。読んだ範囲は上記のファイルだけ。
- domain/ の他の差分（detection.ts、simulation.ts の本体ロジック）は、規約検査（any・useEffect・Math.random・色の直書き・zustand）を grep しただけで、ロジックの中身は読んでいない。
- 今回の依頼範囲外のため、`npm run typecheck` と lint は実行していない。型の一致は読んで確かめたもの。
