# 計画: alert-ui（共通スキーマと 3 状態アラート）

PR は 1 つ（ブランチ `feat/alert-ui`）にまとめ、コミットを下の単位で切る。Day 1 の凍結対象（schema と alert-ui の公開 API）を
1 回のレビューで確かめるため。合計の行数が 1,000 行を超えたら、#1〜#2 と #3〜#6 の 2 つの PR に分ける。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | PR タイトル                          | 含むもの                                                                                                                    | 行数目安 | 依存   | テスト要件                                     |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ---------------------------------------------- |
| 1   | feat(schema): 共通スキーマ           | `packages/schema/src/`（Zod の定義、readAlertFlag、toJst、isUploadable）、見本 `fixtures/`、JSON Schema の書き出し `json/`  | 450      | なし   | unit（UC-1・UC-11・AUTH・MASS・FAIL-1/2）      |
| 2   | test(edge): スキーマの契約テスト     | `edge/detector/tests/test_schema_contract.py`、dev 依存に jsonschema                                                        | 60       | #1     | contract（UC-1j）                              |
| 3   | feat(alert-ui): トークンと整形と言語 | `scripts/build-tokens`、`src/tokens/`、`src/format/`、`src/i18n/`                                                           | 250      | なし   | unit（UC-6・UC-9・UC-10c・UC-12）              |
| 4   | feat(alert-ui): 表示状態の決定       | `src/state/deriveAlertState`                                                                                                | 120      | #1     | unit（UC-2・FAIL-5）                           |
| 5   | feat(alert-ui): 音                   | `src/sound/`（AlertSoundController、beepIntervalMs、Web Audio と speechSynthesis の差し込み口）、wav の生成スクリプトと wav | 300      | なし   | unit（UC-5・FAIL-3/4・IDEM・CONC）             |
| 6   | feat(alert-ui): AlertState           | `src/components/`（AlertState、形、矢印、DeerPictogram、useBlink）、受け入れテスト                                          | 350      | #3〜#5 | component（UC-3・4・7・8・10・13、AC-1・AC-2） |

### 依存グラフ

```
#1 schema ──┬── #2 edge 契約テスト
            └── #4 state ──┐
#3 tokens/format/i18n ─────┼── #6 AlertState ＋ 受け入れテスト
#5 sound ──────────────────┘
```

## このフェーズで実装すること（In Scope）

- `@antler/schema`: TripPlan / AlertFlag / Capture / ClientMessage（ack・label）の Zod 定義と型、JSON Schema の書き出し、
  `readAlertFlag`（ゆるい受信）、`toJst`、`isUploadable`、見本の JSON
- `@antler/alert-ui`: `AlertState`、`deriveAlertState`、`AlertSoundController`（Web Audio・speechSynthesis の実装と、テスト用の差し込み口）、
  `beepIntervalMs`、`resolveLang`、`formatKm` / `formatM`、`DeerPictogram`、tokens.css / tokens.ts と生成スクリプト、chime.wav / beep.wav と生成スクリプト
- edge の契約テスト（JSON Schema で共有の見本を検証）

## このフェーズで実装しないこと（Out of Scope）

- GPS × 鹿ゾーンの判定（PWA）、鹿ゾーンの GeoJSON（zones）
- Wake Lock・回転ロック・「未接続」の灰色帯・B-0 の画面（PWA）
- WebSocket のクライアントとサーバー（PWA・edge）
- Capture の保存・アップロード・EXIF 除去（api・edge・dataset）
- A の 3D 車内へのスマホの配置（drive-3d）。この feature では A からも同じ `AlertState` を compact で描けることだけを確かめる
- 読み上げ音声ファイル 4 言語（Deferred。暫定は speechSynthesis）
- `apps/sim` / `apps/pwa` への組み込み（各画面の feature）

## マイグレーション統合チェック

N/A: DB のスキーマ変更は無い（Capture の保存先は api の feature）。

## 凍結

この PR のマージで `@antler/schema` と `@antler/alert-ui` の公開 API（`src/index.ts` から export するもの）を凍結する。
以後の変更は PR に人 A・人 B の両方の合意を書き、alert-contract-guard の Critical 0 を確かめる（CLAUDE.md）。
