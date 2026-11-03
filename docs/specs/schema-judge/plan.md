# 計画: schema-judge（JudgeRequest・AlertFlag.l1・Capture.l1Probs）

PR は 1 つ（ブランチ `claude/schema-judge-c6edee`）。合計は約 600 行（生成物と JSON Schema を含む）で 1,000 行以内。
コミットを下の単位で切る。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | PR タイトル                                 | 含むもの                                                                                                                                                             | 行数目安 | 依存   | テスト要件                           |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------ |
| 1   | docs(spec): schema-judge の仕様             | `docs/specs/schema-judge/`（functional・threat・resilience・plan）、spec-adversary の報告                                                                            | 350      | なし   | sfad-guard                           |
| 2   | feat(schema): JudgeRequest と l1・l1Probs   | `packages/schema/src/judge-request.ts`（と l1 の部品）、`alert-flag.ts`・`capture.ts` への任意フィールド、`index.ts`、`json-schema.ts`、見本、書き出した JSON Schema | 250      | #1     | unit（UC-1〜UC-5・AUTH・FAIL・IDEM） |
| 3   | feat(edge): JudgeRequest の pydantic        | `edge/detector/scripts/generate_models.py`、`src/detector/schema/`（生成物・基底クラス・`JUDGE_QUESTIONS`）、`pyproject.toml`（pydantic・生成ツール）、契約テスト    | 150      | #2     | unit・contract（UC-5b・UC-6・FAIL）  |
| 4   | docs(spec): 確認済みの印と alert-ui の spec | `spec_confirmed_at` の更新、alert-ui の functional.md に「AlertFlag.l1・Capture.l1Probs は schema-judge が足した」の一行                                             | 20       | #2・#3 | sfad-drift                           |

### 依存グラフ

```
#1 spec ── #2 schema（Zod・JSON Schema・見本） ── #3 edge（pydantic・契約テスト） ── #4 spec の確認印
```

## このフェーズで実装すること（In Scope）

- `@antler/schema`: `JudgeRequestSchema`・`JUDGE_QUESTIONS`・`AlertLevel`・`L1ResultSchema`・`L1ProbsSchema` と型、`AlertFlag.l1`・`Capture.l1Probs`（任意）、JSON Schema の書き出し（`judge-request`）、見本
- edge: JSON Schema から pydantic の `JudgeRequest` を生成するスクリプトと生成物、Python の `JUDGE_QUESTIONS`、3 つの一致を確かめる契約テスト
- 依存の追加: `edge/detector` に `pydantic`（実行時）と `datamodel-code-generator`（開発時、バージョン固定）

## このフェーズで実装しないこと（Out of Scope）

- L1 のクライアント（`l1/client.py`）、`l1/questions.py`、`fusion.py`、`calibrate.py`（edge-l1・edge-l1-calibration の feature）
- L1 の応答の型（choice / probabilities / confidence）。原本に形が無いので edge-l1 の cycle で決める
- `AlertFlag.l1`・`Capture.l1Probs` の pydantic（edge は jsonschema の既存の方式）
- PWA の変更（`l1` を読まない）、A 側の変更
- `docs/requirements/ch7-data.md` の写しの更新（原本の再エクスポートはユーザーの作業。写しは原文のまま）

## マイグレーション統合チェック

N/A: DB のスキーマ変更は無い（Capture の保存先は api の feature）。

## 凍結

`@antler/schema` は凍結済み。この PR は**追加だけ**（既存の欄の名前・型は変えない）。PR に「推奨で決定」の判断と
alert-contract-guard の結果（Critical 0）を書く。人 A・人 B の合意は、依頼の方針（推奨で決定）により PR に明記する。
