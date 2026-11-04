# code-reviewer: edge-capture（5fdbef3..HEAD）

レビュー日: 2026-11-04 / 対象: docs/specs/edge-capture/functional.md の E1〜E6・A1〜A9・P1〜P5 と Test List

## 前提と限界

- このセッションのツールは Read / Grep / Glob / Write / Edit だけで、**Bash が無い**。pytest・vitest・ruff・tsc・eslint は実行していない。以下はすべてコードを読んだ上での指摘。テストの合否、カバレッジ 70%、lint の通過は、メインセッションの `python scripts/local-ci.py` で確かめること。
- `git diff` も使えないため、pipeline.py・l1/runner.py・config.py・app.ts・container.ts・error-mapper.ts・env.ts・App.tsx・vite.config.ts は、capture に関する箇所を grep と部分読みで確かめた（差分の最小性の判断はその範囲）。

## レビュー結果

### Critical（修正必須）

なし。

赤の経路を壊す指摘、同意なしでの送信、パス・個人情報の漏れ、レイヤ境界の違反は見つからなかった。下の Warning は、直さないとデータを失う・数字が嘘になる・テストが何も守らない、というものを優先して並べた。

### Warning（推奨）

**W1 [edge/detector/src/detector/capture/jpeg.py:42-57 ↔ apps/api/src/domain/captures/rules/capture-image.ts:46-125] 本物の OpenCV の JPEG が api の検査を通るかを確かめるテストが、どちらの側にも無い**

- api の `parseJpeg` は「APP0 は JFIF 1 つだけ・長さ 16・サムネイル 0×0、APP1〜15 と COM は即拒否、EOI の後ろに 1 バイトも付けない」と厳しい。api のテストの JPEG は手組み（`buildJpeg`）で、edge 側のテストは `cv2.imdecode` で戻せることしか見ていない（`test_capture_recorder.py:206-218`、しかも `importorskip("cv2")` なので cv2 が無い CI では黙ってスキップされる）。
- 合わないと、PWA は 400 を「再送しても直らない」と扱い、edge に `consent:false` を送って**画像を消す**（`send-all.ts:111-119`、UP-1e）。つまり検査の食い違いが、利用者が同意した全件の静かな削除になる。
- 直し方: cv2 で作った 320×240 の JPEG を 1 枚 `apps/api/src/test/fixtures/` に置き、`inspectCaptureImage(bytes, [320, 240])` が `ok` になる 1 件を足す（生成は edge 側のテストで fixture と同じバイト列のメタデータ部分が変わっていないかを確かめてもよい）。調査走行（Day 4）の前に、実機の 1 枚でも同じ確認を。

**W2 [edge/detector/src/detector/capture/store.py:219-225] `_delete` が OSError を全部握り潰すので、「提供しない」を選んでも画像が残りうる**

- `.json` の unlink が失敗しても、索引（`_index.pop`）だけ消えて `changed += 1` で「消した」と応答する。ディスクにはファイルが残り、次の起動の `_load` で復活する（`consent:false` の JSON のまま、または画像だけ残って JSON は消えた状態）。ch5 の「断ったものは次に出ない」に反する。ログも出ない。
- 直し方: 失敗を `capture.failed`（`error_type` のみ）で残し、JSON が消せなかったときは索引から外さず `False` を返して `set_consent` の件数に入れない。

```python
def _delete(self, capture_id: str) -> bool:
    for suffix in (".json", ".jpg", ".uploaded"):
        try:
            (self._dir / f"{capture_id}{suffix}").unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("capture.failed", extra={"error_type": type(exc).__name__})
            if suffix == ".json":
                return False  # 完成のしるしが消えていない。索引にも残す
    self._index.pop(capture_id, None)
    self._uploaded.discard(capture_id)
    return True
```

**W3 [edge/detector/tests/test_capture_http.py:129] 常に通るアサーション `... or True`**

- `assert b"/" not in ... or True` は何も確かめない。HTTP-1b の「パスを返さない」はこの行では守られていない（`str(tmp_path)` の検査は HTTP-1f 側にしかない）。
- 直し方: `or True` を外す。エラー文は `見つかりません` で `/` を含まないので、そのまま通る。さらに `assert str(tmp_path).encode() not in body` を足す。

**W4 [edge/detector/tests/test_capture_http.py:432-451] 「遅い接続は 5 秒で切れる」を確かめていない。時間待ちのフレークもある**

- 握った 8 本のソケットを `close()` してから最後のリクエストを投げているので、サーバー側に timeout が無くても通る（クライアントが閉じれば EOF で `handle` は終わる）。タイトルの「打ち切られる」は未検証。
- `threading.Event().wait(0.3)` で「サーバーのスレッドが 8 つのスロットを取る」のを待つのは、負荷の高い CI で 9 つ目が 503 にならず 200 になるフレーク要因。
- 直し方: ソケットを閉じる**前**に `held[0].settimeout(3); assert held[0].recv(1) == b""`（サーバーが切った）を確かめる。スロット待ちは「`slots._value == 0` まで最大 2 秒ポーリング」か、8 本のうち最後の 1 本の接続後に `recv` なしで短いポーリングにする。

**W5 [edge/detector/src/detector/capture/http.py:212, 229, 352] `str.isdigit()` のあとに `int()` する形が、`"²"` のような文字で ValueError になる**

- `"²".isdigit()` は True だが `int("²")` は ValueError。
  - `:212`（`limit`）と `:229`（`Content-Length`）は `handle` の try/except に入り 400/411 ではなく **500** になる。
  - `:352`（`_serve`）は `api.handle` の外なので例外がスレッドから漏れ、`socketserver` が標準エラーに traceback を print して応答なしで切れる（ログの形式も崩れる）。車内 LAN からヘッダを 1 つ書き換えるだけで起こせる。
- 直し方: `raw.isascii() and raw.isdigit()` にそろえる。または共通の `_to_int(text) -> int | None` を作って 3 か所で使う（DRY にもなる）。

**W6 [edge/detector/src/detector/capture/model.py:125-133] ボックスの 8 件目での打ち切りが入力順で、距離・方向は「先頭 8 件の中の最大」になる**

- 仕様 E1/CAP-1c は「`distanceM`・`side` は最も大きく写った検出から」。実装は `len(boxes) >= BOX_LIMIT` で `continue` するため、9 件目以降に最大の検出があると無視される。`boxes` に何が入るかも検出器の出力順に依存する（確信度順の保証はない）。
- テスト `test_CAP_1c`（`test_capture_model.py:90-91`）の 12 件は高さがすべて 0.05 で、この穴を踏まない。
- 直し方: 先に有効なボックスを全部集め、**高さ（なければ確信度）の降順**に並べてから `[:BOX_LIMIT]`。距離・方向は並べた先頭から取る。テストは「9 件目だけが最大」のケースを足す。

**W7 [edge/detector/src/detector/capture/recorder.py:178, 317-325] `answer: object` と `# type: ignore[attr-defined]` が 4 つ**

- `on_l1_answer` を `object` で受けているのは型の穴を作る。`service.py:101` は `L1Answer` で受けており、recorder だけ手放している。例外を握り潰す `except Exception`（`:187`）が「属性が無い」ミスも隠すので、取り違えが無音で `l1Probs` 欠落になる。
- 直し方: `TYPE_CHECKING` で `L1Answer` を import して `answer: L1Answer` にすれば、ignore は全部要らなくなる。

```python
def _probs_of(answer: L1Answer) -> dict[str, object]:
    return {
        "alert_level": dict(answer.alert_level),
        "on_roadway": answer.on_roadway,
        "static_shoulder": answer.static_shoulder,
        "false_positive": answer.false_positive,
    }
```

**W8 [apps/pwa/src/features/capture/lib/send-all.ts:66-80, 154-160 / hooks/use-send.ts:44-46] 「もう一度」で件数が二重に数えられ、画面の「N 件を提供しました」が実数より多くなる**

- `carry` に前回の `provided` を足し、再実行では `handled` が空から始まる。
  - 送信済みの更新（`markUploaded`）だけ失敗した 1 件は、再送で api が 200 を返し `provided` をもう一度増やす。`send-all.test.ts:356-358`（FAIL-10）は `provided: 2` を**正解として固定**している（実際は 1 件）。
  - `isUploadable` でない・画像が 404・`consent !== true` の「失敗」は edge に残る（削除しない）ので、再実行のたびに `failed` が増える。
- `use-send.ts:15` のコメントは「件数は足し続ける」と書いており、足し込み自体は意図どおり。ただし確認してほしいのは、完了文言（P3-5「N 件を提供しました」）の N が「api が受けた回数」か「提供した枚数」か。後者のつもりなら、再送の 200（replayed）で同じ 1 枚が 2 件と出る。`failed` も、edge に残る失敗（`isUploadable` でない・画像 404・`consent !== true`）が再実行のたびに増える。
- 利用者に見せる数字なので、枚数のつもりなら今のうちに直す。
- 直し方: `carry` は件数ではなく「提供が確定した id の Set」と「失敗として数えた id の Set」を持ち回り、件数は Set のサイズで出す。そのとき FAIL-10 の期待値は `provided: 1` になる。回数のつもりなら、仕様 P3-5 の文言を「受け取られた回数」に直す。

**W9 [apps/pwa/src/features/capture/lib/http.ts:14-33] 打ち切りが「応答のヘッダが届くまで」で、本文の読み込みには効かない**

- `withTimeout` は `fetchLike` が解決した時点で `clearTimeout` する。edge の `fetchImage` の `response.blob()`（`edge-api.ts:103`）と `response.json()`（`:85,97`）は、ヘッダのあとで Wi-Fi が切れる（車から離れる、という本機能の主場面）と、本文の途中で止まる。その間 `phase` は `sending` のまま、止まったと分かる表示も「もう一度」も出ない。
- 直し方: `controller.abort()` を本文の読み込みが終わるまで有効にする（`fetchLike` の戻りを包み、`blob()`・`json()` にも同じタイマーをかける）。もしくは `edge-api.ts` 側で `Promise.race([response.blob(), timeout])` にし、`TimeoutError` を `EdgeError('timeout', null)` として `viaEdge` で `Stop('edge')` にする。

**W10 [edge/detector/src/detector/capture/http.py:323-325] 5 秒の打ち切りは 1 回の `recv` ごとで、「接続ごとに 5 秒」ではない**

- `self.timeout` はソケットの 1 操作ごとの待ち。1 バイトずつ 4 秒おきに送れば、8 本のスロットを長時間占有できる（E5 の同時接続 8 の意味がなくなる）。車内 WPA2 の LAN が前提なので優先度は低いが、仕様の文言とは違う。
- 直し方: `handle()` の先頭で `time.monotonic()` の期限を持ち、`_serve` の読み込み前後で超えたら切る。ヘッダ読み込み中の上限は `setup` で `self.connection.settimeout` を残り時間に更新する。または仕様の文言を「1 操作ごとに 5 秒」に直す（現状の実装に合わせる案）。

### Info（参考）

**良い点**

- 赤の経路: `offer` は参照を渡すだけで、縮小・JPEG・書き込みはワーカー。`wrap` は下流へ渡してから `offer`。キュー満杯は捨てて数える。`on_l1_answer` もディスクに触れず、書き足しはワーカー（`recorder.py:129-202`）。`pipeline.py` の差分は `image` フィールド 1 つと `image=resized.image` の 1 行で最小（`resize_frame` は fancy index で新しい配列を作るので、「参照を渡しても書き換えられない」は成り立つ）。
- l1Probs の前 1 秒・後 3 秒と「一度だけ」の規則は、`pending.saved`・`_Attach`・保存中に来た答え（`late`）まで漏れなく扱っている（`recorder.py:242-270`）。
- api: Domain は Hono・Zod・Node に依存していない（`rules/`・`policies/`・`errors/`・`models/` は相対 import だけ）。Route は検証・UseCase 呼び出し・応答変換だけ。Repository は port。HTTP の知識（status）は `error-mapper.ts` に閉じている。検証の順（A2）は UseCase の実行順と一致し、`A2` のテストもある。`bodyLimit` の 413 は `trip.routes.ts` と同じ既存パターン。
- `FileCaptureRepository.create` の「画像は EEXIST を同じ内容として無視、JSON のハードリンクで勝敗を決める」設計と、負けた側の画像の片づけ（`:133-136`）は筋が通っており、同時 2 リクエストのテスト（API-1j）で守られている。
- PWA: ロジックは hooks（`use-send`・`use-pending-captures`）と純関数（`send-all`・`gate-rule`・`edge-api`・`upload`）に分かれ、`useEffect` は 0。データ取得は TanStack Query（`useQuery` / `useMutation`）。feature の barrel は `CaptureGate` と型だけ。`upload.ts` は PWA にも sim にも依存しない（P5）。i18n は `Record<Lang, CaptureText>` で欠けが型で止まる。
- 規約: 色の直書き（`capture.css` は `var(--...)` のみ）・絵文字・print・console・`any`・`@ts-ignore` は capture の範囲に無い。Capture のキーは固定で、個人情報・緯度経度の欄を持たない（`model.py` と CAP-1f）。api のログは `id`・`source`・`imageBytes`・`status` だけ（API-1k で IP・roadSegment が出ないことまで確認）。

**Info 一覧（直さなくても可）**

- [edge/.../store.py:188] `l1_missing` はどこからも呼ばれない死んだコード。削除。
- [edge/.../http.py:361, 364] `do_HEAD` が無いので `self.command != "HEAD"` は到達しない。かつ HEAD・TRACE・CONNECT は標準ライブラリの 501（HTML、Host 検査より前）になり、仕様の「メソッド違いは 405」とずれる。`do_HEAD = ... = _serve` に足せば 405 の JSON になり、死んだ分岐も消せる。
- [edge/.../recorder.py:135] `_has_trigger` はラベルを見ないが、`build_capture` は `deer` だけを `boxes` に入れる。検出器が deer 以外を返さない限り問題ないが、`boxes: []`・`distanceM: null` の Capture が保存されうる（スキーマは許す）。前提を 1 行コメントに。
- [edge/.../recorder.py:269] 書き足し（`_attach`）が例外を出すと、保存は成功しているのに `capture.saved` が出ず `_failed` に数えられる（`store.attach_l1_probs` は OSError を握るので実際は起きにくい）。`_attach` は `try/except` で包むか、`saved` ログを先に。
- [edge/.../store.py:132-133] `_evict` が、直前に保存した新しい 1 件を消すことがある（`createdAt` が巻き戻った時計のとき）。保存した id は victim から外す。
- [edge/.../store.py:237-244] 保持期間は `createdAt`（カメラの `t_frame`）で決まる。起動直後で時計が狂っている edge だと、保存した画像が次の一覧ですぐ消える可能性。`_utc_now` との差が大きいものを警告ログに。
- [edge/.../service.py:95-99] `recorder.offer` は例外を外へ出さないので、`_offer` の try/except は二重。仕様 E6 が要求しているなら残してよい（WIRE-1a のテストが守る）。
- [edge/.../service.py:109-111] `close()` は `server.stop()` が例外を出すと `recorder.close()` に届かない。`try/finally` に。
- [edge/.../service.py:50-58] 仕様は `from_config(config, now, encoder)` だが実装は `(config, *, encoder, segment)`。`now`（ストアの時計）を注入できないので、保持期間をサービス経由で試験できない。仕様のほうを実装に合わせて直すのが軽い。
- [edge/.../store.py:77] メソッド名 `list` が、クラス本体内の後続の型注釈 `list[...]` と衝突する（今は `from __future__ import annotations` と、`list` を注釈に使う箇所がこのメソッドの前だけなので動いているが、型チェッカーを入れると誤検知する）。`list_items` などに。
- [edge/.../config.py:251-264] `allowed_origins` は大文字小文字を区別して比較される（`http.py:177`）。ブラウザの Origin は小文字なので、設定に `EzoRoad.local` と書くと一致しない。`_origins` で小文字にそろえる。IPv6 のオリジンは正規表現（`:211`）で通らない。
- [edge/tests/test_capture_service.py:191] AC-1 の `total >= 4` は緩い。6 枚を流して `offer` は全部走る（ループが尽きるまで進めるため）ので、`== 6` で固定できる。取りこぼしの退行を拾える。
- [apps/pwa/src/features/capture/components/CaptureGate.test.tsx:207] `expect(...width...).toBeDefined()` は「幅の指定がある」ことしか見ない。チェックボックスの大きさの下限は確かめていない（`<label>` の `min-height: 56px` が 44 px を満たすので実害はない）。数値を取り出して `>= 24` などで比べるか、行を消す。CSS を正規表現で読む検査は、jsdom がレイアウトを計算しないための代用で、見た目の回帰は accessibility-checker のほうで見る。
- [apps/api/src/infrastructure/http/routes/capture.routes.test.ts:481-493] FAIL-8 は `chmod 0o500` で書き込み不可を作るため、root で動く CI（コンテナ）では書けて 201 になりフレークする。`process.getuid?.() === 0` なら `it.skip`。
- [apps/api/.../file-capture.repository.ts:92-104, 133-140] JSON を作れなかったときに残る画像は、再起動で `bytes` に数えられるが、実行中は数えない。再送されない孤児が溜まりうる。起動時に JSON の無い画像を数えるだけでなく、一定期間後に消す運用を `CAPTURES_DIR` の運用メモに。
- [apps/api/.../submit-capture.usecase.ts:1] Application が `@antler/schema` の `isUploadable` を import している（CLAUDE.md の「application は domain のみ」から外れるが、凍結パッケージの純関数なので許容。新しい Capture の判定は domain の policy にして、`isUploadable` はそこから呼ぶ形にすると境界が明確）。
- [apps/pwa/src/features/capture/hooks/use-send.ts:56-59] `mutation.isError` の枝は、`sendAll` が全例外を握るので到達しない。死んだ分岐。
- [apps/pwa/src/features/capture/components/CaptureDialog.tsx:57-65] `aria-modal="true"` だが、背後の `ConnectFlow` は `inert` になっていない。キーボードでフォーカスが背後の B-0 に出られる。`ConnectFlow` を変えない制約があるので、ここでは直さず accessibility-checker の判断に回す。
- [apps/pwa/csp.ts:5 と apps/pwa/src/features/capture/lib/capture-url.ts:6] edge の URL `http://ezoroad.local:8767` が 2 か所に別々に書かれている。片方だけ変えると本番で通信が CSP に止まる。`csp.test.ts` で `DEFAULT_EDGE_CAPTURE_URL === EDGE_CAPTURE_ORIGIN` を 1 行確かめるだけでも守れる。
- [apps/pwa/src/features/capture/lib/send-all.ts:81] `isUploadable(raw)` の直後の `CaptureSchema.parse(raw)` は、同じ検査をもう一度している（`isUploadable` は `safeParse` を内部で呼ぶ）。動作は正しい。気になるなら `safeParse` 1 回で `success && data.consent` にする（ただし仕様は `isUploadable` を使うこと）。

## 仕様と Test List のずれ

- Rule にあって実装・テストが無いもの: 見つからなかった。Test List の ID（CAP・LIGHT・REC・L1P・STO・HTTP・CFG・WIRE・API・IMG・GATE・UP・URL・CSP・AUTH）を、テストのファイル・関数名と突き合わせた（grep で全 ID に対応するテストがあることを確認。`capture-image.test.ts`・`test_capture_config.py`・`test_capture_jpeg.py` の中身は ID の存在までで、アサーションの質は読んでいない）。
- PWA のテストに `.skip` / `.only` / `.todo` は無い。`toBeTruthy` / `toBeDefined` は 3 か所（i18n の空文字検査、aria-label の有無、上の CaptureGate.test.tsx:207）。
- Rule に対してテストが弱いもの: E5「接続ごとに 5 秒で打ち切る」（W4・W10）、E1/CAP-1c「最も大きい検出から」（W6）、HTTP-1b「パスを返さない」（W3）、UP-1h「進み具合」の数字の正しさ（W8）。
- 実機・結合でしか分からないもの: W1 の JPEG の整合。edge の `OpenCvJpegEncoder`（cv2 がある環境）の出力を、そのまま api に POST する一度きりの手順を、調査走行の前に。
