# 計画: edge-l1（L1 への問い合わせと fusion）

PR は 1 つ（ブランチ `feat/edge-l1`、base は main）。実装 約 600 行、テスト 約 800 行の見込み。1,000 行を超えるが、受け入れテスト (a)〜(c) が
クライアント・fusion・配信のすべてを通らないと意味を持たないので分けない（コミットを分けて読みやすくする）。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | コミット                                 | 含むもの                                                                                                 | 行数目安 | 依存 | テスト要件                            |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | ---- | ------------------------------------- |
| 1   | docs(spec): edge-l1                      | functional / threat / resilience / plan                                                                  | 400      | なし | なし                                  |
| 2   | feat(edge-l1): 設定と L1 の部品          | `config.py` の `[l1]`・`[l2]`、`l1/questions.py`・`request.py`・`client.py`・`calibration.py`、pyproject | 500      | #1   | unit（Q・REQ・CL・CAL・CFG）          |
| 3   | feat(edge-l1): fusion と配信とタスク     | `fusion.py`、`hub.py`、`runner.py` の background、`l1/runner.py`、`l0/stage.py` の赤の候補               | 700      | #2   | unit・integration（FU・HUB・RUN・AC） |
| 4   | docs: レビューの報告と spec_confirmed_at | `docs/reports/`、CREDITS、前の feature の spec_confirmed_at                                              | 100      | #3   | なし                                  |

### 依存グラフ

```
#1 spec ── #2 設定・L1 の部品 ── #3 fusion・配信・タスク ── #4 報告
```

## このフェーズで実装すること（In Scope）

- 4 問の写し（schema の `JUDGE_QUESTIONS` から）、L0 からの `JudgeRequest` の組み立て
- `typesafe-sdk` のクライアント（ループバックだけ、800 ms、リトライなし）と、答えの読み取り
- `calibration.json` の形・読み込み・温度の当て方
- fusion（校正後 0.9 以上・今のエピソード・赤の候補 1 つ・`lane` の拒否・2 秒で失効・1 秒の反転の上限）
- `AlertHub` の再送と `AlertFlag.l1`、`wait_for_l1_before_red` の保留（150 ms まで）
- L1 のタスク（同時 1 つ、失敗で間隔を延ばす、止まらない）と `pump` の background
- 設定 `[l1]`・`[l2]`、`tracker.min_conf ≤ judge.threshold` の検査

## このフェーズで実装しないこと（Out of Scope）

- 温度の学習（`l1/calibrate.py`・`dataset/export_l1_labels.py`、Step 4）
- L2（Step 5、任意）、`bench_l1.py`（Step 0・6）、Mac mini 実機での計測
- `Capture.l1Probs` の保存（edge-capture）
- 起動の入口（CLI）、PWA（`l1` は読まない）、`packages/schema`（凍結。変更しない）
- local-jev・mlx・モデルの重みのインストール（Mac mini で別に入れる）

## リスクと対策

| リスク                               | 対策                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| SDK と local-jev の実物の形がずれる  | SDK は実物を `httpx2.MockTransport` で使う。local-jev は README の応答の形。実物との接続は Step 0 で確かめる |
| SDK が pydantic を 2.12 以上に上げる | CI は `[dev]` で最新を入れる。既存の生成物のテスト（schema-judge）が新しい pydantic でも通ることを確かめた   |
| 降格が本物の鹿の赤を消す             | 条件を 6 つ重ね（R5）、解除の向きは遅らせない。受け入れ (b) と FU のテストで固定                             |
| 非同期のテストが時間に依存して不安定 | 時計と sleep を注入する。受け入れテストだけ実時間（数秒）                                                    |
