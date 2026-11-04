# security-auditor: edge-capture（2026-11-04）

対象: コミット 5fdbef3..HEAD（edge の Capture サーバーと保存、api の `POST /api/captures`、PWA の `features/capture` と CSP）。仕様は `docs/specs/edge-capture/` の functional / threat / resilience。コードは変えていない。検証は使い捨ての実行だけで、スクリプトは scratchpad に置いた（`.../scratchpad/edge/t1〜t4.py`、`.../scratchpad/api/fuzz.mjs`・`live.mjs`・`race.mjs`）。api は 8804、edge は 8767 で立てて止めた。

レベルは依頼の語（Critical / Warning / Info）を使う。

## 総合

- リスクレベル: **Medium**（Critical 0、Warning 5、Info 12）
- 同意の迂回、画像の検査の迂回、パス、CSRF / DNS rebinding、情報の漏えいは、確かめた範囲で破れなかった。
- 直す順: W2（保持期間の迂回と送信済み画像の残り）→ W3（git に入る）→ W1（遅い接続）→ W5（api の容量）→ W4（例外の取りこぼし）。
- 新しい依存と秘密の直書きは無い（差分を `secret|token|password|api_key` で検索。`secrets.token_*` の乱数だけ）。

## Critical

なし。

## Warning

### W1. edge の「5 秒で打ち切り」は 1 回の受信ごとで、要求全体の期限ではない（CWE-400, CWE-770）

- 場所: `edge/detector/src/detector/capture/http.py:323-334`（`setup` の `self.timeout`、`handle` の `BoundedSemaphore`）、仕様は threat.md AUTH-11
- 筋書き: 同じ AP の端末が 8 本の接続を張り、ヘッダを 3 秒に 1 バイトずつ送る。`socket.settimeout(5)` は受信 1 回ごとなので切れない。**実測: 8 本を 12 秒保持できた（打ち切りは 5 秒のはず）。このとき 9 本目は 503 BUSY**。ヘッダ 1 行は 65536 バイトまで読むので、理論上は何時間も保てる。接続を閉じると 200 に戻る。
- 影響: 走行後の同意画面が出ない・送れない（可用性のみ。データは漏れない）。AP の合言葉を知る端末が必要。
- 直し方: `handle()` の先頭で `time.monotonic()` の期限（例 5 秒）を決め、`rfile` の読みの前後と本文を読むループで超過を見て閉じる。またはヘッダ読みを `settimeout(1)` で刻んで合計を数える。ヘッダの合計バイト数にも上限（例 8 KB）を付ける。

### W2. 送信済みの印は誰でも付けられ、保持期間を迂回する。送信済みの画像はそのまま読める（CWE-613, CWE-359）

- 場所: `edge/detector/src/detector/capture/store.py:158-175`（`mark_uploaded`）、`:235-244`（`_expire` が送信済みを飛ばす）、`:98-107`（`read_image`）、`http.py:166-170`（`GET /captures` と画像は送信済みも返す）
- 筋書き: (a) AP の端末が `POST /captures/consent {consent:true}` → `POST /captures/uploaded` を Origin 無しで打つ（curl）。**実測: どちらも 200。80 年後の時刻でも一覧に残り、画像も読めた**。24 時間で消える約束（C1 の決定）が、実際には消えない。(b) 正規の送信でも、送信済みは `max_items`（2000）まで車に残り、`pending=1` を付けない `GET /captures` と `/captures/{id}/image` で次の借り手が読める。画像は他の車のナンバー・歩行者が写りうる（threat.md の Data Classification で「個人情報に近い」）。
- 影響: 借り手が替わった車に前の人の送信済みフレームが残り、AP につながる人が読める。threat.md は「送信済みは max_items で古いものから」と書いて受け入れているが、送信後に画像を持ち続ける理由は無い。
- 直し方: `mark_uploaded` で画像（と JSON の画像参照）を消し、索引には `uploaded` の印だけ残す。または `_expire` が送信済みも `retention_hours` で消す。あわせて `GET /captures` の既定を未送信だけにし、画像は未送信にだけ返す。`mark_uploaded` を「PWA が同じ接続で api から 201 / 200 を受けた」証拠なしに受け付けるのは AP 境界の設計のままなので、削除に寄せるのが安い。

### W3. edge の保存先 `edge/detector/captures` が .gitignore に無い（CWE-538）

- 場所: `edge/detector/config.example.toml:63`（`dir = "captures"` / 「git に入れない」とコメント）、`/.gitignore`
- 筋書き: 既定の相対パスは設定ファイルのディレクトリ、つまり `edge/detector/captures/`。`git check-ignore -v edge/detector/captures/x.jpg` は何も返さない（無視されない）。実走行のフレーム（道路・他の車・歩行者）と JSON が `git add -A` で公開リポジトリに入りうる。`.gitignore` には `data/captures-received/` と `edge/**/runs/` と `edge/**/models/` はあるが、これは無い。
- 影響: 同意前の画像の公開。リポジトリは公開予定（CLAUDE.md の「同意・匿名化の前のものを公開リポジトリに入れない」と同じ趣旨）。
- 直し方: `.gitignore` に `edge/**/captures/` を足す（`sfad` 側の .gitignore 検査があれば自己テストに入れる）。

### W4. edge の例外の取りこぼし（CWE-248, CWE-755）

- 場所: `http.py:352`（`_serve`）、`:212`（`_list`）、`:231`（`_post`）、`:234`（`json.loads`）
- 筋書き: `str.isdigit()` は `²` `³` `¹`（Latin-1 の上付き数字）にも True を返し、`int()` は ValueError。**実測: `Content-Length: \xb2` の POST は `_serve` が `api.handle` の try の外で `int()` を呼んで例外 → 応答無しで接続が切れ、stderr にトレースバック**。`GET /captures?limit=%C2%B2` は 500。8 KB 近くの `[[[[…` は RecursionError で 500（`capture.http_failed` のエラーログ）。クラッシュはしない（スレッド単位）。応答に内部の文は出ない。
- 影響: 想定外の入力でログが荒れる、400 で返すべきところが 500 / 無応答。DoS にはならない。
- 直し方: 数字の判定は `value.isascii() and value.isdigit()`（または `re.fullmatch(r"[0-9]{1,7}", …)`）。`_serve` の本文読みを `api.handle` と同じ try に入れる。`json.loads` の except に `RecursionError` を足す。`BrokenPipeError`（応答を書く前に切られたとき）も `_serve` で握る。

### W5. api の容量: 1 画像 1 MB の上限が実際の画像（320 px の JPEG は数十 KB）より大きすぎ、保存の上限は同時要求で超える（CWE-770）

- 場所: `apps/api/src/domain/captures/rules/capture-rules.ts:6`（`CAPTURE_IMAGE_MAX_BYTES = 1 MiB`）、`submit-capture.usecase.ts:61-62`（上限の検査）と `file-capture.repository.ts:126-131`（作った後に数える）、`env.ts` の `CAPTURES_MAX_BYTES` 既定 5 GiB
- 筋書き: 認証なしの口で、1 IP（IPv6 は /64）あたり 1 分 60 件。1 MB の合法な画像（DQT などに詰め物ができる。I1）を送れば 60 MB/分、約 85 分で 5 GiB に達して全員が 503 `STORE_FULL`。IP を替えれば（IPv4 を複数持つ、複数の /64）速くなる。上限の検査は保存の前、数えるのは保存の後なので、同時に来た分は上限を超えて通る（コードのコメントに「数件の超過は許す」とあるが、IP が多いと「数件」にならない）。JSON の分（最大 8 KB × 件数）は `bytes` に入らない。
- 影響: 匿名の送信口が埋まる（同意した利用者の送信が失敗する。データが漏れるわけではない）。threat.md は「容量はレート制限・件数の上限で抑える」とする。
- 直し方: `CAPTURE_IMAGE_MAX_BYTES` を 256 KB 程度に下げる（edge の 320 px は 20〜40 KB。sim も同程度）。本文の上限も 0.3 MB 程度へ。`CAPTURES_MAX_BYTES` の運用値と dataset の取り込み間隔（満杯の前に運び出す）を `.env.example` に書く。同時要求の超過は `stats()` で予約（`count += 1` を先に、失敗したら戻す）にすると、ほぼ厳密になる。

## 検証して問題が無かった点（行つき）

1. **同意**
   - api: `submit-capture.usecase.ts:43`（`isUploadable` が最初の検査。`consent:false` は 422、実測。何も保存しない）。保存する JSON の `consent` はサーバーが `true` に固定（`:50`）。
   - PWA: `send-all.ts:122-133`。edge に同意を書けなければ api へ何も送らず（`viaEdge` の Stop）、取り直した一覧の `consent === true` だけを送り、送る直前にもう一度 `isUploadable`（`:66`）。dialog の「送る」「提供しない」は利用者のクリックでだけ `send()` を呼ぶ（自動送信の経路は無い）。AP の別端末が同意を `true` に書いても、PWA は自分が開いた一覧の id だけを扱うので、勝手に送られない。
   - 「提供しない」: `store.py:135-156`。未送信の JSON と画像を削除（`_delete` が JSON を先に消す）。
2. **画像の検査**（api）。`fuzz.mjs` で実測。
   - JPEG: APP1〜15、COM、APP0 の 2 つ目、JFXX、サムネイル付き、EOI の後ろの 1 バイト、2 つ目の JPEG の連結、寸法 4096 / 65535、`imageSize` との不一致、空、SOI だけ、FF の詰め物 1 MB、走査データの FF 洪水は、すべて拒否。
   - PNG: tEXt・eXIf・iTXt・zTXt・iCCP・私的チャンク、IEND の後ろ、長さ 0xffffffff、幅高さ 2^32-1 は拒否。
   - HTML のバイト列は `not_image`（400 INVALID_IMAGE）。MIME が `text/html` でファイル名が `a.html` でも、中身が JPEG なら受ける = MIME・ファイル名を見ていない（意図どおり）。ファイル名 `../../../etc/x.jpg` は 201 で、保存名は `{key}-{sha12}.jpg`（無視されている）。
   - **例外・遅延**: ランダム 2 万件と、正しい JPEG の 3 バイト変異 2 万件で例外 0、50 ms 超 0。60000 個の空 IDAT、1 MB の FF 洪水も即座に結果が返る。ループは毎回前に進む（`length >= 2`、PNG は `end >= pos + 12`）。
3. **パス・ファイルシステム**
   - api: key は id の小文字化 → `CAPTURE_KEY_PATTERN`（`^cap_[a-z0-9]+$`）→ `assertKey`（`file-capture.repository.ts:33`）。id の `é`・`İ` は CaptureSchema で 400。41 文字は 400、40 文字は 201。大文字小文字だけ違う id は同じ key になるが、本文ハッシュに元の id が入るので 409 になる（`cap_V1` 実測）。クライアントの `image` は使われない（`image: '/etc/passwd.jpg'` と `../../x.jpg` は 400）。
   - 競合: 同じ id で別画像 40 並行 → 201 が 1、409 が 39。残ったのは JSON 1 つと画像 1 つ。負けた画像は `unlink` され、一時ファイルは 0。ディレクトリ 0700、ファイル 0600（`ls -la` 実測）。ハードリンク（`link`）は既存を上書きせず、`wx` の一時ファイルはシンボリックリンクを辿らない。
   - edge: `valid_id` = `fullmatch(cap_[0-9a-f]{12})`（`store.py:32,41`）。`../`、`%2f`、大文字、改行付き（`cap_aaaaaaaaaaaa%0a`）は 404（実測）。ファイル名は id からだけ作り、`os.open(O_EXCL, 0600)` → `os.replace`。
4. **DoS（api）**
   - Hono 4.13.16 の `bodyLimit` は、Content-Length があれば宣言値で先に判定し、無い・Transfer-Encoding ありは 1.25 MiB を超えた時点で打ち切って 413（`onError`）。実測: 2 MB の宣言も、4 MB の分割送信も 413。`parseBody` はその後なので、全部読んでから判定するわけではない。レート制限は `bodyLimit` の前。
   - X-Forwarded-For: `TRUST_PROXY=false`（既定）では無視。X-Forwarded-For を 1 件ごとに替えた 70 件で 201 が 33（それ以前の 27 と合わせて 60）、429 が 37（実測）。`TRUST_PROXY=true` では右端を使い、IPv6 は /64 に束ねる（`client-ip.ts`）。
   - 20000 個の multipart 欄（約 1 MB）、`__proto__` の欄、`capture[]` は 400（prototype pollution なし）。`capture` が 8 KB 超は 400。
5. **情報の漏えい**
   - 応答は `code` と短い文だけ。パス・例外・スタックを含まない（`NODE_ENV=production`）。ログは JSON 1 行。`capture.received` は id・source・imageBytes・status だけ。4xx の `http.error` は `path`（クエリなし）と `serializeError`（型名・短い文・スタック）で、Capture の本文・画像・roadSegment・IP は出ない。欄名はクライアントが選べるが、構造化ログなので注入にならない。
   - edge: ログは `capture.http`（method・route・status・ms）と `capture.http_failed`（型名）。応答に例外文なし（`_error` は固定文）。
6. **Host / Origin / CORS / CSRF（edge）**。`t1.py` で `CaptureApi.handle` を直接叩いて実測。
   - Host: 外部名 421、IPv4、`[::1]`、素の `::1`、大文字 `EZOROAD.LOCAL` は 200、空・無し・末尾ドット・`127.0.0.1.evil.com`・`evil.com@127.0.0.1` は 421。`X-Forwarded-Host` は見ていない（Host が正しければ 200）。
   - Origin: `null`・外部・サブドメイン（`x.ezoroad.local`）は GET で 200（ACAO 無し = ブラウザは読めない）、POST で 403。同じホスト名・別ポート・別スキームは許可（I4）。許可リストは ACAO と `Vary: Origin` を返す。preflight は不許可なら 403、許可なら 204 + `Allow-Private-Network`。
   - 書き込み: `text/plain` の単純 POST は 415（Origin 無し）/ 403（外部 Origin）。Origin の検査が Content-Type の検査より先。`ids` の個数・型・ほかのキーは厳密。
   - 画像の `<img>` は CORS の外（threat.md AUTH-7 のとおり）。id が 48 ビットの `secrets.token_bytes(6)` で、一覧を読めない外部ページは id を知れない（W2 の `GET /captures` は同じ AP の端末だけ）。
7. **api の CORS**: 既存の `cors()`（`CORS_ORIGINS` は明示。`*` は起動で拒否）。実測: 許可 Origin だけ ACAO、外部と `null` は付かない。`exposeHeaders` に `Retry-After` と `Idempotent-Replayed` が入っていて、PWA の 429 待ちは読める。`GET`・`DELETE`・`PUT /api/captures/*` は 404（読み出し・削除の口が無い、AUTH-6）。
8. **PWA**
   - 全 fetch（一覧・画像・同意・送信済み・api）が `credentials: 'omit'` + `referrerPolicy: 'no-referrer'`（`edge-api.ts:80`, `upload.ts`）。`<img>` も `referrerPolicy="no-referrer"`（`CaptureDialog.tsx`）。
   - edge の応答を信じすぎていない: 一覧の id は `CAPTURE_ID` で再検査してから `<img src>` と URL に使う（`parsePendingList`、`fetchImage`）。URL は固定の `baseUrl`（本番は `http://ezoroad.local:8767` 固定。`?edge=` は `import.meta.env.DEV` のときだけ。I9）+ 検査済みの id。`dangerouslySetInnerHTML` / `innerHTML` / `createObjectURL` は無い。edge の JSON の `capture` は `isUploadable` に通してから送る。
   - CSP（`csp.ts`）の追加は 3 つだけ: `connect-src` に edge の 8767 と api のオリジン、`img-src` に edge の 8767（`<img>` が使うので必要）。ワイルドカード・`unsafe-inline` は無し。
9. **仕様の敵対レビューの取り込み**（`2026-11-04-spec-adversary-edge-capture.md`）: C1（`consent:false` で削除・`pending=1`・200 件ずつ）、C2（`idleSeconds` の 60 秒）、C3（CSP・同じホスト名の許可・`VITE_API_BASE_URL` 必須。無ければ `CaptureGate` が何も描かない）、W1（Host の 421、実測）、W2（OPTIONS）、W3（`file` と論理パス）、W4（画像の検査）、W5（id 40 文字・小文字の key・バイト数の上限）は実装にある。C4（`l1Probs` のキューとロック）は性能・整合の話で、今回は読んでいない（edge-latency-reviewer が見た）。W6 のうち 24 時間の保持は、W2 の迂回がある。

## Info

- **I1. JPEG は「禁止リスト」で、任意のバイト列を運べる。** APP1〜15・COM は止めるが、DQT / DHT / DRI / DNL / JPG0・JPGn（0xF0〜0xFD）/ 0xC8 の本体は検査しない。実測: DQT に約 40 KB の詰め物を入れた JPEG、0xFD、0xC8、DNL、JFIF 無しの JPEG は通る。PNG も IDAT の中身は任意。匿名の利用者のメタデータを消す目的は満たす（正規の画像）が、悪意ある送信者が 1 MB まで好きなバイトを置ける（ポリグロットではないが、デコーダ側の既知の脆弱性を狙う入力になりうる）。dataset 側は信頼しないデコード（Pillow を `verify` + 寸法の再確認 + 再エンコード）をする。api で許可リスト（SOI, APP0 JFIF, DQT, DHT, DRI, SOF0〜2, SOS, EOI）に絞ると面は減る。走査データ自体は検査できない。
- **I2. api の consent は自己申告。** `consent: true` を付ければ誰でも画像を入れられる（匿名で、本人確認の手段が無い）。偽の画像・偽の同意は防げない（threat.md の ✅ (公開) の理由に書かれた既知の受け入れ）。dataset への取り込みで、画像の再検証と出所（source、重複）の確認を。
- **I3. AP の境界。** 同じ AP の端末は、Origin 無しなら `GET /captures`・画像・同意・送信済みを全部操作できる（AUTH-8 の ✅）。同乗者のスマホで PWA を開けば、同じ画面が出て送れる。合言葉の管理（B3-1）が全部。W2 の削除への寄せ方で、読める範囲を最小にする。
- **I4. 同じホスト名ならポートとスキームを問わず許可**（`http.py:175-183`）。Mac Mini 上のほかの Web サービス（開発サーバー、8766 など）のページから書ける。運用では `allowed_origins` を明示し、同じ Host の規則に頼らない。
- **I5. `allowed_origins` は完全一致で、小文字化しない**（`config.py` の `_ORIGIN_RE`）。ブラウザの Origin は小文字なので、大文字を書くと黙って 403。起動時に小文字へ直すか、大文字を拒否する。
- **I6. edge の `host` を `0.0.0.0` にすると AP 以外のインターフェースにも出る。** 既定の `127.0.0.1` は安全。本番の設定は AP の LAN のアドレスに限る（`config.example.toml` に書いてある）。
- **I7. 48 ビットの sha 接頭辞を「同じ中身」とみなしている**（`file-capture.repository.ts:116, 135`）。実ファイル名は `{key}-{sha 先頭 12 桁}`。同じ id で、先頭 12 桁が同じ別の画像（約 2^24 回の計算で作れる）を同時に送ると、片方の `bodyHash` を持つ JSON が、もう片方の画像を指しうる。影響は送信者自身の記録の食い違いだけ。JSON に画像の sha256 全体を持たせ、`EEXIST` のときは既存ファイルの sha を確かめると、「JSON が完成のしるし」の不変条件が固くなる。
- **I8. `FileCaptureRepository` は既存のディレクトリの権限を直さない**（`:94`）。edge の `CaptureStore` は `chmod` する。`CAPTURES_DIR` が 0755 で先にあると画像が他のユーザーから読める（ファイル自体は 0600 なので、ディレクトリ一覧だけ）。起動時に `chmodSync(dir, 0o700)` を。
- **I9. `?edge=host` の開発用パラメーター**（`capture-url.ts`）は開発ビルドだけ。細工したリンクで開発者の PWA の送り先を変えられる（本番では効かない）。
- **I10. `VITE_API_BASE_URL` は `http:` も通る**（`resolveApiBaseUrl`、`apiOrigin`）。本番ビルドで `http://` の api に画像を送ると平文になる。`https:` か、`localhost` / `127.0.0.1` だけを許し、CSP も同様に。
- **I11. edge の `new_capture_id` は 48 ビット乱数。** 一覧が AP の内側で読めるので、id の推測しにくさは境界の補助に過ぎない。外部ページが画像を `<img>` で取る攻撃は、Host の検査（DNS rebinding）+ 一覧を読めないことで止まる。
- **I12. api のエラー文に zod の正規表現が出る**（`must match pattern /^cap_[A-Za-z0-9]+$/`）。秘密ではないが、人に見せる文としては長い。`describeIssues` で規則名に置き換えると、スキーマの内部が見えにくい。

## 修正の優先

1. W2（保存の削除への寄せ。小さな変更で、借り手が替わった車の問題も、迂回も消える）
2. W3（.gitignore の 1 行）
3. W1（期限）、W4（`isascii` と try の範囲）
4. W5（上限を現実の大きさに）
5. Info は PR の本文に「残す / 直す」を書く
