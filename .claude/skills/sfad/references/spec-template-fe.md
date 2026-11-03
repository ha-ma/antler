# functional.md テンプレート — FE（画面/コンポーネント）

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
{Discovery の出力をそのまま残す — Living Documentation}

## ユースケース

### UC-1: {Rule名}
- **Given**: {前提条件}（AND で複合条件可）
- **When**: {ユーザーの操作}
- **Then**: {期待される結果}（AND で複数結果可）
- **Examples**:
  - {具体例1の Given/When/Then}
  - {具体例2の Given/When/Then}

### UC-2: ...

## 状態パターン

### S-1: ローディング中
- **Given**: データ取得中 → **Then**: {表示}

### S-2: エラー
- **Given**: API エラー発生 → **Then**: {エラーメッセージ}

### S-3: 空データ
- **Given**: データが0件 → **Then**: {空状態メッセージ}

### S-4: 正常表示
- **Given**: データ取得成功 → **Then**: {表示方法}

## Questions（Deferred のみ残存可）

解決済みの Question は削除する。答えが得られていないものは Deferred として残す:

- [Deferred: 担当={名前/役割} / 期日={YYYY-MM-DD} / 暫定挙動={それまでの振る舞い}] {質問}

## Test List（Canon TDD Step 1）

実装前に洗い出した全テストシナリオ。実装中の発見は [ADDED] マークで追加する。
threat.md / resilience.md（Tier 2）が生成する AUTH-* / IDOR-* / MASS-* /
FAIL-* / IDEM-* / CONC-* もこのリストに統合される。

- [ ] UC-1: {テストシナリオ1}
- [ ] UC-1: {テストシナリオ2}
- [ ] S-1〜S-4: 各状態の表示

## Rule → ドメイン語彙対応（Tier 2 推奨）

Discovery の Rule がどのドメイン語彙としてコードに着地するかを1対1で追跡する。
置き場所の規約はスタック層が正。/sfad drift が実在を機械検査する。

| Rule | 語彙 | 置き場所 | 証明 |
|------|------|---------|------|
| R1: {ルール} | {PolicyName} | {domain policies のパス} | UC-N |

## 非機能要件

- [ ] アクセシビリティ: スタックの a11y 規約（react/nextjs の rules・skill）に従う。
      フォーム/モーダル/対話 UI がある場合はその項目を受け入れ基準に含める
- [ ] SSR/State 整合性: スタックの規約に従う（規約は stacks 層が正。ここに転記しない）
- [ ] パフォーマンス: 目標がある場合のみ「観測要件」として記載（例: 初期表示 < Xs を APM で監視）。
      テスト化は決定的に書ける場合のみ

## 受け入れ基準
- [ ] 受け入れテスト（機能全体）が Green
- [ ] 全 UC / 全状態パターンのテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型）
```
