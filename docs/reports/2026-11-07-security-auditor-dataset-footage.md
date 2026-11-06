# セキュリティ監査（プライバシー中心）: dataset-footage

- 対象: ブランチ `claude/dataset-footage-98c8e1` のコミット 3c6b549（`dataset/self_footage.py`・`dataset/self_footage.toml`・`dataset/tests/test_self_footage.py`・`dataset/README.md`・`dataset/pyproject.toml`・`docs/specs/dataset-footage/functional.md`）
- 方法: コードとテストの読み取り。元の映像（`dataset/raw/`）と `dataset/private/` の画像は開いていない。ultralytics 8.4.202（`edge/detector` の day0 extra の固定版）はホイールを調査用ディレクトリに取得し、ソースの該当箇所だけ読んだ（インストールしていない）。JPEG の検査とトップレベルの正規表現は、手元の小さな合成バイト列で動かして確かめた。
- 結論: Critical 0。匿名化前のフレームが出力・manifest・ログ・例外・一時ファイルに残る経路は見つからなかった。Warning 5・Info 8。

## Critical

なし。

確かめて問題が無かった点（偽陽性を避けるため記録）:

- 匿名化前のフレームは、メモリ上でだけ扱われる。ディスクに書かれるのは `encode(clean)`（塗りつぶし・モザイク済み）の JPEG だけで、一時フォルダ `.tmp-<clip.id>` にも匿名化後のものしか入らない（`self_footage.py:733-739`）。`OverlayMeter` が持つのは画素ごとの回数の配列だけで、画像は保持しない。
- 音声・メタデータ・GPS トラックは、フレームを 1 枚ずつ `retrieve` して JPEG にする方式のため構造上入らない。
- manifest の `files[]` / `clips[]` に絶対パス・作成時刻・機種・元のファイルの更新時刻は入らない（`image` は `frames/...` の相対パス、`file` は一覧に書かれた名前）。`fps`・`size` は入る（Info I-3）。
- 例外メッセージ・標準エラー・標準出力に出るのは、クリップ id・一覧の値・画素数・SHA-256 の先頭 12 桁だけ。フレームの内容は出ない。`FootageError` 以外の例外（cv2・numpy・OSError）は traceback になるが、画素データは含まれない。
- 重みは `YOLO()` で読み込む（pickle の読み込み）前に SHA-256 で固定している（`:957-959`）。重みの差し替えによる任意コード実行の経路を塞いでいる（CWE-502 対策として良い）。
- ultralytics の `predict` は `save=False` で、結果の画像・ラベルのフォルダを作らない。重みのダウンロードもしない（ローカルのファイルを渡している）。
- `verify_source` は、クリップのフォルダ・映像・サイドカーのシンボリックリンクを拒否し、`resolve()` した実体が `raw` の中にあることを確かめる。`raw` 自体を `resolve()` してから比べるので、親ディレクトリ経由のリンクも止まる（テストあり）。

## Warning

### W-1 焼き込みの残りの検査が、白以外・低コントラストの文字と、帯の外で毎秒変わる桁を見逃す（偽陰性）| CWE-200 / CWE-359

- [`dataset/self_footage.py:67-75, 469-475, 485-501`]
- 「明るい縁」は、画素の B・G・R の平均 > 180 かつ隣との差の和 > 60。純黄・シアンは平均 170、橙は 140、赤・緑は 85 で、色つきの文字はこの検査に一切かからない。昼の明るい空の上の白文字も、差が小さく外れうる。
- 検査 2（矩形の外）は「50% 以上のフレームで同じ画素に続く」ものだけを数える。毎秒変わる桁（秒・速度・GPS の下の桁）は、矩形から 60 px の帯の外では数えられない（検査 3 は帯の中だけ）。別のファームウェア・別の配置のカメラで、変わる桁が帯の外にあると、どの検査にも当たらず通る。
- `OVERLAY_MAX_RESIDUAL = 50` 画素は、文字の 1〜2 桁分が残っても通る許容（検査 2）。
- 陽性対照（検査 1）は同じ「明るい縁」の定義を使うため、色つきの焼き込みのカメラは `overlay_min_pixels` に届かず止まる（安全側）。ただしそれは矩形の中だけの話で、**矩形の外の別の焼き込み**には効かない。dashcam-a の 5 本では実データで確かめ済みだが、カメラを足したときの保証にはならない。
- 影響: 新しいカメラ（ドラレコの別機種・スマホアプリの重ね書き）を足したとき、日時・速度・GPS が JPEG に残ったまま manifest が「確かめ済み」の数値を出す。Git の外（`dataset/private/`）に留まるが、配布（`blur_reviewed` の後）に進む前提のデータ。
- 修正: (a) 明るさを `max(B, G, R)` か輝度に変え、閾値を下げる（昼夜それぞれ実データで再確認）。(b) 画面全体で「時間方向の変動が大きく、エッジの強い画素」を数える検査を足す（毎秒変わる桁は変動が大きい。道路は動きが滑らかで、固定位置のエッジの点滅は少ない）。(c) カメラを足すとき、塗りつぶし後の最初の 1 枚をユーザーが目で確かめたことを `[camera.*]` の `reviewed_overlay = "…"` のような項目で必須にする（無ければ ingest を止める）。(d) `OVERLAY_MAX_RESIDUAL` を実データで 0 に近づけられるか確かめる。

### W-2 ultralytics のオフライン指定が、環境変数の事前設定で外れ、`sync=False` は効かない順序になっている | CWE-200

- [`dataset/self_footage.py:960-963`]
- `os.environ.setdefault("YOLO_OFFLINE", "1")` は、すでに `YOLO_OFFLINE=0`（や空以外の偽の値）が環境にあれば上書きしない。8.4.202 の `env_bool` は "1"/"true"/"yes"/"on"/"y"/"t" だけを真とするので、"0" ならオンライン扱い（`utils/__init__.py` の `is_online` が DNS を引く）。
- `settings.update({"sync": False})` は `from ultralytics import ...` の**後**。`Events.enabled`（`utils/events.py:87-93`）は `Events()` の生成時（import 時、`events = Events()`）に `SETTINGS["sync"]` と `ONLINE` から決まって保存される。後から `sync` を変えても、このプロセスの `events.enabled` は変わらない。実際に効いているのは import 前の環境変数だけ。しかも `settings.update` は利用者の全体の設定ファイル（`~/Library/Application Support/Ultralytics/settings.json`）を書き換え、edge の他の用途にも副作用を残す。
- 影響: オンライン判定になると、`on_predict_end` が匿名の利用イベント（モード・タスク・重みのファイル名・デバイス・匿名 UUID）を送る。フレームの画素・パスは送られない（8.4.202 のコードで確認）ため、深刻度は Warning。「検出器は利用状況を送らない（オフライン）」という R4 の要件が、環境次第で破れる。
- 修正: `os.environ["YOLO_OFFLINE"] = "1"` と代入して上書きする。import 後に `ultralytics.utils.ONLINE is False` と `ultralytics.utils.events.events.enabled is False` を確かめ、違えば `FootageError`（あるいは `events.enabled = False` を明示）。`settings.update` は消す（グローバルな設定を書き換えない）。実行は `python -I` に加えてネットワークの無い環境（または `sandbox-exec`）で回す手順を README に書く。

### W-3 `--out` / `--raw` の場所の制限が弱い（Git の外であることを保証していない）| CWE-22 / CWE-732

- [`dataset/self_footage.py:822-831`, `:808-819`, `:668-671`]
- 検査は「解決したパスのどこかに `dataset/private/…` の並びがある」だけ。リポジトリの `dataset/` に固定されておらず、`~/Downloads/dataset/private/x` や、`.gitignore` の無い別のリポジトリの同名のフォルダも通る。`git check-ignore` での確認もない。
- `--out` が `dataset/private/` の別の素材のフォルダ（`osaki-2026-11` など）でも通る。`manifest.json` が version 1 でキーが合わなければ `KeyError` の traceback で止まるが、合うものなら `frames/`・`.ingest.lock`・manifest を別の素材のフォルダに書く。
- `out` の中のシンボリックリンクは確かめない（`frames`、`frames/.tmp-*`、`.manifest.json.tmp`）。`_write_json` は固定名の一時ファイルを `write_text` で開くので、置かれたリンクの先を上書きする（同じ利用者のローカルの範囲）。
- ディレクトリ・ファイルは umask 任せ（通常 0755 / 0644）。共有の Mac では、匿名化した後のフレームでも `dataset/private/` が他のユーザーから読める。
- 影響: 設定ミスで、公開してはいけない JPEG が Git に入る場所に書かれる。README の例は絶対パスで渡す手順なので、取り違えが起きうる。
- 修正: `out.resolve()` が `REPO/dataset/private/self-footage`（worktree を考えて `git rev-parse --git-common-dir` の親からの相対）と一致するか、末尾が `self-footage` で `git check-ignore -q` が 0 を返すことを必須にする。既存の manifest が `license == "self"` でなければ止める。`os.umask(0o077)` か `out` に `chmod 700`。`out`・`frames` がリンクなら拒否。一時ファイルは `tempfile.NamedTemporaryFile(dir=out)` / `os.open(..., O_EXCL | O_NOFOLLOW)`。

### W-4 学習とテストの漏れを、日付の規則だけでは止められない（走行の境界・近い重複）| CWE-1244（設計）

- [`dataset/self_footage.py:234-237, 285-293, 618-628, 638-644`]
- 重複の検査は元ファイルの SHA-256 が**一致するもの**だけ。再エンコード・切り出し・隣り合うクリップ（連続して録画されたドラレコの 3 分刻みのファイルは、境界の前後がほぼ同じ画）は止まらない。
- クリップの日付は「走行の日付かその翌日」を許す。連続した 2 日の走行（例: 2026-11-06 = train、2026-11-07 = test）が両方あると、`20261107_*` のクリップは**どちらの走行にも書ける**。0 時を跨ぐ夜の走行を、翌日の走行（test）に誤って置くと、train の走行の続きが test に入る。道具は区別できない。
- 同じ日に `2026-11-06` と `2026-11-06-b` を別の split で作れる。日が違う走行でも、同じ旅の同じ道・同じ鹿の出る場所なら、背景と地形が近く、評価が甘くなる（旅の連続した 2 夜を train / test に分ける予定が仕様にある）。
- `check_splits` が守るのは「manifest に入った後の変更」だけ。最初の割り当て自体の誤りは止まらない。
- 修正: (a) `[[drive]]` に `route`（旅・道の識別子）を必須にし、同じ `route` が複数の split に跨るときは `allow_cross_split = "<理由>"` を書かない限りエラー。(b) 翌日の日付のクリップは、どちらの走行に属するか曖昧な場合（両方の走行の候補になる）にエラーにする。(c) ingest の終わりに、split をまたぐフレーム間の知覚ハッシュ（dHash など）の近さを数え、閾値以上があれば警告（または止める）。(d) 隣り合うクリップの境界は、一覧に `after = "<前のクリップ id>"` のように書かせ、同じ走行にそろえる。

### W-5 Git に入る一覧に、撮影日・地域・夜昼・元の映像の SHA-256・カメラの特徴が残る | CWE-200 / CWE-359

- [`dataset/self_footage.toml:14-16, 24-30, 35-83`、`docs/specs/dataset-footage/functional.md`]
- 公開リポジトリに入る情報: 撮影日（2026-09-07・2026-11-06）、昼・夜、地域（道東）、クリップ名（`deer-crossing` など）、鹿が映る秒（38 秒・161 秒）、元の映像の SHA-256 5 本、カメラの特徴（1920×1080・27.5 fps・右下の焼き込みの矩形と文字の座標「x 1581〜1894・y 987〜1033」）。
- 緯度経度・時刻・機種名は無い（意図どおり）。ただし日付と「道東」の組は、レンタカーの旅行日程と地域を公開することになる（不在・行動の推定）。SHA-256 は映像を復元できないが、同じ映像を持つ第三者が「この映像だ」と確認できる。焼き込みの座標と 27.5 fps は機種の推定材料になる。
- 仕様はこれを承認している（I5、ID の日付）。ただし「撮影の時刻」を残さない方針（C4）と比べて、日付が残るのは意図の範囲か、ユーザーに確かめる価値がある。
- 修正案（採るかは判断）: 日付・SHA-256・座標・fps・秒は `dataset/private/self-footage/self_footage.private.toml`（Git の外）に置き、Git の一覧には構造（カメラの種類・split のルール）だけを残す。または drive id を日付でなく `trip-a` のような仮名にし、日付は月までにする。少なくとも toml のコメントから、機種の推定になる数値（座標・fps）を外す。

## Info

- **I-1 JPEG のマーカーの検査の範囲**（`:507-524`）。許すのは SOS より前の APP0・DQT・DHT・DRI・SOF だけで、EXIF・XMP・ICC・IPTC・COM は拒否される（テストあり）。次は検査の対象外: (a) APP0 の中身（手元で、200 バイトの任意の中身を持つ APP0 が通ることを確かめた。JFXX のサムネイルや任意データを置ける）、(b) 最初の SOS より後のマーカー（プログレッシブ・複数スキャンの途中の APPn、手元で SOS 後の APP1 が通ることを確かめた）、(c) EOI より後の追記。cv2 の `imencode` はこれらを書かないので、現状は漏れない。エンコーダ・ライブラリの変更や差し替えに対する防御として、APP0 を 16 バイト固定（サムネイル 0×0）にし、EOI まで歩いて末尾に余りが無いことを確かめるとよい。逆に、0xFF の詰め・RSTn・TEM は誤検出になる（安全側）。
- **I-2 正規表現の `$`**（`:40-44`）。`CLIP_ID`・`DRIVE_ID`・`CAMERA_ID`・`SHA256` は `match` と `$` のため、末尾の改行 1 文字を許す（`"20261106_x\n"`、64 桁 + `\n` が通ることを確かめた）。TOML の `"\n"` で書ける。`fullmatch` にするか `\Z` を使う。`\d` は全角などの Unicode の数字も受ける（`re.ASCII` を付ける）。
- **I-3 時刻の形の検査の抜け**（`:41, 219-227`）。`TIME_LIKE = \d{4,}` は 4 桁以上の続きだけ。`dr-21-35-02` のような区切り付きの時刻は通る（手元で確かめた。`t2135` は止まる）。`file` と id の語尾に時・分・秒が区切り付きで残る可能性がある。区切りを除いた数字の合計が 4 桁以上なら拒否するとよい。また `fps`・`frame_count`・`size` は manifest に入り、機種・録画の長さの手がかりになる（Git の外なので許容。公開前に外す一覧に加える）。
- **I-4 TOCTOU**（`:308-332, 856`）。SHA-256 の計算と、cv2 での読み込みの間でファイルが差し替わりうる。同じ利用者のローカルだけの話で影響は小さい。気になるなら、開いた 1 つのファイル記述子から読む。
- **I-5 フレームの大きさの確かめが無い**（`:714`）。`video.size` はメタデータ（`CAP_PROP_*`）の値で、`retrieve()` で得たフレームの `shape` とは比べていない。回転のメタデータなどで食い違うと、矩形がずれる。陽性対照が通常は止めるが、`assert frame.shape[:2] == (h, w)` を 1 フレームごとに入れれば確実。
- **I-6 `--redo` の途中の失敗**（`:860-878`）。`rmtree(final)` → `rename` → manifest の書き込みの間で止まると、manifest の `sha256` とフレームが食い違う。プライバシーではなく整合性の問題。`final` を `.old` に退避し、manifest を書いてから消す順にするとよい。
- **I-7 `facing = "front"` は宣言だけ**（`:47, 169-170`）。前向きのカメラでも、フロントガラスへの映り込みや、2 レンズのドラレコで車内向きのレンズの映像を別のクリップとして渡すことは防げない。クリップごとの目視はユーザーの責任（README に「車内が写る映像は一覧に入れない」と 1 行足す）。乗員の顔は `person` の検出頼みで、夜の対向車・遠い車は再現率が低い（仕様は `blur_reviewed: false` で人の確かめに回している。`BLUR_CONF = 0.15`・imgsz 1280 の設定は妥当）。
- **I-8 `blur_reviewed` / `distribution: not_allowed` は助言にすぎない**。コードも CI も、`dataset/private/` と `dataset/raw/` が Git に入っていないことを検査しない（`.gitignore` だけ。`git add -f` や、`.gitignore` の無い別の worktree への出力で破れる）。`scripts/ci_arch_check.py` に `git ls-files dataset/private dataset/raw` が空であること、`*.mp4`・`*.sha256`・`dataset/**/frames/**` が追跡されていないことを足すと、人の注意に頼らず止まる。後続の `dataset-synth` / `dataset-train` が `blur_reviewed` を読み、`false` の間は成果物（合成画像・重みの学習ログ）に画像を出さない検査を持つのが前提（Deferred に記載あり）。

## テストの確認

- テストは、`tmp_path` の偽物（`dataset/raw/self`・`dataset/private/self-footage` を模した場所）だけを使い、実データのパス・実機のファイル名は含まない（`/Users`・`ha-ma` の文字列なし）。`test_repository_config_is_valid` は Git の一覧だけを読む。
- 足りないテスト: (1) `YOLO_OFFLINE=0` が環境にあるときの挙動（W-2）。(2) 色つきの焼き込み・帯の外の変わる桁（W-1）。(3) `out` が別の素材のフォルダ・`git` の対象のフォルダのとき（W-3）。(4) 末尾が改行の id・APP0 の大きな中身・SOS より後の APP1（I-1・I-2）。

## 総合評価

- リスクレベル: Medium（Critical 0、High 0。匿名化前のフレームが残る経路は無い。匿名化の完全性の確認が、白い文字の dashcam-a の実データに依存している）
- 推奨アクション（優先順）:
  1. W-2（`YOLO_OFFLINE` を上書きで固定し、import 後に確かめる。`settings.update` を消す）— 数行で直せる。
  2. W-3（`--out` を `…/dataset/private/self-footage` に固定し、`git check-ignore` で確かめる。`umask 077`）と I-8（CI で追跡の検査）。
  3. W-1（輝度の定義と、変動する桁の検査。カメラを足すときの目視の記録を必須に）— 2 回目の映像（2026-11-07）で別の条件が入る前に。
  4. W-4（`route` と split の跨ぎの検査、翌日のクリップの曖昧さ）— 2026-11-07 の test の走行を追加する前に。
  5. W-5（Git の一覧から日付・SHA-256・座標を外すか、判断を残す）— 公開の前にユーザーが決める。
  6. I-1〜I-7 は次の改修でまとめて。
