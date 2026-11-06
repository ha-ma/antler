# component-guard レビュー: drive-tourism（React 側 T7〜T15）

日付: 2026-11-06 / 対象: apps/sim/src/features/drive/{chat,components}、plan-trip/index.ts
注: このセッションには Bash が無く git diff は取っていない。現在のファイルを読んで判定した（DrivePage.tsx の差分は RecommendCard と右の列の追加のみに見えた）。

結果: Critical 0 / Warning 4 / Info 6

## Critical

なし。

- components/ 内の fetch・useEffect によるデータ取得: なし（chat-api.ts の fetch は TanStack Query の queryFn 経由、useChatDeck）。
- feature 間 import: すべて `@/features/plan-trip` の barrel 経由（ChatFeed / PhotoCaption / RecommendCard / use-chat-track）。深い import なし。
- Zustand create(): 新規ファイルになし。ChatFeedStore / RecommendTracker は subscribe/getSnapshot の小さなクラスで、State 設計を冒頭コメントに宣言している。
- any 型: なし。
- 新規ファイル（ChatFeed の変更・PhotoCaption・RecommendCard・recommend*.ts）に useEffect は 0 個。useState は RecommendCard が 1 個、DrivePage が 3 個（上限内）。

## Warning

W1. use-chat-track.ts:52-54 — `tourismPleasures(scenario).map(...).join(',')` が render ごとに走る。
DrivePage は useDriveSnapshot で約 10 Hz 描き直されるので、PLEASURES.filter + map + join が 10 Hz で回る。ファイル冒頭コメント（呼ぶ側が毎回新しい配列を渡しても作り直さない）と同じ意図なのに、キーの計算が useMemo の外にある。
対応案: キー計算を `useMemo(..., [scenario.stops, scenario.to, scenario.startAt])` に入れる。scenario は engine.world.scenario で不変なので 1 回で済む。legKey / zonesKey（既存）も同じ。

W2. RecommendCard.tsx:18 — memo されていない。
ChatFeed は memo だが RecommendCard は違う。親（DrivePage）が 10 Hz で描き直されるたびに、カードが出ている間は aside・img・DestinationTime を毎回再評価する。ファイル冒頭コメントの「親の 10 Hz の描き直しに頼らない」は DestinationTime にしか効いていない。props（engine, lang）は安定している。
対応案: `export const RecommendCard = memo(function RecommendCard...)`。

W3. recommend-tracker.ts:41-44 — subscribe が購読者ごとに update() を進める。
`source.subscribe(() => { if (this.update()) listener() })` は、購読者が 2 つ以上になると、2 番目の購読者の呼び出しでは update() が「同じ」と判定して false を返し、通知されない。いまは useSyncExternalStore の購読が 1 つだけなので動くが、テストや別の消費者が増えると壊れる。ChatFeedStore のように、tracker が source を 1 回だけ購読して自分の listeners Set に配るほうが安全（購読は 0→1 で張り、1→0 で外す）。
併せて、render から subscribe までの間に進んだ分は getSnapshot（this.current を返すだけ）では拾えず、次の publish（0.1 秒後）まで遅れる。実害は小さい。

W4. ロジックの置き場所 — RecommendCard.tsx:19-21。
コンポーネントが `useState(() => new RecommendTracker(engine, engine.world.scenario, engine.world.plan.totalKm * 1000))` で tracker の生成と購読を持っている。規約（ロジックは hooks/ へ）に合わせるなら `hooks/use-recommendation.ts`（`useRecommendation(engine): Recommendation | null`）に切り出し、RecommendCard は表示だけにする。あわせて recommend.ts / recommend-tracker.ts / recommend-text.ts は components/hud/ にあるが、純粋関数と tracker なので domain/ か hooks/ のほうが層が合う（text は hud-text.ts の隣で可）。

## Info

I1. recommend.ts:6 が `STAGE_BANNER_MS` を StageBanner.tsx（コンポーネント）から import している。純粋関数が React のモジュールに依存する。定数を hud-text.ts か domain/ に移す。

I2. RecommendCard.tsx:4 が `htmlLang` を chat/ChatFeed.tsx から import している。コンポーネント同士の結合になり、chat-feed.css も一緒に読み込まれる。chat-text.ts に移す。

I3. 写真の img の組み立てが ChatFeed（width=64 height=48 を直書き）と RecommendCard（photo.width / photo.height）で別々。比率が違う写真だと CSS の object-fit 頼みになる。サイズの決め方を揃える（CSS で枠を固定するなら両方 CSS 側へ）。

I4. DestinationTime（RecommendCard.tsx:65）は getSnapshot で毎回 formatJstTime を呼ぶ（10 Hz）。文字列の値比較なので描き直しは分が変わったときだけ。実害なし。

I5. 3D のフレームへの影響はなし。onFrame / world / phone の useMemo の依存は変わらず、新しい CSS のアニメーションは HUD の DOM のみ（opacity 系。prefers-reduced-motion で無効化済み）。tracker はエンジンの 10 Hz の publish から進めるだけで、毎フレーム（useFrame）の処理を足していない。

I6. plan-trip の barrel は PlanPage も export しているので、drive から barrel を import すると plan-trip のモジュール群が drive の依存に入る（ownerTokenOf で既にそう）。photoOf / photoSrc の追加で増えるのは photos.json と zod の検証のみ。気になれば photos を shared/ に昇格する選択肢もあるが、現状は規約どおり。

## 良い点

- ChatFeed の ChatFeedStore と RecommendTracker は、10 Hz で描き直さない（出すものが変わったときだけ通知）設計で、useSyncExternalStore の getSnapshot が同じ参照 / 同じ値を返している。
- PhotoCaption は ChatFeed と RecommendCard で共通化されていて、Props が単純。
- chat-api の応答は zod で検証され、マスターに無い楽しみ id は null に落としている。
