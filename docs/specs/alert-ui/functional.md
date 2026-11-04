---
feature: alert-ui
target_paths:
  - packages/schema/
  - packages/alert-ui/
  - edge/detector/tests/test_schema_contract.py
spec_confirmed_at: 541cfb5
tier: 2
---

# 仕様: alert-ui（共通スキーマと 3 状態アラート）

## 概要

A の車内スマホと B の PWA が、同じ型（`@antler/schema`）と同じ部品（`@antler/alert-ui` の `AlertState`）で、
鹿ゾーンと前方の鹿を同じ色・形・音・言葉で伝える。要件: ch5-common.md（3 状態表・音・多言語・a11y・同意）、
ch7-data.md（TripPlan / AlertFlag / Capture）、ch4-edge.md B4-2〜B4-7、ch8-design.md 規約 1〜8、
docs/design/AlertState.md、docs/design/tokens.json。

**範囲外**（別 feature）: GPS × 鹿ゾーンの判定そのもの（B4-5 の判定は PWA、ゾーンの GeoJSON は zones）、
Wake Lock・回転ロック（B4-6 の残り）、「未接続」の灰色帯（ch6、PWA）、WebSocket の接続、Capture の保存と送信。

**追記（2026-11-03、schema-judge）**: 凍結後に `packages/schema` へ次を**追加**した（既存の欄は変えない）。仕様は `docs/specs/schema-judge/`。
`AlertFlag.l1`・`Capture.l1Probs`（どちらも任意）、新しい型 `JudgeRequest`。`readAlertFlag` は厳しい検証（`strict`）を `l1` を除いて判定する
（`l1` だけが壊れた deer:false を PWA が捨てて赤が解けなくなるのを防ぐ。R11 の「deer を最優先で読む」と同じ向き）。

## Example Map

Story: A の車内スマホを見るプレイヤーと B の PWA を見るドライバーとして、鹿ゾーンと前方の鹿を、
画面を読まなくても同じ色・形・音で知りたい。誤った表示で旅を失わないために。

- R1: 3 つの型（と WebSocket のメッセージ）は packages/schema だけで定義し、TS の型と JSON Schema を同じ定義から作る
  - ch7 の AlertFlag の例 → 通る / `v:2` → 拒否 / deer:true で distanceM が無い → 拒否
  - inside で zoneRemainingKm、outside で zoneDistanceKm（次のゾーンが無ければ省略可）。逆の組み合わせ → 拒否
  - Capture に lat・lng・email・deviceId → 拒否 / consent が無い → 拒否 / consent:false → 通る
  - roadSegment に `43.1751,144.3` → 拒否（英数字とハイフンだけ）/ boxes 0 件 → 通る / xywh が 0〜1 の外 → 拒否 / reactionMs が負 → 拒否
  - TripPlan の ch7 の例 → 通る / pleasures 11 件 → 拒否 / weight 0・6 → 拒否 / drivers > size → 拒否
  - 凍結後の追加（既存の型は変えない）: `TripDetails`（plan-trip の Claude の文。4 言語のタイトル・日ごとの説明・入りきらない楽しみ）。edge は使わないので JSON Schema には書き出さない。仕様は docs/specs/plan-trip/、形の検証は plan-trip の AC-1（2026-11-03、推奨で決定、alert-contract-guard Critical 0）
  - 時刻はタイムゾーン付きの ISO 8601。`Z` も `+09:00` も通り、JST に正規化できる。タイムゾーン無し → 拒否
  - クライアント → サーバーは ack（t_shown）と label だけ。クライアントが flag を送る形 → 拒否
  - edge（Python）は書き出した JSON Schema で同じ見本を検証して同じ結果になる
- R2: 表示する状態は「最新のフラグ・その受信時刻・GPS のゾーン判定・前の状態」から決まる
  - 解除の 1.5 秒は edge（A はシミュレーター）が数える。alert-ui は数えない（二重に数えない）
  - フラグが新しい（受信から 5 秒以内）かつ deer:true → ゾーンに関係なく danger
  - deer:false が届いた → すぐ前の状態（ゾーン内なら zone、外なら safe）
  - 最後が deer:true のまま 5 秒届かない（切断・停止）→ 危険側に倒して 5 秒は danger、過ぎたらゾーンの状態へ
  - フラグの zone と GPS のどちらかが inside → zone。GPS が不明で新しいフラグも無い → 前のゾーンの状態を保つ
  - 起動してからゾーンの内外が一度も分かっていない（GPS が unknown のまま・前の状態が無い）→ zone（琥珀）。緑は「ゾーン外と分かった」ときだけ出す（2026-11-03 ユーザー判断。alert-contract-guard C-1。R9 の「緑はゾーン外であって安全ではない」）
  - フラグが 1 つも来ない（Mac Mini なし）→ safe / zone だけが出て danger は出ない（B4-5）
- R3: AlertState は状態ごとに背景・形・主数値・文言が決まる（AlertState.md の表）
  - safe, 38 → alert-safe の背景、円＋チェック、「38 km」、主文「鹿ゾーンまで」
  - zone, 14.2 → alert-zone、三角＋鹿ピクト、「14 km」、主文「鹿ゾーン走行中」、補助「減速 50 km/h 以下に」（B4-3）
  - danger, 58, side L → alert-danger、八角＋鹿ピクト、左向き矢印、「58 m」、主文「前方に鹿」、補助「ブレーキ」（B4-4）
  - danger, side 無し → 上向き（前方）の矢印
  - 背景色は data-theme を trip / night に変えても同じ
- R4: danger は白枠 14px を 1 Hz（0.5 秒ごとに切り替え）で点滅し、1 Hz を超えない。動きを減らす設定でも止めない
- R5: 音は状態の変化で鳴る（音の解除は alert-ui が公開し、PWA の B-0 で呼ぶ）
  - zone に入った瞬間にチャイム 1 回。zone のまま再描画しても鳴らない。最初の描画が zone でも鳴る
  - safe → danger → zone（危険の間にゾーンに入った）→ zone になった時点で鳴る。danger → zone（入ったことを知らせ済み）→ 鳴らない
  - zone を出てから 30 秒以内に入り直した → 鳴らない（GPS の揺れ）。30 秒を過ぎて入った → 鳴る
  - danger の間はビープを繰り返す。間隔は距離不明で 0.25 秒、120 m 以上で 0.4 秒、30 m 以下で 0.12 秒、その間は直線
  - danger に入ってビープ 2 回のあとに 1 回だけ読み上げ。2 回目の前に danger が解けた → 読み上げない
  - muted → 何も鳴らさない。danger の途中で muted になった → 次のビープから止まる
  - 音の解除前に danger が来た → 画面だけ出し、`canPlay` は false のまま
  - A でアラート OFF → 消費側は danger を渡さない（safe / zone とゾーン進入のチャイムは残る。A5-4・A5-1）
- R6: 4 言語（ja / en / zh = zh-TW / ko）。主文は lang、副文に残り 3 言語の一語を常に出す（B4-7）
  - lang=ja, danger → 主文「前方に鹿」、副文「DEER AHEAD ・ 前方有鹿 ・ 전방 사슴」
  - 端末の言語が zh-TW / zh-Hant → zh、zh-CN・fr → en、ko-KR → ko、ja-JP → ja
- R7: compact（A の車内スマホ）は数値と形だけ。文字は 9px、副文は出さない
- R8: 操作要素を置かない。タップで消えない
- R9: tokens.json から CSS 変数（tokens.css）と TS 定数（tokens.ts）を作る。生成物を手で直さない。alert-* はテーマで変わらない
  - TS 定数はサブパス `@antler/alert-ui/tokens` からも読める（React を読まずに色だけ使う api の SSR・OG 画像のため。record で追加、2026-11-04。既存の export は変えない）
- R10: 支援技術に状態を伝える
  - danger は割り込みで、入ったときの 1 回だけ「前方に鹿 左 58 メートル」のように伝える。距離が変わっても読み直させない
  - safe / zone は状態が変わったときだけ穏やかに伝える
  - 文字のコントラストは 3 状態とも 4.5:1 以上（on-alert-* と alert-* の組み合わせ）
  - [ADDED 2026-11-03・ユーザー決定] 元の alert-danger（白文字と 4.02:1）は ch5 の「4.5:1 以上（確認済み）」に届かなかった。
    ユーザー判断「赤を濃くする」により、色相・彩度を保って明度だけを下げた色（白文字と 4.6:1）に変えた。
    赤と緑の輝度比も 1.3 から 1.6 に広がり、「明度でも区別」も満たす（docs/design/tokens.json）
- R11: 受信時はゆるく読む（契約テストは厳しく、受信は deer を最優先）
  - deer:true で他の項目が壊れている → danger として読む（距離は無し → 「--」）
  - JSON でない・type が flag でない → 無視（前の状態のまま）
  - conf で間引かない（deer:true, conf 0.3 → danger）
- R12: 数値の表示
  - km: 10 未満は小数 1 桁（9.4）、10 以上は整数（38）。無い → 「--」。0 → 「0.0」
  - m: 整数（58）。無い → 「--」。0 → 「0」。負・NaN → 「--」
- R13: 鹿のピクトグラムは自作の stroke SVG 1 つを全画面で共有する

Questions は全問決着（2026-11-03、ユーザー回答「全部推奨で」）。保留は下の 3 件。

## ユースケース

### UC-1: 共通スキーマ（R1）

- **Given**: A・B・API・edge が受け渡す JSON
- **When**: `@antler/schema` の検証にかける / edge が書き出した JSON Schema で検証する
- **Then**: ch7 の形に合うものだけ通り、個人情報・精密位置・範囲外の値は拒否される。TS と Python で結果が同じ
- **Examples**: R1 の各行

### UC-2: 表示状態の決定（R2）

- **Given**: 最新のフラグと受信時刻、GPS のゾーン判定（inside / outside / unknown）、前の状態、現在時刻
- **When**: `deriveAlertState` を呼ぶ
- **Then**: safe / zone / danger と表示する距離が一意に決まる
- **Examples**: R2 の各行

### UC-3: 状態ごとの表示（R3）

- **Given**: state・distance・side・lang
- **When**: `AlertState` を描画する
- **Then**: 背景・形・主数値・単位・矢印・主文・補助文が AlertState.md のとおり
- **Examples**: R3 の各行

### UC-4: danger の点滅（R4）

- **Given**: state=danger
- **When**: 時間が進む
- **Then**: 白枠が 0.5 秒ごとに表示・非表示を繰り返す。safe / zone では点滅しない

### UC-5: 音（R5）

- **Given**: 音の制御（`AlertSoundController`）に状態の列が届く
- **When**: 状態・距離・muted が変わる
- **Then**: チャイム・ビープ・読み上げが R5 のとおり鳴る / 鳴らない

### UC-6: 言語（R6）

- **Given**: lang、または端末の言語の一覧
- **When**: 描画する / `resolveLang` を呼ぶ
- **Then**: 主文と副文が R6 のとおり。4 言語以外は en

### UC-7: compact（R7）

- **Given**: compact=true
- **When**: 描画する
- **Then**: 形と数値だけ（文字 9px、副文なし）

### UC-8: 操作要素なし（R8）

- **Given**: どの状態でも
- **When**: 描画してタップする
- **Then**: button・a・input が無く、状態が変わらない

### UC-9: トークンの生成（R9）

- **Given**: docs/design/tokens.json
- **When**: 生成スクリプトを回す
- **Then**: tokens.css・tokens.ts がリポジトリのものと一致する。alert-* は trip と night で同じ

### UC-10: 支援技術（R10）

- **Given**: 状態が変わる / danger の間に距離が変わる
- **When**: 描画する
- **Then**: danger は入ったときだけ割り込みで伝え、safe / zone は状態の変化だけを伝える。コントラストは 4.5:1 以上

### UC-11: ゆるい受信（R11）

- **Given**: WebSocket で届いた文字列
- **When**: `readAlertFlag` を呼ぶ
- **Then**: deer を最優先で読み、壊れた項目は無いものとして扱う。flag でなければ null

### UC-12: 数値の表示（R12）

- **Given**: 距離の値と単位
- **When**: 整形する
- **Then**: R12 のとおり

### UC-13: 鹿ピクトの共有（R13）

- **Given**: zone と danger の AlertState
- **When**: 描画する
- **Then**: 同じ `DeerPictogram` が使われる

## 状態パターン

### S-1: safe

- **Given**: ゾーン外・鹿なし → **Then**: alert-safe、円＋チェック、次のゾーンまでの km（無ければ「--」）、音なし

### S-2: zone

- **Given**: ゾーン内・鹿なし → **Then**: alert-zone、三角＋鹿ピクト、ゾーン終了までの km、進入時チャイム

### S-3: danger

- **Given**: 新しい deer:true → **Then**: alert-danger、八角＋鹿ピクト、距離 m と矢印、白枠 1 Hz 点滅、ビープと読み上げ

### S-4: 音が出せない

- **Given**: 音の解除前 → **Then**: 画面はそのまま出し、`canPlay` が false

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（人 A）/ 期日=2026-11-04（Day 2）/ 暫定挙動=ブラウザの読み上げ（Web Speech API の speechSynthesis）で、主文の言語の「前方に鹿がいます」を読む] 読み上げ音声ファイル 4 言語の作り方とライセンス
- [Deferred: 担当=ユーザー（ネイティブ確認）/ 期日=2026-11-07（Day 5 の多言語）/ 暫定挙動=この仕様の訳（距鹿區・鹿區行駛中・前方有鹿、사슴 구역까지・사슴 구역 주행 중・전방 사슴）を表示する] zh-TW と ko の文言の確認
- [Deferred: 担当=ユーザー（PO）/ 期日=2026-11-06（Day 4 の dataset）/ 暫定挙動=alert-ui では保存・削除をしない（型だけ）] Capture の画像の保持期間と、consent:false の画像を消すタイミング

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: ch7 の AlertFlag の例を `readAlertFlag` → `deriveAlertState` → `AlertState` に通すと、B と A（compact）の両方で danger・58 m・左矢印・「前方に鹿」が出て、ビープ 2 回のあと読み上げが 1 回鳴る
- [x] AC-2: フラグなし・GPS がゾーン内 → zone とチャイム 1 回。ゾーン外へ出る → safe。danger は一度も出ない（Mac Mini なし、B4-5）

UC-1 共通スキーマ:

- [x] UC-1a: ch7 の AlertFlag・TripPlan・Capture の例が通る
- [x] UC-1b: AlertFlag の `v:2`・deer:true で distanceM 無し・deer:true で side 無し・conf が 0〜1 の外 → 拒否
- [x] UC-1c: inside で zoneDistanceKm、outside で zoneRemainingKm → 拒否。outside で zoneDistanceKm 無し → 通る
- [x] UC-1d: Capture に lat / lng / email / deviceId を足す → 拒否。consent 無し → 拒否。consent:false → 通る
- [x] UC-1e: Capture の roadSegment に座標・空文字 → 拒否。boxes 0 件 → 通る。xywh が範囲外・reactionMs が負 → 拒否
- [x] UC-1f: TripPlan の pleasures 11 件・weight 0 と 6・drivers > size・重複した楽しみ → 拒否
- [x] UC-1g: 時刻は `Z` と `+09:00` が通り、タイムゾーン無しは拒否。`toJst` が +09:00 に正規化する
- [x] UC-1h: ClientMessage は ack と label だけ通り、flag の形 → 拒否
- [x] UC-1i: 書き出した JSON Schema（packages/schema/json/）が定義から作り直したものと一致する
- [x] UC-1j: edge（Python）が JSON Schema で共有の見本（packages/schema/fixtures/）を検証し、valid は通り invalid は落ちる
- [x] UC-1k: [ADDED code-reviewer] JSON Schema の正規表現を Python でも同じ意味にする（`\d`→`[0-9]`、末尾 `$` は改行の前に当たらない）。全角数字・末尾改行の見本で確かめる

UC-2 表示状態の決定:

- [x] UC-2a: ゾーン外・フラグなし → safe、GPS の次ゾーン距離
- [x] UC-2b: GPS inside → zone、残り距離
- [x] UC-2c: 新しい deer:true → GPS が outside でも danger、距離 m と side
- [x] UC-2d: deer:false が届く → すぐ zone（inside）/ safe（outside）
- [x] UC-2e: 最後が deer:true のまま 5 秒以内 → danger のまま。5 秒を過ぎた → ゾーンの状態
- [x] UC-2f: フラグの zone が inside・GPS が outside → zone。逆も zone
- [x] UC-2g: GPS unknown で新しいフラグも無い → 前のゾーンの状態を保つ
- [x] UC-2h: フラグが 1 つも無い → danger にならない
- [x] UC-2i: [ADDED alert-contract-guard] 起動直後で GPS が unknown・前の状態なし → zone（距離「--」）。その後 outside が分かれば safe、unknown が続く間は zone のまま

UC-3 状態ごとの表示:

- [x] UC-3a: safe 38 → 円＋チェック、「38」「km」、主文「鹿ゾーンまで」、背景は --alert-safe
- [x] UC-3b: zone 14.2 → 三角＋鹿ピクト、「14」「km」、「鹿ゾーン走行中」「減速 50 km/h 以下に」、背景は --alert-zone
- [x] UC-3c: danger 58 L → 八角＋鹿ピクト、左矢印、「58」「m」、「前方に鹿」「ブレーキ」、背景は --alert-danger
- [x] UC-3d: danger で side 無し → 前方の矢印。side R → 右矢印
- [x] UC-3e: 背景色はトークンの alert-* を参照し、data-theme で変わらない

UC-4 点滅:

- [x] UC-4a: danger → 白枠が 0.5 秒ごとに切り替わる（1 秒に 1 周期）。safe / zone では点滅しない
- [x] UC-4b: 点滅は CSS アニメーションに頼らない（動きを減らす設定の全体指定で止まらない）

UC-5 音:

- [x] UC-5a: safe → zone でチャイム 1 回。zone のまま更新しても鳴らない
- [x] UC-5b: 最初の状態が zone → チャイム 1 回
- [x] UC-5c: safe → danger → zone で 1 回。zone → danger → zone では 2 回目は鳴らない
- [x] UC-5d: zone を出て 30 秒以内に入り直す → 鳴らない。30 秒を過ぎて入る → 鳴る
- [x] UC-5e: `beepIntervalMs`: 不明 0.25 秒、120 m 以上 0.4 秒、30 m 以下 0.12 秒、75 m は直線上の値
- [x] UC-5f: danger の間ビープが間隔どおり繰り返し、danger が解けたら止まる
- [x] UC-5g: ビープ 2 回のあとに読み上げ 1 回（lang の文）。2 回目の前に解けたら読まない。同じ danger の間は 2 回目を読まない
- [x] UC-5h: muted ならチャイムもビープも読み上げも鳴らない。danger の途中で muted → 次から止まる
- [x] UC-5i: 解除前は何も鳴らさず canPlay=false。`unlock()` 後は canPlay=true
- [x] UC-5j: [ADDED alert-contract-guard] 起動直後で位置が不明（距離「--」の zone）→ チャイム 1 回。不明のあいだは鳴らず、outside と分かって safe になっても鳴らない
- [x] UC-5l: [ADDED code-reviewer] danger の AlertState が画面から外れたら、ビープと発話が止まる

UC-6 言語:

- [x] UC-6a: lang=ja danger → 主文「前方に鹿」、副文「DEER AHEAD ・ 前方有鹿 ・ 전방 사슴」
- [x] UC-6b: lang=en / zh / ko でも主文はその言語、副文は残り 3 言語（safe・zone も同じ）
- [x] UC-6c: `resolveLang`: ja-JP→ja、zh-TW・zh-Hant-TW→zh、ko-KR→ko、zh-CN・fr・空→en

UC-7 compact:

- [x] UC-7a: compact → 形と数値と矢印だけ。主文・補助文・副文が無い

UC-8 操作要素なし:

- [x] UC-8a: 3 状態とも button・a・input が無く、クリックしても表示が変わらない

UC-9 トークン:

- [x] UC-9a: 生成スクリプトの出力が、リポジトリの tokens.css・tokens.ts と一致する
- [x] UC-9b: tokens.css で --alert-* は trip と night の両方で同じ値

UC-10 支援技術:

- [x] UC-10a: danger に入ると role="alert" に「前方に鹿 左 58 メートル」。距離が 40 に変わっても文は変わらない
- [x] UC-10b: safe / zone は role="status" で、状態が変わったときだけ文が変わる
- [x] UC-10d: [ADDED accessibility-checker] alert と status の要素を常に置き、role を切り替えない（role の切替は読まれない SR が多い）
- [x] UC-10e: [ADDED accessibility-checker] 読み上げ文に lang 属性。いまの距離はライブでない要素で読める（状態の変化時の通知と分ける）
- [x] UC-10f: [ADDED code-reviewer] 距離が分からないときは距離の句を読ませない。言語が変わったら読み上げ文を作り直す
- [x] UC-10c: 3 状態とも on-alert-* と alert-* のコントラストが 4.5:1 以上。赤と緑の輝度比が 1.5 以上（tokens.json から計算）

UC-11 ゆるい受信:

- [x] UC-11a: 正しいフラグ → そのまま読む
- [x] UC-11b: deer:true で distanceM が文字列・side が "X" → danger、距離・side は無し
- [x] UC-11c: JSON でない・type が ack → null
- [x] UC-11d: deer:true, conf 0.3 → deer:true のまま（間引かない）

UC-12 数値:

- [x] UC-12a: km: 9.44→「9.4」、10→「10」、38.6→「39」、0→「0.0」、無し→「--」
- [x] UC-12b: m: 58.4→「58」、0→「0」、負・NaN・無し→「--」
- [x] UC-12c: [ADDED code-reviewer] 10,000 以上（壊れた値）は「--」。指数表記を出さない

UC-13 鹿ピクト:

- [x] UC-13a: zone と danger で同じ DeerPictogram の SVG（同じ path）が描かれる

状態パターン:

- [x] S-1: safe の表示（UC-3a と同じテストで確かめる）
- [x] S-2: zone の表示（UC-3b と同じテストで確かめる）
- [x] S-3: danger の表示（UC-3c と同じテストで確かめる）
- [x] S-4: 音の解除前でも danger の画面は出る

認可（threat.md）:

- [x] AUTH-1: PWA が flag の形をクライアント → サーバーで送ると ClientMessage の検証で拒否される
- [x] AUTH-2: edge が作る Capture に lat を入れると拒否される
- [x] AUTH-3: B の PWA が作る Capture に lng を入れると拒否される
- [x] AUTH-4: A が作る Capture に email を入れると拒否される
- [x] AUTH-5: API が受け取る Capture に deviceId があると拒否される
- [x] AUTH-6: consent:false の Capture は edge・A のどちらから来ても `isUploadable` が false
- [x] MASS-1: ClientMessage・Capture・TripPlan に余分なフィールドを足すと拒否される

障害耐性（resilience.md）:

- [x] FAIL-1: JSON でない文字列を受けても状態が変わらず、logger.warn に本文が入らない
- [x] FAIL-2: v:2 で deer:true のフラグ → danger になる
- [x] FAIL-3: AudioContext の再生が例外を投げても AlertState の描画は続き、canPlay=false になる
- [x] FAIL-4: speechSynthesis が無くてもビープは続く
- [x] FAIL-5: 時計が後ろへ戻っても danger を早く解かない
- [x] IDEM-1: 同じ状態で update を 10 回呼んでもチャイムは 1 回
- [x] IDEM-2: unlock を 2 回呼んでも AudioContext は 1 つ
- [x] CONC-1: danger → zone → danger を 1 秒以内に繰り返しても、古いビープの予約が残らず、読み上げは各 danger で 1 回ずつ（前の発話は止まる）
- [x] CONC-2: [ADDED code-reviewer] 読み上げ済みの danger → zone → 消音のまま danger → 消音を解く と、新しい danger の読み上げが鳴る
- [x] FAIL-6: [ADDED code-reviewer] 再生に失敗したあと unlock をやり直して成功すれば canPlay に戻る
- [x] FAIL-7: [ADDED code-reviewer] 出力側の unlock が同期で例外を投げても（AudioContext の無い端末）、呼び出し元に漏らさず false を返す
- [x] FAIL-8: [ADDED code-reviewer] danger が解けたら発話を止め、release でビープも発話も止まる

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule               | 語彙                                                                   | 置き場所                          | 証明             |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------- | ---------------- |
| R1: 共通スキーマ   | AlertFlagSchema / CaptureSchema / TripPlanSchema / ClientMessageSchema | packages/schema/src/              | UC-1             |
| R2: 表示状態の決定 | deriveAlertState                                                       | packages/alert-ui/src/state/      | UC-2             |
| R3・R7・R8: 表示   | AlertState                                                             | packages/alert-ui/src/components/ | UC-3・UC-7・UC-8 |
| R4: 点滅           | useBlink                                                               | packages/alert-ui/src/components/ | UC-4             |
| R5: 音             | AlertSoundController / beepIntervalMs                                  | packages/alert-ui/src/sound/      | UC-5             |
| R6: 言語           | resolveLang / ALERT_TEXT                                               | packages/alert-ui/src/i18n/       | UC-6             |
| R9: トークン       | tokens.css / tokens.ts                                                 | packages/alert-ui/src/tokens/     | UC-9             |
| R10: 支援技術      | AlertState の読み上げ文                                                | packages/alert-ui/src/components/ | UC-10            |
| R11: ゆるい受信    | readAlertFlag                                                          | packages/schema/src/              | UC-11            |
| R12: 数値          | formatKm / formatM                                                     | packages/alert-ui/src/format/     | UC-12            |
| R13: 鹿ピクト      | DeerPictogram                                                          | packages/alert-ui/src/components/ | UC-13            |

## 非機能要件

- [ ] アクセシビリティ: 3 状態とも 4.5:1、操作要素なし、点滅 1 Hz 以下、状態を支援技術に伝える（UC-10）
- [ ] 点滅とビープは止める手段を AlertState の中に置かない（安全上必要な通知。WCAG 2.2.2 / 1.4.2 の essential 扱い）。音量・消音の手段は消費側（B-0、A の音トグル）が必ず持つ
- [ ] 遅延: `deriveAlertState` と描画は同期で、フラグ受信から次の描画までに待ちを入れない（ch6 の描画 ≤ 50 ms の予算を alert-ui が食わない）
- [ ] オフライン: 音源（wav）は同梱し、ネットワークを使わない（ch8 規約 4、B PWA）
- [ ] 色の直書きなし（hook）、アイコンはインライン SVG（ch8 規約 7）

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC / 全状態パターンのテストが Green
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型、edge の ruff）
- [ ] alert-contract-guard が Critical 0
