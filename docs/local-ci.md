# local-ci — 手元の検査の実行・記録・pre-push

手元で検査を回し、結果を「この差分に対する記録」として残し、**記録が無ければ push できない**ようにする部品。単体で動く（他の部品に依存しない。単一スタックでもモノレポでも同じ）。

## 取り込み

```bash
python scripts/bootstrap.py --tools-only --dest <案件> --with-tools local-ci
sh scripts/setup.sh      # clone ごとに 1 回（core.hooksPath の設定と、記録の保存先の .gitignore）
```

## 使い方

```bash
python scripts/local-ci.py                  # 検査を回して記録を作る（比較元との差分があるとき）
python scripts/local-ci.py --status         # HEAD の差分に合う記録があるか（rc 0 = ある）
python scripts/local-ci.py --plan           # 何を回すかだけ出す
python scripts/local-ci.py --stacks api,web # 回す stack を絞る（common は常に回る）
python scripts/local-ci.py --ci             # CI 用: 記録も枠も作らず、同じ一覧を回して rc を返す
python scripts/local-ci.py --allow-dirty    # 未コミットでも検査だけ回す（記録は作らない）
```

検査の一覧は案件の `local_ci_checks.toml`（雛形 `local_ci_checks.toml.example`）。stack ごとの一覧の雛形（fastapi・react）と、一覧と CI の整合の検査は別の PR（G-2）で入る。routes.toml による『変更した stack だけ回す』も別（stack-routes 部品との配線）。この版は一覧にある stack を全部回すか、`--stacks` で絞る。

## 検査の定義（`[[check]]`）

| 欄 | 意味 |
|---|---|
| `name` / `stack` / `cmd` | 名前、stack（`common` は毎回回す）、コマンド（文字列の配列）。コマンドの中で `{PYTHON}`（起動した python）・`{BASE_SHA}`（比較元の sha）・`{SLUG}`（作業ツリーごとの 8 桁）・`{WORKERS}`（並列数）を差し込める |
| `cwd` | 案件のルートからの相対（既定 `.`。外へ抜ける指定は拒否） |
| `needs` / `needs_path` / `needs_probe` | コマンド・パスが無い、または確認コマンドが rc≠0 なら**見送り**（通ったことにしない） |
| `pre` | 下ごしらえ `[ラベル, コマンド]` の並び。**落ちたら fail**（見送りに化けさせない） |
| `env` / `env_drop` | 検査へ足す環境変数 / 親から外す変数（末尾 `*` は前方一致） |
| `required` | 既定 true。false の見送りは通す（件数は判定に出る） |
| `hint` | 見送り・失敗のとき『どうすれば回せるか』。必ず書く（書かないと止まった人が検査を外す方向へ行く） |
| `timeout` | 秒（既定 900）。超えたら**木ごと**止めて `timeout` |
| `os` | `windows` / `linux` / `macos`。外れたら見送りでなく `out_of_scope`（理由つき） |
| `ci` | false なら `--ci` では回さない（手元だけの検査） |
| `artifacts` / `self_test_of` | 検査が作る生成物 / 自己防衛の対象（整合の検査が使う。G-2） |
| `recreate_db` | 検査の前に確認つきで DB を作り直す（下の節）。DROP を書ける唯一の経路 |

未知の欄・形の誤りは**黙って無視せず**、まとめて出して rc=2 で止まる。`[[check]]` が 1 本も無い一覧も止まる（何も回さない『全部通った』を作らない）。

状態は `pass` / `fail` / `skipped`（見送り）/ `out_of_scope`（対象外）/ `timeout`。必須の検査を見送った記録は `--status` が通さない。

## 記録が主張すること

鍵 = `sha256(head_tree, base_sha, 差分)` の先頭 16 桁。

| 要素 | なぜ |
|---|---|
| `head_tree` | コミットの sha でなく tree。中身が同じ amend で鍵が動かない |
| `base_sha` | 比較元の tip の sha（merge-base ではない）。マージ対象が動いたら別の検証 |
| 差分 | 差分が変われば鍵が変わる |

`--status` は鍵に加えて次を**照合**する（鍵が合っても、これが違えば NG）:

- 記録の `base_sha` / `head_tree` が今と同じ
- 記録の**行ごとの合否から verdict を導き直し**、記録の verdict と一致する（verdict だけを信じない）
- 必須の検査を見送った記録は通さない。行が 0 本の記録も通さない
- **環境の指紋**: `local_ci_checks.toml` の `[env] tool_probes`（版を調べるコマンド）の出力のハッシュが、記録のときと同じ。違えば NG で push を止める。記録に残すのは**検査が終わった後**の環境

ロックファイルや検査の一覧はコミットされているので、変われば `head_tree` が動く（鍵に足しても何も塞がない）。本当の穴は「**手元に実際に入っている版がロックファイルと違う**」ことで、それを環境の指紋で塞ぐ。

## 汚れの関門

`git status --porcelain`（**未追跡も数える**）が空でなければ、何を回すか決める前に止まる（rc=1）。検査の途中で作業ツリーか HEAD が動いた場合も記録を作らない。**検査が無視されていない生成物を残す場合も毎回止まる**（ファイル名が出る。黙って除外しない。stack の `.gitignore` に入れる）。`--allow-dirty` は検査だけ回して記録は作らない。記録の保存先 `.claude/state/` が `.gitignore` に入っていなければ記録を作らない。

## stack ごとの一覧の取り込み（`include`）と `[stack] name`

stack ごとの一覧（`stacks/fastapi/local_ci_checks.toml` など）は、**単一スタックの案件ではそのまま案件のルートの一覧**になる。モノレポでは `backend/` などに配り、案件のルートの一覧から取り込む:

```toml
[local_ci]
base = "origin/main"
include = ["backend/local_ci_checks.toml", "frontend/local_ci_checks.toml"]
```

- 取り込まれた一覧の `cwd` / `needs_path` / `artifacts` は、その一覧のフォルダからの相対で書く。読み込み時に案件のルートからの相対に直る
- `stack` を省いた検査は、その一覧の `[stack] name` を使う。名前は案件の `routes.toml` に合わせて 1 行直す
- 比較元 `base` は**ルートの一覧だけ**が決める。環境の確認コマンド（`tool_probes`）は全部の一覧から集め、**取り込んだ一覧のものは、その一覧のフォルダで回す**
  （`frontend/` の一覧の `npm ls` は `frontend/` の依存を見る。ルートで回すと何も見えない）。出力が実行の場面（直接 / git の hook）で
  変わる確認コマンドは指紋が一致せず push が止まり続ける: `npm ls` は罫線が変わるので `--json` にする
- 案件の外へ抜ける・存在しない・同じ一覧を 2 度読む（循環を含む）・4 段より深い、は**黙って無視せず**止める

## CI で回す（`--ci`）

CI の雛形は 2 通り。**どちらにも検査のコマンドは書かない**（手元と同じ一覧を `local-ci.py --ci` で回す）。

- `.github/workflows/checks.yml` — **手動実行のみ**（既定）。課金を抑え、検査は手元の local-ci を主にする方針
- `.github/workflows/checks-on-pr.yml.example` — PR で自動実行する版。**拡張子が `.example` なので有効ではない**。使うときは `checks-on-pr.yml` に改名する

切り替え方: 自動実行したくなったら `git mv .github/workflows/checks-on-pr.yml.example .github/workflows/checks-on-pr.yml`（手動版 `checks.yml` は消してよい）。戻すときは逆。**手動実行を忘れれば、手元の記録の嘘を止めるものは CI には何も無い**。その分、記録の鍵（`head_tree`・`base_sha`・差分・環境の指紋）とセルフレビューで守る。雛形の依存を入れる行（`pip install -e ".[dev]"`）は案件に合わせて直す。stack が従来から持つ `quality-check.yml`（PR で動く）とは**どちらか一方だけ**を使う。

## テスト DB の確認つき作り直し（`recreate_db`。PostgreSQL 専用）

DB を使う検査の前に DB を作り直すための欄。**別の DB を消さない**ことを最優先にして、消す前に次を全部満たすことを要求する。どれか欠ければ**消さずに検査を fail**にする（見送りにしない）。

```toml
recreate_db = { url = "postgresql://postgres@localhost:5433/app_test_{SLUG}", prefix = "app_test_", url_env = "DATABASE_URL" }
```

1. 接続先はこのマシン（localhost / 127.0.0.1 / ::1）。リモートは拒否
2. DB 名が **`prefix` + 作業ツリーごとの 8 桁（`{SLUG}`）にぴったり一致**する。`postgres` や slug を含まない名前（共用の DB）はこの条件で消せない。引用符などを含む名前も拒否
3. 既にある DB は、**この道具が作った印**（DB のコメント `local-ci:<slug>`）が付いているときだけ消す。印が無い DB（人が作った・別の作業ツリーが作った）は、名前が合っても消さない

手順は「有無と印の確認 → DROP → CREATE → 印を付ける」。有無を確かめられないときは DROP しない。検査には作った DB の URL が `url_env` の環境変数で渡る。実行は `psql`（無ければ見送り）。**`url` に `{SLUG}` が無い一覧・短い `prefix` は読み込みで拒否**する。

限界: 名前と印で守っているだけで、**接続先のサーバが想定のものか**（版やデータの置き場）までは見ていない。別のサーバが同じ名前・同じ印の DB を持つことまでは防げない。`LOCAL_CI_PSQL` は試験用の差し替え口で、実運用では設定しない。

## 木ごと止める・出力

時間切れでは子の**木ごと**止める（Windows は `taskkill /T /F`、他はプロセスグループ）。孫（pytest-xdist のワーカーなど）が残ると DB の接続も残る。子の出力は**バイトで受けて**そのまま流し、失敗の末尾を utf-8 → cp932 の順で復号して記録に残す。文字コードの環境変数（`PYTHONIOENCODING` など）は**既定で子へ渡さない**（付けると cp932 でしか出ない不具合を隠した）。`--inherit-encoding` で渡したときは記録に残る。本体の出力は cp932 の端末で出せない文字があっても落ちない（`?` に置き換える）。

## 同時実行の枠

PC 全体で同時に回す local-ci は既定 3 本まで（`LOCAL_CI_MAX_CONCURRENT`）。**OS のファイルロック**（Windows は `msvcrt.locking`、それ以外は `fcntl.flock`）で枠を取る。プロセスが異常終了しても（`taskkill /F`・`kill -9`）OS が枠を返す。pid の生死では判定しない（Windows は pid がすぐ再利用される）。子プロセスにロックを継がせない。

- 待つのは**空き**だけ（他人が全部終わるのは待たない）。待ち時間に上限（`LOCAL_CI_SLOT_WAIT`、既定 600 秒）。超えたら rc=2・記録は作らない。**時間切れを『空き』として扱わない**
- 枠の置き場所は OS の一時フォルダ（`LOCAL_CI_SLOTS_DIR` で変更）。**WSL と Windows は別の一時フォルダなので共有されない**
- `--ci` は枠を取らない。`{WORKERS}` = clamp(cpu÷2, 1, 8)、ほかに走っているときは 4 まで

## 自己再入の禁止

検査の一覧に自分自身を回す検査が入ると、合成環境などで本物を引数なしに起動したとき無限に増える（実案件で 235 プロセスまで増えた）。子には `LOCAL_CI_SELFTEST_DEPTH` を 1 足して渡し、深さが 1 以上で**検査を回す起動は rc=1 で拒否**する（理由を出す。`--status` / `--pre-push` は拒否しない）。壊れた値は『入れ子ではない』に倒す（拒否に倒すと、環境変数が壊れただけで検査が素通りするため）。

## `--ci`

記録も枠も作らず、同じ一覧を回して rc を返す。**見送りは fail にする**（CI で道具が無いのは環境の欠陥。手元の甘さを持ち込まない）。`ci = false` の検査と OS が違う検査は `out_of_scope`。雛形の workflow（手動実行が既定）は G-2 で入る。

## 限界（必ず読む）

- **記録の嘘は止められない。** 回さずに記録だけ作る手を抜く意思は止められない。止めるのは CI の回し直し（`--ci`）だけ。記録は git に入らない（コミットすると汚れの関門が自分の記録で止まる）ので、CI からは見えない。CI に『記録の有無を見るジョブ』は作れない
- `base_sha` は手元の追跡ブランチから取る。**fetch していなければ古いまま**。鮮度は「最後に fetch した時点」までしか保証しない
- clone では pre-push が有効にならない（`scripts/setup.sh`）。`git push --no-verify` で飛ぶ
- 環境の指紋は `tool_probes` に書いたものしか見ない。宣言が無ければ照合しない
- 検査は 1 本ずつ直列（v1）。前回の記録からの引き継ぎはしない（待ち時間が問題と測れてから再導入）。staging を取り込むたびに全部回し直す
- Python 3.11 以上が必要（`tomllib`）。3.10 以下では明示のエラーで止まる
- シェルのスクリプト（`.githooks/pre-push`、`scripts/setup.sh`）は **LF のまま**保つ。CRLF だと sh で動かない

## 終了コード

0 = 通ってよい／1 = 通さない（記録なし・不一致・失敗・汚れ・入れ子）／2 = 使えない（比較元を解決できない・一覧が壊れている・枠が空かなかった）。

## 出所

ある実案件のローカル CI（記録の鍵・汚れの関門・行ごとの合否・pre-push・木ごと止める・バイト受け・自己再入の禁止）で、事故のたびに足された経験から、案件固有の部分（DB・特定の検査・前回記録の引き継ぎ・プロセス一覧を数える同時実行の制限）を除いて新しく設計し直したもの。
