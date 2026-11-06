# antler（EZO ROAD）— モノレポ共通ルール

北海道のレンタカー旅行者が、エゾシカとの衝突で旅を失わないためのプロダクト。Built with Claude Japan 2026、1 週間・2 名。

- **A** 運転前: ブラウザの 3D 運転シミュレーション（apps/sim ＋ apps/api）
- **B** 運転中: 車載 Mac Mini のカメラで鹿を検知し、スマホ PWA に通知（edge/detector ＋ apps/pwa）
- A と B は同じ 3 状態（緑＝円／琥珀＝三角／赤＝八角）を同じ `AlertState` で出し、同じ `Capture` で教師データを残す

## 正（迷ったらここを読む。ここに無いことを推測で決めない）

| 何 | どこ |
| --- | --- |
| 要件（第 0〜10 章） | `docs/requirements/`（下の一覧）。原本は Claude Docs https://claude.ai/artifact/Jr6zYHcjdSy5xEd1WaG7v8 |
| 第 9 章の判断 | `docs/requirements/ch9-decisions.md` の「判断記録」表。**このファイルだけはリポジトリ側が正** |
| デザイントークン | `docs/design/tokens.json` |
| デザインの原則・コンポーネント・アートボード→ルート対応表 | `docs/design/README.md` |
| `AlertState` の props と規約 | `docs/design/AlertState.md` |
| 画面 | UI キャンバス v2 https://claude.ai/artifact/92Ho3c3gpV3CdNwmLvUS5F（画面名 A-1〜A-7 / B-0〜B-3 は要件 ID と対応） |
| 統計の実数 | `packages/trip/data/stats.json`（出典・照合状態つき。sim と api が `@antler/trip` の `STATS` で読む） |
| stack の登録 | `routes.toml` |
| feature の順番（ch10 ＋ 付録 A の改善リスト） | `docs/roadmap.md` |
| 背景（ビジネス・プレゼン・開発の全体像） | 統合ドキュメント https://claude.ai/artifact/EWgkjzMEFsTKozahPeT4pg（文脈。要件の正ではない） |

要件の分割（ファイル名で指す。依頼も「ch5-common.md の 3 状態表」のように章で指す）:

| ファイル | 章 |
| --- | --- |
| `ch0-about.md` | 0. この文書について（MUST / SHOULD / MAY、用語） |
| `ch1-background.md` | 1. 背景・ゴール・KPI |
| `ch2-architecture.md` | 2. システム全体構成、A と B の接続点 |
| `ch3-sim.md` | 3. A の機能要件 A-1〜A-7 |
| `ch4-edge.md` | 4. B の機能要件 B1〜B4（ハード・パイプライン・通信・PWA） |
| `ch5-common.md` | 5. 共通要件（3 状態・音・多言語・アクセシビリティ・データ同意） |
| `ch6-nfr.md` | 6. 非機能要件（性能・遅延内訳・可用性・セキュリティ・プライバシー・ライセンス） |
| `ch7-data.md` | 7. データモデル（TripPlan / AlertFlag / Capture）と API |
| `ch8-design.md` | 8. デザインシステムと UI 実装規約 1〜8 |
| `ch9-decisions.md` | 9. ユーザー判断（判断記録＋原文） |
| `ch10-plan.md` | 10. 1 週間の計画・受け入れ基準・リポジトリ構成 |
| `ch11-appendix-a.md` | 付録 A. ハッカソン評価と改善リスト（15 項目）・デモの 3 分構成 |

要件・デザインの写しは原文のまま。直すときは原本（Claude Docs / Claude Design）を直して再エクスポートする（ch9 の判断記録を除く）。
文書中の `@ezoroad/*` と `ezo-road/` は、このリポジトリでは `@antler/*` と `antler/`。

**要件は章ファイル単位で読む。全章をまとめて読み込まない**（全文で約 25k トークン）。各 feature の `docs/specs/{feature}/functional.md` は担当の章と要件 ID だけを参照する。広く探す・長いログを読むときは repo-explorer に任せる。

毎回読む価値がある 2 つ（色・文字・余白と、A と B の共通コンポーネントの契約）だけをここで読み込む:

@docs/design/tokens.json
@docs/design/AlertState.md

**frontend-design スキルを使うときも、色・フォント・余白は tokens.json が正。** スキルの「独自のフォント・配色を選ぶ」指示は antler では使わない（数値は IBM Plex Mono、文章は Noto Sans JP。ch8 規約 4）。

## ディレクトリ・stack・担当

| ディレクトリ | 中身 | stack（routes.toml） | 規約 | 担当 |
| --- | --- | --- | --- | --- |
| `apps/sim/` | A: Vite + React + R3F | `sim`（React） | [apps/sim/CLAUDE.md](apps/sim/CLAUDE.md) | 人 A |
| `apps/api/` | A API（Hono） | `api`（Hono） | [apps/api/CLAUDE.md](apps/api/CLAUDE.md) | 人 A |
| `packages/alert-ui/` | 3 状態コンポーネント・音源・トークン | `packages`（React のチェッカーを流用） | ch5・ch8・AlertState.md | 人 A |
| `packages/schema/` | TripPlan / AlertFlag / Capture の型と JSON Schema | `packages` | ch7 | 人 A |
| `packages/zones/` | 鹿ゾーン GeoJSON と生成スクリプト | `packages` | ch2・ch7 | 人 A |
| `apps/pwa/` | B: スマホ PWA | `pwa`（React） | [apps/pwa/CLAUDE.md](apps/pwa/CLAUDE.md) | 人 B |
| `edge/detector/` | B: Mac Mini の検知パイプライン（Python） | `edge` | ch4・ch6 | 人 B |
| `dataset/` | 匿名キャプチャと学習スクリプト | `dataset` | ch5・ch6 | 人 B |

作業対象のディレクトリの CLAUDE.md を読んでから着手する。`.claude/rules/react-*.md` と `hono-*.md` は stack 直下の相対パス（`src/**`）で書かれていて、モノレポで自動で効くかは未確認。apps 配下でも同じ規約に従う。

**Day 1 午後に `packages/schema` と `packages/alert-ui` の公開 API を凍結する。** 凍結後の変更は、人 A と人 B の両方の合意を PR に書き、alert-contract-guard の Critical 0 を確かめてから入れる。

## 依頼の単位と完成

- **1 feature ＝ 1 `/sfad cycle`（ブランチと PR も feature ごと）。ただしセッションは区切らず、なるべく長く続けて次の feature に進む**（2026-11-03 にユーザーが方針を変更。以前の「1 セッションに 1 feature」は廃止）
  - feature を 1 つ終えたら（sfad-done exit 0 → PR）、`docs/roadmap.md` の順で次の feature の cycle を同じセッションで始める
  - 統合ドキュメントの「1 セッション 1 feature」「agent 3 体」は古い記述（いまは長時間セッション・antler の agent 4 体）
  - 長く続けるためにコンテキストを守る: 探索・長い出力は repo-explorer に、3D の試行錯誤は sim-3d-architect に任せ、エージェントの結果はファイルで受ける（下の「エージェントチームの動かし方」）。コンテキストが 60〜70% を超えたら区切りの良いところで `/compact`（自動圧縮にも任せてよい）
  - **推奨案のある判断は推奨案で決めて進める**（2026-11-03 にユーザーが方針を変更）: Example Mapping の Questions、仕様の承認ゲート、第 9 章の「推奨」がある項目（仮採用）、凍結 API への追加・変更（PR に「推奨で決定」と書き、alert-contract-guard の Critical 0 を確かめる）。決めた内容は仕様・PR・報告に残す
  - **止まってユーザーに聞くのは次のものだけ**: 推奨案が無いもの（第 9 章の予算・アセットのライセンスなど、ユーザーにしか分からない事実）、破壊的な操作、外部への公開（push 以外の公開・送信）。聞くあいだも、その判断に依存しない作業を先に進める
  - **PR のマージは Claude が行ってよい**（2026-11-03 にユーザーが許可）。条件は CI が通っていることと、レビューの Critical が 0 であること
  - **互いに依存しない feature は別セッション（worktree）で並走させる**（2026-11-03、速度優先。トークンを多く使ってよい）。1 つの feature の中の独立した部品はサブエージェントに分ける。同じファイルを 2 つのセッションが書かないように、担当のディレクトリを brief で決める
- 依頼は要件 ID と画面名で受ける（例: 「B4-2〜B4-7 と ch5 の 3 状態表の各行を Test List に 1 項目ずつ」）。文章の機能説明を Test List に膨らませない
- 「全部作って」は feature に分けてから始める。「色はいい感じに」は tokens.json の中から選ぶ。「動くはずだから進めて」には応じない
- **完成は `python .claude/hooks/sfad-done.py` の exit 0 だけ。** 自己申告で「完成」と書かない。feature ごとの追加条件（alert-contract-guard Critical 0 など）は cycle の依頼に従う
- 第 9 章の判断が空欄・要確認の項目に触れるときは、`ch9-decisions.md` の「推奨」を仮採用し、PR に「仮採用: <項目> = <推奨>」と書く。ユーザーに聞くときは「判断記録の該当行に 1 行書いてから『続けて』と言ってください」と頼む（チャットの回答は次のセッションに残らない）。セッション開始時に `ch9-status.py` が未確定の項目を出す

## MUST（hook・CI が止めるもの）

`.claude/hooks/dispatch_local_rules.py` が Write / Edit / MultiEdit のときに止める（`python scripts/ci_arch_check.py` が PR でも同じ検査を当てる）:

- UI（apps/sim/src・apps/pwa/src・packages/alert-ui/src）に色を直書きしない。tokens.json から生成した CSS 変数 / TS 定数を使う。3D シーンの配色だけは `apps/sim/src/**/scene/palette.ts` にまとめてよい。`#D83B1E`（alert-danger。旧 `#E2492C` も）はどこにも直書きしない
- 統計の実数（6,705 件・61.5 万円など）をコードに埋めない。`stats.json` から読み、出典を画面に出す
- Capture まわり（パスに capture を含むファイル）に氏名・メール・電話・端末識別子・緯度経度を書かない。位置は `roadSegment` に丸める
- UI に絵文字を使わない。アイコンはインライン SVG（stroke）

Amptech 由来（stack のチェッカーと SFAD）:

- コードは `Write` / `Edit` / `MultiEdit` で書き、hook に検査させる。Bash や Python スクリプトでソースを生成・上書きしない
- `docs/specs/{feature}/` の仕様は空セル・frontmatter 欠落で止まる（sfad-guard）
- push の前に `python scripts/local-ci.py`。`.githooks/pre-push` が記録を要求する（有効化は clone ごとに `sh scripts/setup.sh`）
- stack を足したら `routes.toml` に登録し、`python scripts/registry_check.py` を通す

## MUST（レビューで見るもの）

- A の車内スマホと B の PWA は同じ `@antler/alert-ui` の `AlertState` を使う。`AlertFlag` / `Capture` の型は `packages/schema` だけに置き、edge（Python）は JSON Schema から合わせる
- 3 状態の色はテーマで変えない。`alert-danger` は鹿検知専用（注意・リスク・喪失の金額は `clay`）
- B の走行ログに `t_frame` / `t_sent` を必ず残し、PWA は `t_shown` を返す
- 同意済みの Capture だけをアップロードする。車内を写す映像は保存しない
- 乱数はシード付き（同じシードで再生できる）
- アセットは CC0 / CC-BY / 自作のみ。**フォントは SIL OFL 1.1 も可**（2026-11-06 にユーザーが許可。Noto Sans JP / TC / KR。ライセンス本文を同じ場所に置く）。入れたら `CREDITS.md` に出所を書く。ライセンス未確認のアセットを `dataset/` に入れない

## エージェントチームの動かし方

**実装はメインセッションが `/sfad cycle` を回して行い、下のエージェントはそこから呼ぶサブエージェント。常駐の PM エージェントは置かない**（Amptech のハーネスの設計どおり）。
メインセッションは人 A（sim 系統: apps/sim・packages・apps/api）と人 B（edge 系統: edge/detector・apps/pwa・dataset）の 2 系統で分ける。`packages/schema` と `alert-ui` の API 凍結（Day 1 午後）までは、両系統ともモックで進める。

| agent | 出自 | model | `/sfad cycle` のどこで呼ぶか | 返し方 |
| --- | --- | --- | --- | --- |
| spec-adversary | Amptech（sfad） | **opus** | Discovery で functional.md のドラフトに必ず 1 回（鹿ゾーン・アラート・同意は穴が致命的） | 指摘をそのまま |
| sim-3d-architect | antler | **opus** | drive-3d などの 3D の難所（シーン構成・車両力学・カメラ追従・鹿 5 パターン・性能）。設計から実装まで任せる | `docs/reports/` ＋ 5 行要約 |
| alert-contract-guard | antler | sonnet | alert-ui・schema・Capture・TripPlan・WebSocket フラグに触れた実装の後と PR の前 | Critical / Warning / Info |
| edge-latency-reviewer | antler | sonnet | edge-detector の完成時と、閾値・間引き・VLM の設定を変えたとき（Bash はログの読み取りだけ） | `docs/reports/` ＋ 10 行要約 |
| component-guard / layer-guard | Amptech（react / hono） | sonnet | sim・pwa・alert-ui / api の実装の後 | 指摘をそのまま |
| accessibility-checker | Amptech | sonnet | 画面・AlertState を作った後（4.5:1、44px、aria-label、1 Hz 点滅） | 指摘をそのまま |
| performance-analyzer | Amptech | sonnet | 3D（60 / 30 fps）、初回読込 3 秒、B の遅延に触れたとき | `docs/reports/` ＋ 10 行要約 |
| code-reviewer / security-auditor | Amptech | sonnet | PR の前（security-auditor は API・アップロード・WebSocket・同意に触れたとき） | 指摘をそのまま |
| test-writer / debugger | Amptech | sonnet | 受け入れテストの雛形づくり / 原因の分からない失敗 | 結果をそのまま |
| doc-writer | Amptech | **haiku** | README・CREDITS・ライセンス表（Day 6） | 書いたファイル |
| repo-explorer | antler | **haiku** | 広い探索、要件の章からの抜き出し、長いテスト・ビルド出力の要約 | 10 行要約（長ければ `docs/reports/`） |

- **エージェントの結果の全文はファイル（`docs/reports/YYYY-MM-DD-<agent>-<対象>.md`）に書かせ、メインセッションはパスと 10 行以内の要約だけを受け取る。** 全文をメッセージで受けない（長時間の作業でコンテキストを守るため）
- Amptech 由来のエージェントへの antler の変更（モデル・ツール・返し方）は `scripts/setup-from-amptech.sh` の「antler の上書き」が当てる。エージェントのファイルを直接直さない
- レビューの型: 「code-reviewer と alert-contract-guard でレビュー。Critical だけ直して、Warning は `docs/reports/` に残して次に回す」
- 互いに依存しないレビュー（例: code-reviewer と accessibility-checker）は同時に呼ぶ

**モデルとトークン**

| メインセッション | model | effort | 理由 |
| --- | --- | --- | --- |
| sim 系統（3D 中心） | Opus | high | シーン・物理・HUD の同時整合。往復が減るほうが総トークンは減る |
| edge 系統（Python ＋ PWA） | Sonnet | medium | 仕様が明確。遅延は数字で判定できる |
| 仕様フェーズ（Discovery・threat） | Opus | high | ここで漏れると実装が往復する |

- sim 系統だけ出力の上限を広げる（16k 程度）。個人設定なので `.claude/settings.local.json` の `env` に `CLAUDE_CODE_MAX_OUTPUT_TOKENS` を各自で書く（キー名は使っている Claude Code の版で確かめる）
- hook は dispatcher 経由で編集先の stack のチェッカーだけを回す（全チェッカーを毎回回すと hook の出力でコンテキストを食う）
- 目安（1 週間）: sim 系統 Opus 1 日 1.5〜2.5M 入力トークン、edge 系統 Sonnet 0.8〜1.2M、サブエージェント合計 0.5M 前後。Day 1 の仕様フェーズは上振れを許容する

## コマンド

```bash
npm ci                                                       # Node の依存（npm workspaces。node_modules はルートに集まる）
pip install -e "edge/detector[dev]"                          # edge の依存（pytest・ruff）
sh scripts/setup.sh                                          # clone ごとに 1 回（pre-commit / pre-push を有効にする）
npm run dev:sim / dev:pwa / dev:api                          # 開発サーバ（api は apps/api/.env.example を .env にコピーしてから）
npm run lint / typecheck / test / test:coverage / build      # 全 workspace（カバレッジの下限は 70%）
python scripts/registry_check.py                             # stack の登録漏れ
python scripts/ci_arch_check.py --self-test                  # 検査自体が生きているか
python scripts/tests/test_antler_hooks.py                    # antler の hook の自己テスト
python scripts/local-ci.py                                   # push 前の検査と記録
python .claude/hooks/sfad-done.py                            # feature の完成判定
AMPTECH=../Amptech_AI_docs sh scripts/setup-from-amptech.sh   # ハーネスの取り込み直し（Amptech 由来のファイルは上書き。git diff で確かめる）
```

- コミット前に `.githooks/pre-commit` が、ステージしたファイルの Prettier・ESLint（workspace ごと）・ruff と、全体の型チェックを回す
- PR と main への push で `.github/workflows/checks-on-pr.yml` が `local-ci.py --ci` を回す
- ESLint の設定は `scripts/templates/eslint.*.config.js` が正（Amptech の設定は各 app の `eslint.amptech.config.js`。直接直さない）
- `dataset/` の検査（ruff・pytest）は edge-l1-calibration でテストができたので必須（CI でも回す）。`detector` を import するので `pip install -e "edge/detector[dev]"` が要る。sfad-done のテストにも入っている
- ログの決まりは `docs/adr/001-logging-strategy.md`

## ブランチ運用

`main` から feature ごとにブランチを切り、PR で `main` に入れる。PR の本文に、仮採用した判断・凍結 API への変更の有無・sfad-done の結果を書く。

## 1 週間（詳細は ch10-plan.md）

Day 1 schema / alert-ui 凍結・判断確定 → Day 2 A-2 と 3D 骨格、B の WS と B-0 / B-1 → Day 3 車両力学・鹿・B-2 / B-3 → Day 4 A-4 / A-6 / A-7・調査走行 → Day 5 スマホ横・多言語・学習スクリプト → Day 6 修正・ライセンス → Day 7 デモ動画。
