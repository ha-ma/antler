---
feature: edge-capture
target_paths:
  - edge/detector/src/detector/capture/
  - edge/detector/src/detector/config.py
  - edge/detector/src/detector/pipeline.py
  - edge/detector/src/detector/l1/runner.py
  - edge/detector/config.example.toml
  - edge/detector/tests/test_capture_
  - apps/api/src/domain/captures/
  - apps/api/src/application/ports/repositories/capture.repository.ts
  - apps/api/src/application/usecases/captures/
  - apps/api/src/infrastructure/repositories/file-capture.repository.ts
  - apps/api/src/infrastructure/http/routes/capture.routes.ts
  - apps/api/src/infrastructure/http/schemas/capture.schema.ts
  - apps/api/src/infrastructure/http/error-mapper.ts
  - apps/api/src/infrastructure/http/app.ts
  - apps/api/src/infrastructure/config/env.ts
  - apps/api/src/di/container.ts
  - apps/pwa/src/features/capture/
  - apps/pwa/src/app/App.tsx
  - apps/pwa/vite.config.ts
  - apps/pwa/.env.example
spec_confirmed_at: 16eb795
tier: 2
---

# 仕様: edge-capture（検知フレームの保存 → 走行後の同意 → 同意済みだけアップロード）

**og-font（2026-11-06）での変更**: OG 画像（`/t/:id/og.png`）は同梱の Noto Sans JP / TC / KR（OFL）で描く（`docs/specs/og-font/functional.md`）。この feature の挙動は変わらない。

## 概要

B2-5（MUST）「検知フレームはローカルに Capture スキーマで保存。走行後に同意のあるものだけアップロード」と、変更指示 B2-9「Capture に L1 の確率を `l1Probs` として保存」を作る。
A と B が同じ `Capture` で教師データを残す（付録 A #5〜7、データループ）。この feature は **B の側の保存と送信**、**api の受け口**、**PWA の走行後の同意画面**を作る。A の「見つけた」（sim）は同じ `POST /api/captures` を呼ぶ予定なので、sim から呼べる形（欄名・CORS・認証なし）にしておくが、sim の画面は作らない。

3 つの部品が **edge → PWA → api** の順につながる。車に回線は無い（B3-1）ので、送るのは回線のあるスマホ:

1. **edge**（`edge/detector/src/detector/capture/`）: 検知した場面の 320 px の画像と `Capture` をローカルのディレクトリに保存する。保存は赤の経路の外（別スレッド、キューが溢れたら捨てる）。同じ車内ネットワークの別ポートに、PWA が一覧・画像・同意・送信済みをやり取りする小さな HTTP を開く（WebSocket サーバーには足さない。pwa-uplink と衝突しない）
2. **api**（`apps/api`）: `POST /api/captures`（multipart）。形・同意・画像の中身を検証して、ファイルに保存する。SQLite の表は足さない（stop-events・loss・record が同時に表を足すため。Repository の口は同じなので、あとで DB に替えられる）
3. **PWA**（`apps/pwa/src/features/capture/`）: 走行後（アプリを開き直したとき）に「前回の走行の検知フレーム N 件」を出し、「提供する（匿名）」（初期 ON）で同意を決め、edge から取って api へ送る。走行中には何も出さない（B4-6）

要件: `docs/requirements/ch4-edge.md` B2-5・B3-3、ch5「データ収集と同意」、ch6「プライバシー」、ch7 の Capture と `POST /api/captures`、`docs/changes/2026-11-03-b-l1-local-jev.md` B2-9。
契約: `@antler/schema` の `CaptureSchema`・`isUploadable`・`L1ProbsSchema`（凍結。変更しない）、docs/specs/edge-camera（`FrameResult`・`format_t_frame`）、docs/specs/edge-judge（`estimate_distance_m`・`side_of`）、docs/specs/edge-l1（`L1Answer`・`run_l1`）。

**deploy-a（2026-11-05）での変更**: `CaptureRepository` に Vercel の実装 `BlobCaptureRepository`（本文と数えは Turso の `captures`、画像は Vercel Blob の非公開のストア。pending で行を取ってから画像を置き done にする。古い pending の判断は `domain/captures/policies/capture-claim-policy.ts`）を足した。ローカルは `FileCaptureRepository` のまま。口・UseCase・応答（201 / 200 / 409 / 503）は変えない。di は Platform から保存先を受ける。env に `TURSO_AUTH_TOKEN` を足した。レート制限の枠の名前は `captures.submit`。詳しくは docs/specs/deploy-a/。

**範囲外**: 実写の画像を `dataset/` に入れること（ch9 ③「学習データ配布の可否確認」は要確認のまま。テストは合成画像だけ）、sim の「見つけた」の画面、`dataset/` への取り込みと学習、ナンバー・顔のぼかし、B2-6 の音声ラベル、`roadSegment` を埋める経路（pwa-uplink）、edge の起動入口（`__main__`。まだ無い）。

**Tier 2 の根拠**: 永続化する形を足す（Capture のファイルと画像）。外部副作用がある（api へのアップロード、LAN に HTTP を開く）。個人情報に近いデータ（道路の画像・位置の区間・時刻）を扱い、同意が要る。認可は無い（匿名）ので、認可の代わりに「同意がなければ送れない」「何も上書きできない」を守る。

## 依存

- edge: 新しい必須の依存は足さない（標準ライブラリと numpy）。JPEG への変換は port（`JpegEncoder`）にし、実体は OpenCV（`pyproject.toml` の `camera` extra に既にある）。テストは偽物のエンコーダと、最小の本物の JPEG のバイト列で確かめる
- api: 追加の npm 依存なし（Hono の `parseBody`・Node の `fs`・`crypto`）。JPEG・PNG の寸法とメタデータは手で読む
- PWA: 追加の npm 依存なし（`fetch`・`FormData`・TanStack Query・`@antler/schema`）

## Example Map

Story: 運転手として、鹿が出た場面の写真を、あとで自分で選んで匿名で提供したい。提供しなくても通知は変わらない。
開発者として、B の検知フレームと A の「見つけた」を同じ形・同じ入口で集めたい。

### edge（保存）

- E1: Capture の組み立て（`build_capture`）
  - `id` = `cap_` + 乱数 12 桁（16 進、`secrets`）。`source` = `vehicle`。`image` = `captures/{id}.jpg`、`imageSize` = 保存した画像の `[幅, 高さ]`
  - 画像 = 640×480（edge-camera の `resize_frame` の後）を、幅 `image_width`（既定 320、160〜640）× 高さ（4:3 で 240）に最近傍で縮める。**フロントガラスの外を向いたカメラの 1 枚だけ**。ほかのカメラ・車内用の経路を持たない
  - `boxes` = その場面で確信度 ≥ `tracker.min_conf`（0.4）の検出、最大 8 つ、`label: deer`・`by: model`。**xywh は左上基準（x, y, 幅, 高さ。0〜1）に変換する**（YOLO の `Detection.xywh` は中心基準。x = cx − w/2 を 0〜1 に収める。edge-camera の Deferred「xywh の基準」はこれで決着。推奨で決定。A の「見つけた」も利用者が囲む左上基準に合わせる）
  - `distanceM` = 最も大きく写った検出（ボックス高さ最大）からの `estimate_distance_m`、`side` = `side_of`（中心 x）
  - `createdAt` = そのフレームの `t_frame`（`format_t_frame`。JST）。`conditions.month`・`season` はそこから（12〜2 冬、3〜5 春、6〜8 夏、9〜11 秋）
  - `conditions.light` = 太陽の高さで決める（`@antler/zones` の `lightPeriod` と同じ式・しきい値: +6° 超 day、−6° 未満 night、その間は午前 dawn・午後 dusk）。場所は固定の道東（北緯 43.0°・東経 144.4°）の近似。edge に GPS は無い
  - edge が知れない欄の既定値（推奨で決定。ラベルの無い欄は嘘の値を入れず、語彙の `unknown` を使う。enum に `unknown` が無い欄だけ次の値）: `weather`・`surface`・`traffic`・`vehicle`・`pose` = `unknown`、`fog` = `none`、`outcome` = `avoided`、`reactionMs` = `null`
  - `roadSegment` = 位置の提供元（`SegmentProvider`。呼ぶと文字列を返す）の値。既定は常に `unknown`。提供元が例外・空・形違い（ハイフン区切りの英数字以外）を返したら `unknown`。**緯度経度を受け取る口を持たない**（pwa-uplink が PWA のゾーンを edge に送るようになったら、ゾーン id を返す提供元を差し込む）
  - `consent` = `false`（同意は走行後に PWA が決める。決める前は送れない）
  - Capture に個人情報のキー（氏名・メール・電話・端末識別子・緯度経度）を持たない。キーは固定で、`build_capture` が足す欄は CaptureSchema の欄だけ
- E2: 何を保存するか（`CaptureRecorder`）
  - 条件: そのフレームの検出のうち、確信度が `trigger_conf`（既定 0.8 = L0 の赤の閾値）以上でボックスの高さが有限で正のものがある。壊れたフレーム（`failed`・全部不正）は対象外。画像の無い `FrameResult` は対象外
  - 間隔: 前に保存してから `min_interval_s`（既定 2 秒。フレームの t_frame で測る）以上。1 回の起動で `max_per_run`（既定 300）まで。赤が続いても 2 秒に 1 枚で、1 回の起動で 300 枚が上限（推奨で決定）。**t_frame が前回より戻った（時計の巻き戻し）ときは間隔の判定をやり直し、その枚を保存の対象にして基準を置き直す**（追いつくまで保存が止まらない）
  - 走行中かどうか（P1）: `offer` はフレームを受け取るたびに（保存しないフレームでも）単調時計の時刻を覚え、`idle_seconds()` が「最後にフレームを受け取ってからの秒」（まだ 1 枚も受け取っていなければ `None`）を返す
  - **赤の経路を遅らせない**: `offer(result)` は判定してよいときだけ、画像の**参照**（pipeline は 1 フレームごとに新しい配列を作るので、あとから書き換えられない）と検出をキューに入れて即戻る（中央値 1 ms 未満）。縮小（整数倍は間引きの切り出し）・JPEG 変換・ディスク書き込みは専用のスレッドで行う。キューは `queue_size`（既定 8）で、溢れたら**捨てて数える**（`capture.dropped`）。例外は外へ出さない
  - 走行ログ: 保存したら `capture.saved`（`id`・`t_frame`・`encode_ms`・`write_ms`・`bytes`）を JSON で残す。失敗は `capture.failed`（理由の型名だけ）、連続 20 回で `capture.degraded`（critical）。画像・Capture の中身はログに出さない
  - 終了: `close()` はキューを最大 2 秒で吐き出し、スレッドを止める
- E3: L1 の確率（B2-9、`l1Probs`）
  - L1 の答えは赤の始まりから 0.4 秒以上あとに届く。`run_l1` に**観察者** `observer(answer, at, fresh)`（答え・単調時計の時刻・新しい答えか）を渡せるようにし、`CaptureRecorder.on_l1_answer` が受ける。**観察者はイベントループの上で呼ばれるので、ディスクに触れない**: 答えの確率を検査してワーカーのキューに積むだけで即戻り、書くのはワーカー（spec-adversary C4）。観察者が例外を出しても `run_l1` の降格・ログは変わらない
  - `fresh = false`（聞いているあいだに赤のエピソードが変わった答え。`run_l1` の `stale`）は使わない（前のエピソードの答えを次の保存に付けない）
  - 保存の**前 1 秒から後 `l1_attach_window_s`（3 秒）まで**に届いた答えを、offer された保存のうち `l1Probs` が無いものに付ける（前を 1 秒に絞るのは、古い答えを先に付けて、あとから来る正しい答えを「一度だけ」の規則で捨てないため。edge-latency-reviewer W2）。答えの確率（**校正前の生の確率**。校正は `calibration.json` であとから当て直せる）を `os.replace` で書き足す（ワーカーが行う。ストアの 1 本のロックの中で、同意・送信済みの更新と競合しない）。まだ保存前（キューの中）のものにも、保存の時点で付ける
  - 形は `L1ProbsSchema`: `alert_level{none,zone,danger}`・`on_roadway`・`static_shoulder`・`false_positive`、すべて有限の 0〜1。外れた答えは付けない（欄ごと省く）。L1 が止まっていれば欄は省く
  - ソフトラベルは「そのときの赤の候補への答え」で、そのフレームのボックスと 1 対 1 ではない（推奨で決定。ソフトラベルは学習側で重みを下げる）
- E4: ローカルの保存（`CaptureStore`）
  - 置き場所は `capture.dir`（設定ファイルのディレクトリからの相対）。`{id}.jpg`・`{id}.json`（CaptureSchema そのもの）・`{id}.uploaded`（空のしるし）。JSON を**最後に**、一時ファイルに書いて `os.replace`（JSON があるものが完成品）
  - ディレクトリは 0700、ファイルは 0600
  - `id` は `^cap_[0-9a-f]{12}$` だけを受ける（パスに使う前に必ず検査。`..` や `/` を通さない）
  - 上限 `max_items`（既定 2000）。超えたら**送信済みのうち古いもの**から、無ければ全体で古いものから消す（`capture.evicted`）。1 枚約 20〜40 KB なので 2000 枚で約 60 MB
  - 壊れた JSON（長さ 0・途中で切れたものを含む）・画像の無い JSON・JSON の無い画像は一覧に出さず、起動時に孤児の一時ファイルと JSON の無い画像を片づける。fsync してから置く（電源断で中身の無い JSON を完成品にしない）
  - 同意の更新（`set_consent(ids, consent)`）: `true` は JSON の `consent` だけを書き換える。送信済みのしるしがあるものは変えない。**`false`（提供しない）は画像・JSON を消す**（推奨で決定。断ったものが次の起動でまた出ない・次の人に出ない。spec-adversary C1）。再び同意を尋ねるのは新しい検知フレームだけ
  - **保持期間** `retention_hours`（既定 24、1〜168）: 起動時と一覧のたびに、`createdAt` からこの時間を過ぎたものを、**送信済みでも**消す（`capture.expired`）。借り手が替わった車に前の画像を残さない（送信済みを残すと、同じ AP の端末が consent・uploaded の順に打って保持期間を迂回できる。security-auditor W2。推奨で決定）
  - 一覧の絞り込み: `pending`（送信済みでないもの）だけを返せる。保存先の `max_per_run`（300）が一覧の上限（200）を超えても、PWA は繰り返し取って全部を扱える
- E5: PWA 向けの HTTP（`CaptureServer`）。別ポート（`capture_server.port`、既定 8767、host は `server.host` と同じ考え方で既定はループバック。車載では AP の LAN のアドレス）
  - `GET /captures?pending=1&limit=200` → `{"items":[{"capture": Capture, "uploaded": bool}], "total": n, "idleSeconds": s | null}`（新しい順。`limit` は既定 200・最大 500。`pending=1` は未送信だけ。`idleSeconds` は P1 の走行中の判定に使う、最後にフレームを受け取ってからの秒で、まだ 1 枚も受け取っていなければ `null`）
  - `GET /captures/{id}/image` → `image/jpeg`
  - `POST /captures/consent` ← `{"consent": bool, "ids": ["cap_…", …]}`（ids は 1〜200 件）→ `{"updated": n}`（`consent:false` は E4 のとおり消した件数）
  - `POST /captures/uploaded` ← `{"ids": [...]}` → `{"updated": n}`（送信済みのしるしを付ける。同意のあるものだけ）
  - それ以外のパスは 404、メソッド違いは 405。POST の本文は 8 KB まで・`Content-Type: application/json` だけ（それ以外は 415）。同時の接続は 8 まで（超えたら 503）。読み書き 1 回ごとに 5 秒で打ち切る（1 バイトずつ送り続けて枠を握り続けられる点は、車内 WPA2 の LAN が前提なので許容する。edge-capture のレビュー W10）。接続は保たない（`Connection: close`）。一覧はメモリの索引から返し、ディスクを走査しない（走行中でも検知を邪魔しない）
  - **Host の検査（DNS rebinding）**: `Host` ヘッダのホスト名が **IP アドレスのリテラル・`localhost`・`ezoroad.local`** のどれかでなければ 421（外部のページが自分のドメインを車内の IP に向けても読めない）。ポートは見ない（spec-adversary W1）
  - **ブラウザの別サイトから叩かれない**: `Origin` ヘッダがあるリクエストは、次のどちらかのときだけ許す: (a) `capture_server.allowed_origins` に載っている、(b) **オリジンのホスト名が `Host` のホスト名と同じ**（PWA を同じ機器の別ポートで配信するとき。既定の空の許可リストでも動く）。許したときだけ `Access-Control-Allow-Origin`（そのオリジンを返す）と `Vary: Origin` を付ける。許さない Origin（`null` を含む）の POST は 403。`Origin` が無い（ブラウザ以外）リクエストは通す。GET は許さない Origin に CORS ヘッダを付けない（ブラウザは中身を読めない。画像の `<img>` 表示は CORS の対象外）
  - **OPTIONS（preflight）**: 許す Origin には 204 と `Access-Control-Allow-Methods: GET, POST`・`Access-Control-Allow-Headers: Content-Type`・`Access-Control-Max-Age: 600`。許さない Origin には 403。Chrome の Private Network Access のために `Access-Control-Allow-Private-Network: true` を許す Origin にだけ返す
  - 応答にファイルのパス・内部のエラー文を出さない。ログは `capture.http`（メソッド・パスの型・status・所要 ms）だけ
- E6: つなぎ（`CaptureService`）
  - `CaptureService.from_config(config, now, encoder)` が store・recorder・server を組み立てる。`wrap(results)` は結果のイテレータを包み、**結果を先に下流へ渡してから** `offer` を呼ぶ（赤の判定の後。例外は握りつぶして記録）。`offer` は次のフレームを要求されたときに走るので、入力が尽きる・閉じられる直前の最後の 1 枚は offer されないことがある（許容する）。`on_l1_answer` を `start_l1(..., observer=...)` に渡す。`close()` で全部止める
  - `capture.enabled = false` なら何も作らない（`from_config` は `None`）
  - `FrameResult` に `image`（縮小後の 640×480、`np.ndarray | None`、既定 `None`、比較・repr から外す）を足す。`process_frames` が成功したフレームに付ける
  - edge の起動入口（`__main__`）はまだ無いので、この feature は「つなげる部品」までを作る（Deferred）

### api（受け口）

- A1: `POST /api/captures`（multipart/form-data）。欄名は固定（sim からも同じ）
  - `capture`: Capture の JSON 文字列（8 KB まで）。`CaptureSchema`（strict。知らない欄は拒否）に通す
  - `image`: JPEG か PNG のファイル（512 KiB まで。320 px の JPEG は数十 KB、sim の 1280×720 の JPEG は 100〜300 KB）。全体の本文は 640 KiB まで（超えたら 413）
  - IP あたり 1 分 60 件（バッチで送るため trips より緩い）。認証なし（登録なし。#9）
- A2: 検証の順（最初に外れたもので止める。画像の保存は最後）
  1. 本文の大きさ → 2. `capture`・`image` が揃っている → 3. JSON が読める → 4. `CaptureSchema`（400 `INVALID_INPUT`、欄名つき）→ 5. **`consent` が `true`**（`isUploadable`。false は 422 `CONSENT_REQUIRED`。保存しない）→ 6. 画像（下の A3）→ 7. 同じ `id` の扱い（A4）→ 8. 空き（A5）→ 9. 保存
- A3: 画像の検証（`domain/captures/rules/capture-image.ts`。純粋な関数）
  - 先頭のバイト列で JPEG（`FF D8 FF`）か PNG（`89 50 4E 47 0D 0A 1A 0A`）。**ファイル名・Content-Type は信用しない**
  - 寸法（JPEG は SOF、PNG は IHDR）が Capture の `imageSize` と等しい。違えば 400 `INVALID_IMAGE`。**寸法は 16〜2048 px**（巨大な画像で取り込み側を詰まらせない。sim の 1280×720 は通る）
  - **メタデータを持つ画像は受けない**: JPEG は APP0 が **`JFIF\0` の 1 つだけ**で、サムネイルが 0×0（JFXX・別の APP0 は拒否）、APP1〜APP15 と COM は 1 つでもあれば拒否。PNG は `IHDR PLTE IDAT IEND tRNS gAMA cHRM sRGB sBIT bKGD pHYs` 以外のチャンク（`eXIf`・`tEXt`・`zTXt`・`iTXt`・`tIME`・`iCCP` など）があれば拒否
  - **構造の厳密さ**: JPEG は SOI で始まり EOI で終わり、**EOI の後ろに 1 バイトも付けない**。PNG は IEND の後ろに付けない。PNG はチャンクの CRC は見ないが、チャンクの長さが本文を超えるものは拒否。途中で切れた・SOF や IHDR が無い画像も拒否（例外ではなく結果として返す）
- A4: 同じ `id` の再送（冪等）
  - 保存したのは「サーバーが決めた形」: 論理の `capture.image` = `captures/{id}.{jpg|png}`（クライアントが送った `image` のパスは**使わない**。応答・保存する JSON・`dataset/` が見る値はこれ）、`consent: true`。本文のハッシュ = sha256(キーを辞書順に並べた Capture の JSON（サーバーが置き換えた `image` を含む）+ `\n` + 画像の sha256)
  - 既に同じ `id` があり、ハッシュが同じ → 200 と `Idempotent-Replayed: true`（保存し直さない）。ハッシュが違う → 409 `CAPTURE_CONFLICT`（**既存を上書きしない**）
  - 同時に同じ `id` が来たら、片方だけが保存し（JSON のハードリンクによる作成。存在すれば失敗）、もう片方は 409 か 200
  - `id` は HTTP の層で **40 文字まで**（ファイル名の上限を超えない。凍結の CaptureSchema は変えない）。ファイル名のキーは `id` を小文字にしたもの（大文字小文字を区別しないファイルシステムで `cap_A` と `cap_a` が別物にならない。衝突したら本文のハッシュで 200 か 409）
- A5: 空き。保存件数が `CAPTURES_MAX_ITEMS`（既定 50,000）以上、または保存した画像の合計が `CAPTURES_MAX_BYTES`（既定 5 GiB）以上なら 503 `STORE_FULL`（件数だけでは画像 1 MB × 50,000 でディスクが先に尽きる）
- A6: 保存先。`CAPTURES_DIR`（既定 `./data/captures-received`）。`{key}.json`（`{capture, file, bodyHash, receivedAt}`。`capture.image` は論理のパス）と画像の実ファイル `{key}-{sha256 先頭12桁}.{jpg|png}`（`file` がその名前。同じ `id` で中身が違う競合の画像を取り違えない）。`key` は `id` の小文字で、`^cap_[a-z0-9]+$` をパスに使う前に検査。**読み出しの API は作らない**（取り込みは `dataset/` がファイルを直接読む。IDOR の面を作らない）
- A7: 応答。201 `{"id", "image"}`（`image` は論理のパス）。エラーは既存の `{error:{code,message}}`。ログには `id`・`source`・画像の大きさ・status だけ（Capture の本文・roadSegment・画像は出さない）
- A8: CORS は既存の `CORS_ORIGINS`（PWA・sim のオリジンを入れる）。multipart は単純リクエストなので追加の許可ヘッダは要らない
- A9: multipart の読み方。`capture` は**文字列**（ファイルで来たら 400）、`image` は**ファイル**（文字列で来たら 400）。同じ名前の欄が 2 つ以上あれば 400。ほかの欄は無視する（保存しない）

### PWA（走行後の同意）

- P1: 入口。`App.tsx` が `CaptureGate`（`features/capture` の barrel）を `ConnectFlow` の**上に重ねる**。`features/connect` は変えない（pwa-uplink の担当）
  - 起動の直後に 1 回だけ edge の `GET /captures?pending=1` を取る（TanStack Query、リトライなし、3 秒で打ち切り）。次の**すべて**を満たすときだけ重ねる: (a) 3 秒以内に取れた、(b) 未送信が 1 件以上、(c) **`idleSeconds` が `null` か 60 秒以上**（edge がフレームを処理している間 = 走行中は重ねない。走行中の再読み込みで赤の画面を隠さない。B4-6。spec-adversary C2）。遅れて届いても出さない。edge につながらなければ何も出ない
  - 重ねた画面を閉じると B-0 が見える。B-0 から出発したあとは二度と出ない（再読み込みまで）
  - エンジンを切ると edge の電源が落ちる場合は、次に edge が起動したあと（古い分は `retention_hours` で消える）に重なる。edge が動いたまま止まらない間は重ならない（暫定。Deferred）
- P2: 画面（night テーマ。4 言語。主文は端末の言語、残りは `CAPTURE_TEXT` の表から。表の欠けは検査で止める）
  - 見出し「未送信の検知フレーム N 件」（N は取れた未送信の件数 `total`）、説明（匿名・画像に写る道路のようすだけで車内は写さない・位置は区間に丸める・提供しなくても通知は変わらない・**「提供しない」を選ぶとこの機器からも消える**）、サムネイル最大 6 枚（edge の画像 URL を `<img>` で。何に同意するかを見せる）、チェック「提供する（匿名）」（**初期 ON**）、主ボタン、副ボタン「あとで」（何も変えずに閉じる。次に開いたとき、保持期間の中ならまた出る）
  - 主ボタン: チェック ON のとき「送る」、OFF のとき「提供しない」。タッチターゲット 44 px 以上、`aria-label` あり、絵文字なし（アイコンはインライン SVG）、色は tokens の変数だけ
  - チェックを外しても通知・接続の機能は制限しない（何も変わらない）
- P3: 送る手順（1 件ずつ順番に。同時 1）0. 未送信が 200 件を超えるときは、200 件ずつの「ページ」を繰り返す（`GET /captures?pending=1&limit=200` を、取れなくなるまで。1 回の起動の上限は 300 枚）。扱ったものは送信済みか削除になって未送信から消えるので、同じものを二度扱わない。失敗して残ったものは、このセッションの失敗の id として覚えて飛ばす
  1. `POST edge /captures/consent {consent, ids}`（OFF なら、edge がそのページを消して終わり。api へは何も送らない）。**この POST が成功しなければ api へ何も送らない**。成功したら同じ条件で一覧を取り直し、`capture.consent === true` のものだけを送る対象にする
  2. ON のとき、各 Capture について: `isUploadable(capture)` を確かめる（`@antler/schema`。同意のあるものだけ）→ edge の画像を blob で取る → `FormData`（`capture` = JSON、`image` = blob）→ `POST {api}/api/captures`（`credentials: 'omit'`・`referrerPolicy: 'no-referrer'`）
  3. 201 か 200 のとき `POST edge /captures/uploaded {ids:[id]}`。進み具合「n / N」を出す
  4. 失敗の扱い:
     - **ネットワークの失敗・5xx**: そこで止めて「回線がつながったら、もう一度送ってください」を出す（残りは未送信のまま）
     - **429**: `Retry-After` の秒（最大 65 秒）だけ待って同じ 1 件をもう一度送る。それでも 429 なら止めて「混み合っています。しばらくしてからもう一度」を出す（回線のせいではないと分かる文言。1 分 60 件の上限は IP ごとなので、携帯回線の共有でも起きる）
     - **409・422・413・400 `INVALID_INPUT`（再送しても直らない）**: その 1 件を失敗に数え、edge に `consent:false`（= 削除）を送って未送信から外し、続ける
     - **それ以外の status（404・405 など。送り先の設定違い）**: 止めて「送り先に届きませんでした」を出す（全件を失敗にしない）
  5. 全部終わったら「N 件を提供しました（失敗 M 件）」と閉じるボタン
- P4: 送るもの・送らないもの。送るのは Capture の JSON と画像だけ。端末の位置・識別子・クッキー・Referer を付けない。api の URL は `VITE_API_BASE_URL`（**必須**。本番の PWA は Mac mini の静的配信で `/api` が無いので、同じオリジンへの代わりは作らない。無ければ画面を出さない = `CaptureGate` は何も描かない）、edge の URL は WebSocket と同じホストの `capture_server.port`（8767。`?edge=host[:port]` の host だけを使う開発用の上書きは今の `resolveEdgeUrl` に合わせる）
  - **CSP（本番ビルド）**: `apps/pwa/vite.config.ts` の CSP に、`connect-src` と `img-src` へ edge の `http://ezoroad.local:8767`、`connect-src` へ `VITE_API_BASE_URL` のオリジンを足す（pwa-connect の「CSP を変えない」を、この feature で必要な 2 か所の追加に限って改める。spec-adversary C3）。`VITE_API_BASE_URL` が無ければ api の追加はしない。`apps/pwa/.env.example` に見本を足す
    - **2026-11-06 pwa-https R5 で改めた**: edge の URL は WebSocket と同じく、ページのホスト（`VITE_EDGE_HOSTS` にあるとき）か一覧の先頭の 8767。ページが https なら `https://`。CSP の `connect-src`・`img-src` には一覧の各ホストの `https://h:8767` と `http://h:8767` が入る（既定のビルドでは `ezoroad.local` の 2 つ）。`[tls]` を設定すると CaptureServer は https で待ち受ける（握手は枠を取ったあと、枠が溢れたら握手せずに閉じる）。途中で切れた接続のエラーは型の名前だけを `capture.request_failed`（debug）に残し、接続元のアドレスを stderr に出さない
- P5: sim から呼べる形。`features/capture/lib/upload.ts` の `uploadCapture({baseUrl, capture, image, fetch})` は PWA にも sim にも依存しない純粋な関数（`fetch` を渡す）。欄名と応答の読み方はここだけ。sim が使うときに共有パッケージへ移す（Deferred）

## エラーパターン（api）

| 状況                                                                 | HTTP | code                                |
| -------------------------------------------------------------------- | ---- | ----------------------------------- |
| 本文が大きすぎる                                                     | 413  | `INVALID_INPUT`                     |
| `capture`・`image` が無い、JSON が読めない、スキーマ違反、知らない欄 | 400  | `INVALID_INPUT`                     |
| `consent` が false                                                   | 422  | `CONSENT_REQUIRED`                  |
| 画像が JPEG/PNG でない、寸法が違う、メタデータがある、壊れている     | 400  | `INVALID_IMAGE`                     |
| 同じ `id` で中身が違う                                               | 409  | `CAPTURE_CONFLICT`                  |
| 保存件数の上限                                                       | 503  | `STORE_FULL`                        |
| 1 分 60 件を超えた                                                   | 429  | `RATE_LIMITED`（既存の middleware） |

## ユースケース

### UC-1: Capture の組み立て（E1）

- **Given**: 検出つきのフレームと提供元
- **When**: `build_capture`
- **Then**: CaptureSchema の JSON Schema に通る。xywh は左上基準。知れない欄は既定値。個人情報・緯度経度のキーが無い

### UC-2: 光の区分（E1）

- **Given**: JST の時刻
- **When**: `light_period`
- **Then**: `@antler/zones` と同じしきい値で dawn・day・dusk・night

### UC-3: 何を保存するか（E2）

- **Given**: 検出つきの FrameResult の列
- **When**: `offer`
- **Then**: 条件・間隔・上限どおりに保存し、キューが溢れたら捨てて数える。`offer` は待たない

### UC-4: L1 の確率（E3）

- **Given**: 保存済み・保存前の Capture と L1 の答え
- **When**: `on_l1_answer`
- **Then**: 3 秒以内のものに `l1Probs`（校正前の生の値）が付く。外れた値は付けない

### UC-5: ローカルの保存（E4）

- **Given**: 画像と Capture
- **When**: `save`・`list`・`set_consent`・`mark_uploaded`・`evict`
- **Then**: 完成品だけが見え、id の検査・権限・上限のとおり

### UC-6: PWA 向けの HTTP（E5）

- **Given**: 保存済みの Capture
- **When**: 一覧・画像・同意・送信済み
- **Then**: 仕様どおりの JSON とバイト列。Origin・本文・同時接続の制限

### UC-7: つなぎと設定（E6）

- **Given**: 設定と結果のイテレータ
- **When**: `from_config`・`wrap`・`load_config`
- **Then**: 結果は先に下流へ渡る。無効なら何も作らない。設定の範囲外は拒否

### UC-8: POST /api/captures（A1〜A8）

- **Given**: multipart の Capture と画像
- **When**: POST
- **Then**: 検証の順どおりに 201 / 200 / 4xx / 503

### UC-9: 画像の検証（A3）

- **Given**: バイト列
- **When**: `inspectCaptureImage`
- **Then**: 形式・寸法・メタデータの有無

### UC-10: 走行後の同意と送信（P1〜P5）

- **Given**: edge の一覧
- **When**: 画面を開く・チェック・送る
- **Then**: 同意した分だけ api へ。失敗は未送信のまま残る

## 状態パターン

### S-1: 回線が無い

- **Given**: edge には届くが api に届かない → **When**: 送る → **Then**: 同意は edge に残り、送信済みのしるしは付かない。次に開いたとき続きから

### S-2: edge が見つからない

- **Given**: edge に届かない（家に着いたあと等）→ **When**: 起動 → **Then**: 何も重ねない。B-0 は今までどおり

### S-3: 保存の失敗が続く

- **Given**: ディスクが満杯・書けない → **When**: 保存 → **Then**: `capture.failed` を記録し、検知（赤）は止まらない。20 回続けば `capture.degraded`

## 非機能要件

- [x] 赤の経路: `offer` の追加の遅延は 1 フレームあたり 1 ms 未満（縮小のコピーだけ）。JPEG 変換・書き込みは別スレッド。キューが溢れても赤は遅れない
- [x] 個人情報: Capture と api のログに氏名・メール・電話・端末識別子・緯度経度が出ない。位置は `roadSegment` だけ。車内を写すカメラの経路が無い
- [x] 同意: `consent: false` の Capture は PWA から api に送られず、api も受けない（二重の確認）
- [x] 画像: 1 枚 512 KiB 以下（320 px の JPEG は約 20〜40 KB）。メタデータを持つ画像を保存しない
- [x] 決定性: `id`・時刻・乱数・エンコーダは注入できる（テストで同じ結果になる）
- [x] 保存の上限: edge は `max_items`（2000）、api は `CAPTURES_MAX_ITEMS`（50,000）
- [x] 依存を足さない（edge: numpy と標準ライブラリ、api と PWA: npm の追加なし）
- [x] edge の ruff（print 禁止・Any 禁止・秘密の直書き禁止）と pytest のカバレッジ 70% 以上。api・PWA の lint・typecheck・カバレッジ 70% 以上
- [x] 色は tokens の変数だけ、絵文字なし、アイコンはインライン SVG、4 言語が欠けない

## Questions（Deferred のみ残存可）

決着済み（2026-11-04、すべて推奨で決定。PR にも書く）:

- 画像の運び方 → edge の別ポートの HTTP で PWA が取り、PWA が api に送る。WebSocket には足さない（pwa-uplink と衝突させない）
- `xywh` の基準 → Capture は左上基準、edge が変換する（edge-camera の Deferred を回収）
- api の保存先 → ファイル（Repository の口は同じ）。SQLite の表を足さない（stop-events・loss・record と衝突させない）
- 同意の初期値 → ON（ch5）。edge に保存する時点の `consent` は false（決める前は送れない）
- 保存の頻度 → 赤の閾値以上のフレームを 2 秒に 1 枚まで、1 起動で 300 枚まで
- PWA の入口 → 起動直後に重ねる画面（走行中は出ない）。`features/connect` は変えない
- 区間（`roadSegment`）→ edge は `unknown`、提供元の口だけ置く
- L1 の確率 → 校正前の生の値を 3 秒以内の保存に付ける
- 「提供しない」「恒久的に送れない」の扱い（spec-adversary C1）→ edge から消す。毎回の起動で出続けない・次の人に出さない。未送信は 24 時間（`retention_hours`）で消える
- 走行中に画面が出る（C2）→ `idleSeconds`（最後のフレームから 60 秒）が空いているときだけ重ねる
- 本番の通信が CSP で止まる（C3）→ `vite.config.ts` の CSP に edge の 8767 と api のオリジンを足す。`VITE_API_BASE_URL` を必須にし、同じオリジンへの代わりを作らない。`allowed_origins` が空でも、Host と同じホスト名のオリジンは許す
- `l1Probs` の書き足しがイベントループを塞ぐ（C4）→ 観察者はキューに積むだけ、書くのはワーカー。`fresh` でない答えは使わない
- DNS rebinding（W1）→ Host のホスト名を IP リテラル・`localhost`・`ezoroad.local` に限る
- api の画像の名前（W3）→ 論理の `image` は `captures/{id}.{ext}`、実ファイルは `{key}-{sha 先頭12桁}.{ext}`（JSON の `file` が指す）
- 429（W6）→ `Retry-After` で待ってもう一度。それでも 429 なら「混み合っています」を出す

- [Deferred: 担当=人 B / 期日=2026-11-06（Day 4 の調査走行）/ 暫定挙動=edge が動いたまま止まらない間（停車後も電源が入っている）は、走行後の画面が出ない。次に edge が起動したあと、または手でフレームの処理を止めたあとに出る。PWA が走行中に画像を端末へ取り込み（IndexedDB）、edge から離れた家の回線で送る設計は、この feature では作らない] 走行後の送信の経路（C2 の別案）
- [Deferred: 担当=ユーザー（ch9 ③ の確認と同時）/ 期日=未定 / 暫定挙動=api は受けたファイルを自動で消さない。運用者が `CAPTURES_DIR` を管理する。「同意の取り消し」（送ったあとに消す）は匿名で本人を特定できないので作らない] api に保存した画像の保持期間と取り消し
- [Deferred: 担当=人 B（pwa-uplink）/ 期日=2026-11-06 / 暫定挙動=`roadSegment` は常に `unknown`。`SegmentProvider` の口があるので、PWA のゾーンを edge が受け取れるようになったらゾーン id を返す提供元を差し込む] 位置の区間を Capture に入れる
- [Deferred: 担当=人 B / 期日=2026-11-06 / 暫定挙動=この feature は `CaptureService` までを作る。`pump` を呼ぶ入口（`__main__`）が無いので、起動の配線は入口を作る feature で行う] edge の起動入口への配線
- [Deferred: 担当=人 B / 期日=2026-11-06（Day 4 の調査走行）/ 暫定挙動=画像はそのまま保存する。ナンバー・顔のぼかしはしない。ボンネット・ダッシュボードのマスクもしない。提供するかどうかは利用者が走行後に画像を見て決める（サムネイルが見える）] 画像の中の第三者の情報
- [Deferred: 担当=人 A（sim の「見つけた」）/ 期日=2026-11-06 / 暫定挙動=`uploadCapture` は PWA の `features/capture/lib/upload.ts` にある。sim が使うときに共有パッケージ（または sim 側のコピー）へ移す] sim からの呼び出し
- [Deferred: 担当=人 B / 期日=2026-11-06 / 暫定挙動=`outcome` は `avoided`、`fog`・`weather` などは既定値。B2-6（音声「いた」「いない」）の `label` が入るまで、ラベルとして使わない] 誤検知・見逃しのラベル
- [Deferred: 担当=ユーザー（ch9 ③「学習データ配布の可否確認」）/ 期日=未定 / 暫定挙動=api が受けたファイルを `dataset/` に入れない。取り込みの feature を作らない。実写の画像は `dataset/` に入れない] 学習データとしての配布

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 合成のフレーム（検出つき）を `CaptureService` に流すと、Capture と 320 px の JPEG が保存され、`GET /captures` に出て、画像が取れ、同意を付けると `consent: true` になり、送信済みにすると一覧の `uploaded` が true になる。赤の判定の結果は保存の有無・失敗に影響されない
- [x] AC-2: api に multipart の Capture と画像を POST すると 201 でファイルに保存され、同じものの再送は 200（Idempotent-Replayed）、同じ id で中身が違えば 409、`consent: false` は 422 で何も保存されない
- [x] AC-3: PWA に偽の edge（2 件、うち 1 件は consent 後に送れない状態）と偽の api を渡すと、重ねた画面に件数・チェック（ON）・サムネイルが出て、「送る」で同意した分だけが api に multipart で届き、edge の送信済みが更新され、回線切れでは未送信のまま「もう一度」が出る

UC-1 Capture の組み立て:

- [x] CAP-1a: 検出つきのフレームから作った Capture が `packages/schema/json/capture.schema.json` に通る（`l1Probs` あり・なしの両方）
- [x] CAP-1b: `xywh` は中心基準から左上基準に変わり、0〜1 に収まる（端にはみ出す検出も）
- [x] CAP-1c: `distanceM` と `side` は最も大きい検出から。検出が 9 件以上でも `boxes` は 8 件まで
- [x] CAP-1d: 知れない欄の既定値（weather・surface・traffic・vehicle・pose は `unknown`、fog は `none`、outcome は `avoided`、reactionMs は null）、`consent` は false、`source` は `vehicle`
- [x] CAP-1e: `roadSegment` は提供元の値。例外・空・座標のような文字列（`43.1,144.3`）・形違いは `unknown`
- [x] CAP-1f: キーに個人情報・緯度経度が無い（キーの集合が CaptureSchema の欄と一致）
- [x] CAP-1g: `id` は `cap_` + 16 進 12 桁で、乱数の差し込みで決定的
- [x] CAP-1h: `createdAt` は `t_frame` の JST、`month`・`season` はそこから（12 月と 2 月は冬、3 月は春）

UC-2 光の区分:

- [x] LIGHT-1a: 2 月の道東で 6:30 は dawn、7:30 と 12:00 は day、16:30 は dusk、20:00 は night
- [x] LIGHT-1c: [ADDED] タイムゾーンが違っても同じ瞬間なら同じ区分
- [x] LIGHT-1d: [ADDED] タイムゾーン無しの日時は拒否する
- [x] LIGHT-1b: `@antler/zones` の `lightPeriod` と同じ値（固定の日時 8 点を TS の実行結果と同じ値で確かめる。6 月の 4:00 は dawn、19:00 は dusk、12 月の 15:30 は dusk・17:30 は night など）

UC-3 何を保存するか:

- [x] REC-1a: 確信度 0.8 以上の検出があるフレームは保存の対象、0.79 以下・検出なし・`failed`・全部不正・画像なしは対象外
- [x] REC-1b: 2 秒未満の間隔の 2 枚目は保存しない（t_frame で測る）。2 秒ちょうどは保存する
- [x] REC-1c: `max_per_run` に達したら保存しない（ログに 1 回）
- [x] REC-1d: キューが満杯なら捨てて数える（`capture.dropped`）。`offer` は待たない（書き込みが止まったエンコーダでも即戻る）
- [x] REC-1e: ワーカーが例外を出しても次を処理する。20 回連続で `capture.degraded`、成功で回復
- [x] REC-1f: 保存したあとの JPEG の幅が `image_width`、高さが 4:3、`imageSize` と一致する
- [x] REC-1g: `close()` はキューを吐き出してから止まる。2 回呼んでも壊れない
- [x] REC-1i: t_frame が前回より戻ったら（時計の巻き戻し）、その枚を保存して基準を置き直す。追いつくまで止まらない
- [x] REC-1j: `idle_seconds()` はフレームを受け取るたび（保存しなくても）0 に戻り、1 枚も受け取っていなければ `None`
- [x] REC-1l: [ADDED] `offer` の同期の仕事は中央値 1 ms 未満（縮小と変換はワーカー。edge-latency-reviewer W1）
- [x] REC-1k: [ADDED] id が衝突したら（すでに同じ id の Capture がある）作り直して保存する
- [x] REC-1h: ログに `capture.saved`（id・t_frame・encode_ms・write_ms）が出て、画像・Capture の中身は出ない

UC-4 L1 の確率:

- [x] L1P-1a: 答えの前後 3 秒以内に offer された保存（保存前・保存済み）に `l1Probs` が付き、`CaptureSchema`（L1ProbsSchema）に通る
- [x] L1P-1b: 3 秒より離れた保存には付けない。すでに `l1Probs` があるものは書き換えない
- [x] L1P-1c: NaN・無限大・範囲外を含む答えは付けない
- [x] L1P-1d: 付けた値は校正前の生の確率（校正を当てた値ではない）
- [x] L1P-1e: `run_l1` の観察者が答えごとに呼ばれ、観察者が例外を出しても L1 の動作（降格・ログ）は変わらない。観察者なしの動作は今までと同じ
- [x] L1P-1f: `fresh = false`（エピソードが変わった答え）は使わない。観察者（`on_l1_answer`）はディスクに触れずに戻る（書き込みが止まったストアでも即戻る）

UC-5 ローカルの保存:

- [x] STO-1a: 保存すると `{id}.jpg`・`{id}.json` ができ、JSON が最後。一覧は JSON のあるものだけ。権限が 0700/0600
- [x] STO-1b: `id` が `..`・`/`・大文字・長さ違いなら拒否（パスに使わない）
- [x] STO-1c: 壊れた JSON・画像の無い JSON・JSON の無い画像は一覧に出ない。起動時に孤児の一時ファイルと JSON の無い画像を消す
- [x] STO-1d: `set_consent(true)` は送信済みのものを変えない。存在しない id は数えない
- [x] STO-1i: `set_consent(false)` は未送信の画像・JSON を消す（一覧・画像の取得から消える）。送信済みは消さない
- [x] STO-1j: 保持期間（`retention_hours`）を過ぎた未送信は起動時と一覧のたびに消え、送信済みと期間内のものは残る
- [x] STO-1h: [ADDED] 同じ id は二度保存できない（`StoreError`）
- [x] STO-1k: 長さ 0・途中で切れた JSON は一覧に出ない。`pending` の絞り込みは未送信だけを返す
- [x] STO-1e: `max_items` を超えると送信済みの古いものから消え、無ければ古いものから消える
- [x] STO-1f: 書き込みの途中で失敗しても、JSON ができない（完成品に見えない）。一時ファイルを残さない
- [x] STO-1g: `l1Probs` の書き足しが `os.replace` で原子的（読み手が途中の JSON を見ない）

UC-6 HTTP:

- [x] HTTP-1a: `GET /captures` が新しい順で、`uploaded` を含み、最大 200 件・`total` つき
- [x] HTTP-1b: `GET /captures/{id}/image` が `image/jpeg` でバイト列を返す。不正な id・存在しない id は 404（パスを返さない）
- [x] HTTP-1c: `POST /captures/consent` と `POST /captures/uploaded` の本文の検証（ids 0 件・201 件・不正な id・型違い → 400、JSON 以外の Content-Type → 415、8 KB 超 → 413）
- [x] HTTP-1d: Origin: 許可リストにあるオリジンは ACAO と preflight（OPTIONS）が返る。無いオリジンの POST は 403、GET は CORS ヘッダ無し。Origin 無しは通る
- [x] HTTP-1e: 同時接続が 8 を超えたら 503。遅い接続は 5 秒で切れる
- [x] HTTP-1f: 未知のパス 404、メソッド違い 405。応答にファイルパス・例外文が無い
- [x] HTTP-1g: 実際にソケットで待ち受けて（`port=0`）、標準の HTTP クライアントで一覧が取れる
- [x] HTTP-1h: `Host` が IP リテラル・`localhost`・`ezoroad.local` 以外（`evil.example`）なら 421。ポートは見ない
- [x] HTTP-1i: `allowed_origins` が空でも、`Host` と同じホスト名のオリジン（別ポート）は許す。`Origin: null`・別ホストは 403。許したときだけ ACAO と `Vary: Origin`
- [x] HTTP-1j: OPTIONS（preflight）は許す Origin に 204 と許可ヘッダ、許さない Origin に 403
- [x] HTTP-1k: `GET /captures?pending=1&limit=N` は未送信だけ、`limit` は最大 500、`idleSeconds` を含む。`POST /captures/consent {consent:false}` は消した件数を返す

UC-7 つなぎと設定:

- [x] WIRE-1a: `wrap(results)` は結果をそのままの順で返し、`offer` は結果を返した**あと**に呼ばれる。`offer` が例外でもイテレータは続く
- [x] WIRE-1b: `capture.enabled = false` で `from_config` は `None`
- [x] WIRE-1c: `process_frames` が成功したフレームの `FrameResult.image` に 640×480 を付ける。失敗したフレームは付けない。`FrameResult` の等しさは画像に影響されない
- [x] CFG-1a: `[capture]`・`[capture_server]` の既定値と範囲（image_width 160〜640、jpeg_quality 50〜95、trigger_conf 0.4〜1、min_interval_s 0.5〜60、max_per_run 1〜10000、max_items 10〜20000、queue_size 1〜64、port 1〜65535）。外れたら `ConfigError`
- [x] CFG-1b: `capture_server.allowed_origins` は `http(s)://host[:port]` の形だけ（`*`・パス付き・空文字は拒否）
- [x] CFG-1c: `capture.trigger_conf` は `tracker.min_conf` 以上にする。`config.example.toml` に両セクションがある
- [x] CFG-1d: `capture.retention_hours` は 1〜168（既定 24）

UC-8 POST /api/captures:

- [x] API-1a: 正しい multipart（JPEG・sim と vehicle の 2 つ）が 201 で、`{id, image}`。ファイルが保存される（JSON の `image` はサーバーが決めたパス）
- [x] API-1b: 同じものの再送は 200 と `Idempotent-Replayed: true`。保存は 1 つのまま
- [x] API-1c: 同じ `id` で中身（Capture か画像）が違えば 409 `CAPTURE_CONFLICT`。既存のファイルは変わらない
- [x] API-1d: `consent: false` は 422 `CONSENT_REQUIRED`。何も保存されない
- [x] API-1e: `capture` が無い・`image` が無い・JSON でない・スキーマ違反・知らない欄（`email`・`lat`）は 400 `INVALID_INPUT`
- [x] API-1f: クライアントの `image` のパス（`/etc/passwd`・`../x.jpg`）は使われず、サーバーが決めたパスで保存される（`image` の形が合わなければスキーマで 400）
- [x] API-1g: 本文が 640 KiB を超えたら 413、画像が 512 KiB を超えたら 400 `INVALID_IMAGE`。`capture` が 8 KB を超えたら 400
- [x] API-1h: 1 分 60 件を超えたら 429
- [x] API-1i: 保存件数が上限なら 503 `STORE_FULL`。上限の判定は件数の数え直しなしでも正しい（保存のたびに増える）
- [x] API-1j: 同じ `id` の同時の 2 リクエストで、保存されるのは片方だけ（もう片方は 200 か 409）
- [x] API-1k: ログに Capture の本文・roadSegment・画像が出ない（`id`・`source`・大きさ・status だけ）
- [x] API-1l: CORS: 許可したオリジンに ACAO が返る
- [x] API-1m: `id` が 41 文字以上は 400。`cap_A` と `cap_a` は同じ key（同じ本文なら 200、違えば 409）
- [x] API-1n: `capture` がファイルで来る・`image` が文字列で来る・同じ名前の欄が 2 つ → 400。ほかの欄は無視される
- [x] API-1o: 画像の合計が `CAPTURES_MAX_BYTES` を超えたら 503。実ファイル名は `{key}-{sha 先頭12桁}.{ext}`、JSON の `file` がそれを指し、`capture.image` は論理のパス

UC-9 画像の検証:

- [x] IMG-1a: 最小の JPEG（JFIF）と PNG の寸法を読める
- [x] IMG-1b: 先頭のバイトが JPEG/PNG でない（ファイル名や Content-Type が jpg でも）→ 拒否
- [x] IMG-1c: 寸法が `imageSize` と違う → 拒否
- [x] IMG-1d: JPEG に Exif（APP1）・XMP・コメント（COM）→ 拒否。PNG に `eXIf`・`tEXt`・`iTXt`・`tIME` → 拒否。JFIF（APP0）だけ・PNG の許可チャンクだけは通る
- [x] IMG-1e: 途中で切れた・SOF が無い・IHDR が無い・チャンク長が本文を超える → 拒否（例外ではなく結果として）
- [x] IMG-1f: EOI（`FF D9`）・IEND の後ろに 1 バイトでも付いている画像、JFXX や 2 つ目の APP0、0×0 でない JFIF のサムネイルは拒否。寸法が 16 未満・2048 超は拒否

UC-10 PWA:

- [x] GATE-1a: 3 秒以内に未送信が 1 件以上取れ、`idleSeconds` が `null` か 60 秒以上のときだけ画面が重なる。0 件・取得の失敗・3 秒超過・`idleSeconds` が 60 秒未満（走行中の再読み込み）では重ならない（B-0 だけ）
- [x] GATE-1f: `VITE_API_BASE_URL` が無ければ（送り先が無いので）何も描かない
- [x] GATE-1b: 画面に件数・サムネイル（最大 6 枚）・チェック（初期 ON）・主ボタン「送る」・「あとで」が出る。チェックを外すと主ボタンが「提供しない」になる
- [x] GATE-1c: 「あとで」で閉じると B-0 が見える。何も送らない・edge の状態を変えない
- [x] GATE-1d: 4 言語（ja・en・zh・ko）の表に欠けが無い。主文は端末の言語
- [x] GATE-1e: ボタンとチェックは 44 px 以上のタッチターゲット、アイコンのみのボタンに `aria-label`、絵文字なし
- [x] UP-1a: OFF で「提供しない」→ edge に `consent:false` を送り、api には何も送らない
- [x] UP-1b: ON で「送る」→ edge に `consent:true` →画像を取る → api に multipart（`capture`・`image`）→ 成功した id だけ edge に送信済みを送る
- [x] UP-1c: `isUploadable` でない Capture（壊れた形）は api に送らず失敗に数える
- [x] UP-1d: ネットワークの失敗・5xx で止めて残りは未送信のまま「もう一度」が出る。「もう一度」で続きから（送信済みは飛ばす）
- [x] UP-1e: 409・413・422・400 `INVALID_INPUT` はその 1 件を失敗に数え、edge に `consent:false`（削除）を送って未送信から外し、続ける。400 `INVALID_IMAGE` は失敗に数えるが削除しない（エンコーダと検査の食い違いで同意済みのデータを失わない。保持期間に任せる。alert-contract-guard W-1）
- [x] UP-1i: 429 は `Retry-After`（最大 65 秒）を待って同じ 1 件をもう一度送る。それでも 429 なら止めて「混み合っています」（回線の文言ではない）。404・405 は「送り先に届きませんでした」で止める
- [x] UP-1j: 200 件を超える未送信はページを繰り返して全部扱う。同意の POST が失敗したら api に何も送らない。一覧を取り直して `consent === true` のものだけを送る
- [x] UP-1k: OFF で「提供しない」は edge に `consent:false`（削除）を送る
- [x] UP-1f: api へのリクエストが `credentials: 'omit'`・`referrerPolicy: 'no-referrer'`、本文は Capture の JSON と画像だけ（位置・識別子なし）
- [x] UP-1g: `uploadCapture` が PWA・sim のどちらにも依存せず、`fetch` を差し込める。欄名が `capture`・`image`
- [x] UP-1h: 進み具合「n / N」と完了の文言が出る
- [x] URL-1a: edge の Capture サーバーの URL は WebSocket のホストと同じで、ポートは 8767（`?edge=host:port` の host だけを使う）。api の URL は `VITE_API_BASE_URL`（必須。無ければ送り先が無いので画面を出さない）
- [x] CSP-1a: 本番ビルドの CSP の `connect-src` に edge の `http://ezoroad.local:8767` と `VITE_API_BASE_URL` のオリジン、`img-src` に edge の 8767 が入る。`VITE_API_BASE_URL` が無ければ api は足さない。`script-src` などほかの指示は変わらない

認可（threat.md の ❌ セルごとに 1 項目。認可は無いので「拒否する検査」）:

- [x] AUTH-1: `consent: false` の Capture は api が 422 `CONSENT_REQUIRED` で受けず、何も保存しない
- [x] AUTH-2: すでにある `id` で中身が違うものは 409 で、既存のファイルが変わらない
- [x] AUTH-3: 知らない欄・個人情報のキー・`image` に絶対パスや `../` を入れた Capture は 400。保存されるパスはサーバーが決めたもの
- [x] AUTH-4: メタデータ付きの画像・寸法違いの画像・画像でないものは 400 `INVALID_IMAGE`
- [x] AUTH-5: 1 分 61 件目は 429、保存件数が上限なら 503 `STORE_FULL`
- [x] AUTH-6: `GET /api/captures`・`GET /api/captures/{id}`・`DELETE /api/captures/{id}` は 404（口が無い）
- [x] AUTH-7: edge の `GET /captures` は許可リストに無い Origin に ACAO を付けない（許可リストが空なら CORS ヘッダ無し）
- [x] AUTH-8: edge の `POST /captures/consent`・`/captures/uploaded` は許可リストに無い Origin なら 403、`text/plain` や `multipart/form-data` なら 415
- [x] AUTH-9: 送信済みのしるしがある Capture の `consent` は `POST /captures/consent` で変わらない
- [x] AUTH-10: edge の画像・JSON に `..`・`/`・絶対パスの id を渡すと 404（ファイルシステムに触れない）
- [x] AUTH-11: edge は 8 KB を超える本文を 413、同時 9 接続目を 503 にする
- [x] AUTH-12: PWA は OFF なら api に何も送らず、ON でも `isUploadable` でない Capture は送らない
- [x] AUTH-13: edge は `Host` が IP リテラル・`localhost`・`ezoroad.local` 以外（DNS rebinding）なら 421 で、一覧も画像も返さない

トレーサビリティ:

| 要件                           | 実装                                               | 主なテスト       |
| ------------------------------ | -------------------------------------------------- | ---------------- |
| B2-5（保存）                   | `capture/{model,recorder,store}.py`                | UC-1・UC-3・UC-5 |
| B2-5（同意のあるものだけ送る） | PWA の `isUploadable` ＋ api の `CONSENT_REQUIRED` | UP-1a〜c、API-1d |
| B2-9（`l1Probs`）              | `recorder.on_l1_answer`、`run_l1` の観察者         | UC-4             |
| B3-3（320 px の JPEG）         | `JpegEncoder`、`image_width`                       | REC-1f           |
| ch5（保存しない・同意）        | `build_capture` のキー固定、api の画像検証         | CAP-1f、IMG-1d   |
| ch6（位置は区間に丸める）      | `SegmentProvider`（座標を受け取らない）            | CAP-1e           |
| ch7（`POST /api/captures`）    | `capture.routes.ts`、`capture.schema.ts`           | UC-8             |

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2・AC-3 が Green
- [x] 全 UC / 全状態パターンのテストが Green、既存テストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（edge: ruff、api・PWA: lint・typecheck）
- [x] alert-contract-guard・security-auditor・edge-latency-reviewer・code-reviewer の Critical 0（docs/reports/2026-11-04-{security-auditor,code-reviewer,edge-latency-reviewer}-edge-capture.md。alert-contract-guard は返答のみで Critical 0・Warning 4（W-1〜W-4）。W-1・W-2 は直し、W-3・W-4 は Deferred に記録）
