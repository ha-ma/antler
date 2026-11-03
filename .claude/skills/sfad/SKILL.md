---
name: sfad
description: "Spec-First AI Development (SFAD) - BDD Discovery + Double-Loop TDD を AI 支援ワークフローに適応させた開発手法。Example Mapping、仕様定義、テスト生成、テスト駆動実装、全自動サイクルをカバー。TDD, BDD, spec-first, test-driven workflow に反応。"
---

# SFAD: Spec-First AI Development

**目的**: ユーザーから機能開発の命令を受けたとき、Claude Code が「必ず」このフローに則り、「漏れなく」、言われた機能を「完成」させられるようにする実行フレームワーク。

- **必ず** — 起動を規律に頼らず、ゲートで機械化する（Tier 判定が入口）
- **漏れなく** — 空セル禁止のマトリクス構造と Test List が、要件漏れ・ケース漏れ・実装漏れを形式で検出する
- **完成** — 完成は自己申告ではなく機械の判定（全テスト Green + 全ゲート通過）

## 経緯（なぜこの形か）

78 Issue のレトロスペクティブ（BE 34 + FE-admin 23 + FE-service 21、2026-02-19 起票）から生まれた。
初版（02-21）は spec/test/impl のみ。02-28 の N+1 障害で DB パターン検査を追加、04-19 に
threat / resilience / plan の3仕様を追加して現在の 4 ファイル分割になった。
各ゲートは実際に起きた事故の再発防止装置である。

## Theoretical Foundation

| 概念 | 出典 | SFADでの適応 |
|------|------|-------------|
| **Canon TDD** | Kent Beck (2023) | Test List → 1つ選ぶ → Green → Refactor → リストが空まで |
| **TDD 第一法則** | Uncle Bob Martin | 失敗テストなしにプロダクションコードを書かない |
| **BDD 3 Practices** | Dan North / Cucumber | Discovery → Formulation → Automation |
| **Example Mapping** | Matt Wynne | ルール/具体例/質問の構造化 Discovery |
| **Double-Loop TDD** | Freeman & Pryce (GOOS) | 外側=受け入れテスト、内側=UC テスト |
| **Given-When-Then** | North & Matts (2004) | シナリオの構造化記法 |

**AI 支援での適応**（原典からの意図的な変更）:
- Test List の粒度は「1テストずつ」ではなく「**1 UC ずつ**」（AI との効率的な往復単位）
- **一括生成は受け入れテスト（外側ループ）のみ**。内側は Test List の項目ごとに Red → Green を回す。
  全項目を先に書き切ると、実装を理解する前にテスト構造を固定してしまい、振る舞いではなく
  「形」を検証するテストになる（既存コードがある場合と、ユーザーが明示的に要求した場合は例外）
- AI が Three Amigos の3役 + 攻撃者視点を担い、ユーザーは質問に答える側に回る

## Double-Loop TDD（この図が唯一の定義。他ファイルはここを参照）

```
┌─────────────────────────────────────────────┐
│ 外側ループ: 受け入れテスト（機能全体）           │
│   最初に書いて Red のまま寝かせ、最後に Green    │
│                                               │
│   ┌─────────────────────────────────┐         │
│   │ 内側ループ: UC テスト（個別振る舞い） │         │
│   │   UC-N: Red → Green → Refactor    │         │
│   │   実装中の発見は Test List に追加   │         │
│   └─────────────────────────────────┘         │
└─────────────────────────────────────────────┘
```

**テストの書き方（モック方針・流派・ツール）はスタック層が正**:
各スタックの `stacks/{stack}/docs/architecture.md`「テスト戦略の考え方」に従う
（スタックによっては testing-patterns の references も持つ）。
**どのスタックが何を提供するかの一覧は `CONTRACT.md` が正**で、`test_stack_contract.py` が
宣言と実物の一致を検査する。
共通原則は「境界はスタブで隔離（solitary）、ドメインロジックは状態検証（sociable/Chicago）」のみ。

## リスク階層（Tier）— 儀式の重さをリスクに比例させる

| Tier | 判定条件（機械判定可能） | 要求される仕様 |
|------|------------------------|---------------|
| **0** | 挙動変更なし（文言/スタイル/設定/ドキュメント） | なし（通常コミット） |
| **1** | 挙動変更あり。ただし認可・永続化スキーマ・外部副作用・並行性に**触れない** | `functional.md` + テスト |
| **2** | 認可 or 永続化スキーマ or 外部副作用 or 並行性に**触れる** | フル 4 ファイル |

Tier 1 判定の変更で認可/冪等性系の不具合が出たら境界を見直す（測定前提）。

## Sub-Skills

- **`/sfad cycle`** — Discovery → Spec → Double-Loop TDD の全自動サイクル（メイン推奨）
- **`/sfad spec`** — Example Mapping + 機能仕様（functional.md）
- **`/sfad threat`** — 認可マトリクス + データ分類（threat.md）
- **`/sfad resilience`** — 失敗モード + 冪等性 + 並行性（resilience.md）
- **`/sfad plan`** — PR 分割 + 依存グラフ（plan.md）
- **`/sfad test`** — テスト生成（受け入れ + UC）
- **`/sfad impl`** — Double-Loop 実装（Red → Green）
- **`/sfad reverse`** — 既存コードから仕様を抽出（保守案件）
- **`/sfad drift`** — 仕様とコードの乖離検出（STALE / THREAT GAP / BRIDGE GAP）
- **`/sfad init`** — プロジェクト品質基盤構築（Day 0）

**Agent**: `agents/spec-adversary.md` — 仕様ドラフトの敵対レビュー（攻撃者+QA、読み取り専用、
クリーンな文脈）。Discovery で必ず1回通す。`/sfad init` が `.claude/agents/` に配置する

## 仕様の構成（4 ファイル分割）

```
docs/specs/{feature}/
  ├── functional.md   ← /sfad spec       （何を作るか: Example Map + GWT + Test List）
  ├── threat.md       ← /sfad threat     （誰が叩けるか: 認可マトリクス + データ分類）※Tier 2
  ├── resilience.md   ← /sfad resilience （何が壊れうるか: 失敗モード + 冪等性）※Tier 2
  └── plan.md         ← /sfad plan       （どう作るか: PR 分割 + Out of Scope）※Tier 2
```

各フェーズは 10〜15 分の小ささ。`/sfad cycle` が Tier に応じて必要なものだけをオーケストレートする。
既存 PR への後追いは `/sfad threat --reverse` 等で個別実行できる。

## Usage

```
/sfad cycle お問い合わせ一覧          # 全自動（Tier 判定 → 必要な仕様 → Double-Loop TDD）
/sfad spec [feature]                # 仕様だけ
/sfad test [UC-N]                   # テスト生成だけ
/sfad impl [--regression "バグ説明"] # 実装 / バグ修正 TDD
/sfad reverse "認証機能"             # 既存コード → 仕様抽出
/sfad init                          # Day 0 品質基盤
```

## ライフサイクル

```
新規プロジェクト                既存プロジェクト（仕様書なし）
  /sfad init                    /sfad reverse [feature]
      │                             │
  /sfad cycle [feature]         docs/specs/{feature}/functional.md（同一フォーマット）
      │                             │
      └──────── 以後の変更: /sfad cycle [feature変更] → 仕様修正 → テスト修正 → 実装修正
```

どちらの経路でも最終状態は同じ: `docs/specs/{feature}/` が存在し、テストで保護されている。

## スタック検出

テストツールはプロジェクトのファイル構造から自動検出する。**実装パターン・配置・命名は
このリポジトリの各スタック（`stacks/{stack}` の rules / skills）が正であり、SFAD は関与しない。**

| 検出シグナル | スタック | テストツール | 状態 |
|------------|---------|-------------|------|
| `pyproject.toml` + FastAPI | Python / FastAPI | pytest | 実績あり |
| `package.json` + Next.js | Next.js | Vitest/Jest + RTL | 実績あり |
| `package.json` + Hono | Hono | Vitest | 実績あり |
| `package.json` + React (SPA) | React | Vitest + RTL | 実績あり |
| `composer.json` + Laravel | Laravel | Pest | スタック定義あり |
| `package.json` + Astro | Astro | astro check + Vitest | スタック定義あり |
| その他（Go/Rust/Java/Ruby/Vue/Svelte/Flutter 等） | — | フレームワーク標準 | 未検証 |

## Enforcement（hooks — 仕様の完全性を機械で守る）

`hooks/sfad-guard.py` が仕様成果物とプロセスゲートを write-time に検査する
（配線は `/sfad init`、検査内容と重大度は `hooks/README.md` が正）:

- **deny**: functional.md の frontmatter 欠落 / threat・resilience のマトリクス空セル /
  シークレットのコミット
- **warn（測定して昇格判断）**: 起動ゲート（仕様なきソースの作成・編集。パスごとに1回）/
  逃げ言葉 / Questions 未解決 / テストなしコミット
- **drift 検出**（`hooks/sfad-drift.py`、CI 組込可）: 仕様の最終更新以降のコード変更 /
  threat.md に無い実在ルート / 逆に threat.md にあるのに消えたルート /
  Rule→語彙対応表の置き場所欠落 / Test List に対応するテストの不在 /
  ❌ セル数に対する AUTH-* の不足

- **完成判定**（`hooks/sfad-done.py`、CI 組込可）: Test List 消化 / 仕様ゲート /
  drift クリーン / テスト Green の4つを見て exit 0/1。**「完成」は Claude の自己申告ではなく
  この exit code**。検証できなかった項目（テストコマンド不明・guard の異常終了 等）は
  UNKNOWN として不合格にする — 確かめられなかったものを通すと自己申告に戻るため

コードレベルの規約はスタック層（`stacks/{stack}` の hooks/CI）の管轄。SFAD は仕様を守り、
スタックはコードを守る — 相互に重複させない。**この分担の接続点は `CONTRACT.md` が唯一の宣言**で、
参照先の消滅・見出しの改名・hook が撃てなくなることを `test_stack_contract.py` が検出する。

## Principles

1. **Day 0 に品質基盤**: CI + lint strict + test infra + logger（`/sfad init`）
2. **Discovery が先、コードが後**: ルール/具体例/質問を先に洗い出す
3. **テストは仕様の表現**: 実装の検証ではなく、振る舞いの定義
4. **Test List を育てる**: 実装中に発見したシナリオはリストに追加
5. **Double-Loop で安全網**: 外側=機能が動く、内側=各部品が正しい
6. **仕組みで防ぐ**: 人（と AI）の規律に頼らない。ゲートで機械的にブロック
7. **儀式はリスクに比例**: Tier 0 に認可マトリクスを要求しない
