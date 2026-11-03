# code-reviewer: schema-judge（claude/schema-judge-c6edee, 6116484..HEAD）

範囲: packages/schema/src/*.ts、edge/detector/scripts/generate_models.py、edge/detector/src/detector/schema/、edge/detector/tests/、pyproject.toml。
見本 JSON・json/judge-request.schema.json・judge_request.py は抜き取り。仕様 docs/specs/schema-judge/functional.md と照合。
注意: このレビューは Read/Grep のみで、テスト・生成スクリプトは実行していない（Green の確認は sfad-done / local-ci に任せる）。

## Critical（修正必須）

なし。仕様 R1〜R6 の実装（Zod、JSON Schema の `(?!\n)$` 変換、StrictModel、質問の固定、readAlertFlag の strict 判定から l1 を除く処理）は仕様どおりに読める。

## Warning（推奨）

- [edge/detector/scripts/generate_models.py:80] `subprocess.run(..., check=True, capture_output=True)` は失敗時に CalledProcessError を投げるが、traceback に子プロセスの stderr が出ない。
  生成ツールが落ちた原因（フラグ名の誤り・版の違い・入力 JSON Schema の不備）が見えなくなる。
  → `check=False` で受け、`returncode != 0` なら `sys.stderr.write(result.stderr)` して `SystemExit(result.returncode)`。
- [generate_models.py:84-92] `harden` は正規表現が 1 件も当たらなくても黙って素通りする。生成ツールの出力の整形が変わると、RootModel の NaN/Infinity 拒否が消える。
  `ConfigDict` の import も、他のクラスが偶然 import させているのに頼っている。
  → 置換件数と `class .*\(RootModel\[` の件数が一致することを assert する。件数が 0 の場合の扱い（スキーマから RootModel が無くなった場合）も決める。
- [edge/detector/tests/test_judge_request_model.py:129-135, 138-149] 1e400 のテストは `speedKmh` だけ。
  仕様 UC-1i は speedKmh・lateralMps・ttcSec の 3 つ。`ttcSec` は harden の RootModel 経路で、1e400 を JSON 文字列から読む経路（`model_validate_json`）が最も壊れやすい。
  → `ttcSec` と `lateralMps` を parametrize で足す。
- [test_judge_request_model.py:159-171] `test_IDEM_2` は `--check` を 2 回呼ぶだけ。`--check` は書き込まないので「ファイルが変わらない」は常に真で、UC-6a と同じ検査の繰り返し（subprocess が 2 回増えるだけ）。
  → 消す。冪等性を見たいなら `render()` を import して 2 回呼び、バイト列を比べる。
- [packages/schema/src/judge-request.test.ts:32-45] AC-2 の「既存の全見本の結果が変わらない」は `length > 0` を見ているだけ。
  実際の担保は schema.test.ts の全見本ループ（`names(kind,'valid',false)` など）と edge の契約テストにある。テスト名と中身が食い違う。
  → 名前から「既存の全見本」を外すか、schema.test.ts への参照を書く。
- [packages/schema/src/judge-request.ts:87, edge/detector/src/detector/schema/questions.py:14] `JUDGE_QUESTIONS` は可変の配列と dict。
  利用側の 1 行（`JUDGE_QUESTIONS[0].text = ...`）でプロセス全体の質問が変わり、「校正が無効になるのでスキーマで固定する」という趣旨に反する。
  → TS は `as const satisfies`（型は readonly タプル）と `Object.freeze`、Python は `MappingProxyType`、または読み取り専用の型（`Sequence[Mapping]`）で出す。

## Info（参考）

- [judge_request.py:26-28, 40] `ttcSec` が `TtcSec(RootModel)` になるので、型付きで組み立てる edge-l1 は `TtcSec(root=3.9)` か dict 経由になる（`model_validate` は素の 3.9 を受ける）。
  型チェッカーが ttcSec を `TtcSec | None` と見る点を edge-l1 の cycle に申し送る。
- [generate_models.py:101-107] `--check` が失敗したとき、違う場所の差分が出ない。`difflib.unified_diff` を stderr に出すと、CI で原因がすぐ分かる。
- [test_judge_request_model.py:88-94] `json.loads(...) == value` の比較では `54` → `54.0` の変化を検出しない（StrictFloat は int を float にする）。仕様の「元のとおり戻る」は JSON の意味で満たしている。
- [judge-request.test.ts:301-316] UC-5c の alert-flag は 8 キーだけを確かめている（`distanceM`・`side`・`zoneRemainingKm`・`zoneDistanceKm` が無い）。capture は全キーを確かめているので、それに合わせる。
- [judge-request.test.ts:398-402] IDEM-1 は同じ関数を 2 回呼んで比べるだけ（乱数・時刻が入らないことの確認としては意味がある）。
  Python 側の FAIL_3 / IDEM_2 などの ID は functional.md の Test List に無い（resilience.md 由来と思われる）。ID の出所を docstring に書くと追える。
- 良い点: Python と TS が同じ見本を使い、jsonschema と pydantic の結果を全見本で突き合わせている（UC-6b）。既知の差を UC-6f で固定している。
  `readAlertFlag` が l1 だけ壊れた deer:false の赤解除を守る設計と、UC-3e でその 3 通りを確かめているのは堅い。
  `portablePattern` の `(?!\n)$` は Python の `re` の `$` の差を実際に潰しており、`track-pos-trailing-newline` / `model-newline` の見本と FAIL-2 で裏付けている。
