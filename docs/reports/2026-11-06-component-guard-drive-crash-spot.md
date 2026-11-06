# component-guard: drive-crash-spot（2026-11-06）

対象: ブランチ claude/drive-crash-spot-6469d4。`apps/sim/src` 配下の次のファイル。

- drive/components の DrivePage.tsx、hud/CrashOverlay.tsx、hud/SpotCount.tsx、spot-text.ts
- drive/hooks の use-crash-sequence.ts、use-deer-tap.ts
- drive/scene の DeerPicker.tsx、DriverCamera.tsx、Cabin.tsx、DriveScene.tsx
- app/DriveRoute.tsx、loss/components/LossPage.tsx、loss/spot-text.ts、record/components/RecordContent.tsx

Bash が使えなかったので `git diff` は取っていない。上のファイルを全文読んで判定した。判定は現在の内容に対するもの。

## 結論

Critical は 0 件。ルールのうち、components/ 内のデータ取得、store.ts 以外の Zustand、`any`、feature 間の barrel 迂回は、いずれも検出されなかった。

- `useState` は DrivePage が 3 個（engine・started・soundOn）で上限ちょうど。SpotCount・CrashOverlay・LossPage・RecordContent は 0 個。
- `useEffect` は hooks/ の 2 本だけ（use-crash-sequence、use-deer-tap）。どちらも外部（タイマー・canvas の pointer イベント）の購読で、`eslint-disable` に理由が書いてある。派生値のための `useEffect` は無い。
- 新しく足された `useEffect` は components/ にも scene/ にも無い。
- feature 間の import は barrel 経由だった。`@/features/drive`、`@/features/loss`、`@/features/record`、`@/features/plan-trip` の 4 つだけで、内部ファイルへの直接 import は無い。
- `PhoneScreenHtml` への参照は残っていない（grep 済み）。

## Critical

なし。

## Warning

### W1 衝突の演出の「偽の outcome」（DrivePage.tsx:225-230）

`EndBanner` に `outcome={crashed && !crashEnded ? 'driving' : snapshot.outcome}` と、本当は衝突しているのに `'driving'` を渡して帯を隠している。

- 子が「走行中」と誤解する可能性がある。将来 EndBanner が outcome で別の表示（音、`aria-live` など）を出すと壊れる。
- 提案: `EndBanner` に `hidden` を足すか、`{(!crashed || crashEnded) && <EndBanner ... />}` で出し分ける。

### W2 衝突の演出のつなぎが DrivePage に散っている（DrivePage.tsx:122-126, 165, 223-230）

`crashed` / `crashEnded` / `onCrashEnd` / `data-crash` / CrashOverlay / EndBanner の出し分けが、ファイルの 3 か所に分かれている。DrivePage は約 250 行で、hook 12 個以上と JSX が同居している。

- 提案: `useCrashFlow(engine, snapshot.outcome, started, onCrashEnd)` を hooks/ に切り出し、`{ crashed, ended, dataCrash }` を返す。DrivePage の見通しが良くなり、`useState` の上限（3 個）にも余裕ができる。
- 今回の差分で急ぎではないので、Critical にはしない。

### W3 「60 m」が仕様の値とは別に 4 言語の文字列へ直書きされている（loss/spot-text.ts:7-12）

drive の `SPOT_EARLY_M = 60`（domain/spot.ts:9）と loss の 4 言語の文字列「60 m より前で」が別々に書かれている。しきい値を変えると、文言だけ古い数字のまま残る。

- loss は drive の内部を import できない（barrel のみ）。
- 提案: `LossSpotting`（または `DriveResult.spotting`）にしきい値 `earlyM` を載せて `{earlyM}` を差し込む。もしくは `SPOT_EARLY_M` を drive の barrel から出す。
- 同じ構造の `Spotting`（drive）と `LossSpotting`（loss）の型の二重定義も、`packages/schema` か barrel の型にまとめるか検討する（Info I5）。

### W4 HUD の文言の置き場が 2 つに割れている（drive/components/spot-text.ts:8-13）

drive の HUD の文言は `hud/hud-text.ts`（`hudText(lang)`）に集まっている。`SPOT_TEXT` だけが components/ 直下の別ファイルにある。

- SpotCount は `hudText` を使わず `spotCount()` を使う。CrashOverlay は `hudText` を使う。同じ HUD なのに引き方が 2 通りある。
- 提案: `hudText(lang).spot.count` に寄せ、`spotCount` は hud-text 側の関数にする。

### W5 DriveScene の `useState` が上限ちょうど（DriveScene.tsx:32-40）

`road`・`initial`・`look` の 3 個で、1 個足すと違反する。

- `initial` は初期化後に変わらない値なので、`useRef` / `useMemo` に置ける。
- `setRoad` / `setLook` を `useFrame` の中から呼ぶ構造は今回の差分の前からある。今回は触れていないので、指摘にとどめる。
- 同じく DriveScene.tsx:47-48 の `Object.assign(globalThis, ...)` はレンダー中の副作用。DEV 限定なので害は小さいが、`useLayoutEffect` か `useFrame` に移すのが望ましい。

## Info

- I1 use-crash-sequence.ts:10-26: `ended` の state と、クリーンアップでの `setEnded(false)` を組み合わせている。戻り値は `crashed && ended` で実害は無い。
  - タイマーの発火（外部の時計）で `setEnded(true)` を呼ぶのは「外部の同期」に当たるので妥当。
  - クリーンアップでの setState を避けたいなら、`key={crashId}` で作り直す設計にして、リセットを不要にする手もある。
  - `useLayoutEffect` で ref を毎レンダー更新する「最新の onEnd」パターンは、use-deer-tap.ts と揃っていて一貫している。
- I2 DeerPicker.tsx:18: `useState(() => ({ raycaster, ndc }))` は定数の入れ物。`useMemo` / `useRef` のほうが意図が伝わる（`useState` の個数にも数えられる）。
  - `useDeerTap` に毎レンダー新しい関数を渡しても、ref 経由なので購読は張り直されない。これは正しい。
- I3 CrashOverlay.tsx:15: `role="alert"` は、マウントされたときに 1 回だけ読み上げられるので設計どおり。
  - `StageBanner` の `role="status"` と同時に鳴らないかは、a11y 側で確認するとよい（accessibility-checker に回す）。
  - 操作要素を持たず、ポインタを奪わない点は AlertState の規約に合っている。
- I4 DriverCamera.tsx:27-39: 衝突の実時間と reduced-motion を ref に持ち、`useFrame` 内で `performance.now()` を読むのは R3F の作法として妥当。`matchMedia` を衝突ごとに 1 回しか読まないのも良い。`aim` の `driveLook` はモジュールのシングルトンのままで、今回の差分では変更なし。
- I5 `Spotting`（drive/types）と `LossSpotting`（loss/types）が別々に定義されている。barrel 越しに drive の型を使うと loss → drive の依存が増える。凍結 API ではないので、いまのままでも構わない。W3 の対処と一緒に決めるとよい。
- I6 小さな重複: `focusOnMount`（LossPage.tsx:26、RecordContent.tsx:23）と `htmlLang`（LossPage.tsx:30、RecordContent.tsx:20、drive の ChatFeed）が複数の feature に同じ形で存在する。`shared/utils/` への昇格を検討する（今回の差分で増えたものではない）。
- I7 依存の向き: LossPage.tsx:4 が `@/features/record` から `recordHref` を import している（barrel 経由なので違反ではない）。
  - DriveRoute.tsx のコメントは「drive と record・loss をつなぐのは app 層だけ」と書いているが、loss → record、loss → drive（型）の依存が実際にはある。
  - コメントを実態に合わせるか、`recordHref` を shared に出す。
- I8 Cabin.tsx: スマホを 3D から外したあと、`useState` / `useEffect` を持たず、`useMemo` + `useFrame` だけの素直な構成。コメントの更新も済んでいる。
- I9 DrivePage.tsx:38-50 の State 設計の宣言は、今回の追加分（衝突の演出・鹿の発見・車内のスマホ・useEffect の置き場）まで更新されていて、ルールを満たしている。
- I10 `any`、`@ts-ignore`、Zustand `create()` は `apps/sim/src` 全体で検出されなかった。

## 参照した規約

`apps/sim/CLAUDE.md`、`.claude/rules/react-architecture.md`、`.claude/rules/state-management.md`（CLAUDE.md の @ 参照として渡された内容）。
