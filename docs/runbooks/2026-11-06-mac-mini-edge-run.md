# 手順書: Mac mini で B の検知を起動する（edge-run）

Mac mini（M1 / 16 GB / macOS 27）の前で、上から順に打つ。カメラ → YOLO（L0）→ 判定 → WebSocket → スマホの PWA が赤になるまでを確かめる。
L1（local-jev）は入れなくてよい（**この手順書は L1 なしが既定**。足し方は 10.）。終わったら、最後の「11. 貼るもの」をメインセッションに貼る。全体で 30〜45 分。

- ターミナルは 2 つ使う。**A** = 検知（起動したままにする）、**B** = 確かめる側
- dev Mac（開発用の Mac）の作業は 3. だけ。ほかは Mac mini で行う
- 各段の「確かめる」が期待どおりでなければ、次へ進まず「うまくいかないとき」を見る
- 仕様: `docs/specs/edge-run/functional.md`。Day 0 の手順書: `docs/runbooks/2026-11-04-mac-mini-day0.md`

## 1. 前提（Day 0 の 1〜3 と 5）

Day 0 の手順書の **1（前提の確認）・2（Xcode のコマンドラインツール）・3（clone と venv）・5（電源とスリープ）** が済んでいること。
済んでいなければ、先にそこだけ行う（4 の `day0` の依存・6 の local-jev・7 の YOLO-World・8 の計測は、この手順書では要らない）。

## 2. 最新の main（1 分。ネットワーク）

**ターミナル A**

```sh
cd ~/work/antler
source edge/detector/.venv/bin/activate
git checkout main && git pull
```

確かめる: `which python` が `.../antler/edge/detector/.venv/bin/python`。`python -m detector --help` が使い方を出す（`--no-l1` `--check` がある）。

## 3. モデルを運ぶ（dev Mac → Mac mini。5 分）

L0 のモデル `yolo26n-deer-20261105-480.mlpackage`（約 5 MB。入力 640×480）は `.gitignore` 済みで、git では届かない。dev Mac から手で運ぶ。
**このモデルは CC BY-SA を含む学習の派生で、採用は ch6 の判断のあと**（`docs/reports/2026-11-06-dataset-train-run.md`）。公開・配布しない。

**dev Mac**（`.mlpackage` はフォルダなので、zip にしてから運ぶ）

```sh
cd ~/Documents/herald/antler   # dev Mac の clone の場所
ditto -c -k --keepParent edge/detector/models/yolo26n-deer-20261105-480.mlpackage ~/Desktop/yolo26n-480.zip
shasum -a 256 ~/Desktop/yolo26n-480.zip
```

出た 64 桁を控える。`~/Desktop/yolo26n-480.zip` を **AirDrop**（Finder → AirDrop → Mac mini）で送る。
AirDrop が使えなければ、同じネットワークで `scp ~/Desktop/yolo26n-480.zip <Mac mini のユーザー名>@<Mac mini の名前>.local:~/Downloads/`（Mac mini の「システム設定 → 一般 → 共有 → リモートログイン」が要る）。

**Mac mini・ターミナル A**

```sh
shasum -a 256 ~/Downloads/yolo26n-480.zip
mkdir -p edge/detector/models
ditto -x -k ~/Downloads/yolo26n-480.zip edge/detector/models/
ls -d edge/detector/models/*.mlpackage
git status --short
```

確かめる

- `shasum` の 64 桁が dev Mac と同じ
- `ls` に `edge/detector/models/yolo26n-deer-20261105-480.mlpackage` が出る
- `git status --short` が何も出さない（モデルがコミット対象になっていない）

## 4. 実行の依存（5〜10 分。ネットワーク）

```sh
pip install -e "edge/detector[dev,run]"
python -c "import coremltools, cv2, PIL, numpy; print(coremltools.__version__, cv2.__version__, numpy.__version__)"
```

`run` は実行に要るものだけ（coremltools・Pillow・opencv）。ultralytics と torch は入れない（書き出し用の `day0` に入っている）。

確かめる: 2 行目が `9.0 4.x.x 2.x.x` のように 3 つの版を出す。

## 5. 設定（3 分）

スマホから届くアドレス（Mac mini の LAN のアドレス）を調べる。Mac mini の **en0 は有線**、**en1 は Wi-Fi** のことが多い。スマホと同じネットワークにいる方を使う。

```sh
ipconfig getifaddr en0; ipconfig getifaddr en1
```

出たアドレス（例 `192.168.1.23`）を `IP` に入れて、設定ファイルを作る（`config.toml` は `.gitignore` 済み。車ごとの設定）。

```sh
IP=192.168.1.23
cat > edge/detector/config.toml <<EOF
[infer]
model_path = "models/yolo26n-deer-20261105-480.mlpackage"

[l1]
enabled = false

[server]
host = "$IP"

[capture_server]
host = "$IP"
EOF
cat edge/detector/config.toml
```

- 書かなかったキーは `config.example.toml` の既定値（カメラ 1280×720・60 fps、間引いて 10 fps、赤の閾値 0.8、WebSocket 8765、capture 8767）
- カメラの解像度・fps が違うときは `[camera]` の `width` `height` `fps` を足す。USB カメラが 0 番でない（iPhone の連係カメラなどが先に見える）ときは `device = 1` を足す
- アドレスは DHCP で変わることがある。変わると起動が「待ち受けを始められない」で止まるので、5. をやり直す

## 6. 確かめる（`--check`。2〜5 分）

待ち受けずに、ポート・モデル・カメラ 1 枚・推論 2 回だけを確かめる。

```sh
python -m detector --config edge/detector/config.toml --check
```

- **1 回目は macOS が「"ターミナル"がカメラへのアクセスを求めています」と聞く。** 「許可」を押す。1 回目は「カメラを開けない」で終わることがあるので、もう一度同じコマンドを打つ
- 最初の 1 枚は暗いことがある（露出が合う前）。`detections` が空でもこの段では失敗ではない

確かめる: JSON が出て、exit 0（`echo $?` が `0`）。

- `"model": "yolo26n-deer-20261105-480.mlpackage"`、`"compute_units": "cpu_and_ne"`、`"frame_shape": [720, 1280, 3]`（カメラの解像度）
- `"first_infer_ms"`（初回。CoreML のコンパイルで数百 ms〜数秒）と `"infer_ms"`（2 回目。**数 ms〜数十 ms**）

鹿の写真で、モデルが鹿を出すかも見る（`~/work/deer.jpg` は Day 0 の 7. の写真。無ければ鹿がはっきり写った写真を 1 枚置く。リポジトリには入れない）。

```sh
python -m detector --config edge/detector/config.toml --check --image ~/work/deer.jpg
```

確かめる: `"deer_detected": true`（赤の閾値 0.8 以上の鹿がある）。`false` なら、別の写真でも試し、両方の出力を貼る。

## 7. YOLO 単独の計測（約 1 分 × 2）

L1 を呼ばずに、L0 の推論の速さだけを測る。`mkdir -p ~/day0` してから:

```sh
python scripts/bench_l1.py --no-l1 --model edge/detector/models/yolo26n-deer-20261105-480.mlpackage --out ~/day0/bench-yolo-only-ane.json
python scripts/bench_l1.py --no-l1 --model edge/detector/models/yolo26n-deer-20261105-480.mlpackage --compute-units cpu_only --out ~/day0/bench-yolo-only-cpu.json
```

確かめる（1 行目）

- 先頭に JSON（`"mode": "yolo"`）、続いて表。exit 0
- `l0_alone.infer.p50_ms` / `p95_ms`（1 回の推論の ms）と `l0_alone.fps`。`verdict.meets_ch6` が `true`（p95 が予算 100 ms 以内、10 fps 以上）。`infer_p95_within_target`（目標 50 ms）も見る
- これは乱数の画像での**推論の速さ**だけ。鹿を見つけられるかは 6. の `--image` と 9. で見る。赤までの遅延（1,000 ms 未満）は 9e. で測る
- 2 行目（`cpu_only`）の `fps` が 1 行目の **半分以下**なら ANE が効いている目安。ほぼ同じなら ANE に載っていない疑い。どちらもそのまま貼る

終了コード: `0` = 合格、`2` = 引数・モデルの読み込みの誤り、`3` = 結果が信用できない（推論が例外を出した・立ち上がらない）、`4` = 測れたが ch6（p95 100 ms・10 fps）を満たさない。
入力は乱数画像で、鹿が写っていない分だけ後処理が軽い。数字は推論だけの参考値（カメラ・判定・通信は入らない。それは 9. の走行ログで見る）。

## 8. 起動（ターミナル A。起動したままにする）

```sh
python -m detector --config edge/detector/config.toml
```

確かめる: 次の 3 行が出て止まる（プロンプトに戻らない）。

```
detector: 走行ログ /Users/.../antler/edge/detector/logs/run-20261107-101500.jsonl
detector: ws://192.168.1.23:8765/alerts で待ち受けています
  L1: off  capture: http://192.168.1.23:8767  止める: Ctrl-C
```

このあと端末には警告以上だけが出る（毎フレームの記録は走行ログのファイルへ）。

## 9. 赤が出るまで

**9a. WebSocket の中身を見る（ターミナル B）**

```sh
cd ~/work/antler && source edge/detector/.venv/bin/activate
python -m websockets ws://192.168.1.23:8765/alerts
```

（アドレスは 5. の `IP`）。確かめる: `< {"deer": false, ...}` が 1 秒ごとに流れる（ハートビート）。

**9b. 鹿の写真をカメラにかざす**

スマホかタブレットに鹿の写真を全画面で出し、カメラの 30〜50 cm 前にかざす。

確かめる

- 0.5 秒ほどで `"deer": true` と `distanceM`・`side`（`L` / `R`）が流れる
- 写真を外すと、1.5 秒で `"deer": false` に戻る

**9c. 走行ログを見る（ターミナル B。9a を Ctrl-C で止めてから）**

```sh
grep -E '"(run.started|flag.sent|ack|infer.over_budget|judge.stalled)"' "$(ls -t edge/detector/logs/run-*.jsonl | head -1)" | tail -20
```

確かめる: `flag.sent` に `t_frame`（フレームの時刻）と `t_sent`（送った時刻）がある。`ack`（`t_shown`）は PWA をつないだ 9d. のあとにだけ出る。

**9d. スマホの PWA をつなぐ（dev Mac で PWA の開発サーバー）**

スマホ・dev Mac・Mac mini を同じ Wi-Fi に置く。**dev Mac** で:

```sh
cd ~/Documents/herald/antler
npm run dev:pwa -- --host
```

出た `Network: http://<dev Mac のアドレス>:5174/` に、Mac mini のアドレスを付けてスマホで開く（開発ビルドだけが `?edge=` を受ける）。

```
http://<dev Mac のアドレス>:5174/?edge=192.168.1.23
```

確かめる: PWA が「接続」になり、9b と同じように写真をかざすと **画面全体が赤（八角）** になり、外すと戻る。

- 本番ビルドの PWA は接続先が `ws://ezoroad.local:8765/alerts` に固定。そちらで試すときは Mac mini の名前を `ezoroad` にする（システム設定 → 一般 → 共有 → ローカルホスト名）
- 走行後に PWA から検知フレームの一覧・同意を送るには、`config.toml` の `[capture_server]` に `allowed_origins = ["http://<dev Mac のアドレス>:5174"]` を足して 8. からやり直す

**9e. 赤までの遅延を数える（9d. のあと。写真のかざし・外しを 10 回以上）**

`ack` の `since_frame_ms` は「Mac mini がフレームを撮った時刻 → スマホが赤を描いた時刻」。**2 台の時計の差がそのまま入る**ので、先に Mac mini とスマホの両方で「日付と時刻を自動的に設定」をオンにする。`flag.sent` の `t_sent − t_frame`（Mac mini の中だけ、同じ時計）も一緒に出す。

```sh
python - "$(ls -t edge/detector/logs/run-*.jsonl | head -1)" <<'PY'
import json, sys
from datetime import datetime
rows = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8")]
def p(xs, q):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None
ack = [r["since_frame_ms"] for r in rows if r.get("event") == "ack" and r.get("since_frame_ms") is not None]
ts = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
sent = [(ts(r["t_sent"]) - ts(r["t_frame"])).total_seconds() * 1000 for r in rows if r.get("event") == "flag.sent" and r.get("t_frame") and r.get("t_sent")]
print({"ack_n": len(ack), "ack_p50": p(ack, .5), "ack_p95": p(ack, .95), "ack_min": min(ack, default=None),
       "edge_n": len(sent), "edge_p50": p(sent, .5), "edge_p95": p(sent, .95)})
PY
```

確かめる: `ack_p95` が 1,000 未満（目標 500）。`ack_min` が負、または `edge_p95` より大きく外れて小さいときは時計がずれている（自動設定を確かめてやり直す）。`ack_n` が 10 未満なら回数を足す。

## 10. 止める・L1 を足す

**止める**: ターミナル A で **Ctrl-C を 1 回**。「止めています」が出て、2〜3 秒でプロンプトに戻る（鹿が出ていれば OFF を送ってから）。戻らないときは 10 秒ほどで自動で抜ける（カメラの読み取りを 5 秒待ち、capture の片付けを待つ）。もう一度 Ctrl-C を押すとすぐ終わる。モデルを読み込んでいる間（起動の数秒）は Ctrl-C が効かないので、待ち受けの行が出てから押す。
**止める前に**、PWA で検知フレームの一覧・同意を済ませる（Ctrl-C で capture の HTTP も止まる）。

| 終了コード（`echo $?`） | 意味                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `0`                     | Ctrl-C で止めた                                                                 |
| `1`                     | 動いている途中で止まった（カメラが抜けた など）。走行ログの `run.failed` を見る |
| `2`                     | 起動できない（設定・モデル・カメラ・ポート）。端末の 1 行のメッセージを見る     |
| `130`                   | Ctrl-C を 2 回押した                                                            |

**L1 を足す（任意。後日）**: Day 0 の手順書の 6. で local-jev を起動したまま（ターミナル C）、`config.toml` の `[l1]` を `enabled = true` にして 8. からやり直す。
走行ログに `l1.endpoint` が出て、`l1_unavailable` が続かなければ動いている。L1 が落ちても赤は L0 だけで出る。
一時的に L1 を切るときは `python -m detector --config edge/detector/config.toml --no-l1`。

## 11. 貼るもの

```sh
{ sw_vers; system_profiler SPHardwareDataType | grep -E "Chip|Memory"; python --version; pip list 2>/dev/null | grep -Ei "^(coremltools|opencv-python|pillow|numpy|websockets) "; } 2>&1
python -m detector --config edge/detector/config.toml --check
python -m detector --config edge/detector/config.toml --check --image ~/work/deer.jpg
cat ~/day0/bench-yolo-only-ane.json ~/day0/bench-yolo-only-cpu.json
grep -E '"(run.started|run.stopped|ack|infer.over_budget|infer.degraded|judge.stalled|camera.lost|pipeline.summary)"' "$(ls -t edge/detector/logs/run-*.jsonl | head -1)" | tail -40
```

9e. の出力 1 行も貼る。あわせて、9b・9d で赤が出たか（出るまでの体感の秒数）と、8.〜10. の終了コードを書く。結果は `docs/reports/2026-11-0X-edge-run-mac-mini.md` にメインセッションがまとめる。

## うまくいかないとき

| 症状                                                   | 確かめること                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `モデルが無い: yolo26n-deer-20261105-480.mlpackage`    | 3. の `ls`。`config.toml` の `model_path` は `config.toml` の場所（`edge/detector/`）からの相対パス                                                                    |
| `coremltools が無い` / `opencv が入っていない`         | venv が有効か（`which python`）。4. をやり直す                                                                                                                         |
| `pip install` が `numpy` で衝突                        | `pip install "numpy<=2.3.5"` してから 4. をもう一度                                                                                                                    |
| `カメラを開けない: 開けない: device:0`                 | 6. のカメラの許可（システム設定 → プライバシーとセキュリティ → カメラ → ターミナルを オン）。USB を挿し直す。`device = 1` を試す                                       |
| `--check` で `frame_shape` が設定と違う                | カメラがその解像度に対応していない。出た値を `[camera]` に書く                                                                                                         |
| `"deer_detected": false`（鹿の写真で）                 | 別の写真。鹿が画面の 1/10 以上の大きさか。両方の出力を貼る                                                                                                             |
| `WebSocket の待ち受けを始められない: 192.168.x.x:8765` | アドレスが変わった（5. をやり直す）か、前の検知が動いたまま（`lsof -i :8765` で確かめて、そのターミナルで Ctrl-C）                                                     |
| 9a で何も流れない・つながらない                        | `[server] host` が 5. のアドレスか。スマホ・Mac が同じネットワークか。macOS のファイアウォールが Python の受信を止めていないか（初回に「受け入れる」を聞かれたら許可） |
| 9a でハートビートが止まる                              | カメラが止まった（3 秒で黙る）。走行ログの `judge.stalled`・`camera.lost` を貼る                                                                                       |
| 写真をかざしても `deer: true` にならない               | 6. の `--image` が `true` か。部屋を明るくする・写真を大きく・近く。走行ログの `frame.processed` の `max_conf` を貼る                                                  |
| `infer.over_budget` が続く                             | 推論が 100 ms を超えている。7. の結果と一緒に貼る                                                                                                                      |
| Ctrl-C で戻らない                                      | 10 秒ほど待つ（自動で抜ける）。もう一度 Ctrl-C                                                                                                                         |
| 終了コード `1`・`run.failed`                           | 走行ログの最後の 40 行を貼る（`camera.lost` ならカメラの接続）                                                                                                         |
