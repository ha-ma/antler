# SFAD Init — プロジェクト品質基盤構築

プロジェクト Day 0 に品質基盤を一括構築するスキル。
"後でやる = 4倍でやる" を防ぐための初期投資。

**設計原則**: 「何を達成するか」を定義し、「どう実現するか」は検出スタックに基づいて AI が判断する。

## Invocation

```
/sfad init                     # Auto-detect from current directory
/sfad init --be python         # Python (FastAPI/Django)
/sfad init --be go             # Go
/sfad init --be rust           # Rust
/sfad init --be java           # Java (Spring Boot)
/sfad init --be kotlin         # Kotlin (Spring Boot)
/sfad init --be ruby           # Ruby (Rails)
/sfad init --fe next           # Next.js (App Router)
/sfad init --fe react          # React (Vite)
/sfad init --fe vue            # Vue/Nuxt
/sfad init --fe angular        # Angular
/sfad init --fe svelte         # SvelteKit
/sfad init --fe flutter        # Flutter
/sfad init --monorepo          # BE + FE in one repo
```

## Stack Detection Matrix

スタック検出は `SKILL.md` の「スタック検出」表を正とする（本ファイルでは重複定義しない）。
検出したスタックに対応する標準パッケージマネージャ（例: Python は pip / poetry、Node 系は npm / yarn / pnpm、
Go は go mod、Rust は cargo、Java/Kotlin は maven / gradle、Ruby は bundler、Flutter は pub）を用いて
以降の Phase を実行する。

## Quality Foundation Checklist

init が保証する項目。**全項目が達成されて初めて完了。**

```
✅ 1. CI        — PR 時に lint + type-check + test + build が自動実行される
✅ 2. Pre-commit — ローカルで lint + type-check がコミット前に強制される
✅ 3. Lint       — 危険パターンがコードレベルで禁止される
✅ 4. テスト基盤  — テスト実行環境 + 共通ユーティリティ + カバレッジ閾値が整う
✅ 5. ログ基盤    — 構造化ログ + グローバル例外ハンドラーが動く
✅ 6. セキュリティ基盤 — 以下を Day 0 で確立:
       - CORS / CSP / .env管理 / .gitignore が設定される
       - ユーザーアップロードを `static/` 等の公開配信ディレクトリに直接置かない（非公開ストレージ + 認可付き配信。詳細は threat.md の Data Classification）
✅ 7. 認証・認可基盤 — 以下を Day 0 で確立（BE のみ）:
       - シークレット管理: 環境変数必須、フォールバック値禁止、未設定時はエラーで停止
       - 開発用バイパス: テスト用認証ヘッダー等は NODE_ENV でガード
       - CORS: 本番は許可オリジンを明示（`*` 禁止）
       - 入力検証: リクエストボディは型パラメータ + ホワイトリスト方式（Mass Assignment 防止）
       - 認可パターン: authMiddleware / editorOrAdmin / adminOnly のミドルウェア定義
       - ロール値バリデーション: 列挙型のランタイム検証関数を用意
✅ 8. ヘルスチェック — /health と /health/ready が応答する（BE のみ）
✅ 9. Docker      — docker-compose で開発環境が統一される
✅ 10. テンプレート  — Issue / PR テンプレートでプロセスが標準化される
✅ 11. ADR        — 技術的意思決定が記録される
✅ 12. Dependabot — 依存関係の脆弱性が自動検知される
✅ 13. FE 品質基盤 — 以下を Day 0 で確立（FE のみ）:
       - TypeScript strict: `noUncheckedIndexedAccess: true` 推奨
       - 状態管理: Context/Provider パターンで認証状態を一元管理
       - a11y lint: eslint-plugin-jsx-a11y を導入
       - prefers-reduced-motion: アニメーション無効化対応を CSS に組み込み
✅ 14. SFAD hooks  — 仕様ガード（sfad-guard.py）が .claude/hooks/ に配置され settings.json に配線される
```

---

## Execution Flow

**達成要件はここが正、実現方法はスタック層が正。**
各 Phase は「何が満たされていれば合格か」だけを定義する。どのツールでどう設定するかは
`stacks/{stack}`（`.github/workflows/quality-check.yml`、lint 設定、`docs/architecture.md`）の
実物が唯一の正であり、このファイルに写しを置かない — 写しは必ず本体から遅れて嘘になる。

| スタック | 実現方法の所在 |
|---|---|
| fastapi / nextjs / hono / react / laravel / astro | `stacks/{stack}/` の実ファイル（`scripts/bootstrap.py` が配布する） |
| それ以外（Go / Rust / Java / Ruby / Vue / Svelte / Flutter 等） | そのフレームワークの標準ツール。SFAD は達成要件の充足だけを判定する |


### Phase 1: 検出と確認

1. **プロジェクト検出**: Stack Detection Matrix に基づいてスタックを判定
2. **既存設定の確認**: 各 Checklist 項目について既存の設定をスキャン
3. **差分リストアップ**: 不足している項目だけを提示
4. **ユーザーに確認**: 追加予定の項目を提示し承認を得る

```
検出結果:
  スタック: Python (FastAPI) + Next.js (App Router)
  パッケージ: pip + yarn

既存設定:
  ✅ .gitignore: 存在
  ❌ CI: なし
  ❌ Pre-commit: なし
  ❌ Lint strict: 部分的（基本ルールのみ）
  ❌ テスト基盤: なし
  ...

{N} 項目を追加します。進めてよいですか？
```

### Phase 2: CI/CD パイプライン

#### 達成要件
- PR 作成時に自動で品質チェックが実行される
- チェック項目: lint → type-check → test (カバレッジ付き) → build
- 1つでも失敗したら PR がマージできない

#### CI サービスコンテナ（必要時）

| 依存 | イメージ | ヘルスチェック |
|------|---------|-------------|
| PostgreSQL | `postgres:15` | `pg_isready` |
| MySQL | `mysql:8` | `mysqladmin ping` |
| Redis | `redis:7` | `redis-cli ping` |
| MongoDB | `mongo:7` | `mongosh --eval "db.runCommand('ping')"` |

プロジェクトの依存関係を検出し、必要なサービスコンテナを CI に追加する。

### Phase 3: Pre-commit Hooks

#### 達成要件
- `git commit` 時にローカルで lint + type-check が自動実行される
- 失敗したらコミットがブロックされる
- CI まで待たずにフィードバックが得られる

#### hook で実行する内容

```
lint-staged (FE) / pre-commit (BE):
  1. Lint: ステージングされたファイルのみ
  2. Type Check: 全体（差分チェックが困難なため）
  3. Format Check: フォーマッターで差分検出
```

### Phase 4: Lint Strict 設定

#### 達成要件（全スタック共通）

以下のパターンを**コードレベルで禁止**する:

| 禁止パターン | 理由 |
|------------|------|
| print / console.log 出力 | 本番で確認不可。logger を使用 |
| bare except / catch all | SystemExit 等を握りつぶす |
| 未使用の catch（silent failure） | エラーが消える |
| any / interface{} / Object 型 | 型安全性の崩壊 |
| 未使用変数 / 未使用 import | コードの腐敗 |
| ハードコード秘密鍵 | セキュリティリスク |

### Phase 5: テスト基盤

#### 達成要件
- テストランナーが設定済みで `1コマンド` で全テスト実行できる
- 共通の fixture / test utility が用意されている
- カバレッジ計測が有効で閾値（70%以上）が設定されている
- テストとプロダクションコードが分離されている

#### 共通 Utility の達成要件

**BE**:
- テスト用 DB セッション（テスト後にロールバック）
- 認証済みクライアント fixture
- 未認証クライアント fixture
- テストデータファクトリ（必要に応じて）

**FE**:
- Provider をラップしたカスタム render 関数
- Router モック
- API クライアントモック
- 共通テストデータ

### Phase 6: ログ・エラー基盤

#### 達成要件
- 全ログが構造化フォーマット（JSON）で出力される
- ログレベルが環境変数で制御できる
- 未捕捉例外がグローバルハンドラーで捕捉される
- 本番ではスタックトレースがユーザーに露出しない
- リクエスト ID でログが追跡できる（BE）
- クライアントエラーが適切に捕捉される（FE）

### Phase 7: セキュリティ基本設定

#### 達成要件
- CORS が適切に制限されている（`*` 禁止、本番オリジンのみ）
- CSP ヘッダーが設定されている（FE）
- 環境変数テンプレート（`.env.example`）が存在する
- `.gitignore` に機密ファイルが含まれている
- シークレットがソースコードにハードコードされていない

#### .env.example の必須項目

```env
# .env.example — 値は空またはダミー
DATABASE_URL=
REDIS_URL=
SECRET_KEY=change-me-in-production
API_BASE_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:3000
LOG_LEVEL=INFO
ENVIRONMENT=development
```

#### .gitignore 検証チェックリスト

以下が `.gitignore` に含まれていることを確認:

```
.env
.env.local
.env.*.local
*.pem
*.key
credentials.json
service-account.json
node_modules/
__pycache__/
.pytest_cache/
dist/
build/
coverage/
.next/
```

#### CORS 設定ルール

```
開発環境: localhost オリジンを許可
本番環境: 明示的なオリジンリストのみ
全環境共通:
  - allow_methods は実際に使用するメソッドのみ
  - allow_headers は必要なヘッダーのみ
  - allow_credentials は必要時のみ true
```

### Phase 8: ヘルスチェック（BE のみ）

#### 達成要件
- `GET /health` — アプリケーションが起動しているか（liveness）
- `GET /health/ready` — 外部依存（DB, Redis 等）が接続可能か（readiness）
- レスポンスは JSON: `{ "status": "ok" }` or `{ "status": "error", "details": {...} }`

### Phase 9: Docker 開発環境

#### 達成要件
- `docker compose up` で開発に必要な全サービスが起動する
- DB、Redis 等の外部依存がコンテナで統一される
- 「自分の環境では動く」問題を排除する
- 開発用のシード/マイグレーションが自動実行される

#### docker-compose.yml の構成要素

```yaml
services:
  # 外部依存のみコンテナ化（アプリ自体はローカル実行が開発効率が良い）
  db:        # PostgreSQL / MySQL / MongoDB
  cache:     # Redis（必要時）
  mailhog:   # メール確認（必要時）
```

プロジェクトの依存関係を検出し、必要なサービスのみ追加する。
アプリケーション自体はコンテナ化しない（ホットリロードの開発体験を優先）。

### Phase 10: テンプレート + ADR

#### 達成要件
- Issue テンプレートにユースケースと状態パターンの記入欄がある
- PR テンプレートにテスト・セキュリティのチェックリストがある
- ADR（Architecture Decision Records）でロギング戦略が記録される

#### Issue テンプレート必須項目
- 概要（1-2文）
- ユースケース（番号付きリスト）
- 状態パターン（loading / error / empty / data）
- 受け入れ基準（チェックリスト）

#### PR テンプレート必須項目
- 変更内容
- 関連 Issue
- チェックリスト:
  - テストの追加/更新
  - 全テスト通過
  - カバレッジ維持
  - lint エラーなし
  - ユーザー入力のサニタイズ確認
  - シークレットのハードコードなし

#### ADR 初期記録
- `docs/adr/001-logging-strategy.md`: print 禁止 → logger 使用、JSON 形式、CI で強制

### Phase 11: Dependabot

#### 達成要件
- 依存関係の脆弱性が自動で検知され PR が作成される
- 週次でチェックが実行される

### Phase 11.5: SFAD hooks の配線

`python scripts/bootstrap.py --stack {stack} --dest {path}` が配線する。
手順を手で書き下すとコピー元とズレるため、ここには持たない
（`install_sfad()` と `merge_settings()` が実装。既存 hook を壊さない冪等マージ）。

配線されるもの: `.claude/hooks/sfad-guard.py` / `sfad-drift.py`、
`.claude/agents/spec-adversary.md`、`settings.json` の `PreToolUse`（`Bash` / `PowerShell` /
`Write|Edit|MultiEdit`）。検査内容と重大度は `hooks/README.md` が正。
CI には `python .claude/hooks/sfad-drift.py`（乖離検出）と
`python .claude/hooks/sfad-done.py`（完成判定）を追加する。

### Phase 12: 検証と完了

1. **全 Checklist 確認**: Phase 1 で特定した全項目が実装されたか
2. **テスト実行**: テストランナーが正常動作するか（0テストでもエラーなく終了）
3. **Lint 実行**: lint が正常動作するか
4. **Docker 起動**: `docker compose up` でサービスが起動するか
5. **生成ファイル一覧**: 全ファイルをリストアップ
6. **ユーザー承認**: 承認後にコミット提案

## Output Format

```
SFAD Init 完了

検出スタック: {言語} + {フレームワーク}

Quality Foundation:
  ✅ CI: {ワークフローファイルパス}
  ✅ Pre-commit: {設定ファイルパス}
  ✅ Lint strict: {設定ファイルパス}
  ✅ テスト基盤: {テストユーティリティパス}
  ✅ ログ基盤: {ログモジュールパス}
  ✅ セキュリティ: CORS + CSP + .env.example + .gitignore
  ✅ ヘルスチェック: /health, /health/ready
  ✅ Docker: docker-compose.yml
  ✅ テンプレート: Issue + PR
  ✅ ADR: docs/adr/001-logging-strategy.md
  ✅ Dependabot: .github/dependabot.yml
  ✅ 認証・認可基盤: シークレット必須化 + 開発バイパスガード + 認可ミドルウェア（BE）
  ✅ FE 品質基盤: TypeScript strict 等（FE）
  ✅ SFAD hooks: .claude/hooks/sfad-guard.py 配線済み

生成ファイル:
  {ファイルパス一覧}

次のステップ:
  1. git add && git commit で品質基盤をコミット
  2. /sfad cycle [機能名] で最初の機能を実装
```

## エラー時の振る舞い

- **スタック検出失敗**: ユーザーに `--be` / `--fe` の明示指定を求める
- **既存設定との競合**: 既存設定を上書きせず差分を提示、ユーザー判断を仰ぐ
- **Docker 非対応環境**: Docker フェーズをスキップし、手動セットアップガイドを出力
- **monorepo**: BE と FE の各 Phase を順に実行、共通 CI ワークフローで統合
