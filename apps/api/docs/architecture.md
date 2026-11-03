# Hono アーキテクチャ設計ノート

この文書は **「なぜこの構成にしているか」** を人間が読むためのものです。

**「何をどう書くか」の実行ルールは `.claude/rules/` にあります。** そちらが正で、AI もそこを読みます。
この文書はルールを繰り返さず、背景・判断基準・トレードオフだけを扱います。

---

## 基本方針

```
Route -> UseCase -> Domain
                 -> Repository (port + 実装)
                 -> Gateway    (port + 実装)

依存の向き: infrastructure -> application -> domain
            di -> 全層（組み立てのみ）
```

| レイヤ | 置き場所 | 責務 |
|---|---|---|
| Route | `infrastructure/http/routes/` | HTTP I/O、zValidator、schema ⇔ DTO 変換、UseCase 呼び出し |
| Schema | `infrastructure/http/schemas/` | Zod の request/response 契約 |
| ErrorMapper | `infrastructure/http/error-mapper.ts` | `errorCode` → HTTP status 変換（唯一の変換点） |
| Middleware | `infrastructure/http/middleware/` | トークン読み取り、logging、CORS（認可の判断はしない） |
| UseCase | `application/usecases/{domain}/` | 順序、分岐、権限、トランザクション境界、DTO |
| Domain | `domain/{domain}/` | 業務モデル、値オブジェクト、ルール、Policy、Event、Error（純粋 TypeScript） |
| Port | `application/ports/` | Repository / Gateway / Security / UnitOfWork の interface |
| Repository（実装） | `infrastructure/repositories/` | Drizzle クエリ、DB レコード ⇔ Domain モデル変換 |
| Gateway（実装） | `infrastructure/gateways/` | 外部 SDK/HTTP 実装（mail / storage / 決済 / LLM） |
| Security（実装） | `infrastructure/security/` | hash / token / crypto の技術実装 |
| DB | `infrastructure/db/` | Drizzle schema、接続、migration/seed、UnitOfWork 実装 |
| Job | `infrastructure/jobs/{domain}/` | Queue consumer、commit 後の副作用 |
| Command | `infrastructure/commands/` | 運用タスクの entrypoint |
| DI | `di/container.ts` | Composition Root（全層を組み立てる唯一の場所） |
| Entrypoint | `index.ts` / `worker.ts` | Node.js / Cloudflare Workers の起動点、環境設定の読み取り |

---

## なぜ「Service」を単独レイヤにしないのか

`Service` は最も意味が曖昧になる語です。放置すると、1つの `services/` に
「業務判断」「DB クエリ」「外部 API 呼び出し」「hash 計算」が全部入り、
どこに何があるか誰も説明できないディレクトリになります。

そこで、Service が指しうるものを**役割ごとに別の名前で分けています**。

| 曖昧な呼び方 | この構成での置き場所 |
|---|---|
| Application Service | `application/usecases/{domain}/` |
| Domain policy（業務判断） | `domain/{domain}/policies/` |
| DB 操作 | `application/ports/repositories/` + `infrastructure/repositories/` |
| 外部連携 | `application/ports/gateways/` + `infrastructure/gateways/` |
| hash / token などの技術処理 | `application/ports/security/` + `infrastructure/security/` |

**`src/services/` · `application/services/` · `ports/services/` は作りません。**
名前が役割を説明しないディレクトリを1つ許すと、そこが「置き場所に迷ったものの吹き溜まり」になるためです。

---

## なぜ Domain を純粋な TypeScript に保つのか

`domain/` は `hono` · `drizzle-orm` · `zod` · 外部ライブラリ · Node/Workers API を一切 import しません。理由は3つあります。

- **テストが速く、壊れない** — DB もフレームワークも起動せずに業務ルールを検証できます。
  だから Domain のテストは最速かつ最多にでき、カバレッジ 100% を現実的な目標にできます
- **動くランタイムを選ばない** — このスタックは Node.js（`index.ts`）と Cloudflare Workers（`worker.ts`）の
  両方をエントリポイントに持ちます。業務ルールがランタイム固有 API を知らなければ、
  どちらで動かしても同じコードのままです
- **依存の向きが一方向に固定される** — Domain が何も知らないので、循環参照が原理的に起きません

この制約は ESLint の import zones と PreToolUse hook の**二重ゲート**で機械的に強制しています。
人間のレビューに頼ると必ず漏れるためです。

---

## なぜ Repository / Gateway を interface と実装に分けるのか

この構成の一番の特徴は、Repository と Gateway が
**`application/ports/` の interface** と **`infrastructure/` の実装**に分かれていることです。
1つのクラスで済ませない理由は4つあります。

- **実装が実際に差し替わる** — 同じ UseCase を Node.js と Cloudflare Workers（D1）の両方で動かします。
  DB 接続も UnitOfWork の実装もランタイムで変わるので、UseCase が具象クラスを知っていると
  ランタイムごとに UseCase を書き分けることになります
- **UseCase のテストに fake を差し込める** — port の fake を渡すだけで、DB も外部 API も無しに
  順序と分岐を検証できます。UseCase 90% という目標はこれが前提です
- **ORM の型が上の層に漏れない** — port のシグネチャに `drizzle-orm` の型を入れない、というルールは
  「application 層が Drizzle を知らない」状態を保つためのものです
- **組み立てが1箇所に集まる** — Hono には Laravel のような service container が無いので、
  誰かが明示的にインスタンスを組み立てる必要があります。それを `di/container.ts` に集約し、
  「どの実装が使われているか」を1ファイルで読めるようにしています

裏返すと、interface と実装の2ファイルを書くコストは常に払います。
それでも払う価値があるのは、上の4つが**実際に起きる**構成だからです。

---

## なぜドメイン例外に HTTP status を持たせないのか

ドメイン例外は `errorCode` だけを持ち、HTTP status を知りません。
`errorCode → HTTP status` の変換は `infrastructure/http/error-mapper.ts`（`app.onError()`）一箇所に集約します。

```
domain/{domain}/errors/   （errorCode のみ）
  → UseCase が throw
    → error-mapper が HTTP status に変換   ← HTTP を知るのはここだけ
```

こうする理由は、**HTTP を知る場所を増やさないこと**そのものです。

- 例外が status を持つと、その例外を投げるすべての層が HTTP を意識することになります
- Route ごとに try/catch を書くと、エンドポイントごとにレスポンス形状がずれていきます
- `infrastructure/jobs/` や `infrastructure/commands/` から同じ UseCase を呼んだとき、HTTP status は意味を持ちません

変換点が1つなら、レスポンス形状の統一もエラーコード体系の見直しも1ファイルで済みます。
Drizzle の生エラーがそのままクライアントへ漏れるのを止められるのも、ここが唯一の出口だからです。

---

## なぜトランザクション境界を UseCase に置き、UnitOfWork を挟むのか

トランザクションを開始・確定できるのは UseCase だけです。Repository は書き込みますが、確定しません。

Repository は「1つのクエリ」を担当する部品なので、**どこまでを1トランザクションにするかを知りません**。
それを決められるのは、操作の全体像を持っている UseCase だけです。
Repository が commit してしまうと、複数の Repository を跨ぐ操作で整合性を保てなくなります。

その上で、UseCase は `db.transaction()` を直接呼ばず、`application/ports/unit-of-work.ts` の
interface 越しに扱います。理由は2つです。

- UseCase が ORM のトランザクション API を直接触ると、application 層に Drizzle が漏れます
- Node と Workers/D1 で UnitOfWork の実装は違いますが、UseCase は同じままでいられます

同じ理由で、commit 後に走らせたい副作用（メール送信など）は Gateway 呼び出しをトランザクションの外に出します。
トランザクション内で送信してしまうと、ロールバックされたのにメールだけ飛ぶ状態が起きます。
そして「commit 後に呼ぶ」設計は再送を前提にするので、Gateway は冪等キーを受け取れる形にします。

---

## なぜ Repository と Gateway を相互に呼ばせないのか

`infrastructure/repositories/` ↔ `infrastructure/gateways/` の相互呼び出しは禁止しています。

**DB はロールバックできますが、外部 API 呼び出しはロールバックできません。**
この2つは失敗したときの取り扱いが根本的に違うので、混ぜると「どこまで戻せるのか」が読めなくなります。

- Repository から Gateway を呼べると、トランザクションの内側から外部呼び出しが起きます
- Gateway から Repository を呼べると、外部連携の途中で DB が書き換わります

どちらも、UseCase が持っているはずの「順序」と「失敗時の方針」が見えない場所に散る形です。
両方を呼ぶ必要があるなら、それを並べるのは UseCase の仕事です。

---

## 迷ったときの判断

上から順に当てはめます。

1. HTTP request/response の形か → `infrastructure/http/schemas/` + `infrastructure/http/routes/`
2. 1つのユーザー操作の流れか → `application/usecases/{domain}/`
3. 業務モデル・値オブジェクト・純粋な判定か → `domain/{domain}/`（`models` / `value-objects` / `rules` / `policies`）
4. DB の保存/取得/検索条件か → `application/ports/repositories/`（interface）+ `infrastructure/repositories/`（実装）
5. 外部サービス呼び出しか → `application/ports/gateways/`（interface）+ `infrastructure/gateways/`（実装）
6. hash / token などの技術的な処理か → `application/ports/security/` + `infrastructure/security/`
7. Drizzle schema・接続・migration・UnitOfWork 実装か → `infrastructure/db/`
8. commit 後でよい非同期の副作用か → `infrastructure/jobs/{domain}/`
9. 運用タスク（seed/sync/backfill）か → `infrastructure/commands/`
10. 組み立て（DI）か → `di/container.ts`
11. 共通化か → **2箇所以上で実際に使われてから**

### 判断のコツ

- DB も API も知らないなら Domain に置ける
- DB を読む/書くなら Repository、外部サービスを呼ぶなら Gateway（どちらも port + 実装）
- hash/token のような、業務判断を持たない技術的関心事なら Security port
- 順番・権限・トランザクション境界を決めるなら UseCase
- HTTP の契約なら Zod schema。ここに業務ルールを書き始めたら、それは `domain/{domain}/rules/` の仕事

---

## テスト戦略の考え方

| レベル | 対象 | 目安 |
|---|---|---|
| Unit | Domain（model / value object / rules / policy） | **100%** — 依存が無く最速なので、ここを厚くする |
| Unit | UseCase | **90%** — ports を fake にして orchestration を見る |
| Integration | Repository 実装 | 主要クエリを test DB（D1 / libsql）で |
| Integration | Gateway 実装 | 代表的な success / error |
| Integration | Route | `app.request()` で happy path + 権限 + validation + 代表的 error |

**下ほど遅く、壊れやすく、書くのが高い**という前提で配分しています。
Domain を純粋に保ち、Repository/Gateway を port で切っているのは、
この表の上2段を厚くできるようにするためでもあります。

テストデータは `tests/factories/` のビルダーに集約します。
具体的なテストの書き方は `.claude/skills/hono-backend/references/testing-patterns.md` を参照してください。

---

## 実行ルールの所在

| 知りたいこと | 見る場所 |
|---|---|
| 各レイヤに何を書き、何を書かないか | `.claude/rules/hono-{layer}-rules.md` |
| ディレクトリ構成の全体像と依存の禁止事項 | `.claude/rules/hono-architecture.md` |
| Zod schema / UseCase / UnitOfWork / エラー変換の実装パターン | `.claude/rules/hono-patterns.md` |
| トランザクション境界の実装 | `.claude/skills/hono-backend/references/transaction-boundary.md` |
| テストの書き方 | `.claude/skills/hono-backend/references/testing-patterns.md` |
| Cloudflare Workers / D1 固有の事情 | `.claude/skills/hono-backend/references/runtime-cloudflare.md` |
| 新規ドメインの雛形 | `.claude/skills/hono-backend/references/scaffold-template.md` |
| よくある違反例 | `.claude/skills/hono-backend/references/anti-patterns.md` |
| 違反の自動検出 | `.claude/hooks/check-hono-architecture.py`、`eslint.config.js`（import zones）、`.github/workflows/quality-check.yml` |
