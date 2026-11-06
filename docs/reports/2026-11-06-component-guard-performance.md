# component-guard: performance feature（apps/sim）

日付: 2026-11-06 / 対象ブランチ: claude/performance-d0daf4（925bb98...HEAD）

注意: このレビューでは Bash が使えず `git diff` を取っていない。対象ファイルの現在の中身を読んで判定した。
ビルド・テストは走らせていない（依頼どおり）。

読んだもの: apps/sim/CLAUDE.md、.claude/rules/react-architecture / hooks / components / app / feature-api、
FrameMeter.tsx（とテスト）、hooks/use-frame-meter.ts、DrivePage.tsx、scene/AdaptiveDpr.tsx（とテスト）、
scene/DriveCanvas.tsx、scene/load-drive-canvas.ts、drive/index.ts、app/routes.tsx、preload-drive.ts、DriveRoute.tsx。

## 結論

Critical: 0 件。useEffect の乱用なし、feature 境界の違反なし、Zustand の create() なし、any なし。

良い点:

- タイマーの購読を useEffect ではなく useSyncExternalStore で受けている。FrameMeter 系・AdaptiveDpr に useEffect は 1 つも無い。
- AdaptiveDpr は useRef と useFrame だけで、段が変わったときだけ setDpr を呼ぶ。再レンダーを起こさない。
- app → features の import は routes.tsx（plan-trip の barrel、他は `import('@/features/...')`）、preload-drive.ts（`@/features/drive` の barrel）、DriveRoute.tsx（drive・loss・record の barrel）のすべてで barrel 経由。
- DrivePage の useState は 3 個ちょうど（engine / started / soundOn）で、FrameMeter を足しても増えていない。
- 3D を読む口（loadDriveCanvas）が 1 つで、DrivePage の lazy と先読みが同じ import を共有している。

## Critical

なし。

## Warning

W-1. FrameMeter.tsx に 2 つのコンポーネントがある（FrameMeter と FrameMeterReadout）

- react-architecture の「1 ファイル 1 コンポーネント」に反する。
- FrameMeterReadout は on のときだけ useFrameMeter を呼ぶために分けている（hook を条件付きで呼べないので分割自体は正しい）。
- 対処案: FrameMeterReadout.tsx に分ける。または FrameMeter が URL の判定を hooks 側（`useFrameMeterOn()` のようなもの）に出し、1 コンポーネントにする。ただし hook は条件付きにできないので、前者が素直。

W-2. 新しい state の State 設計が宣言されていない

- apps/sim/CLAUDE.md の MUST「新しい state を追加する前に State 設計を宣言する」。
- DrivePage.tsx の冒頭の State 設計コメントに、?fps=1（URL state）と 0.5 秒ごとの要約（外部ストアの購読）が無い。FrameMeter.tsx の冒頭コメントにも「State」としての宣言は無い。
- 対処案: DrivePage の State 設計に 1 行足す（「- 開発用の fps: ?fps=1 は FrameMeter が場面を作るときに 1 回読む。要約は use-frame-meter が 0.5 秒ごとに取り直す」）。

W-3. DriveCanvas の `dpr={[1, 1.5]}` と AdaptiveDpr の `setDpr` が同じ値を別々に持っている（要確認）

- DriveCanvas が再レンダーされて Canvas に新しい配列リテラルが渡ったとき、R3F が dpr prop の変化として扱って DPR を 1.5 に戻すかどうかは、使っている R3F の版の挙動による。ここでは確かめていない。
- DriveCanvas は Scene が memo なので再レンダーは少ないはずだが、「下げたら戻さない」(AdaptiveDpr の仕様) が prop の再適用で破れる可能性がある。
- 対処案: `const DPR_RANGE: [number, number] = [1, 1.5]` をモジュール定数に出す（identity を固定）。さらに quality.ts の INITIAL_QUALITY の step 0 の DPR とこの上限を同じ定数から作る。
- テストは AdaptiveDpr を Canvas なしの test renderer で動かしているので、Canvas の dpr prop との相互作用は検証されていない。

W-4. DriveRoute（app 層）に判断のロジックがある（既存の構造だが記録する）

- app-rules は「business logic を置かない」。onFinish の中の「旅の場面だけ保存」「not-owner なら移らない」「衝突なら loss へ」「完走なら record へ」は app 層の業務判断。
- performance の差分はコメントの変更だけと見える。この feature で直す必要は無い。
- 次に触るときは、record か loss の barrel に `useFinishDrive(navigate)` のような hook を出して app は配線だけにする案を検討する。

W-5. routes.tsx の `/trip/:id/brief` の lazy 内に副作用（schedulePreloadDrive）がある

- ルートのチャンクを読み終えたときに 1 回呼ぶ作りで、useEffect よりは筋が良く、動作は妥当。
- ただし lazy ファクトリは「チャンクを取る」責務で、先読みの予約を混ぜると、このルートを別の経路で先読みしたときにも A-2 を開いていないのに drive の先読みが走る。
- 対処案: 影響が小さいので許容してよい。気になるなら app 層の薄い BriefRoute ラッパー（DriveRoute と同じ並び）に `useEffect` ではなくルートの `loader` で呼ぶ。

## Info

I-1. 状態の読み方が二重

- FrameMeter は `window.location.search` を直接読む。drive には hooks/use-drive-params.ts が既にあるので、?fps の判定も同じ場所に寄せると URL の読み口が 1 つになる（isFrameMeterOn は use-frame-meter.ts にある）。

I-2. useFrameMeter の `useMemo` はキャッシュを保証しない

- React は useMemo の値を捨てることがある。捨てられると store が作り直され、subscribe の identity が変わって再購読になる（値は read() で取り直されるので壊れはしない）。
- 厳密にするなら useState の遅延初期化か、engine ごとに WeakMap で store を持つ。いまの用途（開発用）では許容。

I-3. テストのしかた

- FrameMeter.test.tsx は hook をコンポーネント経由で検証している。実装は小さいので問題ないが、次を足すと堅くなる:
  - アンマウントで clearInterval されること（`vi.getTimerCount()` が 0 になる）
  - engine が変わったときに store が作り直されること
  - `isFrameMeterOn` の純関数テストは hooks/use-frame-meter.test.ts に移す（現状は component のテストの中の UC-2b と混ざっている）
- AdaptiveDpr.test.tsx の `seen` はモジュールのグローバル配列。afterEach で空にしているので今は問題ない。

I-4. コメントの数字が合っていない

- load-drive-canvas.ts は「gzip 約 250 KB」、DrivePage.tsx は「gzip 約 300 KB」。どちらかに揃える。

I-5. preload-drive.ts のモジュール変数 `pending`

- テストの間に状態が残る。リセット用の export が無い場合は、テストで vi.resetModules を使っているか確認する（preload-drive.test.ts は読んでいない）。

I-6. DrivePage.tsx は hook と props が多い（useState 3 + hook 8 前後）

- 今回の差分で悪化はしていない。FrameMeter は engine を 1 段渡すだけで props drilling にはならない。

## 参照した規約

- apps/sim/CLAUDE.md（MUST の State 設計の宣言、barrel 経由）
- .claude/rules/react-architecture.md（1 ファイル 1 コンポーネント、依存方向）
- .claude/rules/react-app-rules.md（app 層にロジックを置かない）
- .claude/rules/react-hooks-rules.md（購読・タイマーは hooks に隔離）
