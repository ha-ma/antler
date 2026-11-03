# component-guard レビュー: apps/pwa/src/features/connect（feat/pwa-drive）

対象: hooks/use-gps-zone.ts, use-wake-lock.ts, use-drive-alert.ts, use-zones.ts, components/DriveScreen.tsx, ConnectFlow.tsx。
基準: apps/pwa/CLAUDE.md, .claude/rules/react-*.md, state-management.md。コードは直していない。
パスは全て apps/pwa/src/features/connect/ からの相対。

## 結論

Critical 0 / Warning 6 / Info 5。
無限ループは起きない。ただし、収束が judgeZone の実装の癖に依存している（W-1）。
components/ での fetch、feature 間 import、store.ts 以外の create()、any は無し。useState は DriveScreen 0 個、ConnectFlow 2 個、useGpsZone 3 個（上限ちょうど）。

## Warning

### W-1 use-gps-zone.ts:69-70 描画中の setPrevious が judgeZone の不動点に依存している

`judgement = judgeZone({previous})` を描画中に計算し、前回と違えば `setPrevious` している。React 公式の「描画中に state を調整する」型で、条件付きなので書き方自体は許される。

- 実際には 2〜3 パスで収束する。
  - 新しい inside を初めて判定した描画では `enterZone: true`、`passages` は横切りの結果になる。
  - これを previous に入れて再描画すると、同じ fix に対して `enterZone: false`、`passages: []` になる。これは judge.ts:124 と judge.ts:204-212 の挙動。
  - 3 パス目は同じ結果で止まる。
- React の上限（25 回）には届かない。ただし契約として保証されていない。
  - `previous = 自分の出力` で judgeZone が JSON 同値の不動点になる、という性質が前提になっている。
  - judge.ts を直すと「Too many re-renders」になりうる。
- 副作用: 一度きりのイベント（`enterZone`、`passages`）が、コミット前の再描画で消える。
  - PWA は今 `toGpsZone` 経由で status と km しか使わないので実害は無い。
  - 将来 `enterZone` を使うと取りこぼす。コメントで「PWA では使わない」と明記するか、使うなら設計を変える。
- 1 回の描画で nearestZone の全走査と JSON.stringify を 2〜3 回繰り返す。
  - DriveScreen は 1 秒ごとの now、フラグ受信（snapshot）、fix のたびに描画される。
  - judgeZone は useMemo されていない。
- 提案（いずれか）:
  - (a) fix 到着時に `setTrack((t) => ({ fix, judgement: judgeZone({ fix, now: Date.now(), previous: t.judgement, zones }) }))` と reducer 内で畳み込む。
    - reducer は純関数なので StrictMode の二重実行でも決定的。
    - 1 秒の tick では stale 判定だけを `useMemo` で行う。
  - (b) 最低限、`judgeZone(previous=judgeZone(...))` が JSON 同値になる回帰テストを packages/zones に足す。
- ref を描画中に書き換える案は不可。StrictMode の二重描画で previous が汚れる。

### W-2 use-drive-alert.ts:20-30 `previous` state が実質デッドで、毎回余分な再描画をしている

`gps.status === 'unknown' ? null : previous` と渡している。deriveAlertState が previous を読むのは次の 2 箇所だけ。

- `resolveInZone` の末尾（derive-alert-state.ts:81）は gps も flag.zone も不明のときだけ。
- `keptDistance`（同 :86）は gps が unknown のときだけ。

gps が unknown のときは常に null を渡すので、どちらにも前の値は届かない。gps が既知のときは previous に届く前に return する。つまり `previous` は結果に影響しない。

- 影響: state が増え、変化のたびに描画中の setState による再描画が 1 回余分に走る。
- 提案: `useMemo(() => deriveAlertState({..., previous: null}), [snapshot.flag, snapshot.flagReceivedAt, now, gps])`。
  - gps は毎回新しいオブジェクトなので、deps には `gps.status` と距離の値を展開する。
  - もしくは useMemo を諦めて、直接計算だけにする。
- 意図が「持ち越しを使う」なら、いまは動いていない。テストで確かめる。

### W-3 DriveScreen.tsx:87-89 ref コールバックが毎描画で focus() する

`ref={(el) => { el?.focus(...) }}` は描画ごとに新しい関数。React 19 は旧 ref に null、新 ref に要素を渡すので、**1 秒ごと・フラグ受信ごとに focus() が走る**。

- フォーカスが他へ動いていれば奪い返す。スクリーンリーダーの位置が戻る。
- 意図は「出発時に 1 回」。
- 提案: マウント時だけ `useEffect`（理由コメント付き）、または安定した `useCallback` の ref。もしくは `autoFocus` 相当を hooks/ の小さな hook（例 `useFocusOnMount`）に隔離する。

### W-4 DriveScreen.tsx:60 `useAckOnDanger` に毎描画新しい関数を渡している

`() => { sendAck(Date.now()) }` が毎描画で新しくなる。use-drive-alert.ts:46 の deps に `onShown` があるため、effect が毎描画で解除と再登録される。

- `acked` ref のおかげで二重送信はしない。UC-3e の StrictMode テストが守っている。
- 挙動は正しいが、無駄な effect の入れ替えがある。
- 提案: 呼び出し側を `useCallback`（`sendAck` は安定）にする。
- 追加の指摘: `sendAck` の戻り値（boolean）が捨てられている。
  - 送れなかった（false）ときも `acked = true` のままなので、その danger では再送されない。
  - B の `t_shown` 返却が欠けるので、意図なら理由をコメントに書く。

### W-5 use-zones.ts:9 useQuery の再試行が既定のままで、失敗の表示が遅れる

本番の `new QueryClient()`（app/App.tsx:8）は既定の `retry: 3`（1+2+4 秒）。

- `zonesFailed` と注記「zones-unavailable」は約 7 秒後に出る。
- ハッシュ不一致・形の検証失敗は決定的なので、再試行は無意味。
- テストのクライアントは `retry: false`（test/render.tsx:8）。このため本番の挙動がテストで見えない。
- 提案:
  - `retry: (n, e) => n < 2 && !(e instanceof 検証エラー)` のように、ネットワーク失敗だけ短く再試行する。
  - もしくは `retry: false`。
  - ゾーン DB の失敗時は gps が unknown になり琥珀で倒れるので、安全側ではある。
- 補足（OK）:
  - `staleTime: Infinity` なので refetchOnWindowFocus / Reconnect は起きない。
  - key `['zones']` は固定でよい。
  - 大きな GeoJSON なら `structuralSharing: false` も検討（1 回きりの取得なので優先度は低い）。

### W-6 use-wake-lock.ts:18-37 take() が並行すると sentinel を取りこぼす

`visibilitychange` が短時間に 2 回 visible になると、take() が 2 本並行する。後に終わった方が `sentinel` を上書きして、先の sentinel は解放されない（クリーンアップは最後の 1 つだけ release する）。

- 取得に失敗（null）した take() が、まだ生きている sentinel を `null` で上書きするケースもある。
- 提案:
  - 進行中の take を 1 つに絞る（`inFlight` フラグ）。
  - 上書き前に旧 sentinel を release する。
  - もしくは sentinel の 'release' イベントで null に戻す。
- 以下は問題なし:
  - StrictMode の二重マウントは、cancelled と `got?.release()` で正しく片付く。
  - `deps` は ConnectFlow の `useState(svc)` 由来で安定。テストで `wakeLock` に毎回新しいオブジェクトを渡すと effect が毎描画で再実行されるが、`setFailed` は同値で bail out するのでループしない。

## Info

- I-1 use-gps-zone.ts:57 `setTrack` を effect 内で同期的に呼んでいる（react-you-might-not-need-an-effect が嫌う型）。
  - denied をリセットする目的。
  - `onFix` で `denied: false` に戻す方が自然で、effect 内の setState が要らなくなる。
  - 今は購読の disable コメントが理由として足りている。
- I-2 use-gps-zone.ts:48,74-79 `startedAt` はマウント時刻。
  - 許可ダイアログを 10 秒以上開いたままにすると、許可前なのに「gps-lost」が出る。
  - `enabled` が false→true になっても `startedAt` と古い `track.fix` が残る。
  - `enabled` が立った時刻から数えるか、track を `key` でリセットする。
- I-3 DriveScreen.tsx は 118 行・props 11 個で、useState は 0 個。
  - 責務: 3 フックの束ね、注記リストの組み立て、路線名・ETA の整形、`clockOf`、JSX。
  - 次に何か足すなら、先に `useDriveNotes`（hooks/、注記の配列を返す）と `DriveNotes` / `RouteLine`（components/）を切り出す。
  - 今は閾値内。props 受け渡しは ConnectFlow→DriveScreen の 2 段で、バケツリレー（3 段超）には当たらない。
  - ただし `geo` / `wakeLock` / `sound` / `now` は svc 由来で、まとめて渡す案もある。
- I-4 ConnectFlow.tsx:57 `svc.sound.canPlay` を描画中に読んでいる（可変な外部値）。
  - now の 1 秒更新で再評価されるため実害は無い。
  - 購読にするなら `useSyncExternalStore`。
- I-5 テストの穴。
  - DriveGps.test.tsx に StrictMode と描画回数のテストが無い。ConnectFlow.test.tsx にはある。
  - W-1 の「同じ fix で judgeZone が不動点になる」ことを守るテストが無い。
  - `lib/` ディレクトリはスキャフォールドの構成（components/hooks/store/types/index）に無いが、純関数の置き場として妥当。barrel も `ConnectFlow` と型だけで最小。

## 規約チェックの結果

| 項目                                       | 結果                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| components/ 内の fetch / データ取得        | 無し（zones は useQuery 経由）                                         |
| components/ の useEffect                   | 無し（DriveScreen・ConnectFlow とも 0 個。購読は hooks/ に隔離）       |
| useEffect の乱用                           | 派生値への使用は無し。購読 4 件は全て理由コメントあり                  |
| useState 3 個超                            | 無し（最大 useGpsZone の 3 個）                                        |
| 描画中の setState                          | 2 箇所（W-1、W-2）。条件付きで収束するが、設計を見直したい             |
| feature 間 import / Zustand create() / any | 無し（Zustand は未使用。State設計は ConnectFlow のコメントに宣言あり） |
| useQuery の使い方                          | W-5（retry）以外は妥当                                                 |
