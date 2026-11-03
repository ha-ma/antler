# functional.md テンプレート — BE（API/サービス）

`/sfad spec` と `/sfad reverse` が共用する唯一のテンプレート。
保存先: `docs/specs/{feature}/functional.md`

```markdown
---
feature: {feature-name}
target_paths:
  - {実装が置かれる予定のパス}
spec_confirmed_at: {確定時のコミットSHA。/sfad spec が承認時に記入}
tier: {1 or 2}
---

# 仕様: {機能名}

## 概要
{1-2文で機能の目的}

## Example Map
{Discovery の出力をそのまま残す}

## API エンドポイント

### {METHOD} {path}
- **認証**: {必要/不要/ロール指定}（詳細な認可は threat.md の管轄）
- **リクエスト**: {パラメータ/ボディ}
- **レスポンス**: {正常時のレスポンス}

## ユースケース

### UC-1: {Rule名}
- **Given**: {前提条件}
- **When**: {APIリクエスト}
- **Then**: {レスポンス + 副作用}
- **Examples**:
  - {具体例1}
  - {具体例2}

## エラーパターン

| 条件 | ステータス | レスポンス |
|------|----------|-----------|
| 認証なし | 401 | {"detail": "認証が必要です"} |
| 権限なし | 403 | {"detail": "権限がありません"} |
| 未検出 | 404 | {"detail": "{リソース}が見つかりません"} |
| バリデーション | 422 | {"detail": [{field, message}]} |

### 例外 → ステータスコードマッピング
| UseCase/Domain 例外 | HTTP ステータス |
|---------------------|---------------|
| {バリデーション例外} | 422 |
| {ビジネスルール違反} | 409/422 |
| {リソース未検出} | 404 |

変換の実装位置（error_mapper / ErrorMapper / app.onError）はスタックの規約が正。

## ビジネスルール
{Example Map の Rules から抽出。各 Rule は Domain policy / rules として実装される}

## Questions（Deferred のみ残存可）

解決済みの Question は削除する。答えが得られていないものは Deferred として残す:

- [Deferred: 担当={名前/役割} / 期日={YYYY-MM-DD} / 暫定挙動={それまでの振る舞い}] {質問}

## Test List（Canon TDD Step 1）

threat.md / resilience.md（Tier 2）が生成する AUTH-* / IDOR-* / MASS-* / AUDIT-* /
FAIL-* / IDEM-* / CONC-* と、plan.md の MIGR-* もこのリストに統合される。

- [ ] UC-1: {テストシナリオ1}
- [ ] ERR-1: 認証なしで 401
- [ ] ERR-2: 権限なしで 403
- [ ] PERF-1: N+1 クエリなし（クエリ数がデータ量に対して固定 — 決定的に書けるため必須）

## Rule → ドメイン語彙対応（Tier 2 推奨）

Discovery の Rule がどのドメイン語彙としてコードに着地するかを1対1で追跡する。
置き場所の規約はスタック層が正。/sfad drift が実在を機械検査する。

| Rule | 語彙 | 置き場所 | 証明 |
|------|------|---------|------|
| R1: {ルール} | {PolicyName} | {domain policies のパス} | UC-N |

## 受け入れ基準
- [ ] 受け入れテスト（エンドポイント全体）が Green
- [ ] 全 UC / 全エラーパターンのテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型 / 依存方向）
```

## 管轄の分離（このテンプレートに書かないこと）

- **認可マトリクス・IDOR・Mass Assignment** → `threat.md`（/sfad threat）
- **キャッシュ無効化・失敗モード・冪等性・並行性・セッション/コネクション管理** → `resilience.md`（/sfad resilience）
- **実装の配置・命名・レイヤ規約・N+1 の実装パターン** → スタック層（stacks/{stack} の rules / skills）
