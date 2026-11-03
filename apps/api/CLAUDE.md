# MUST

- Route handler に業務ロジックを書かない。validation、UseCase 呼び出し、response 変換だけにする
- UseCase は Application Service。1つのユーザー操作の順序、分岐、権限、トランザクション境界、失敗時方針を決める
- Domain は純粋 TypeScript。Hono、Drizzle、Zod、Node/Workers API、外部ライブラリに依存しない
- Domain は関心ごとに `models/`、`value-objects/`、`rules/`、`policies/`、`events/`、`errors/` を分ける
- Repository は `application/ports/` の interface と `infrastructure/repositories/` の Drizzle 実装に分ける。`commit`/`rollback` は UnitOfWork の責務
- Gateway は外部 transport（mail、storage、決済、LLM）専用。Repository に混ぜない
- hash/token 等の技術ポートは `ports/security/`。業務ロジックを持たない
- UseCase/Domain で `Context`、`HTTPException`、HTTP status を使わない。ドメイン例外を `infrastructure/http/error-mapper.ts` で HTTP に変換する
- Zod schema は HTTP 契約のみ。`infrastructure/http/schemas/` に置き、Domain model と混ぜない
- 汎用 `Service` レイヤを作らない。`src/services/`、`application/services/`、`ports/services/` は禁止。業務判断は `domain/{domain}/policies/`、外部 transport は Gateway に明示する
- `Bash` や Python スクリプトで `src/**/*.ts` を生成・上書きしない。コード作成は `Write` / `Edit` / `MultiEdit` 経由にして Hook に検査させる

# Stack

- Framework: Hono
- ORM: Drizzle ORM
- Validation: Zod + @hono/zod-validator
- Runtime: Cloudflare Workers / Bun / Node.js
- Linting: ESLint (typescript-eslint strict) + import boundaries
- Testing: Vitest

# Architecture

標準の言語は `Route -> UseCase -> Domain -> Repository/Gateway`。
`Service` という単独レイヤは作らない。純粋な業務判断は `domain/{domain}/policies/` に置く。

```
src/
  domain/
    users/
      models/
        user.ts                    # 純粋な業務モデル（type/interface）
      value-objects/
        email.ts
      rules/
        user-rules.ts              # 純粋な定数・不変条件
      policies/
        invitation-policy.ts       # 認可・業務判断（純粋関数）
      events/
        user-created.ts            # Domain Event 型
      errors/
        user-errors.ts             # ドメイン例外（HTTP status を持たない）
  application/
    ports/
      repositories/
        user.repository.ts         # Repository interface（ORM 型を含まない）
      gateways/
        mail.gateway.ts            # 外部 transport interface
        storage.gateway.ts
        payment.gateway.ts
      security/
        password-hasher.ts         # 技術ポート interface（hash/token）
        token-provider.ts
      unit-of-work.ts              # トランザクション境界 interface
    usecases/
      users/
        create-user.usecase.ts     # Application Service
        dto.ts                     # UseCase 入出力 DTO
  infrastructure/
    db/
      schema.ts                    # Drizzle テーブル定義
      connection.ts
      migrate.ts
      seed.ts
      drizzle-unit-of-work.ts      # UnitOfWork 実装
    repositories/
      drizzle-user.repository.ts   # Repository 実装（Drizzle はここに閉じる）
    gateways/
      resend-mail.gateway.ts       # Gateway 実装
    security/
      bcrypt-password-hasher.ts    # 技術ポート実装
      jwt-token-provider.ts
    http/
      app.ts                       # Hono アプリ定義（ランタイム非依存）
      error-mapper.ts              # ErrorCode -> HTTP status（HTTP を知る唯一の場所）
      schemas/
        user.schema.ts             # Zod request/response（HTTP 契約のみ）
      routes/
        user.routes.ts             # 薄い Route handler
      middleware/
        auth.middleware.ts
    jobs/
      users/
        send-welcome-mail.job.ts   # Queue consumer / commit 後の副作用
    commands/
      seed-users.ts                # 運用タスク entrypoint
  di/
    container.ts                   # Composition Root（全層を組み立てる唯一の場所）
  index.ts                         # Node.js エントリポイント
  worker.ts                        # Cloudflare Workers エントリポイント
tests/
  factories/                       # テストデータビルダー
```

# Dependency

```
infrastructure -> application -> domain
di -> 全層（組み立てのみ）

domain      -> 何も import しない（純粋 TypeScript）
application -> domain のみ。Hono/Drizzle の型を一切 import しない
infrastructure -> domain + application（ports の実装）
routes -> schemas + usecases。drizzle-orm を直接 import しない
```

- 逆方向依存は禁止（domain -> application、application -> infrastructure）
- HTTP の知識は `infrastructure/http/` にのみ存在する
- Drizzle の知識は `infrastructure/db/` と `infrastructure/repositories/` にのみ存在する

# Commands

- `npm run dev`
- `npx tsc --noEmit`
- `npx eslint .`
- `npx vitest run`

# REMINDER

- 新規 API は schema 定義 -> Route -> UseCase -> Domain -> Repository/Gateway の順で作る
- UseCase に Drizzle の DB 型を渡さない。`UnitOfWork` interface を渡す
- Repository 実装に業務判断を書かない。判断は `domain/{domain}/policies/` へ
- 外部副作用は Gateway に閉じ、コミット後実行、冪等キーを設計する
- `python -c`、here-doc、生成スクリプト、リダイレクトで `src/**/*.ts` を作らない。Bash はテスト・lint・確認に使う

@.claude/rules/hono-architecture.md
@.claude/rules/hono-patterns.md
