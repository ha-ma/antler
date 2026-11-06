# 計画: drive-tourism（A-3 運転中の観光の会話と、鹿ゾーンの前のおすすめ）

ブランチ `claude/drive-tourism-91b6de` から main へ 1 つの PR（1,000 行を超えるならコミットで区切る）。同時に別のセッションが鹿（`domain/deer-*`・`stages` ほか）と路面・季節（`vehicle.ts`・`scene/`）を直すので、そのファイルには触れない。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | 範囲         | 中身                                                                                          |
| --- | ------------ | --------------------------------------------------------------------------------------------- |
| 0   | spec         | `docs/specs/drive-tourism/`・変更記録 `docs/changes/2026-11-06-a-local-feedback-2-tourism.md` |
| 1   | api          | 話題の割り当て（T1〜T3）・材料（T4）・プロンプト（T5）・応答と保存（T6）・鍵の版              |
| 2   | sim 会話     | 応答の確かめ（T10）・行に pleasure を通す・写真つきの吹き出し（T8）・右上・見本の会話（T9）   |
| 3   | sim おすすめ | `recommendation()`（T11・T12）・`RecommendCard`（T13〜T15）・右の列の並び                     |

### 依存グラフ

```
#0 spec ── #1 api ──┐
          #2 sim ───┼── #3 sim おすすめ（右の列の並びを #2 と合わせる）
```

## このフェーズで実装すること（In Scope）

- T1〜T15（functional.md）
- plan-trip の barrel に `photoOf`・`photoSrc`・`PleasurePhoto` を足す（plan-trip の中身は変えない）
- drive-audio-chat の仕様に「drive-tourism で R11・R13・R15・R16・R19 を変えた」と注記

## このフェーズで実装しないこと（Out of Scope）

- 途中の立ち寄りの到着時刻（場面に移動ごとの地点が無い。A-4 の組み込みで）
- 会話の読み上げ（drive-audio-chat の Deferred のまま）
- 鹿・ステージ・路面・季節（別のセッション）
- 表（DB）の変更（`deck` は JSON の列。`SCHEMA_VERSION` は据え置き）

## マイグレーション統合

表は変えない。保存の鍵の版（`CHAT_KEY_VERSION`）を `chat:v1` → `chat:v2` に上げる。Turso の db:migrate は要らない。v1 の行は残る（旅の削除で消える）。

## 共有ファイルへの最小の追加（PR に明記する）

- `apps/sim/src/features/plan-trip/index.ts`（barrel に 3 つの export）
- `docs/specs/drive-audio-chat/functional.md`（変えたルールの注記 1 行）

## 凍結

`packages/schema`・`packages/alert-ui` の公開 API は変えない（凍結 API への変更なし）。
