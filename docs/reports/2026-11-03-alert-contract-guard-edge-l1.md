# alert-contract-guard: edge-l1（AlertFlag.l1 と降格）

対象: `feat/edge-l1` のコミット 9047b47。読み取り専用のエージェントの返答を、メインセッションが写した。

## 結果: Critical 0 / Warning 3 / Info 4

### Critical

なし。

- `deer:false` のフラグは `type, v, deer, zone, t_frame, t_sent`（と任意の `l1`）だけで、JSON Schema の 4 つ目の枝（deer false × outside）に通る（`edge/detector/src/detector/flag.py`）
- `deer:true` は 2 つ目の枝の範囲。`l1` が付いても枝は変わらない
- `l1` のキーは `alert_level, conf, overrode, latencyMs` の 4 つだけ（`fusion.py` の `l1_field`）。`conf` は NaN・無限大を 0 に、範囲外を 0〜1 に丸め、`latencyMs` は 0 以上
- 既存のフィールドの名前・型・`v` は変更なし。`packages/schema` は変更なし
- PWA の `readAlertFlag` は `l1` を除いて strict を判定し、結果にも含めない。壊れた `l1` でも赤が解けなくならない
- 降格を解いて赤に戻してから 1 秒は再降格しない（`FLIP_GUARD_S`）。入れ替わりは 1 Hz 以下

### Warning

- **W-1** 降格は ch5 の解除条件（1.5 秒検知なしで「前の状態」へ）を通らず、`deer:false` 1 通で赤を消す。根拠は edge-l1 の仕様 R5 だけで、AlertState.md・ch5 に「L1 による降格」の記述が無い
  → **対応**: 契約文書（原本）は直さない（原本はユーザーの作業）。PR 本文に「推奨で決定」と、原本への追記をユーザー作業として書く
- **W-2** `_dumps` の退避が `allow_nan` なしで NaN を書きうる
  → **直した**: `AlertHub.dumps_finite` が `l1` を外し、非有限の数を 0 にして `allow_nan=False` で書く（deer は届く）。HUB-1g で確かめる
- **W-3** `_dumps` が `l1` を捨てても、`flag.sent` のログには `l1` が残る
  → **直した**: `_serialize` が実際に付けた `l1` を返し、ログはそれだけを書く

### Info

- **I-1** `snapshot()` も `fusion.refresh` を通るので、送信なしで降格の状態を進めうる。次の `_sync` で他のクライアントにも届くので破綻はない（そのまま）
- **I-2** 降格のままエピソードが閉じると 1 秒のガードが次のエピソードに効かない
  → **直した**: 降格のまま閉じたら `_released_at` を記録する（`test_fu1m_降格のままエピソードが閉じても次の降格まで1秒あける`）
- **I-3** hub が実際に出した JSON を JSON Schema で検証するテスト → HUB-1a・HUB-1b・AC-a〜c が `VALIDATOR`（alert-flag.schema.json）で検証している
- **I-4** ack の基準は送った出力の `deer`（R9 どおり）

### 未確認（このレビューの範囲外）

- PWA が `deer:false` を受けたときの描画（琥珀・緑の選択、ビープの停止）。PWA は変更していない
