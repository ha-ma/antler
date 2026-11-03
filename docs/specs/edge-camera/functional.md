---
feature: edge-camera
target_paths:
  - edge/detector/src/detector/
  - edge/detector/tests/
tier: 1
---

# 仕様: edge-camera（フレーム取り込み・間引き・鹿の一次推論）

## 概要

B の検知パイプラインの入口。カメラ（または動画ファイル）からフレームを受け、640×480 に揃え、5〜10 fps に間引き、
鹿の一次検知（YOLOv8 CoreML）にかけて、走行ログに `t_frame` を残す。要件: ch4-edge.md B1-2・B1-3・B2-1・B2-2、
ch6-nfr.md「B 遅延」（推論 ≤ 100 ms、目標 ≤ 50 ms）、CLAUDE.md MUST「走行ログに t_frame を残す」。

入力（カメラ・動画ファイル・テスト用の画像配列）と推論（CoreML・フェイク）は Protocol で差し替える（B1-3）。
実機（Mac Mini・車載カメラ）と CoreML のモデルが無くても、動画ファイル相当の入力とフェイクの推論で全体が回る。

**Tier 1 の根拠**: 認可・永続化スキーマ・外部副作用・並行性のどれにも触れない（ローカルのログ出力だけ。画像は保存せず、
ネットワークも使わない。同期の 1 本ループ）。Tier 判定は推奨で決定。

**範囲外**（別 feature）: 2 フレーム連続・1.5 秒の判定と距離・方向（edge-judge）、WebSocket・フラグ送信（pwa-connect）、
Capture の保存（edge-capture 以降）、L1・L2（edge-l1・edge-l2。旧 B2-3 の二次確認 VLM は 2026-11-03 の変更指示で削除）、YOLO の CoreML の読み込み（edge-l0。`detector.l0`）、Wi-Fi AP、自動起動（B1-1）、起動用の CLI。

## Example Map

Story: B の検知プログラムとして、どんなカメラ・動画でも同じ形のフレームに揃え、鹿の位置と確信度を、
いつ撮った絵かの時刻つきで次の段（判定）に渡したい。遅延を後から数字で言えるように。

- R1: フレームは `Frame`（画像・`t_frame`・通し番号 `seq`）。入力は `FrameSource.read() -> Frame | None`（None は終わり）
  - 画像配列 3 枚の `ArrayFrameSource` → seq 0・1・2 を返して 4 回目は None
  - 画像は `(高さ, 幅, 3)` の uint8（BGR。OpenCV の慣習）。2 次元・float・チャンネル 4 → `ValueError`
  - `t_frame` はタイムゾーン付き。naive → `ValueError`。内部は JST（+09:00）に正規化し、ログはミリ秒まで
  - 動画ファイル（`VideoFileSource`）: `t_frame` = 開始時刻 + 通し番号 / fps。開始時刻は引数（省略時は開いた瞬間）なので、同じ開始時刻なら何度再生しても同じ値。30 fps で 5 枚 → 33 ms 刻み
  - fps が 0・負・NaN の動画 → `SourceError`（0 で割らない）。可変フレームレートの動画は fps の平均で割り当てる（実際の撮影時刻とはずれ得る。推奨で決定）
  - 動画の終わり（読み取り失敗）→ None
  - カメラ（`CameraSource`）: `t_frame` は `read()` から戻った瞬間の壁時計（注入できる。ドライバの撮影時刻は Deferred）。読み取り失敗 → `SourceError`（`camera.lost` をログ）
  - 開けない（ファイルが無い・デバイスが無い・opencv が入っていない）→ `SourceError`（`camera.open_failed` をログ）
  - OpenCV は `open_video_file` / `open_camera` の中で遅延 import する（テストは偽の cv2 で通す）
- R2: 640×480 に揃える（B2-1）
  - 1920×1080 → (480, 640, 3)。640×480 → 同じ中身
  - 縦横比が違っても引き伸ばす（余白を足さない）。座標は 0〜1 の正規化なので影響しない（推奨で決定）
  - 1×1 の画像も通る。幅か高さが 0 → `ValueError`
  - 元の `Frame` は書き換えない
- R3: 間引き（B2-1）。`FrameThrottle(target_fps)` は `t_frame` の間隔で通す
  - 60 fps の 60 枚 → target 10 fps で 10 枚（先頭は必ず通す）。30 fps → 10 fps は 3 枚に 1 枚
  - 入力が target より遅い（5 fps → target 10）→ 全部通す
  - タイミングの揺れ 5 ms までは同じ間隔として扱う（60 fps の 6 枚目が 99.99 ms でも通す）
  - `t_frame` が前に通したものより前か同じ（戻りが 1 秒以内）→ 捨てて `frame.out_of_order` を warn
  - 1 秒を超えて戻った（NTP の補正など）→ 基準を捨ててそのフレームから数え直し、`clock.jump` を warn（検知を止めない）
  - target_fps が 5〜10 の外（B2-1）→ `ConfigError`
- R4: 推論（B2-2）。`Detector.detect(image) -> list[Detection]`
  - `Detection` = ラベル・確信度 0〜1・`xywh`（正規化 0〜1。中心 x・中心 y・幅・高さ。YOLO の標準。推奨で決定）
  - `DeerDetector` は下の `Detector` を包み、`label == "deer"` だけ残し、確信度の高い順に並べる
  - 確信度が 0〜1 の外・NaN、`xywh` が 0〜1 の外 → その検出だけ捨てて `detection.invalid` を warn（フレームは落とさない）
  - 鹿が無い → 空のリスト（エラーではない）
  - 不正で捨てた数は `last_invalid` に持ち、`FrameResult.invalid_count` と `frame.processed` に出す。検出が全部不正で鹿 0 件のフレームが 30 回続いたら、失敗と同じく `infer.degraded`（壊れたモデルが緑のまま走らない。code-reviewer C-1、推奨で決定）
  - 推論が例外を投げた → `failed=True`・detections 空の `FrameResult` を返す（「鹿なし」と区別できる。後段が失敗を鹿なしと読んで緑にしないため）。`infer.failed`（連続失敗数・例外の型名）を error でログして次へ。止めない（推奨で決定）
  - 連続 30 回失敗 → `infer.degraded` を critical で 1 回（回復したら `infer.recovered`）。PWA へ伝える経路は edge-judge / pwa-connect（Deferred）
  - 実モデル（CoreML）の読み込みはこの feature に入れない。差し込み口とフェイク（`ScriptedDetector`）だけ
- R5: パイプライン `process_frames(source, config, detector)` は `FrameResult` を順に返す
  - 順序: 読む → 間引く → 640×480 → 推論。推論に渡るのは通ったフレームだけ
  - `FrameResult` = seq・`t_frame`・detections・`infer_ms`・`failed`
  - 推論時間 = 単調時計（perf_counter。注入できる）の差。壁時計は使わない（負にならない）。`budget_ms`（設定。既定 100）超 → `infer.over_budget` を warn（結果は捨てない）。50 ms 超 予算以下は warn しない（目標は ch6 の ≤ 50 ms）
  - 終わり方によらず（正常終了・`SourceError`・途中で close・KeyboardInterrupt）、`pipeline.summary`（読んだ数・通した数・捨てた数・推論失敗数・`ended`: eof / error / closed）を info で 1 回
  - 入力が例外（`SourceError` に限らず `ValueError` など）→ `pipeline.aborted`（例外の型名つき）を critical でログして、そのまま上へ
- R6: 走行ログ（CLAUDE.md MUST「t_frame を必ず残す」）
  - 推論したフレームごとに `frame.processed` を info: `seq`・`t_frame`（ISO 8601 +09:00、ミリ秒）・`infer_ms`・`deer_count`・`max_conf`（鹿が無ければ null）
  - `frame.out_of_order`・`infer.failed`・`infer.over_budget` も `t_frame` と `seq` を持つ
  - 捨てた間引きフレームは 1 枚ずつログに出さない（60 fps で溢れる）。数は summary に入れる
  - ログに画像・画素・位置情報（lat/lng）・端末識別子を入れない。例外は型名だけ（メッセージは出さない。numpy の repr や絶対パスが漏れる）。`camera.open_failed` のパスはファイル名だけ
  - ログの `ts` は UTC、`t_frame` は +09:00。比べるときは両方 aware として引く（edge-latency-reviewer への注記）
  - 画像はどこにも保存しない（車内を写す映像は保存しない）
  - 1 行 JSON は既存の `detector.log` の形式（`configure_logging`）
- R7: 設定（B1-2「解像度と fps は設定ファイル」）。`load_config(path)` は TOML を読んで `Config` にする
  - `[camera]` `source`（`"device"` / `"file"`）・`device`（番号）・`path`・`width`・`height`・`fps`。既定: device 0・1280×720・60 fps
  - `[pipeline]` `target_fps`（既定 10）。`[infer]` `model_path`（既定は空）・`budget_ms`（既定 100。1〜1000）
  - 無い項目は既定。知らないキー・型違い・範囲外（幅 0、fps 0 以下、source が 2 種以外、`source = "file"` で path 無し）→ `ConfigError`（キー名をメッセージに入れる）
  - ファイルが無い・TOML でない → `ConfigError`
- R8: 差し替えの境界（B1-3）
  - `FrameSource`・`Detector` は `typing.Protocol`。パイプラインは具体クラスを import しない
  - 同じパイプラインに、配列・動画（偽 cv2）・カメラ（偽 cv2）の 3 つの入力を差し替えて通る

Questions は全問、推奨で決定（ユーザー指示。2026-11-03）。決定の根拠は括弧内。保留は下の 7 件（adversary 指摘の 4 件を含む）。

## ユースケース

### UC-1: フレームと入力（R1）

- **Given**: 画像配列・動画ファイル・カメラのどれか（偽の cv2 でも可）
- **When**: `read()` を呼ぶ
- **Then**: 形の揃った `Frame`（tz 付き `t_frame`・通し番号）が順に返り、終わりで None。壊れた入力は `ValueError` / `SourceError`
- **Examples**: R1 の各行

### UC-2: 640×480 への変換（R2）

- **Given**: 任意の大きさの `Frame`
- **When**: `resize_frame` を呼ぶ
- **Then**: (480, 640, 3) の新しい `Frame`。`t_frame`・`seq` は変わらない

### UC-3: 間引き（R3）

- **Given**: 60 / 30 / 5 fps で並んだ `t_frame`
- **When**: `FrameThrottle(target_fps).accept` を順に呼ぶ
- **Then**: R3 のとおり通す / 捨てる

### UC-4: 鹿の一次推論（R4）

- **Given**: 推論の差し込み口（フェイク）
- **When**: `DeerDetector.detect` を呼ぶ
- **Then**: 鹿の検出だけが確信度順に返り、不正な検出は捨てられる

### UC-5: パイプライン（R5）

- **Given**: 入力・設定・推論
- **When**: `process_frames` を回す
- **Then**: 通ったフレームだけが推論され、`FrameResult` が順に返る。予算超えと失敗は警告・エラーになり、止まらない

### UC-6: 走行ログ（R6）

- **Given**: `configure_logging` 済み
- **When**: パイプラインを回す
- **Then**: 推論したフレームごとに `t_frame` つきの `frame.processed` が JSON 1 行で残り、画像や位置は含まれない

### UC-7: 設定（R7）

- **Given**: TOML ファイル
- **When**: `load_config` を呼ぶ
- **Then**: `Config` になる。不正は `ConfigError`

### UC-8: 差し替え（R8）

- **Given**: 3 種の入力
- **When**: 同じ設定・同じフェイク推論で回す
- **Then**: どれでも `FrameResult` が返る

## 状態パターン

### S-1: 入力が尽きた

- **Given**: 動画の最後 → **Then**: `read()` が None、パイプラインは `pipeline.summary` を残して終わる

### S-2: カメラが途中で外れた

- **Given**: カメラの読み取りが失敗 → **Then**: `SourceError`、`pipeline.aborted`（critical）、そこまでの結果は返し済み

### S-3: 推論が壊れた

- **Given**: 推論が例外 → **Then**: そのフレームだけ結果なし、`infer.failed`、次のフレームは処理される

### S-4: 鹿がいない

- **Given**: 検出が空 → **Then**: `frame.processed` の `deer_count` は 0、`max_conf` は null

## Questions（Deferred のみ残存可）

- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=同期の 1 本ループ。推論が間引き間隔より遅いと、カメラのバッファに古いフレームがたまり得る。いまは read() から戻った時刻が t_frame になるため、滞留した分は t_frame に現れず `ts − t_frame` でも見えない。実機では最新 1 枚だけ保持する取り込みと、grab 時点の打刻に替える（edge-latency-reviewer W1・W2）] 実カメラの最新フレーム優先（古いフレームを捨てる）の取り込み
- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=モデルが無い間は `ScriptedDetector` のフェイクだけ。`model_path` は設定に読めるが使わない] YOLOv8 CoreML の実モデル（deer クラスの学習・変換）の読み込みと、≤ 50 ms の実測
- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=カメラの t_frame は read() から戻った瞬間。バッファで待った分は t_frame の後ろに隠れ、遅延を実際より良く測る。ドライバの撮影時刻（CAP_PROP_POS_MSEC 等）への切り替えは実機で] カメラの撮影時刻
- [Deferred: 担当=人 B（pwa-connect）/ 期日=2026-11-05 / 暫定挙動=t_frame は Mac の壁時計、t_shown はスマホの壁時計。AP にインターネットが無く、端末間のずれは補正しない。infer_ms だけは単調時計で正しい] 端末間の時計の同期
- [Deferred: 担当=人 B / 期日=2026-11-05（Day 3 の実機）/ 暫定挙動=同じ絵の繰り返し・真っ黒・真っ白は検出しない。read が成功すれば正常に動く] 「生きているが絵が死んでいる」カメラの検出
- [Deferred: 担当=人 B（edge-judge・pwa-connect）/ 期日=2026-11-05 / 暫定挙動=`infer.degraded` のログと `failed=True` の結果までが edge-camera。「検知停止」を PWA に出す経路は後段] 検知停止の通知
- [Deferred: 担当=人 B（edge-capture）/ 期日=2026-11-06（Day 4）/ 暫定挙動=`Detection.xywh` は中心基準のまま持ち、Capture へ書くときの変換はその feature で packages/schema（capture.ts）と突き合わせる] xywh の基準（中心か左上か）を Capture と揃える

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 60 fps・1 秒（60 枚）の動画（偽 cv2）を 10 fps で回し、鹿が写る区間のフェイク推論で、10 個の `FrameResult` が `t_frame` の昇順で返り、各 `frame.processed` に ISO 8601 +09:00 の `t_frame` が残る
- [x] AC-2: 同じ設定・同じフェイク推論で、配列・動画・カメラ（どちらも偽 cv2）の 3 入力が `FrameResult` を返す（推論器も入力も差し替え可能）

UC-1 フレームと入力:

- [x] UC-1a: `ArrayFrameSource` が seq 0・1・2 を返し、4 回目は None
- [x] UC-1b: `Frame` は 2 次元・float・チャンネル 4 の画像を `ValueError` で拒否する
- [x] UC-1c: naive な `t_frame` は `ValueError`。`Z` も +09:00 も通り、+09:00 に正規化される
- [x] UC-1d: `VideoFileSource`（30 fps・5 枚）の `t_frame` が開始時刻から 33 ms 刻みで、読み取り失敗で None
- [x] UC-1e: `CameraSource` の `t_frame` は注入した時計の値。読み取り失敗 → `SourceError` と `camera.lost`
- [x] UC-1f: 開けない（偽 cv2 が isOpened=False / opencv 無し）→ `SourceError` と `camera.open_failed`
- [x] UC-1h: [ADDED adversary] 動画の fps が 0・負・NaN → `SourceError`。開始時刻を引数で与えると同じ t_frame が再生で再現する
- [x] UC-1g: `open_video_file` / `open_camera` は偽 cv2 の `VideoCapture` を、解像度と fps の設定つきで使う

UC-2 リサイズ:

- [x] UC-2a: 1920×1080 → (480, 640, 3)。`t_frame`・`seq` は同じ。元の画像は変わらない
- [x] UC-2b: 640×480 は中身が同じ。縦長（480×640）も (480, 640, 3) に引き伸ばされる
- [x] UC-2c: 1×1 の画像は通る。幅か高さが 0 の画像は `Frame` の時点で `ValueError`

UC-3 間引き:

- [x] UC-3a: 60 fps の 60 枚 → 10 fps で 10 枚。先頭は通る
- [x] UC-3b: 30 fps → 10 fps は 3 枚に 1 枚。5 fps → 10 fps は全部通る
- [x] UC-3c: 99.99 ms 間隔（揺れ 5 ms 以内）でも通り、90 ms 間隔は捨てる
- [x] UC-3d: `t_frame` が戻る・同じ → 捨てて `frame.out_of_order` を warn。その後の進む時刻は通常どおり
- [x] UC-3f: [ADDED adversary] 1 秒を超えて戻る → `clock.jump` を warn して数え直し、以降のフレームは通る。1 秒以内の戻りは捨てる
- [x] UC-3e: target_fps が 4・11・0・負 → `ConfigError`。5 と 10 は通る

UC-4 鹿の一次推論:

- [x] UC-4a: deer 以外のラベル（cow・person）は捨てる。鹿が複数なら確信度の高い順
- [x] UC-4b: 確信度が 1.2・-0.1・NaN、`xywh` が 0〜1 の外の検出だけ捨て、`detection.invalid` を warn。他の検出は残る
- [x] UC-4c: 鹿なし → 空のリスト
- [x] UC-4d: `ScriptedDetector` は与えた列を順に返し、尽きたら空を返す。呼ばれた画像の形を記録する

UC-5 パイプライン:

- [x] UC-5a: 推論に渡るのは間引きを通り、640×480 にされたフレームだけ（形で確かめる）
- [x] UC-5b: `infer_ms` は注入した時計の差。100 ms 超で `infer.over_budget`（warn）、結果は残る。50 ms 超 100 ms 以下は警告なし
- [x] UC-5c: 推論が例外 → `failed=True`・detections 空の結果、`infer.failed`（連続失敗数）を error、次のフレームは処理される。成功したら連続失敗数は 0 に戻る
- [x] UC-5d: 入力が尽きたら `pipeline.summary`（読んだ・通した・捨てた・失敗の数、`ended`=eof）を info
- [x] UC-5e: 入力が `SourceError` → `pipeline.aborted`（critical）と summary（`ended`=error）、そこまでの結果は返し済みで、例外は上へ出る
- [x] UC-5f: [ADDED adversary] ジェネレータを途中で close しても summary（`ended`=closed）が 1 回出る
- [x] UC-5g: [ADDED adversary] 連続 30 回の失敗で `infer.degraded` が 1 回だけ critical、成功で `infer.recovered`
- [x] UC-5i: [ADDED code-reviewer] `SourceError` 以外の入力の例外でも `pipeline.aborted` と summary（`ended`=error）が出る
- [x] UC-5j: [ADDED code-reviewer] 全部不正で捨てたフレームは `invalid_count` に出て、30 回続くと `infer.degraded`、鹿なしの正常フレームで `infer.recovered`
- [x] UC-5h: [ADDED adversary] `infer_ms` は単調時計で測る（壁時計が戻っても負にならない）。`budget_ms` は設定の値で警告が決まる

UC-6 走行ログ:

- [x] UC-6a: `frame.processed` に seq・`t_frame`（+09:00・ミリ秒）・`infer_ms`・`deer_count`・`max_conf` がある
- [x] UC-6b: 鹿なし → `deer_count` 0・`max_conf` null
- [x] UC-6c: 間引きで捨てたフレームは個別のログが無い
- [x] UC-6d: ログの全行を走査して、画像・画素・lat・lng・deviceId・email の項目や値が無い
- [x] UC-6e: [ADDED adversary] 推論の例外文に画素の repr を入れても、`infer.failed` は型名だけで本文が無い。`camera.open_failed` のパスはファイル名だけ

UC-7 設定:

- [x] UC-7a: 空の TOML → 既定値（device 0・1280×720・60 fps・target 10・budget 100）
- [x] UC-7b: 全項目を書いた TOML が `Config` になる（source=file, path つき）
- [x] UC-7c: 知らないキー・型違い（width が文字列）・範囲外（幅 0・fps 0）→ `ConfigError`、メッセージにキー名
- [x] UC-7g: [ADDED code-reviewer] UTF-8 でない設定ファイル → `ConfigError`
- [x] UC-7f: [ADDED adversary] `budget_ms` が 0・負・1001 → `ConfigError`
- [x] UC-7d: `source = "file"` で path 無し・source が `"usb"` → `ConfigError`
- [x] UC-7e: ファイルが無い・TOML でない → `ConfigError`

UC-8 差し替え:

- [x] UC-8a: `process_frames` のモジュールは具体的な入力・推論クラスを import しない（Protocol だけ）
- [x] UC-8b: `FrameSource` / `Detector` を満たす最小の自作クラスを渡しても回る

状態パターン:

- [x] S-1: 入力が尽きたら summary を残して終わる（UC-5d と同じテストで確かめる）
- [x] S-2: カメラが外れたら `pipeline.aborted`（UC-5e と同じテストで確かめる）
- [x] S-3: 推論が壊れても `failed=True` の結果が返り、次のフレームは処理される（UC-5c と同じテストで確かめる）
- [x] S-4: 鹿なしの `frame.processed`（UC-6b と同じテストで確かめる）

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule                       | 語彙                                                   | 置き場所                                | 証明       |
| -------------------------- | ------------------------------------------------------ | --------------------------------------- | ---------- |
| R1: 入力                   | ArrayFrameSource / VideoFileSource / CameraSource      | edge/detector/src/detector/sources.py   | UC-1       |
| R1・R2: フレーム           | Frame / resize_frame                                   | edge/detector/src/detector/frame.py     | UC-1・UC-2 |
| R3: 間引き                 | FrameThrottle                                          | edge/detector/src/detector/throttle.py  | UC-3       |
| R4: 推論                   | Detector / Detection / DeerDetector / ScriptedDetector | edge/detector/src/detector/inference.py | UC-4       |
| R5・R6: パイプラインとログ | process_frames / FrameResult                           | edge/detector/src/detector/pipeline.py  | UC-5・UC-6 |
| R7: 設定                   | Config / load_config / ConfigError                     | edge/detector/src/detector/config.py    | UC-7       |
| R8: 差し替え               | FrameSource / Detector（Protocol）                     | edge/detector/src/detector/ports.py     | UC-8       |

## 非機能要件

- [ ] 遅延: 推論 ≤ 100 ms（予算）・目標 ≤ 50 ms を `infer_ms` で毎フレーム測り、超えたら警告に残す（実機の実測は Deferred）
- [ ] 間引き・リサイズ・ログ書き込みは、1 フレームあたり数 ms 以内（numpy の最近傍で 1080p → 480p が 10 ms 未満）
- [ ] プライバシー: 画像を保存・送信しない。ログは項目の許可リスト（seq・t_frame・infer_ms・deer_count・max_conf）だけ
- [ ] ruff（T20・BLE・ANN・S など）と pytest のカバレッジ 70% 以上

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC / 全状態パターンのテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（ruff check・ruff format）
- [ ] edge-latency-reviewer が Critical 0
