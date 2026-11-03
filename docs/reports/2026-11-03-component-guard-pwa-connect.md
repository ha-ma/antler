# component-guard レビュー: apps/pwa/src/features/connect（dc7334b）

照合先: apps/pwa/CLAUDE.md、.claude/rules/react-architecture.md / react-components-rules.md / react-hooks-rules.md / react-feature-api-rules.md / react-store-rules.md / state-management.md。コードは直していない。

## 結論

Critical 0 / Warning 3 / Info 5。構造は規約に沿っている。

## 観点ごとの結果

| 観点                               | 結果                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| components/ 内の fetch・データ取得 | なし。WebSocket は lib/edge-client.ts の EdgeClient に隔離し、hooks で useSyncExternalStore に載せている。TanStack Query の対象（HTTP のサーバーデータ）は無い                                                                                                     |
| useEffect                          | 5 箇所すべて hooks/ 内（use-edge-connection, use-drive-alert の useAckOnDanger, use-location-state, use-now, use-sound-lifecycle）。すべて購読・タイマー・後始末で、理由コメントと eslint-disable 付き。components/ に useEffect は 0。派生値への useEffect は無い |
| 描画中の setState                  | use-drive-alert.ts の `if (!same(previous, next)) setPrevious(next)` の 1 箇所。ガードがあり、deriveAlertState は previous を inZone と keptDistance にしか使わないので 2 回目の描画で収束する（ループしない）。React 公式の「前の値から調整する」型で許容         |
| useState 3 個まで                  | ConnectFlow は 3 個（svc, stage, soundResult）でちょうど上限。ConnectScreen / DriveScreen / LinkIcon は 0。hooks の useState は各 1 個                                                                                                                             |
| barrel                             | index.ts は ConnectFlow と型 ConnectServices だけを明示 export。`export *` なし、store の再 export なし。外部の import は app/App.tsx の `@/features/connect` の 1 件で barrel 経由。他 feature の内部 import なし                                                 |
| Zustand                            | create() / zustand の import なし。store.ts も無い。共有 state が無く、snapshot は useSyncExternalStore、位置は hook 内 state なので State 設計と矛盾しない                                                                                                        |
| props drilling                     | ConnectFlow → Screen の 1 段のみ。3 段以上なし                                                                                                                                                                                                                     |
| any                                | なし                                                                                                                                                                                                                                                               |
| 依存方向                           | feature → shared（@/shared/utils/logger）のみ。app への import なし                                                                                                                                                                                                |

## Warning

### W1. ConnectFlow に出発処理のロジックが残っている（hooks 分離）

components/ConnectFlow.tsx の `depart()` が、音の解除（`svc.sound.unlock()`）、読み上げの解除、位置の許可要求（`requestLocationOnce`）、stage 切替、`unlocking.then(...)` による soundResult 更新、二重実行ガード（`departed` ref）をまとめて持っている。components が `../lib/location` と `../services` を直接 import している点も同根。

- 提案: hooks/ に `useDepart(svc, location)` のようなフックを切り出し、`{ stage, soundResult, depart }` を返す。ConnectFlow は描画と合成だけにする。
- 効果: ConnectFlow の useState が 3 個から減り、上限ぎりぎりの状態を解消できる。

### W2. useAckOnDanger に毎描画で変わるコールバックを渡している

components/DriveScreen.tsx の `useAckOnDanger(alert.state, () => { sendAck(Date.now()) })` はインライン関数なので、useNow により 1 秒ごと（とフラグ受信ごと）に effect の deps `[state, onShown]` が変わり、effect が毎回走り直す。`acked` ref のガードがあるので ack の二重送信は起きず、挙動は正しい。ただ「state が変わったときだけ」という意図が deps に出ていない。

- 提案: `sendAck` を直接渡して hook 内で `Date.now()` を取る（`sendAck` は useCallback 済みで安定）、またはコールバックを ref で持つ。

### W3. ConnectFlow が毎秒、画面全体を再描画する

`useNow()` が ConnectFlow の state なので、1 秒ごとに ConnectScreen（AlertState プレビュー 3 つを含む）または DriveScreen 全体が再描画される。B-1 は now で赤の解除を計算する必要があるので useNow 自体は要る。ただ B-0 のプレビュー 3 つ（props が固定）は React.memo かプレビューのリスト化で止められる。車載スマホの電池と発熱に関わるので、edge-latency-reviewer / performance-analyzer の対象にするとよい。

## Info

- I1. hooks 込みの実質 useState 数: ConnectFlow の描画経路では useEdgeConnection(1) + useNow(1) + useLocationState(1) + 直接 3 = 6。規約は「1 コンポーネントのソース上の useState」と読めるので違反ではない。W1 を直すと実質数も下がる。
- I2. `useState(() => services ?? createBrowserServices())` は「一度だけ作る」ための useState で、3 個の枠を 1 つ使っている。StrictMode の開発時は初期化関数が 2 回呼ばれ、WebAudioPort が 2 つ作られる。WebAudioPort のコンストラクタが AudioContext を作るかは未確認（packages/alert-ui 側）。作るなら開発時のみ 1 つ余る。services の生成は app 側（App.tsx）か hook に移すと、テストの差し込みも素直になる。
- I3. `new WebSocket(url) as unknown as SocketLike`（services.ts）は型の二重キャスト。コメントで理由は書かれている。SocketLike のハンドラ型をブラウザの WebSocket が満たすように寄せれば消せる。
- I4. use-sound-lifecycle の dispose は release と同じ（ビープと発話を止めるだけ）で、StrictMode の二重マウントで cleanup が先に走っても、その後の動作に影響しない。問題なし。
- I5. lib/ は規約のディレクトリ構成（components / hooks / store.ts / types.ts / index.ts）に無い。純粋ロジックの置き場として妥当だが、react-architecture.md に lib/ の記述が無いので、ファイル配置ルールに追記するか services.ts と同様に扱うかを決めるとよい。

## 対象ファイル

- /Users/ha-ma/Documents/herald/antler/.claude/worktrees/pwa-connect-c37cf1/apps/pwa/src/features/connect/components/ConnectFlow.tsx
- /Users/ha-ma/Documents/herald/antler/.claude/worktrees/pwa-connect-c37cf1/apps/pwa/src/features/connect/components/DriveScreen.tsx
- /Users/ha-ma/Documents/herald/antler/.claude/worktrees/pwa-connect-c37cf1/apps/pwa/src/features/connect/hooks/use-drive-alert.ts
- /Users/ha-ma/Documents/herald/antler/.claude/worktrees/pwa-connect-c37cf1/apps/pwa/src/features/connect/services.ts
