# plan-trip（sim）— A-1 旅をつくる（`/plan`）の実装結果

日付: 2026-11-03 / ブランチ: feat/plan-trip（コミットなし）/ 仕様: `docs/specs/plan-trip/functional.md`（R1〜R6・R8 の端末側）、`plan.md` #4

## 確認の結果

| 検査                                                              | 結果                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cd apps/sim && npx --no-install vitest run`                      | 7 ファイル・161 件すべて Green（plan-trip は 4 ファイル・157 件で、そのうち 4 言語の表の検査が 141 件）                                                |
| `npx --no-install tsc --noEmit`                                   | エラー 0                                                                                                                                               |
| `npx --no-install eslint src/`                                    | エラー・警告 0                                                                                                                                         |
| カバレッジ（vitest --coverage）                                   | 全体 lines 96.8%、plan-trip は lines 100% / branches 83%（下限 70%）                                                                                   |
| `check_react_boundaries.py --root apps/sim`                       | 4 規則すべて OK                                                                                                                                        |
| `scripts/ci_arch_check.py`                                        | 違反なし                                                                                                                                               |
| `vite build`（出力は scratchpad。`apps/sim/dist` は触っていない） | 成功。JS 529 kB（gzip 168 kB）で 500 kB の警告あり（下の「未解決」）                                                                                   |
| component-guard                                                   | Critical 0、Warning 5 → W1〜W5 を直した。全文 `docs/reports/2026-11-03-component-guard-plan-trip-sim.md`                                               |
| accessibility-checker                                             | Critical 5 → 5 件とも直した。Warning 14 件のうち 11 件を直した（残り 3 件は「未解決」）。全文 `docs/reports/2026-11-03-accessibility-plan-trip-sim.md` |

`packages/trip` は編集していない（テストの時点で risk / title / locale / plan まで揃っていた）。

## 作ったファイル

`apps/sim/src/features/plan-trip/`

- `store.ts`: Zustand。State 設計を先頭のコメントに書いた。`selections`（エリアごとの選択と重さ）・`area`・`lang` と、`togglePleasure`・`setWeight`・`setArea`・`setLang`・`resetPlanTrip`。初期値はペルソナで、言語は `initialLang(navigator.languages)`。11 件目は store でも足さない。新しく選んだ楽しみの重さは 3
- `types.ts`: フォームの値、選択、遷移の state、失敗の種類
- `text.ts`: 画面の文言を 4 言語の表（`PLAN_TEXT`、`satisfies Record<string, UiText>`）と `fillText`（`{n}` の差し込み）で持つ
- `utils/trip-input.ts`: datetime-local（日本時間）に `+09:00` を付けて ISO 8601 にする。フォームと store から TripInput を作って `TripInputSchema` で検証し、問題を欄と文言に対応づける。resolver の中身もここ
- `utils/lang.ts`: `htmlLang`（zh → zh-Hant）、遷移の state からタイトルを読む
- `hooks/usePlanForm.ts`: React Hook Form。初期値は `PERSONA_INPUT`。resolver は送信の瞬間に store を `getState()` で読む（購読はしない）
- `hooks/useTripPreview.ts`: 入力が変わるたびに `buildItinerary`・`assessRisk`・`draftTitles` を useMemo で作り直す（API は呼ばない）。フォームが不正なあいだは、最後に通ったフォームの値に、いまの楽しみ・エリア・言語を合わせて作る
- `hooks/useCreateTrip.ts`: TanStack Query の `useMutation` で `POST /api/trips` を送る
  - `Idempotency-Key` は押すごとに `crypto.randomUUID()` で作り、`{key, input}` を sessionStorage（`antler.plan-trip.pending`）に残す。成功したら消す
  - 応答は `TripPlanSchema` と `TripDetailsSchema` で検証する
  - 429 は `limit`、それ以外は `failed` として扱う
  - 入力・キー・ownerToken はログに出さない
- `hooks/useSubmitTrip.ts`: 主ボタンは新しいキーで送る。「もう一度」は、入力が前回と同じなら sessionStorage の同じキーと入力で送り直す。失敗のあとに入力を直していたら、新しいキーで送る。成功したら `/trip/:id/brief` に移り、4 言語のタイトルは遷移の state で渡す
- `components/`:
  - `PlanPage`・`PlanHeader`（ロゴ・ステップ・言語）・`LangSelect`・`PlanForm`（2 カラム）
  - `TripInputFields`（8 欄。出発と返却は「（日本時間）」と書いた datetime-local）
  - `PleasurePicker`（カウンター「選択 n / 10」）・`AreaTabs`（tablist、矢印キーで移る）
  - `PleasureCard`（photo-placeholder の面、spruce 2px の枠、SVG のバッジ）・`SelectBadge`・`WeightPicker`（44px の −／＋ と 5 段のバー）
  - `ItineraryPanel`（タイトル、D1〜Dn に地点名と楽しみの名前を表示中の言語で、入りきらない楽しみ、予算 `formatBudget`）・`AllocationBar`
  - `RiskBand`（語と clay の帯。数値は出さない。「重みは目安です。」と出典 `STATS.deerAccidents.source.name`）
  - `CreateTripStatus`（role=alert）・`TripBriefPlaceholder`（「ブリーフィングは準備中です」とタイトル）・`plan-trip.css`
- `index.ts`: `PlanPage`・`TripBriefPlaceholder`・`BriefLocationState` を公開する
- テスト: `text.test.ts`・`store.test.ts`・`components/PleasurePicker.test.tsx`・`components/PlanPage.test.tsx`

`apps/sim/src/app/`

- `routes.tsx`（新規）: `/` → `/plan`、`/plan`、`/trip/:id/brief`、それ以外 → `/plan`
- `App.tsx`: `@antler/alert-ui/tokens.css` を読み込み、RouterProvider を置く。テスト用に `router` を props で渡せる。ブラウザのルーターは 1 つだけ作る
- `App.test.tsx`: 書き換えた。h1 は画面の見出し、「EZO ROAD」はヘッダーのロゴの文字にした

## 満たした Test List の ID

| ID                    | テスト                                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-2                  | `PlanPage.test.tsx`。ペルソナで D1〜D5 と「高い」が出る。タンチョウを外すと days とタイトルが変わる。主ボタンで fetch のスタブを呼ぶ（URL、UUID のキー、body が期待の TripInput、`+09:00` 付き）。201 で `/trip/Ab3dE6gh/brief` に移り、タイトルを出す。sessionStorage は空に戻る |
| UC-2b                 | `PleasurePicker.test.tsx`・`store.test.ts`。10 件選ぶと 11 件目は aria-disabled で、押しても増えない。上限のメッセージが出る。外すと重さの欄が消え、選び直すと 3 から。重さは 1〜5 のあいだに収まる                                                                               |
| UC-2c                 | `PleasurePicker.test.tsx`・`store.test.ts`。道東で 3 件選んで道央に切り替えると「0 / 10」、戻ると「3 / 10」                                                                                                                                                                       |
| UC-6a                 | `store.test.ts`（zh-TW → zh、fr → ja、ko → ko）。`PlanPage.test.tsx`（zh-TW で繁體中文の画面になり、ko に切り替えると文言とリスクの語が変わる。fr → 日本語）                                                                                                                      |
| 文言の欠け            | `text.test.ts`。全キーが 4 言語とも空でなく、差し込みの名前が 4 言語でそろう                                                                                                                                                                                                      |
| 補助（UC-1 の画面側） | 運転 5 人・人数 4 で欄のエラーが出て、しおりは前のまま、api は呼ばない。不正なあいだも楽しみの変更はしおりに反映する。返却日を変えると日数が変わる                                                                                                                                |
| 補助（R8・R9）        | 502 で入力を残して「もう一度」が出て、同じキー・同じ body で再送する。入力を直してからの「もう一度」と、主ボタンの押し直しは新しいキーになる。429 で「本日の生成上限に達しました。」                                                                                              |

## 指示からずらした点（要確認）

1. **環境変数の名前は `VITE_API_BASE_URL` にした（指示は `VITE_API_URL`）。** `apps/sim/.env.example` と `vite.config.ts` の CSP（`connect-src`）が、すでにこの名前を使っている。別の名前を足すと、本番ビルドで API への接続が CSP に止められる。そのため `.env.example` は変えていない
2. **重さは「段をタップ」ではなく「−／＋」の 2 ボタンと見た目だけの 5 段バーにした。** 5 段を押せるボタンにすると、44px（ch5）を満たす幅がカードに入らない（accessibility-checker の Critical）。デザインとの差として、デザイン側の確認が要る
3. 上限に達したカードは `disabled` ではなく `aria-disabled` にした。フォーカスを残し、理由のメッセージを `aria-describedby` で読み上げるため
4. ヘッダーの「EZO ROAD」は h1 ではなくロゴの文字にした。h1 は画面の見出し「どんな北海道の旅を…」で、`App.test.tsx` もこれに合わせて書き換えた

## 未解決の点

- **`@antler/alert-ui` が `apps/sim/package.json` の dependencies に無い。** ワークスペースのシンボリックリンクで解決できているので動く。package.json は範囲外なので触っていない。メインセッションで `"@antler/alert-ui": "^0.0.0"` を足してほしい
- `MAX_BUDGET_JPY` が `@antler/trip` の index から公開されていないので、`utils/trip-input.ts` に `BUDGET_MAX_JPY = 1_000_000` を写した。index で公開されたら置き換える
- `ownerToken` はどこにも残していない（R7 の削除は record の feature）。record の feature で、端末に残すかどうか決める必要がある
- `/trip/:id/brief` は、遷移の state が無いと（読み込み直しや直リンクで開いたとき）タイトルを出さない。GET の API は brief-map の feature で作る
- JS が 529 kB（gzip 168 kB）。zod と楽しみ・地点のマスターが入るため。初回読込 3 秒（ch6）に効くので、drive の feature が入ったらルートごとの lazy 読み込みと performance-analyzer の確認が要る
- a11y の Warning で残したもの:
  - しおりやリスクが変わったことを読み上げる要約のライブリージョンが無い
  - 言語の select が、矢印キーの操作でもすぐ切り替わる（WCAG 3.2.2）
  - 送信時に、最初のエラー欄へフォーカスを移していない（エラーは欄ごとに `aria-describedby` で結んでいる）
  - リスク帯の軌道の `line` が低コントラスト（帯は aria-hidden で、語でも伝えている）
- 出典の名前（`北海道警察`）は stats.json の日本語のまま 4 言語に出している
- フォント（Noto Sans JP・IBM Plex Mono）の読み込みは `index.html` 側にまだ無い（範囲外）
- 写真は `photo-placeholder` の面と説明文のまま（Day 6）
