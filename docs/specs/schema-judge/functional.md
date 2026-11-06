---
feature: schema-judge
target_paths:
  - packages/schema/
  - edge/detector/src/detector/schema/
  - edge/detector/scripts/
  - edge/detector/tests/test_judge_request_model.py
  - edge/detector/tests/test_schema_contract.py
  - edge/detector/pyproject.toml
spec_confirmed_at: 9b54027
tier: 2
---

# 仕様: schema-judge（L1 判断の契約 JudgeRequest と、AlertFlag.l1・Capture.l1Probs）

**edge-day0 の 640×480 の書き出し（2026-11-06）での変更**: target_paths の `edge/detector/scripts/` にある `export_yolo_world.py`（edge-day0 の道具）の `--imgsz` の既定を変えた。schema と JudgeRequest には触れていない。この feature の挙動は変わらない。

## 概要

B の判断を 3 層にする変更（`docs/changes/2026-11-03-b-l1-local-jev.md`）の Step 1。L0（YOLO）が決定的に計算した状態を、
Mac mini 上の jev 互換サーバー（local-jev）に文字で渡す **`JudgeRequest`** を `@antler/schema` に足し、
TypeScript の型（Zod）・JSON Schema・Python の pydantic を **同じ定義から作って一致を確かめる**。
あわせて、既存の型に **任意フィールドを 2 つだけ**足す: `AlertFlag.l1`（ログと評価用。PWA は読まない）、`Capture.l1Probs`（ソフトラベル）。

要件の正: 変更指示 §3.3 と、**要件定義書の原本（Claude Docs）第 7 章の `JudgeRequest` の例**（2026-11-03 に原本を読んだ。
リポジトリの `docs/requirements/ch7-data.md` の写しはまだ古く、`JudgeRequest` が無い。写しは原文のまま残す規約なので直さない。再エクスポートはユーザーの作業）。
原本の例にあって変更指示の箇条書きに無い欄が 1 つある: トップレベルの `model`（例は `"jev-latest"`）。「形は第 7 章の例と同一」に従い、`model` を含める。

**範囲外**（別 feature）: L1 のクライアント（`l1/client.py`）、質問定義の利用側（`l1/questions.py`）、応答の型（choice / probabilities / confidence）、
`fusion.py`、校正（`calibrate.py`）、PWA の表示、A 側。**`JudgeRequest` を作る・送る処理はこの feature に無い**（型と検証だけ）。
応答の型は原本の注記（「応答は question ごとに choice / probabilities / confidence」）にあるだけで形が決まっていないので、edge-l1 の cycle で決める。

> 2026-11-06 pwa-https が `config.py` に `[tls]`・`[pwa_server]` を、`AlertServer` に省略できる `ssl_context` を足した（`pyproject.toml` は E501 の除外だけ）。`[judge]` と AlertFlag の形は変わらない。

## Example Map

Story: B の edge を書く人と、A のシミュレーションログから校正用ラベルを作る人として、L1 に渡す入力と、その結果を残す欄を、
TS・JSON・Python のどれで読み書きしても同じ形・同じ質問文で扱いたい。凍結済みの既存の型を壊さずに。

- R1: `JudgeRequest` は `{ model, state, questions }`（ch7 原本の例と同じ形）。画像・位置・個人情報は入れられない
  - 原本の例（`model: "jev-latest"`、track 2 点、ttcSec 3.9）→ 通る。この例を見本 `ch7-example.json` に**逐語で**置く
  - `model` は英数字で始まり、英数字と `.` `_` `:` `-` だけの 64 字までの文字列（`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`。例 `jev-latest`、`llm-qwen2.5-1.5b`）。欠落・空文字・空白や改行・65 字 → 拒否。値は `jev-latest` に固定しない（config.yaml の `l1.model` で変わる）。字数の数え方が JS と Python で違わないよう ASCII に限る
  - `state` は strict: 余分なキー（`frameJpegB64`・`lat`・`lng`・`deviceId` など）→ 拒否。トップレベルの余分なキー → 拒否
  - `state.speedKmh`: 0 以上の数。`zone`: `inside | outside`（AlertFlag と同じ語）。`light`: `dawn | day | dusk | night`（Capture と同じ語）。`headlight`: `off | low | high`
  - `state.track`: 1 件以上 64 件まで。edge が時刻順（`t` の昇順）に並べ、受け側は順序を前提にしない。各点は `{ t, conf, distanceM, lateralMps, side, pos }`、すべて必須、余分なキー → 拒否
    - `t`: 0 以下の秒（現在 = 0、過去が負。例 -0.8）。`conf`: 0〜1。`distanceM`: 0 以上。`lateralMps`: 符号つきの数（負も可。正負の向きの定義は edge-l0 の cycle で決め、この feature では範囲を制限しない）
    - `side`: `L | R`（`Side`）。`pos`: 小文字と `_` の語で 32 字まで（`^[a-z][a-z_]{0,31}$`。Capture の語彙と同じ形）。値の一覧は原本に例（`shoulder`）しか無いので**列挙にしない**
  - `state.ttcSec`: 0 以上の数、または `null`（衝突コースにない＝接近していないとき。JSON に無限大を書けないため）。キー自体の欠落 → 拒否
  - `state.recentAlerts30s`: 0 以上の整数（小数・負 → 拒否）
  - 数は有限であること。NaN・Infinity は TS（Zod）でも Python（pydantic）でも拒否する（JSON にも書けない値。Python の標準 `json.dumps` は書けてしまうので、受け側でも拒否して揃える）。`1e400` のように JSON として正しいが無限大に読まれる値も、TS（`JSON.parse`）と pydantic は拒否する
  - **既知の差**（3 つが 100% 同じにならない所。どちらも安全側）: (1) jsonschema だけは `1e400`（inf）を、上限の無い欄で通す。原本に無い上限を作らないため。edge は pydantic で検証する。(2) pydantic は `recentAlerts30s: 2.0` を整数として受け付けない（Zod と jsonschema は通す）。Python は整数を送る
  - `noul` は原本の綴りのまま固定する（jev の語。「直さない」）
- R2: `questions` は**ちょうど 4 問・この順・この文言**に固定する（原本の例どおり）
  - 1. `alert_level` / `choice` / "Which alert should the driver get now?" / options `["none","zone","danger"]`
  - 2. `on_roadway` / `noul` / "The animal is moving into the driving lane."
  - 3. `static_shoulder` / `noul` / "The animal is standing still on the road shoulder."
  - 4. `false_positive` / `noul` / "The detection is not a real deer (sign, snow, post)."
  - 文言を 1 語変える・3 問や 5 問・順序の入れ替え・options の順の入れ替え・余分なキー・`type` の取り違え → 拒否（質問文を変えると L1 の校正が無効になるため、スキーマで固定する）
  - TS は `JUDGE_QUESTIONS` を export し、Python は同じ内容の `JUDGE_QUESTIONS`（`detector.schema.questions`。生成物とは別のファイル）を持つ。edge-l1 の `l1/questions.py` はこれを import し、文言を書き直さない
  - 質問文を変えたいときは、この feature の仕様・見本・生成物・校正データをまとめて直す PR にする（凍結 API の変更として扱う）
- R3: `AlertFlag.l1` を**任意**で足す。`{ alert_level, conf, overrode, latencyMs }`
  - `alert_level`: `none | zone | danger`。`conf`: 0〜1（校正後 confidence）。`overrode`: 真偽値（L0 を上書きしたか）。`latencyMs`: 0 以上の数（ミリ秒。丸め方は edge の決め）
  - 4 つとも必須。余分なキー → 拒否。`l1` ごと省略 → 従来どおり通る
  - 4 通りの AlertFlag（deer true/false × inside/outside）のどれにも付けられる
  - PWA の `readAlertFlag` は `l1` を読まない・結果に含めない。`l1` つきのフラグは厳しい検証（strict）にも通るようになる（今は余分なキーとして「一部だけ読めた」になる）
  - **`l1` の中身が壊れていても、フラグの主経路を止めない**: `readAlertFlag` は厳しい検証（`strict`）を `l1` を除いて判定する。PWA は `!deer && !strict` のフラグを捨てる（壊れた deer:false は赤を解く根拠にしない）ので、`l1` だけが壊れた deer:false が捨てられて赤が解けなくなるのを防ぐ。`AlertFlagSchema` 自体は壊れた `l1` を拒否する（edge が送る前の検証用）
  - 送る側（edge）は NaN・Infinity を JSON に書かない（`allow_nan=False`）。書くと JSON として壊れ、`deer:true` も失われる（edge-l1 の feature の責務。ここでは型の側から `l1` の数を 0〜1・0 以上に絞る）
  - 既存の欄（`type, v, deer, conf, distanceM, side, zone, zoneRemainingKm, zoneDistanceKm, t_frame, t_sent, frameJpegB64`）の名前・型・条件は変えない
- R4: `Capture.l1Probs` を**任意**で足す。`{ alert_level: {none, zone, danger}, on_roadway, static_shoulder, false_positive }`
  - すべて 0〜1 の数、すべて必須（`l1Probs` ごと省略は可）。余分なキー → 拒否（位置・識別子などを紛れ込ませない。ch5）
  - `alert_level` の 3 つの合計が 1 かどうかは検査しない（JSON Schema で表せず、TS だけ厳しくすると 3 つが食い違う。校正側の責務）
  - `consent` と `isUploadable` の判定は変わらない（`l1Probs` があっても consent:false はアップロードに回さない）
  - 既存の欄の名前・型は変えない
- R5: 3 つの形（TS・JSON Schema・pydantic）は**1 つの定義（Zod）から作り、一致をテストで確かめる**
  - JSON Schema は既存の仕組み（`npm run build:json`）で `json/judge-request.schema.json` に書き出す。書き出し済みが定義と一致するテストに入れる
  - pydantic は `datamodel-code-generator`（`==0.88.0`、dev 依存）で JSON Schema から `edge/detector/src/detector/schema/judge_request.py` を作る。**手で直さない**。生成コマンドは `edge/detector/scripts/generate_models.py`（`--check` で最新か確かめる）。`pydantic` は実行時の依存
  - 3 つを揃えるための設定: 基底クラス `StrictModel`（`allow_inf_nan=False`）、数は strict（`"54"` を数として受けない）、`ttcSec` は欠落を許さない（`null` は可）、`pos` の正規表現は Python の `re` で読む（`(?!\n)$` は pydantic 既定の rust 正規表現で扱えない）、生成物にタイムスタンプを入れない
  - 生成物は JSON Schema と同じ「生成ファイル」の扱い。MUST の「スクリプトでソースを生成しない」の例外として PR に書く。ruff の対象外にし、鮮度は UC-6a で守る
  - 見本 `packages/schema/fixtures/judge-request/{valid,invalid}/` を 3 つ全部で使い、valid は全部通り invalid は全部落ちる
  - 生成物が JSON Schema から作り直したものと一致しなければテストが落ちる（古い生成物を残さない）
  - 生成物のクラス名は `JudgeRequest`。フィールド名は JSON と同じ（camelCase のまま。`ttcSec` など）。`model_dump_json` で ch7 の例が元のとおり戻る（`ttcSec: null` を落とさない）
  - `AlertFlag.l1`・`Capture.l1Probs` の pydantic は作らない（edge は AlertFlag・Capture を JSON Schema（jsonschema）で検証する既存の方式のまま）
- R6: 既存の契約を壊さない（凍結 API への追加だけ）
  - 既存の見本（alert-flag・capture・client-message・trip-plan）は、結果（通る・落ちる）が 1 件も変わらない
  - 既存の export は名前も型も変えない。足すのは `JudgeRequestSchema`・`JudgeRequest`・`JUDGE_QUESTIONS`・`AlertLevel`・`L1ResultSchema`（`AlertFlag.l1` の型）・`L1ProbsSchema`・およびそれらの型
  - `index.ts` の export は足すだけ。plan-trip の `TripDetails` との衝突は、マージで両方の export を残す
  - 書き出した JSON Schema の既存プロパティは、名前も型も変わらない（`alert-flag`・`capture` は `l1`・`l1Probs` が増えるだけ）

## Questions（Deferred のみ残存可）

決着済み（2026-11-03、依頼の方針「推奨案のある判断は推奨案で決める」により推奨で決定。PR にも書く）:

- `model` を型に含めるか → **含める**（原本の例にある。変更指示は「第 7 章の例と同一」）
- `pos`・`headlight` の値の一覧が原本に無い → `pos` は語彙の形だけ（列挙にしない）、`headlight` は `off | low | high`（例の `high` から。edge-l0 で足りなければ追加は後方互換）
- `ttcSec` が無限大のとき → `null`
- `track` の上限件数 → 64 件（spec-adversary I1 の安い保険。2.5 Hz・10 fps の窓で足りる。足りなければ後方互換で緩める）
- `model` の字種 → ASCII の `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`（spec-adversary W1。JS と Python で字数の数え方が違うため）
- `latencyMs` を整数にするか → 数（0 以上）。Python の計測値の丸めを強制しない
- pydantic の生成ツール → `datamodel-code-generator`（5 分の試作で `prefixItems`＋`const` が `tuple[Literal…]` になることを確認）

- [Deferred: 担当=edge-l0 の cycle / 期日=2026-11-05（Step 2）/ 暫定挙動=`headlight` は `off | low | high` の 3 値。L0 が知りえないときは `low` を入れる。`unknown` を足す必要が出たら追加は後方互換] `headlight` を L0 がどう知るか・不明のときの値
- [Deferred: 担当=edge-l1 の cycle / 期日=2026-11-05（Step 3）/ 暫定挙動=`l1` が無いのは「L1 を動かしていない・タイムアウト・失敗」のどれでも同じ扱い（AlertFlag に載せない）。区別は走行ログの `l1_unavailable` で残す] `l1` が無い理由の区別
- [Deferred: 担当=edge-l1 の cycle / 期日=2026-11-05（Step 3）/ 暫定挙動=応答の型は作らない（この feature は入力だけ）] L1 の応答の型（choice / probabilities / confidence）

## ユースケース

### UC-1: JudgeRequest の形（R1）

- **Given**: edge が L0 の状態から作った JSON
- **When**: `JudgeRequestSchema` で検証する
- **Then**: ch7 原本の形に合うものだけ通り、画像・位置・識別子・範囲外の値は拒否される
- **Examples**: R1 の各行

### UC-2: 質問の固定（R2）

- **Given**: `questions` に入れた配列
- **When**: 検証する
- **Then**: 原本の 4 問が、この順・この文言のときだけ通る
- **Examples**: R2 の各行

### UC-3: AlertFlag.l1（R3）

- **Given**: L1 の結果を持つ AlertFlag
- **When**: `AlertFlagSchema` と `readAlertFlag` にかける
- **Then**: 正しい `l1` は通り、壊れた `l1` は拒否される。PWA の読み取り結果は `l1` の有無で変わらない
- **Examples**: R3 の各行

### UC-4: Capture.l1Probs（R4）

- **Given**: L1 の確率を持つ Capture
- **When**: `CaptureSchema` と `isUploadable` にかける
- **Then**: 正しい `l1Probs` は通り、範囲外・欠落・余分なキーは拒否される。consent の判定は変わらない
- **Examples**: R4 の各行

### UC-5: JSON Schema（R5・R6）

- **Given**: Zod の定義と、書き出し済みの `json/*.schema.json`
- **When**: 作り直して比べる / edge の jsonschema で見本を検証する
- **Then**: 一致する。`judge-request` の見本は valid が通り invalid が落ちる。既存のプロパティは残っている

### UC-6: pydantic（R5）

- **Given**: JSON Schema から生成した `JudgeRequest`
- **When**: 見本を `model_validate` する / 生成し直して比べる
- **Then**: Zod・jsonschema と同じ結果になる。生成物は最新。質問の定数は原本の例と一致する

## 状態パターン

N/A: 状態を持たない（型と検証だけ）。

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 原本 ch7 の JudgeRequest の例が、TS（Zod）・JSON Schema（jsonschema）・pydantic の 3 つで通り、質問文を 1 語変えると 3 つとも落ちる
- [x] AC-2: `l1` つきの AlertFlag と `l1Probs` つきの Capture が通り、PWA の `readAlertFlag` の結果は従来と同じ。既存の全見本の結果が変わらない

UC-1 JudgeRequest の形:

- [x] UC-1a: ch7 原本の例（と valid の見本すべて）が通る
- [x] UC-1b: `model` の欠落・空文字・65 字・空白や改行を含む → 拒否。`jev-latest` 以外の文字列（`qwen-local`）→ 通る
- [x] UC-1c: `state` に `frameJpegB64`・`lat`・`lng`・`deviceId` を足す → 拒否。トップレベルに余分なキー → 拒否
- [x] UC-1d: `zone` が `inside|outside` の外、`light` が `dawn|day|dusk|night` の外、`headlight` が `off|low|high` の外 → 拒否
- [x] UC-1e: `track` が 0 件・65 件 → 拒否。点の `t` が正・`conf` が 0〜1 の外・`distanceM` が負・`side` が `F`・`pos` が `On Road`（語彙の外）・必須キーの欠落・余分なキー → 拒否
- [x] UC-1f: `lateralMps` が負 → 通る。`speedKmh` が負 → 拒否
- [x] UC-1g: `ttcSec` が `null` → 通る。負・欠落 → 拒否
- [x] UC-1h: `recentAlerts30s` が負・小数 → 拒否。0 → 通る
- [x] UC-1i: NaN・Infinity・`1e400` は TS でも Python（pydantic）でも拒否される（`speedKmh`・`lateralMps`・`ttcSec`）

UC-2 質問の固定:

- [x] UC-2a: 文言を 1 語変える（4 問それぞれ）→ 拒否
- [x] UC-2b: 3 問・5 問・順序の入れ替え・同じ質問の重複 → 拒否
- [x] UC-2c: `alert_level` の options の順の入れ替え・欠落 → 拒否。`type` の取り違え（choice ↔ noul）・余分なキー → 拒否
- [x] UC-2d: TS の `JUDGE_QUESTIONS` は ch7 の例の `questions` と一致し、`JudgeRequestSchema` に通る（`JUDGE_QUESTIONS` を使えば誰が作っても通る）

UC-3 AlertFlag.l1:

- [x] UC-3a: `l1` つきの 4 通りの AlertFlag（deer true/false × inside/outside）が通る
- [x] UC-3b: `conf` が 0〜1 の外・`alert_level` が `red`・`overrode` が真偽値でない・`latencyMs` が負・キーの欠落・余分なキー → 拒否
- [x] UC-3c: `l1` の無い既存の見本は結果が変わらない
- [x] UC-3d: `readAlertFlag` は `l1` つきのフラグを厳しい検証にも通し（`strict: true`、`problem` なし）、結果に `l1` を含めない
- [x] UC-3e: [ADDED spec-adversary C1] `l1` だけが壊れた deer:false のフラグは `strict: true`（PWA が捨てない）。deer:true のフラグは壊れた `l1` でも deer・距離・方向を読む。deer の欄も壊れていれば従来どおり `strict: false`

UC-4 Capture.l1Probs:

- [x] UC-4a: ch7 の Capture の例に `l1Probs` を足したものが通る
- [x] UC-4b: 確率が 0〜1 の外・`alert_level` の 3 値の欠落・3 つの質問のどれかの欠落・余分なキー（例: 位置）→ 拒否
- [x] UC-4c: `l1Probs` の無い既存の見本は結果が変わらない
- [x] UC-4d: `l1Probs` があっても consent:false は `isUploadable` が false

UC-5 JSON Schema:

- [x] UC-5a: 書き出し済みの `json/*.schema.json`（`judge-request` を含む 5 つ）が定義から作り直したものと一致する
- [x] UC-5b: edge の jsonschema が `judge-request` の見本を判定し、valid は通り invalid は落ちる。`alert-flag`・`capture` の新しい見本も同じ
- [x] UC-5c: 既存のプロパティ（AlertFlag・Capture の全キー）が JSON Schema に残り、増えたのは `l1`・`l1Probs` だけ
- [x] UC-5d: `index.ts` の既存の export がすべて残っている

UC-6 pydantic:

- [x] UC-6a: 生成物が JSON Schema から作り直したものと一致する（生成ツールのバージョン固定込み）
- [x] UC-6b: pydantic の `model_validate` が、全見本で jsonschema と同じ結果を返す
- [x] UC-6c: ch7 の例を `model_validate` → `model_dump_json` すると元の JSON に戻る（`ttcSec: null`・キー名の camelCase を保つ）
- [x] UC-6d: Python の `JUDGE_QUESTIONS` が ch7 の例の `questions` と一致し、`JudgeRequest` に通る
- [x] UC-6e: pydantic が余分なキー・文字列の数・真偽値の数・NaN・Infinity を拒否する
- [x] UC-6f: [ADDED spec-adversary I2] 既知の差が固定されている: pydantic は `recentAlerts30s: 2.0` を拒否し jsonschema は通す。`1e400` は pydantic が拒否し jsonschema が通す

## Rule → ドメイン語彙対応（Tier 2 推奨）

| Rule                        | 語彙                                                                                     | 置き場所              | 証明                       |
| --------------------------- | ---------------------------------------------------------------------------------------- | --------------------- | -------------------------- |
| R1・R2: JudgeRequest と質問 | JudgeRequestSchema / JUDGE_QUESTIONS                                                     | packages/schema/src/  | UC-1・UC-2                 |
| R3: AlertFlag.l1            | L1ResultSchema / AlertFlagSchema                                                         | packages/schema/src/  | UC-3                       |
| R4: Capture.l1Probs         | L1ProbsSchema / CaptureSchema                                                            | packages/schema/src/  | UC-4                       |
| R5: 3 つの形の一致          | judge-request.schema.json（edge 側は detector.schema の JudgeRequest / JUDGE_QUESTIONS） | packages/schema/json/ | UC-5・UC-6                 |
| R6: 既存を壊さない          | 既存の見本・index.ts の export                                                           | packages/schema/      | UC-3c・UC-4c・UC-5c・UC-5d |

## 非機能要件

- [ ] プライバシー: `JudgeRequest` に画像・位置・識別子を入れられない（strict）。`l1Probs` は位置・識別子を運べない（ch5・ch6）
- [ ] 互換性: 凍結 API への追加だけ。`alert-contract-guard` が Critical 0
- [ ] 保守: 生成物（JSON Schema・pydantic）を手で直さない。古ければテストが落ちる
- [ ] 色・統計の数字・絵文字を使わない（型だけの feature）

## 受け入れ基準

- [ ] 受け入れテスト AC-1・AC-2 が Green
- [ ] 全 UC のテストが Green（TS・Python の両方）
- [ ] Test List の全項目にチェック
- [ ] 静的解析ゲート通過（lint / format / 型、edge の ruff）
- [ ] alert-contract-guard が Critical 0、`sfad-done.py schema-judge` が exit 0
