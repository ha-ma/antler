---
feature: plan-trip-photos
target_paths:
  - packages/trip/src/
  - packages/trip/data/pleasures.json
  - apps/sim/src/features/plan-trip/
  - apps/sim/src/shared/utils/photo-rules.ts
  - apps/sim/scripts/fetch-photos.ts
  - apps/sim/scripts/photo-picks.json
  - CREDITS.md
  - apps/sim/public/photos/
spec_confirmed_at: c7cea1f
tier: 1
---

# 仕様: plan-trip-photos（A-1 の楽しみから「重さ」を外し、カードに写真と引用を出す）

> 2026-11-08 sticky-cta（`docs/specs/sticky-cta/functional.md`）が A-1 の送信ボタンを画面の下に固定した帯に載せ、本文の下の余白に帯の高さを足した（`PlanForm.tsx`・`plan-trip.css`・`text.ts`）。楽しみのカード・写真・引用は変えていない。

> 2026-11-06 i18n（`docs/specs/i18n/functional.md`）で `packages/trip/src/i18n-tables.test.ts` が地点・楽しみの JSON の名前を 4 言語の規則で検査する（写真の台帳は変えていない）。この仕様のルールは変えていない。

> 2026-11-06 drive-tourism が plan-trip の barrel から `photoOf`・`photoSrc` を読み、運転中の会話とおすすめのカードに同じ写真と出典（平文）を出す（`docs/specs/drive-tourism/functional.md` T8・T13）。この仕様のルール（写真の選び方・引用）は変えていない。

> 2026-11-06 result-screens（`docs/specs/result-screens/functional.md` R1）で A-1 の送信ボタンの文言を「しおりを作って鹿ゾーンを確かめる →」（4 言語）に変えた（`features/plan-trip/text.ts` とそのテスト・コメント）。この仕様のルール（写真・引用）は変えていない。

## 概要

**drive-season（2026-11-06）での変更**: `packages/trip` と api への drive-season の変更（当日の条件 v2・trip-day のテストの時間切れ）。写真の振る舞いは変えていない（`docs/specs/drive-season/functional.md`）。

ユーザーがローカルで A-1（`/plan`）を確かめて出した指摘（2026-11-06）の 2 点を直す。

1. 楽しみの「重さ」（1〜5 の 5 段）を**設定させない**。画面から外し、今後も使わない。しおりは楽しみごとの**標準の所要時間**（マスターの `hours`）で割り当てる
2. 楽しみ 24 件のカードに、Wikimedia Commons から選んだ写真（CC0・パブリックドメイン・CC BY だけ）を出し、カードに引用（撮影者・ライセンス・出典へのリンク）を出す。`CREDITS.md` にも一覧で書く

要件: ch3 A1-2・A1-3・A1-4 からの変更（`docs/changes/2026-11-06-a-local-feedback.md`）、ch6 ライセンス（CC0 / CC-BY / 自作のみ）、ch8 規約（色・文字は tokens.json、絵文字なし）。
元の仕様: `docs/specs/plan-trip/functional.md`（R1〜R3 をこの仕様に合わせて直した）。
敵対レビュー: `docs/reports/2026-11-06-spec-adversary-plan-trip-photos.md`（指摘は下の「決着済み」に織り込んだ）。実装のレビュー 4 種は Critical 0。直したものと次に回す Warning は `docs/reports/2026-11-06-plan-trip-photos-review-followups.md`。写真の調査: `docs/reports/2026-11-06-photo-research.md`。
main の取り込み（2026-11-06、og-font・YOLO の素材）で共有の CREDITS.md に他の節が増えた。この仕様の写真の節と挙動は変わらない。
2 回目の main の取り込み（2026-11-06、drive-tune・drive-audio-chat・dataset-train など）でも、CREDITS.md の他の行（音・会話・学習の重み）だけが変わった。写真の節と挙動は変わらない。

**Tier 1 の理由**: 挙動の変更（しおりの組み立て・画面）はあるが、認可・永続化スキーマ（TripPlan の型は凍結のまま）・実行時の外部副作用（写真は開発時に 1 回だけ取って同梱し、画面は同じ origin から読む）・並行性に触れない。

**範囲外**: drive（`apps/sim/src/features/drive/`）、stop-events と loss の画面に残る「重さ」の表示（follow-up。下の Deferred）、写真の差し替え UI、写真の 4 言語の説明文、夜・早朝の楽しみを夜に置くこと（いまも 8:00〜18:00 の枠に入る。plan-trip からの既存の挙動）。

> 2026-11-06 performance（`docs/specs/performance/functional.md`）が `app/routes.tsx`（画面ごとの遅延読込）を変えた。写真の出し方は変えていない。`packages/trip` は記録の形（`frames`）だけを変えた。

> 2026-11-06 sdata-materials が CREDITS.md のデータ・素材の表に Mapillary の画像と 3D の鹿の行を足した。楽しみの写真の表は変えていない。

> 2026-11-06 drive-sound-tourism が CREDITS.md の運転の音の行を CC0 の曲・効果音に替えた（`docs/specs/drive-sound-tourism/functional.md`）。楽しみの写真の表は変えていない。

> 2026-11-07 drive-crash-spot（`docs/specs/drive-crash-spot/functional.md`）も `packages/trip` の記録（`spotting`）だけを変えた。写真の出し方は変えていない。

## Example Map

Story: 台湾から初めて北海道をレンタカーで旅する 4 人のグループの代表として、楽しみを写真で見て選ぶだけで、重さを考えずにしおりが組み上がる。写真の撮影者とライセンスがカードで分かる。

決着済み（2026-11-06、推奨で決定。ユーザーの方針「推奨案のある判断は推奨案で決めて進める」）:

- 重さの解釈: 「設定させない・今後も不要」→ 画面から重さの操作と表示を外す。入力（`TripInput`）にも重さを持たない
- **しおりは 1.6 時間の枠に切り上げて割り当てる**（駐車・歩きを含む）。枠の数 `weightForHours(hours) = clamp(ceil(hours ÷ 1.6), 1, 5)` を、凍結済みの TripPlan の `pleasures[].weight`（必須・1〜5）にそのまま書く。しおりの活動時間・保存の weight・stop-events の滞在（`weight × 96 分`）・loss の達成の重さが同じ整数から決まるので、下流は無改修で厳密に一致する（敵対レビュー 1。指示の例の「一律 3」では滞在とずれるため）。カードの「約 n 時間」はマスターの `hours`（目安）をそのまま出す
- api の入力は `pleasures[{id, weight?}]`。`weight` は任意で、送られても**使わない**（古いタブからの要求を 400 にしない互換）。範囲外（0・6・小数・文字列）は今までどおり 400。冪等キーの body の比較は届いた body のまま行う（weight だけが違う body は別の body として 409 IDEMPOTENCY_MISMATCH。plan-trip R8 のまま）
- 入りきらないときに外す順: **所要の短いもの**から（同じなら周回順で後ろのもの）。重さが無くなったので「時間をかけるものが主目的」とみなす。長い 1 件を外せば入る場面でも短いものを先に何件か外すことがある（下の Example。挙動を隠さず決めたこととして残す）
- **移動だけなら当日に移動する**: 今日の枠に活動が入らなくても、移動だけなら 18:00 までに次の拠点へ着けるなら、今日移動して泊まり、活動は翌朝にする。着けず、翌朝からなら 1 日に収まるときだけ、今いる場所に泊まって翌朝に移動する（重さ 5 ＝ 8 時間の前提で書かれていた待ちの規則が、短い活動で「D1 は空港で 1 日過ごす」になったため）
- **ペルソナの初期の楽しみに夜の「阿寒湖アイヌコタン」を足す**（流氷ウォーク・タンチョウ・アイヌコタン）。重さを外すと D1 の薄暮の移動が減り、ペルソナのリスクが 0.594「注意」に下がった。流氷が目的のまま（ch11 #4）、デザインの A1_Plan と plan-trip UC-4a の「高い」（0.69）を保つ。所要の値を動かして合わせることはしない。api・sim の他の feature のテストの旅は、場面を保つため「流氷・タンチョウ」に固定した（`apps/api/tests/factories/`、`apps/sim/src/test/trip-day.ts`）
- 入力中のタイトルの上位 2 件: 所要の長い順（同じなら id 順）
- 配分バー: 「重さの配分」を「時間の配分（合計 約 n 時間）」に読み替え、各楽しみの所要に比例させる。見出しは「楽しみなことを選ぶ」、補足は「それぞれの目安の時間で日程に入ります。入りきらないときは、短いものから外れます」
- 写真の置き場所: 画像は `apps/sim/public/photos/{楽しみの id}.{jpg|png}`、記録は `apps/sim/src/features/plan-trip/data/photos.json`（取得のスクリプト `apps/sim/scripts/fetch-photos.ts` が書く）。選んだファイルは `apps/sim/scripts/photo-picks.json`（人が選ぶ）
- 写真は Commons のサーバーが縮小した幅 500px のサムネイル（Commons は標準の幅に寄せるので 640px は 960px になる。500px はカード約 250px の 2 倍）。JPEG の EXIF・XMP・IPTC は落とす
- ライセンスの判定は extmetadata の `License`（コード）の許可リスト（`cc0`・`pd`・`cc-by-X.Y[-地域]`）で行い、表示名に SA・NC・ND・GFDL が入っていたら不可（敵対レビュー Q4）。パブリックドメインは指示（ユーザーの指摘を中継した brief）が明示的に許しているので使う。ch6 の「CC0 / CC-BY / 自作」との差は変更記録に書いた
- 帰属は extmetadata の `Attribution`（作者の指定）を `Artist` より優先し、HTML を平文にする（画面では文字として出す）
- 引用（TASL）: カードに撮影者（出典ページへのリンク）とライセンス名（本文へのリンク。パブリックドメインは文字だけ）。作品名（Commons のファイル名）はリンクの読み上げ名と CREDITS.md に。改変（縮小・撮影情報の除去）は A-1 の写真の注記（「写真は Wikimedia Commons から（幅 500px に縮小）」）と CREDITS.md に
- 引用はトグルのボタンの外（カードの下）に置く。ボタンのアクセシブルネームは楽しみの名前のまま。写真はボタンの中の飾り（`alt=""`、親の `aria-hidden`）。リンクの読み上げ名に楽しみの名前と「新しいタブで開きます」を入れる（同じ撮影者が並んでも区別できる）。リンクは下線つき、押せる面は高さ 24px 以上（WCAG 2.5.8）
- 顔・商標・鹿が写っていないことは機械で確かめられないので、確かめたことを記録の `review` に残す（Claude がサムネイルを目視）
- 写真が見つからない楽しみは `photo-placeholder` の面のまま。2026-11-06 の時点では 24 件すべてに写真がある。季節や題材が理想からずれる 3 件（納沙布岬＝灯台・野付＝夏・知床五湖＝夏）は、条件に合う写真が無かったので据え置き（`docs/reports/2026-11-06-photo-research.md`）
- 保存済みの旅の扱い: 組み立ての式が変わったので、以前に保存した旅（ローカルも deploy-a の Turso も）は A-2 で「いまのマスターで作り直せません」になる。ハッカソン中なので作り直してもらう（変更記録に書いた）。マスターの `hours` を直すときも同じことが起きる（Deferred）

- R1 標準の所要（A1-4 の変更）: 楽しみのマスター 24 件それぞれに `hours`（0.5〜8、0.5 刻み）を持たせる。値は補足の「半日」「1日」「朝食」などから起こした目安で、事実の確認は plan-trip の Deferred（`verified:false`）に乗る
- R2 しおりの組み立て: 楽しみは `weightForHours(hours) × 1.6` 時間の活動として 8:00〜18:00 の枠に入れる。移動だけなら 18:00 までに着けるなら当日に移動する。入りきらなければ所要の短いものから外す。入力の `weight` は結果に影響しない（他の規則は plan-trip R3 のまま）
- R3 保存の重さ: `buildTripPlan` は `pleasures[].weight` を `weightForHours(hours)` で書く。入力の weight は無視する
- R4 画面: 楽しみのカードに重さの操作が無い。選択は名前とチェックだけ（store の選択は id だけ）。カードに「約 n 時間」。しおりパネルの配分バーは時間で
- R5 写真の選び方: CC0・パブリックドメイン・CC BY（1.0〜4.0、地域版を含む）だけ。BY-SA・NC・ND・GFDL のみは不可。人物の顔が判別できるもの・商標が大きく写るもの・鹿の写真は使わない
- R6 写真の記録: 写真ごとに、楽しみの id・ファイル・作品名・撮影者（平文）・ライセンス名・ライセンスのコード・ライセンスの URL（パブリックドメインは null）・出典ページの URL・取得日・原本の SHA-1（Commons の値。出所の識別子）・保存したファイルの SHA-256（改ざんの確認）・幅・高さ・改変の内容・写っているものの確認を持つ。画面はこの記録を zod で検証して読む（形が違う・使えないライセンス・名前が id と合わないなら例外）
- R7 引用の表示: 写真のあるカードは、カードの下に「写真: {撮影者} / {ライセンス}」（ラベルは 4 言語。撮影者とライセンス名は訳さない）を出し、撮影者は出典ページへ、ライセンス名は本文へリンクする（新しいタブ、`rel="noopener noreferrer"`）。12px・`ink-faint`（surface の上で 4.5:1）、リンクは `ink-muted` で下線。押せる面は高さ 24px 以上、タッチの端末（`pointer: coarse`）では 44px（ch8）
- R8 取得のスクリプトの安全: 通信先は `commons.wikimedia.org`（API）と `upload.wikimedia.org`・`thumb.wikimedia.org`（画像）の https だけ（ホストの完全一致・ポートとユーザー情報なし）。リダイレクトは失敗にする。API は 1 回の要求でまとめて引き、429 は Retry-After（無ければ 10・20・40 秒）だけ待って取り直す。ライセンスは API で取り直して R5 の規則で確かめ、外れたら保存しない。2 MB を受信の途中で超えたら止める。中身は先頭のバイトで JPEG・PNG かを確かめ（Content-Type を信じない）、幅・高さは実物から読み、幅 800px・高さ 1600px を超えたら保存しない。1 件でも失敗したら画像も記録も書き換えない（画像と記録を 1 対 1 に保つ。レビューの指摘）。存在しないファイル名はその 1 件だけを失敗にする。保存の名前は楽しみの id から作る（リモートの名前を使わない）。User-Agent はプロジェクト名（個人の連絡先を入れない）
- R9 CREDITS.md: 写真ごとに 1 行（楽しみ・作品名・撮影者・ライセンス（本文へのリンク）・出典 URL・取得日・改変）

## ユースケース

### UC-1: 重さを設定せずにしおりができる（R1〜R4）

- **Given**: A-1 をペルソナの初期値で開く
- **When**: 楽しみを選ぶ・外す
- **Then**: カードに重さの操作が無く、しおりは所要時間（1.6 時間の枠）で組み上がる
- **Examples**: ペルソナ（5 日、流氷 3 時間・タンチョウ 2 時間・アイヌコタン 1.5 時間）→ D1〜D5、3 件とも入り、D1 は空港に留まらず鶴居へ移動し、リスクは「高い」 / 道東の 10 件で 3 日 → 所要が最も短い和商市場（1 時間）から外れる（長い釧路湿原 4 時間 1 件を外せば入る場面でも、短いものから外す） / 入力に weight 5 を付けても付けなくても days は同じ / 保存の weight は 1 時間 → 1、2 時間 → 2、3 時間 → 2、4 時間 → 3、8 時間 → 5 / 釧路空港で 17:30 に受け取る旅 → 18:00 までに拠点へ着けないので 1 日目は空港で泊まる

### UC-2: 写真と引用（R5〜R9）

- **Given**: photos.json に記録がある楽しみ
- **When**: カードを表示する
- **Then**: 写真と「写真: 撮影者 / ライセンス」が出て、出典とライセンス本文へリンクする。記録の無い楽しみは placeholder
- **Examples**: CC BY 4.0 の写真 → 引用が出る / ライセンスのコードが cc-by-sa-4.0 → 不可 / コードが cc-by-4.0 でも表示名が CC BY-SA 4.0 → 不可 / 画像の SHA-256 が記録と違う → 不合格 / CREDITS.md に出典 URL が無い → 不合格 / `https://upload.wikimedia.org.evil.example/` → 通信しない / 中身が HTML で Content-Type だけ image/jpeg → 保存しない

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（事実確認）/ 期日=2026-11-08（Day 6）/ 暫定挙動=Claude が補足から起こした値（verified:false）を使う] 楽しみ 24 件の標準の所要 `hours` が妥当か。直すと、その楽しみを含む保存済みの旅は A-2 で作り直せなくなる
- [Deferred: 担当=Claude（stop-events・loss の担当のセッション）/ 期日=2026-11-08 / 暫定挙動=換算した重さ（枠の数）がそのまま出る] stop-events のモーダル（「重さ n」）と loss の達成の重さに残る「重さ」の表示を、時間の表示に言い換えるか消すか（ユーザーの「今後も不要」に合わせる。担当のディレクトリの外なので follow-up）
- [Deferred: 担当=ユーザー / 期日=2026-11-08 / 暫定挙動=いまの写真のまま] 季節・題材がずれる 3 件（納沙布岬の日の出・野付半島の氷平線・知床五湖の冬）を、自分で撮った写真や許諾のある写真に差し替えるか（ch6「写真は最終的に自身で撮影したものか許諾あるもの」）

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] PAC-1: A-1 をペルソナの初期値で開くと、楽しみのカードに重さの操作が無く、写真のあるカードは写真と引用（出典へのリンク）を出し、右パネルに D1〜D5 と時間の配分が出る

UC-1 重さを外す:

- [x] DUR-1: マスターの 24 件すべてに `hours`（0.5〜8、0.5 刻み）がある
- [x] DUR-2: ペルソナ → D1〜D5 に流氷ウォーク・タンチョウ・アイヌコタンが入り、D1 は空港に留まらず、リスクは「高い」。入力の weight を変えても消しても days は同じ
- [x] DUR-3: 入りきらない → 所要の短いものから外れ（同じなら周回順で後ろ）、skipped に入る。外れたものの所要は残ったものの最短以下
- [x] DUR-4: 保存の weight は `weightForHours`（1 時間 → 1、2 時間 → 2、3 時間 → 2、4 時間 → 3、8 時間 → 5。切り上げ）で、入力の weight を使わない。TripPlanSchema を通る
- [x] DUR-5: api の入力（共有の TripInputSchema）は weight の無い pleasures を受け、weight 付き（1〜5）も受ける。weight 0・6 は通らない
- [x] DUR-6: 入力中のタイトルの上位 2 件は所要の長い順
- [x] DUR-7: カードに重さの操作が無く「約 n 時間」が出る。選ぶ・外すで store の選択は id だけ

UC-2 写真と引用:

- [x] PH-1: photos.json の各記録は R6 の欄がそろい、ライセンスは CC0・パブリックドメイン・CC BY だけ（SA・NC・ND を含まない）、楽しみの id はマスターにあり重複しない
- [x] PH-2: 記録の各画像が `apps/sim/public/photos/` にあり、SHA-256 が記録と一致し、中身は JPEG・PNG で、実物の幅・高さが記録と同じで幅は 800px 以下
- [x] PH-3: CREDITS.md に各写真の出典 URL・撮影者・ライセンス・改変（縮小）がある
- [x] PH-4: 写真のあるカードは画像（`alt=""`）と「写真: 撮影者 / ライセンス」を出し、撮影者は出典へ、ライセンス名は本文へ新しいタブでリンクする（`noopener noreferrer`）。引用はトグルのボタンの外で、ボタンの名前は楽しみの名前だけ
- [x] PH-5: 写真の記録が無いカードは placeholder の文言を出し、引用を出さない
- [x] PH-6: 取得のスクリプトの判定（純粋関数）: ライセンスの許可・不許可（コードと表示名の食い違いを含む）、通信先のホストの許可・不許可、先頭のバイトによる画像の種類、実物の幅・高さ、JPEG の撮影情報の除去、HTML の撮影者の平文化

## Rule → ドメイン語彙対応

| Rule           | 語彙                                   | 置き場所                                        | 証明         |
| -------------- | -------------------------------------- | ----------------------------------------------- | ------------ |
| R1: 標準の所要 | `Pleasure.hours`                       | packages/trip/src/pleasures.ts                  | DUR-1        |
| R2: 組み立て   | `buildItinerary` / `activityHours`     | packages/trip/src/itinerary.ts                  | DUR-2・DUR-3 |
| R3: 保存の重さ | `weightForHours` / `buildTripPlan`     | packages/trip/src/plan.ts                       | DUR-4        |
| R4: 画面       | `PleasureCard` / `AllocationBar`       | apps/sim/src/features/plan-trip/components/     | DUR-7        |
| R5・R8: 取得   | `isAllowedLicense` / `isAllowedSource` | apps/sim/src/shared/utils/photo-rules.ts        | PH-6         |
| R6: 写真の記録 | `photoOf`                              | apps/sim/src/features/plan-trip/utils/photos.ts | PH-1・PH-2   |
| R7: 引用の表示 | `PhotoCredit`                          | apps/sim/src/features/plan-trip/components/     | PH-4・PH-5   |

## 受け入れ基準

- [x] 受け入れテスト PAC-1 が Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型）
- [x] plan-trip の仕様（R1・R2・R3）を直し、drift がきれい
