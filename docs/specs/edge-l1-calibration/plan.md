# 計画: edge-l1-calibration（ラベルの書き出しと温度の学習）

PR は 1 つ（ブランチ `feat/edge-l1-calibration`、base は main）。実装 約 700 行、テスト 約 700 行の見込み。
ラベルの書き出しと学習は答えのファイルの形でつながり、受け入れ AC-3 が両方を通らないと意味を持たないので分けない（コミットを分ける）。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | コミット                                        | 含むもの                                                                                     | 行数目安 | 依存 | テスト要件                                 |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ---- | ------------------------------------------ |
| 1   | docs(spec): edge-l1-calibration                 | functional / threat / resilience / plan、spec-adversary の報告                               | 500      | なし | なし                                       |
| 2   | feat(edge-l1-calibration): 温度の学習と書き出し | `l1/calibrate.py`、`tests/l1_synth.py`、`tests/test_l1_calibrate.py`                         | 600      | #1   | unit（FIT・WR・EV・CLI）、AC-2             |
| 3   | feat(edge-l1-calibration): ラベルの書き出し     | `dataset/export_l1_labels.py`、`dataset/tests/`、`dataset/pyproject.toml`、CI の検査の格上げ | 800      | #2   | unit（TR・GEN・TRK・LBL・OUT）、AC-1・AC-3 |
| 4   | docs: レビューの報告と spec_confirmed_at        | `docs/reports/`、spec_confirmed_at                                                           | 100      | #3   | なし                                       |

### 依存グラフ

```
#1 spec ── #2 学習と書き出し ── #3 ラベル（AC-3 が #2 を使う） ── #4 報告
```

## このフェーズで実装すること（In Scope）

- sim のトレースの形（R1）と、その形の合成トレース（R2）
- 実行時と同じ場面（赤の候補・0.4 秒ごと・1 秒の窓）の `JudgeRequest` と、先読みつきの正解ラベル（R3〜R5）
- ラベルの JSONL と件数の要約（R6）
- 質問ごとの温度の学習（log β の黄金分割）、学習用と検証用の分割、書かない条件（R7）
- `calibration.json` の書き出し（一時ファイル → 読み戻し → 置き換え）（R8）
- ECE・NLL・降格の指標と `evaluate`（R9）
- dataset の検査の格上げ（`required`・`ci`・ruff）、sfad の test_command に dataset を足す（R10）

## このフェーズで実装しないこと（Out of Scope）

- sim のコード（`apps/sim`）の変更。トレースの書き出しは Deferred（人 A）
- local-jev への問い合わせで生の確率を集める道具（`bench_l1.py`、Step 0・6）と、実機での学習
- `Capture.l1Probs` の保存（edge-capture）、選択肢の説明文、L2
- `packages/schema` の変更（凍結。変更しない）、edge-l1 の読み込み側（`calibration.py`）の変更

## リスクと対策

| リスク                                           | 対策                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 合成で学んだ温度が実機に置かれ、本物の赤が下がる | `--allow-synthetic` なしでは書かない。生成物は `.gitignore`。テストは `tmp_path` だけ                       |
| ラベルの規則の穴で「危険な鹿を zone」と教える    | 6 秒の先読み（C1）。検証用で正解 danger の降格が 1 件でもあれば書かない（C3）                               |
| 合成の分布が実行時とずれる                       | 赤の候補・0.4 秒ごと・1 秒の窓で場面を選ぶ（C2）。固定の車の状態。確信度の式と誤検知の割合の実値は Deferred |
| 学習の式が読み込み側とずれる                     | `Calibration` を import して当てる。書いたファイルを `load_calibration` で読み戻す（WR-1a・FIT-1b）         |
| dataset のテストが CI で回らない                 | `local_ci_checks.toml` の `required`・`ci` を上げ、`.claude/sfad.json` の test_command に足す               |
