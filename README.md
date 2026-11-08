# SHIKASHI

北海道をはじめてレンタカーで走る旅行者が、エゾシカとの衝突で旅や命を失わないようにするためのプロジェクトです。
運転の前に「鹿との遭遇」をブラウザの 3D で体験し、運転中は車載の検知システムが道を見張って、事故を減らします。

- **SHIKASHI SIMULATOR**（ウェブアプリ）: https://antler-lyart.vercel.app
- **SHIKASHI NAVIGATOR**（車載システム）: ダッシュボードの USB カメラ ＋ 小型の Mac ＋ スマホ

## なぜ作るのか

北海道でエゾシカが関係する交通事故は、2025 年に 6,705 件ありました。9 年連続で過去最多を更新しています。
地元の運転者は、鹿の出る場所や時間を経験で知っています。はじめての人には、その経験がありません。

## 使われ方

台湾から 2 月に家族 4 人で来る旅行者を例にします。

1. **レンタカーを予約したら（自宅で）・受け取る前に（店の待合室で）** SHIKASHI SIMULATOR を開きます。
   旅程を入れると、Claude がしおりを作ります。あわせて、鹿の事故が多い区間が地図に出ます。
2. **出発前チェック** その区間を夕暮れの 3D で走ります。草むらの鹿を見つけて、減速する練習をします。
3. **見落とすと** 旅で失う予定や費用が、実際の統計と出典つきで示されます。
   鹿アラートを ON にして、同じ道を走り直せます。
4. **運転中** SHIKASHI NAVIGATOR が道を見張ります。スマホは鹿の多いゾーンに入ると琥珀、道に入ってくる動きをとらえると赤になります。
   音はシミュレーターと同じです。

画面は日本語・英語・繁體中文・한국어の 4 言語です。

| 状態       | 色   | 形   | いつ                             |
| ---------- | ---- | ---- | -------------------------------- |
| ゾーン外   | 緑   | 円   | 鹿の事故が多い区間の外           |
| 鹿ゾーン内 | 琥珀 | 三角 | 事故が多い区間を走っている       |
| 検知       | 赤   | 八角 | 道に入ってくる動くものをとらえた |

色だけで区別させないよう、形と明度も変えています（`docs/design/AlertState.md`）。

## 鹿の検知で起きたこと

SHIKASHI NAVIGATOR の検知部分では、ダッシュボードの USB カメラの映像から遠くの鹿を早く見つけ、スマホに警報を出すことを目指しました。

**Claude Code への指示**
要件を章ごとのファイルに分け、要件 ID と受け入れの条件を渡しました。そのうえで 1 機能ずつ「仕様 → テスト → 実装」の型（`/sfad cycle`）で進めさせました。
鹿の検知では、YOLO（物体検出のモデル）に鹿を学習させました。学習データの見直し・学習・車載向けの書き出し・評価までを任せ、世代ごとに検証データの成績を比べて改良するよう指示しました。

**期待との違い**
モデルを 3 世代改良し、検証データでの成績は世代ごとに上がりました。
ところが、実際に鹿と遭遇した映像で確かめると、遠くの鹿はどの世代でも 24 回中 1 回も見つけられませんでした。
遠くの鹿は画面の幅の 3% ほどの大きさしかなく、形では見分けられなかったのです。検証データが「遠くの小さな鹿」を代表していませんでした。

**対処**
「鹿は動いている」ことに着目しました。0.1 秒前の画像を車の動きに合わせてずらし、今の画像から引くと、動いたところだけが浮かび上がります。
そこで、まず動きで場所を絞り、その場所だけを切り出してモデルに見せ直す方式にしました。

- 北海道の道路で撮った映像で 18 の方式をバックテストし、この方式が最も高い検知率と最も早い警報になりました
- 鹿を正しく見つけた数は 24 中 0 から 10 に増え、警報は 3 秒以上早くなりました
- 処理は車載コンピュータで 1 フレーム約 56 ミリ秒です

都合のいい数字にならないよう、合格の条件は結果を見る前に決め、方式を選ぶ映像と確かめる映像を分けました。
別の日の昼の森の映像では、木の揺れや木漏れ日まで動いて見え、候補が 1 画面に 400 を超えて不合格でした。これもそのまま報告しています。

あわせて製品の方針も、「鹿を見つける」から「道に入ってくる動くもの（鹿・人・熊・鳥）に気づかせる」に変えました。

## 構成

npm workspaces のモノレポです。

```
apps/
  sim/        SHIKASHI SIMULATOR の画面（Vite・React・React Three Fiber・MapLibre）
  api/        SIMULATOR の API（Hono。Claude の呼び出し・旅の保存・記録の共有ページと OG 画像）
  pwa/        SHIKASHI NAVIGATOR のスマホ画面（PWA。車内の Wi-Fi で検知の結果を受ける）
packages/
  alert-ui/   3 状態の表示（緑・琥珀・赤）。SIMULATOR と NAVIGATOR で同じ部品を使う
  schema/     アラートと Capture の型（zod）
  trip/       旅・ルート・統計のデータと計算
  zones/      鹿ゾーン（事故の多い区間）のデータ
  i18n-check/ 4 言語の文言の検査
edge/
  detector/   SHIKASHI NAVIGATOR の検知（Python。カメラ → 検出 → 判定 → スマホへ wss）
dataset/      鹿の検出の学習データを作る道具（自分で撮った映像の匿名化・ラベル・合成）
docs/
  requirements/  要件（章ごと）
  specs/         機能ごとの仕様（functional.md・threat.md）
  design/        デザインのトークンと規則
  runbooks/      手順書（デプロイ・Mac mini・PWA の https）
  reports/       レビューと検証の記録
```

### Claude の使いどころ

`apps/api` から Claude（`claude-sonnet-5-5`）を呼び、次の文を書かせています。

- 旅程からのしおり
- 衝突したときに「失ったもの」の文
- 観光地の場面の文と、旅の会話

呼び出しには、1 日の上限・同時実行の上限・IP ごとのレート制限を付けています。
同じ要求を繰り返しても呼び直さない、冪等キーも使っています。

## ローカルで動かす

### 用意するもの

- Node.js 22 以上
- Python 3.11 以上（`edge/detector` と `dataset` を触るとき）
- Anthropic の API キー（SIMULATOR の API で使う）

### SHIKASHI SIMULATOR

```sh
git clone https://github.com/ha-ma/antler.git
cd antler
npm ci
sh scripts/setup.sh              # git のフック（コミット前・push 前の検査）を有効にする

cp apps/api/.env.example apps/api/.env
cp apps/sim/.env.example apps/sim/.env
# apps/api/.env に、少なくとも ANTHROPIC_API_KEY と OWNER_TOKEN_SECRET（32 文字以上。例: openssl rand -hex 32）を入れる

npm run dev:api                  # http://localhost:8787 （旅は apps/api/data/ の SQLite に保存）
npm run dev:sim                  # http://localhost:5173
```

ブラウザで http://localhost:5173 を開き、「旅をつくる」から始めます。

### SHIKASHI NAVIGATOR

車載の Mac mini で動かします。手順は次の手順書にあります。

1. `docs/runbooks/2026-11-04-mac-mini-day0.md`: Mac mini の準備
2. `docs/runbooks/2026-11-06-mac-mini-edge-run.md`: 検知の起動（`python -m detector --config edge/detector/config.toml`）
3. `docs/runbooks/2026-11-06-pwa-https.md`: スマホの PWA を https で開く（車ごとの CA）

スマホの画面だけを試すときは `npm run dev:pwa`（http://localhost:5174）で開けます。
偽の検知を流すには `node apps/pwa/scripts/fake-edge.mjs --scenario deer` を使います。

## 環境変数

値の見本と説明は、各アプリの `.env.example` にあります。`.env` と `.env.*` は git に入れません（`.gitignore` 済み）。

| アプリ     | 主な変数                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api` | `ANTHROPIC_API_KEY`・`OWNER_TOKEN_SECRET`・`TRIPS_DB_URL`・`TURSO_AUTH_TOKEN`・`CLAUDE_DAILY_CALL_LIMIT`・`CLAUDE_MAX_CONCURRENT_CALLS` |
| `apps/sim` | `VITE_API_BASE_URL`・`VITE_MAP_STYLE_URL`・`VITE_PWA_URL`                                                                               |
| `apps/pwa` | `VITE_ALERT_SOUND`（ビルド時に `VITE_EDGE_HOSTS`）                                                                                      |

本番は Vercel（`apps/sim` ＋ `apps/api` の関数）・Turso（旅の DB）・Vercel Blob（Capture の画像）です。
本番の秘密は Vercel の環境変数（Sensitive）にだけ置いています。
手順は `docs/runbooks/2026-11-05-deploy-a-vercel-turso.md` にあります。

## テストと検査

```sh
npm test                         # すべての workspace のテスト（Vitest）
npm run typecheck
npm run lint
python3 scripts/local-ci.py      # CI と同じ検査の一覧（local_ci_checks.toml）を手元で回す
```

GitHub Actions でも、PR と main への push のたびに同じ検査（`local-ci --ci`）が走ります。

## Claude Code での進め方

このリポジトリは、Claude Code で作っています。

- `CLAUDE.md` に、作業の決まりを書いています（言葉づかい・ブランチ・マージ・本番への公開の条件など）
- 要件は `docs/requirements/` に章ごとにあります。機能ごとに `docs/specs/<feature>/functional.md` を書いて「仕様 → テスト → 実装」で進めます
- 実装のあと、アクセシビリティ・コード・遅延などを、専用のレビュー役のエージェントが確かめます。記録は `docs/reports/` にあります
- `.claude/hooks/` のフックが、仕様とコードのずれや、決まりの破れを止めます

## 出典とライセンス

鹿ゾーン・統計・地図・ルート・フォント・学習用の映像などの出典と利用条件は、`CREDITS.md` にまとめています。
統計の実数は、画面にも出典を表示しています。

## 名前について

開発中は「EZO ROAD」、リポジトリは `antler` という名前でした。2026-11-08 に、サービス名を SHIKASHI に改めました（`docs/changes/2026-11-08-shikashi-rebrand.md`）。
パッケージ名（`@antler/*`）・リポジトリ名・環境の名前などには、まだ古い名前が残っています。
