# 変更記録 2026-11-08: サービス名を SHIKASHI に（計画の ①）

> **この変更の範囲**: 利用者に見える名前（EZO ROAD → SHIKASHI / SHIKASHI SIMULATOR / SHIKASHI NAVIGATOR）、ロゴ（sim と PWA のヘッダー）、文書の名前。
> 色（tokens.json）、凍結の `packages/schema`・`packages/alert-ui`、AlertFlag・Capture・TripPlan の形、内部の名前（npm のスコープ・リポジトリ・パス・資源の名前）は変えていない。
> 仕様は `docs/specs/rebrand-shikashi/functional.md`。

## 1. ユーザーが決めたこと（2026-11-08）

- サービス名は **SHIKASHI**
  - A（apps/sim ＋ apps/api のウェブアプリ）は **SHIKASHI SIMULATOR**
  - B（apps/pwa ＋ edge/detector の車載）は **SHIKASHI NAVIGATOR**
  - サービス全体を指すところ（CLAUDE.md・CREDITS.md・tokens.json の `name`・デザインの README）は **SHIKASHI**
- 旧名 **EZO ROAD**（EZOROAD・ezo-road の表記も）は、利用者に見えるところから全部替える
- 文書で「antler」「ANTLER」とプロジェクトを呼んでいる文は SHIKASHI に替える
- **ロゴだけ入れる。配色は変えない**（tokens.json が色の正。ブランドの色を足さない）
  - ロゴは透過 PNG（960×231）の 2 つ。昼（trip）は濃い茶の文字＋橙の角の A、夜（night）は明るい文字＋橙
  - テーマでどちらかを選ぶ。製品の行（SIMULATOR・NAVIGATOR）を tokens の文字の決まりで添える
  - ロゴはユーザーが用意したプロジェクトの自作。CREDITS.md に書く
- 内部の名前はこの変更では替えない（下の 4）。後で別の PR で替える
- `docs/requirements/*` は Claude Docs の原本の写しなので本文を替えない。ch0-about.md と CLAUDE.md に注記を 1 つずつ足す。原本はユーザーが直す
- 日付の付いた履歴（`docs/reports/*`・`docs/changes/*`）は替えない

## 2. 計画（5 段）

| 段  | 中身                                                                                                                  | ブランチ                  |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| ①   | 名前とロゴ（この変更）                                                                                                | `claude/rebrand-shikashi` |
| ②   | 操作のボタンを画面の下に固定する（sticky-cta）                                                                        | 別のセッション            |
| ③   | 結果の数字を数え上げて出す（result-countup）                                                                          | 別のセッション            |
| ④   | 写真を動かす（motion-photos）。GIF ではなく、今ある CC0 / PD / CC BY の写真から作るループの動画にする（大きさのため） | 別のセッション            |
| ⑤   | 内部の名前の変更（`@antler/*` のスコープ、GitHub のリポジトリ名、パス）。走っているブランチが無いときに最後に行う     | まだ                      |

①〜④ は並べて進める。① はヘッダーと文言と文書だけを直し、画面の配置は変えない（② の差分とぶつからないように）。

## 3. 替えたもの

| どこ                                   | 何                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sim                                    | `index.html` の `<title>`、`/plan`・`/brief`・`/t/:id` のヘッダー（SVG の印 → ロゴ＋SIMULATOR）、画面の `<title>` の末尾（SHIKASHI SIMULATOR）、しおりの画像の保存名 `shikashi-{id}.png` |
| sim・api 共通の文言（`packages/trip`） | `brand` = SHIKASHI SIMULATOR、`openInApp` =「SHIKASHI SIMULATOR で開く」ほか 4 言語。sim の A-7・api の SSR の共有ページ・OG 画像が同じ表を読む                                          |
| api                                    | OG 画像の左上の文字。長くなったので右の eyebrow を 250 → 440 にずらした                                                                                                                  |
| PWA                                    | `index.html` の `<title>`、接続画面の見出し（ロゴ＋NAVIGATOR＋4 言語の「鹿アラート」）、画面の名前（運転中の画面の aria-label）                                                          |
| edge                                   | 設定ページ（http の `/`）の `<title>`・4 言語の見出し・「SHIKASHI NAVIGATOR を開く」。CLI の説明                                                                                         |
| 画像                                   | `apps/sim/public/brand/`・`apps/pwa/public/brand/` に昼と夜のロゴ                                                                                                                        |
| 文書                                   | CLAUDE.md（題・A と B の名前・注記・ロゴの行）、CREDITS.md（ロゴの行）、デザインの README と tokens.json の `name`、antler 由来のエージェント 4 体の説明、hook の説明、今の runbook 2 つ |
| package の説明                         | apps/sim・apps/api・apps/pwa の `package.json`、edge/detector の `pyproject.toml` の `description`（名前は替えない）                                                                     |

PWA のマニフェスト（`manifest.webmanifest` の `name`・`short_name`）は、このリポジトリに無い（ホーム画面への追加はまだ作っていない）。作るときは `SHIKASHI NAVIGATOR` / `SHIKASHI` にする。

## 4. 残したもの（わざと）

| 何                                                                                                                                | なぜ                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ezoroad.local`（edge のホスト名）、CA の名前と ID（`/ezoroad-ca.crt`、証明書の subject `O = EZO ROAD`）                          | 替えると各車の証明書を作り直し、乗る人のスマホに CA を入れ直す必要がある。設定ページと runbook の「VPN とデバイス管理 → EZO ROAD」はスマホに出るプロファイルの名前なので「EZO ROAD」のまま書く（「証明書の名前」と添えた） |
| npm のスコープ `@antler/*`・import のパス・パッケージ名                                                                           | ⑤ で替える。並べて走っている ②〜④ の差分とぶつかる                                                                                                                                                                         |
| リポジトリ名と URL（github.com/ha-ma/antler）、ディレクトリ（`~/work/antler-*`・`~/.config/antler`・`~/Documents/herald/antler`） | ⑤ で替える。clone・Vercel の連携・手元の手順が一緒に変わる                                                                                                                                                                 |
| 環境変数の名前（`ANTLER_BUILD_MARKER` など）                                                                                      | Vercel と手元の設定を一緒に直す必要がある（⑤）                                                                                                                                                                             |
| Turso・Blob・Vercel の資源の名前（`antler-production`・`antler-captures-*` など）                                                 | 外の資源の名前。作り直し・移し替えが要る                                                                                                                                                                                   |
| localStorage・cookie の鍵                                                                                                         | 替えると、もう使っている人の記録の鍵（削除のトークン）が読めなくなる                                                                                                                                                       |
| CLAUDE.md の「文書中の `@ezoroad/*` と `ezo-road/` は…」                                                                          | 写しの文書の読み替えなので意味は残す（SHIKASHI のことを書き足した）                                                                                                                                                        |
| 鹿ゾーンのデータの加工者の表記（`packages/zones/data/zones.source.json`・`zones.geojson`・`README.md` の「EZO ROAD が作成」）     | 画面には出ない。替えると `zones.geojson` の hash が変わり作り直しが要る。⑤ で一緒に替える（CREDITS.md の表では SHIKASHI と書いた）                                                                                         |
| 外への要求の User-Agent（`antler-ezoroad-photo-fetch`・`antler-ezoroad-route-fetch`）                                             | 開発時に 1 回だけ使う取得スクリプトの識別子                                                                                                                                                                                |
| テストの URL（`ezoroad.example`）、`env.ts` のエラー文の例（`https://ezoroad.app`）                                               | 画面に出ない（開発者向けの例）                                                                                                                                                                                             |
| `docs/requirements/*` の本文、デザインの原本の名前（EZO ROAD Design System）                                                      | 原本（Claude Docs / Claude Design）の写し。原本はユーザーが直す                                                                                                                                                            |
| `docs/reports/*`・`docs/changes/*`（この文書を除く）、`docs/specs/*` の過去の決定の文                                             | 履歴。仕様には「表示名を SHIKASHI に変えた」注記だけを足した                                                                                                                                                               |
| `.claude/agents/` の Amptech 由来のエージェント（performance-analyzer の「antler:」の見出しなど）                                 | `scripts/setup-from-amptech.sh` が上書きするファイル。直接直さない約束                                                                                                                                                     |

## 5. 推奨で決めたこと（PR にも書く）

| 項目               | 決めたこと                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 製品の行の文字     | tokens の `eyebrow`（12px・700・字間 0.12em）を `ink-muted` で。ロゴの右に置く                                        |
| ロゴの高さ         | sim のヘッダー 24px、PWA の見出し 28px。`width`・`height` を書く                                                      |
| 読み上げ           | 画像の alt が「SHIKASHI SIMULATOR」/「SHIKASHI NAVIGATOR」。目に見える製品の行は `aria-hidden`                        |
| 部品の置き場所     | sim と PWA の `src/shared/components/BrandLogo.tsx`（それぞれ 1 つ）。凍結の alert-ui には足さない                    |
| しおりの画像の名前 | `shikashi-{id}.png`                                                                                                   |
| OG 画像            | 左上は文字のまま。eyebrow を 440 からにして、ブランドの文字と重ならない（同梱のフォントで描いた幅をテストで確かめる） |
| SSR・OG のロゴ     | 今回は入れない（SSR は手元の開発で sim とオリジンが違う、OG は resvg への画像の埋め込みが要る）。Deferred             |
